import { describe, it, expect } from 'vitest';
import {
  createLibraryReader, LibraryNotFound, LibraryBadRequest,
  toSlug, buildPreview, renderContextBlocks, composePersona, hiddenFromCaller,
} from '../../supabase/functions/_shared/libraryQueries';

/**
 * SQEM-373 — the access rules, after the move out of `mcp-server`.
 *
 * ⛔ **This is the test the move exists for.** The handlers were shared rather than copied precisely
 * so that "which templates may this person see" has one answer; a test that only covers the shapes
 * would not notice if the filter itself had been dropped on the way across, and a missing filter
 * looks like a feature, not like a bug.
 *
 * The client is faked rather than mocked at the module boundary because the filtering happens in
 * JavaScript, not in SQL — the queries fetch the workspace's rows and the reader decides. That is
 * exactly what is asserted here.
 */

type Rows = Record<string, any[]>;

/**
 * A chainable stand-in for the supabase client: enough of the builder to run these queries, and no
 * more. `.eq`/`.in` filter, `.single()` unwraps, `.or()` is recorded but not applied — every caller
 * passes the same vestigial `published.eq.true,kind.eq.skill` guard (SQEM-110/210) and applying it
 * would only re-test PostgREST.
 */
function fakeClient(tables: Rows, rpcs: Record<string, any[]>, blobs: Record<string, string> = {}, failFirst: Record<string, number> = {}) {
  const seen: string[] = [];
  return {
    seen,
    rpc: async (name: string, args: any) => {
      seen.push(`rpc:${name}`);
      // SQEM-500 — `library_access_sets()` mirrored from its SQL: templates from the template rule
      // (with titles), personas from the persona rule, and files = those attached to an accessible
      // template plus those the caller uploaded. ⚠️ The real SQL is exercised on staging; this fake
      // only lets the JS-side filtering be tested against the same shape.
      if (name === 'library_access_sets') {
        const accT = new Set((rpcs.mcp_accessible_template_ids ?? []).map((r: any) => r.id));
        const t = (tables.prompts ?? []).filter(p => p.workspace_id === args.p_workspace_id && accT.has(p.id));
        const files = new Set<string>();
        for (const p of t) for (const f of p.context_file_ids ?? []) files.add(f);
        for (const f of tables.workspace_files ?? []) if (f.workspace_id === args.p_workspace_id && f.created_by === args.p_user_id) files.add(f.id);
        return { data: {
          templates: t.map(p => ({ id: p.id, title: p.title })),
          personas: (rpcs.mcp_accessible_persona_ids ?? []).map((r: any) => r.id),
          files: [...files],
        }, error: null };
      }
      return { data: rpcs[name] ?? [], error: null, args };
    },
    from(table: string) {
      const filters: [string, any][] = [];
      let one = false;
      let patch: Record<string, unknown> | null = null;
      let columns = '*';
      const rows = () => {
        let out = tables[table] ?? [];
        for (const [col, val] of filters) {
          out = Array.isArray(val)
            ? out.filter(r => val.includes(r[col]))
            : val === null
              ? out.filter(r => r[col] == null)
              : out.filter(r => r[col] === val);
        }
        return out;
      };
      const b: any = {
        select: (cols?: string) => { columns = cols ?? '*'; return b; },
        order:  () => b,
        or:     () => b,
        eq: (c: string, v: any) => { filters.push([c, v]); return b; },
        in: (c: string, v: any) => { filters.push([c, v]); return b; },
        is: (c: string, v: any) => { filters.push([c, v]); return b; },
        update: (p: Record<string, unknown>) => { patch = p; return b; },
        // SQEM-500 — `workspace_file_texts` write-back; ignoreDuplicates keeps the first row.
        upsert: async (rowsIn: any[]) => {
          seen.push(`upsert:${table}:${rowsIn.map(r => r.file_id ?? r.id).join(',')}`);
          const t = (tables[table] ??= []);
          for (const r of rowsIn) if (!t.some(x => x.file_id === r.file_id)) t.push({ ...r });
          return { data: null, error: null };
        },
        single:      () => { one = true; return b; },
        maybeSingle: () => { one = true; return b; },
        then: (resolve: any) => {
          const r = rows();
          if (patch) {
            seen.push(`update:${table}:${r.map(x => x.id).join(',')}`);
            for (const x of r) Object.assign(x, patch);
            return resolve({ data: null, error: null });
          }
          seen.push(`from:${table}`);
          seen.push(`select:${table}:${columns}`);
          // PostgREST embedding of the one-to-one `workspace_file_texts(content)` (SQEM-500).
          const out = table === 'workspace_files' && columns.includes('workspace_file_texts(')
            ? r.map(x => {
                const t = (tables.workspace_file_texts ?? []).find(y => y.file_id === x.id);
                return { ...x, workspace_file_texts: t ? { content: t.content } : null };
              })
            : r;
          return resolve({ data: one ? (out[0] ?? null) : out, error: null });
        },
      };
      return b;
    },
    storage: {
      from: () => ({
        download: async (path: string) => {
          seen.push(`download:${path}`);
          // SQEM-481 — `failFirst[path]` transient failures before the download succeeds.
          if ((failFirst[path] ?? 0) > 0) {
            failFirst[path]--;
            return { data: null, error: { message: 'transient' } };
          }
          return blobs[path] !== undefined
            ? { data: { text: async () => blobs[path], arrayBuffer: async () => new ArrayBuffer(0) }, error: null }
            : { data: null, error: { message: 'not found' } };
        },
      }),
    },
  };
}

/**
 * Two templates and two personas. `open` is visible to our user; `shut` is not — it is in the
 * workspace and in every query result, and only the reader keeps it out.
 */
const WORKSPACE = 'ws-1';
const USER = 'user-1';

function build(overrides: { templates?: any[]; personas?: any[]; routes?: any[]; files?: any[]; accessibleTemplates?: string[]; accessiblePersonas?: string[]; ownFiles?: any[]; blobs?: Record<string, string>; failFirst?: Record<string, number> } = {}) {
  const templates = overrides.templates ?? [
    { id: 't-open', workspace_id: WORKSPACE, title: 'Open Brief', description: 'a brief', kind: 'prompt', content: 'body', variables: [], context_file_ids: ['f-open'] },
    { id: 't-shut', workspace_id: WORKSPACE, title: 'Shut Brief', description: 'a brief', kind: 'prompt', content: 'secret', variables: [], context_file_ids: ['f-shut'] },
  ];
  const client = fakeClient(
    {
      prompts: templates,
      personas: overrides.personas ?? [
        { id: 'p-open', workspace_id: WORKSPACE, title: 'Open Role', description: 'r', content: 'be helpful' },
      ],
      persona_templates: overrides.routes ?? [],
      workspace_files: overrides.files ?? [
        { id: 'f-open', workspace_id: WORKSPACE, name: 'open.md', mime_type: 'text/markdown', size_bytes: 10, storage_path: 'ws-1/open.md', created_by: 'someone' },
        { id: 'f-shut', workspace_id: WORKSPACE, name: 'shut.md', mime_type: 'text/markdown', size_bytes: 20, storage_path: 'ws-1/shut.md', created_by: 'someone' },
      ],
    },
    {
      mcp_accessible_template_ids: (overrides.accessibleTemplates ?? ['t-open']).map(id => ({ id })),
      mcp_accessible_persona_ids:  (overrides.accessiblePersonas  ?? ['p-open']).map(id => ({ id })),
    },
    overrides.blobs ?? { 'ws-1/open.md': '# Heading\n\ncontent', 'ws-1/shut.md': 'secret bytes' },
    overrides.failFirst ?? {},
  );
  (overrides as any)._capture?.(client);
  return createLibraryReader({ client, workspaceId: WORKSPACE, userId: USER });
}

/** Like `build`, but also hands back the fake client, for assertions on what was queried. */
async function buildWithClient(overrides: Parameters<typeof build>[0] = {}) {
  let captured: any;
  const lib = await build({ ...overrides, _capture: (c: any) => { captured = c; } } as any);
  return { lib, client: captured };
}

describe('createLibraryReader — templates', () => {
  it('⛔ a template the caller may not access is absent from the listing', async () => {
    const lib = await build();
    const list = await lib.listTemplates();
    expect(list.map(t => t.id)).toEqual(['t-open']);
  });

  it('⛔ …and from a search that would otherwise match it', async () => {
    const lib = await build();
    const hits = await lib.searchTemplates({ query: 'brief' });
    expect(hits.map(t => t.id)).toEqual(['t-open']);
  });

  it('⛔ …and cannot be opened by id either', async () => {
    // "Not found" rather than "forbidden": a distinct denial would confirm the id exists.
    const lib = await build();
    await expect(lib.getTemplate({ id: 't-shut' })).rejects.toThrow(LibraryNotFound);
    await expect(lib.getTemplate({ id: 't-shut' })).rejects.toThrow('Template not found');
  });

  it('an accessible template opens, by name slug as well as by id', async () => {
    const lib = await build();
    expect((await lib.getTemplate({ id: 't-open' })).name).toBe('open_brief');
    expect((await lib.getTemplate({ name: 'open_brief' })).id).toBe('t-open');
  });

  it('neither id nor name is a bad request, not a not-found', async () => {
    const lib = await build();
    await expect(lib.getTemplate({})).rejects.toThrow(LibraryBadRequest);
    await expect(lib.searchTemplates({ query: '' })).rejects.toThrow(LibraryBadRequest);
  });

  it('⛔ an unknown include_files mode is REJECTED, not silently defaulted', async () => {
    // A typo'd mode would look like it worked while doing the opposite of what was asked.
    const lib = await build();
    await expect(lib.getTemplate({ id: 't-open', includeFiles: 'outline' as any }))
      .rejects.toThrow(/include_files must be/);
  });

  it('⭐ include_files: "list" returns an outline, and no file text in the body', async () => {
    // The lazy-loading core: the caller sees what exists and decides per file whether to spend the
    // tokens. `inline` puts the same file into the content instead.
    const lib = await build();
    const listed = await lib.getTemplate({ id: 't-open', includeFiles: 'list' });
    expect(listed.content).not.toContain('content');
    expect(listed.content).toContain('read via sqemes://files/f-open');
    expect(listed.contextFiles[0]).toMatchObject({ name: 'open.md', byteSize: 10, preview: '# Heading' });

    const inline = await lib.getTemplate({ id: 't-open', includeFiles: 'inline' });
    expect(inline.content).toContain('# Heading');
    expect(inline.contextFiles[0]).not.toHaveProperty('preview');
  });

  it('⭐ SQEM-481 — list mode reads a STORED preview and downloads nothing', async () => {
    // The whole point of the column: a skill with 154 files costs one query, not 154 downloads.
    const { lib, client } = await buildWithClient({
      files: [{ id: 'f-open', workspace_id: WORKSPACE, name: 'open.md', mime_type: 'text/markdown', size_bytes: 10,
                storage_path: 'ws-1/open.md', created_by: 'someone', preview: '# Stored', preview_truncated: true }],
    });
    const listed = await lib.getTemplate({ id: 't-open', includeFiles: 'list' });
    expect(listed.contextFiles[0]).toMatchObject({ preview: '# Stored', previewTruncated: true });
    expect(client.seen.filter((x: string) => x.startsWith('download:'))).toEqual([]);
    expect(client.seen.filter((x: string) => x.startsWith('update:'))).toEqual([]);
  });

  it('⭐ SQEM-481 — a missing preview is computed once and written back', async () => {
    const { lib, client } = await buildWithClient();
    await lib.getTemplate({ id: 't-open', includeFiles: 'list' });
    expect(client.seen).toContain('download:ws-1/open.md');
    expect(client.seen).toContain('update:workspace_files:f-open');

    // Second listing: served from the row.
    client.seen.length = 0;
    const again = await lib.getTemplate({ id: 't-open', includeFiles: 'list' });
    expect(again.contextFiles[0]).toMatchObject({ preview: '# Heading', previewTruncated: false });
    expect(client.seen.filter((x: string) => x.startsWith('download:'))).toEqual([]);
  });

  it('⛔ SQEM-481 — a binary never gets a preview and is never downloaded in list mode', async () => {
    const { lib, client } = await buildWithClient({
      files: [{ id: 'f-open', workspace_id: WORKSPACE, name: 'a.pdf', mime_type: 'application/pdf', size_bytes: 99,
                storage_path: 'ws-1/a.pdf', created_by: 'someone' }],
    });
    const listed = await lib.getTemplate({ id: 't-open', includeFiles: 'list' });
    expect(listed.contextFiles[0]).not.toHaveProperty('preview');
    expect(client.seen.filter((x: string) => x.startsWith('download:') || x.startsWith('update:'))).toEqual([]);
  });

  it('⛔ SQEM-481 — a closed template\'s body is never even fetched', async () => {
    // getTemplate now resolves the id first and fetches one row with content only after the access
    // check. The old shape fetched every body in the workspace and filtered in memory.
    const { lib, client } = await buildWithClient();
    client.seen.length = 0;
    await expect(lib.getTemplate({ name: 'shut_brief' })).rejects.toThrow(LibraryNotFound);
    expect(client.seen.filter((x: string) => x.startsWith('select:prompts:') && x.includes('content'))).toEqual([]);
  });

  it('⛔ SQEM-481 — a download that fails once is retried, and the file still comes back inline', async () => {
    // Measured on production after Promotion (45): concurrent downloads failed sporadically and the
    // file silently degraded to a reference. One transient failure must not cost the caller the text.
    const { lib, client } = await buildWithClient({ failFirst: { 'ws-1/open.md': 1 } });
    const inline = await lib.getTemplate({ id: 't-open', includeFiles: 'inline' });
    expect(inline.content).toContain('[Context: open.md]\n# Heading');
    expect(client.seen.filter((x: string) => x === 'download:ws-1/open.md')).toHaveLength(2);
  });

  it('⛔ SQEM-481 — a download that keeps failing falls back to a reference AND is logged', async () => {
    const errors: string[] = [];
    const orig = console.error;
    console.error = (...a: unknown[]) => { errors.push(a.join(' ')); };
    try {
      const { lib, client } = await buildWithClient({ failFirst: { 'ws-1/open.md': 99 } });
      const inline = await lib.getTemplate({ id: 't-open', includeFiles: 'inline' });
      expect(inline.content).toContain('read via sqemes://files/f-open');
      expect(client.seen.filter((x: string) => x === 'download:ws-1/open.md')).toHaveLength(3);
      expect(errors.some(e => /1 of 1 context file downloads failed/.test(e))).toBe(true);
    } finally {
      console.error = orig;
    }
  });

  it('⭐ SQEM-500 — the reader builds its access sets in ONE database call', async () => {
    // Under load every request queued for PostgREST; four lookups per call became one.
    const { client } = await buildWithClient();
    expect(client.seen).toEqual(['rpc:library_access_sets']);
  });

  it('⭐ SQEM-500 — get_template by name costs no extra titles query', async () => {
    const { lib, client } = await buildWithClient();
    client.seen.length = 0;
    expect((await lib.getTemplate({ name: 'open_brief' })).id).toBe('t-open');
    expect(client.seen.filter((x: string) => x.startsWith('select:prompts:'))).toHaveLength(1);
  });

  it('⭐ SQEM-500 — inline stores a downloaded text once, then reads it without storage', async () => {
    const { lib, client } = await buildWithClient();
    client.seen.length = 0;
    await lib.getTemplate({ id: 't-open', includeFiles: 'inline' }); // downloads + stores
    expect(client.seen).toContain('download:ws-1/open.md');
    expect(client.seen).toContain('upsert:workspace_file_texts:f-open');
    client.seen.length = 0;
    const again = await lib.getTemplate({ id: 't-open', includeFiles: 'inline' });
    expect(again.content).toContain('[Context: open.md]\n# Heading');
    expect(client.seen.filter((x: string) => x.startsWith('download:'))).toEqual([]);
  });

  it('SQEM-500 — list mode with a missing preview uses a stored text instead of downloading', async () => {
    const { lib, client } = await buildWithClient();
    await lib.getTemplate({ id: 't-open', includeFiles: 'inline' }); // stores the text, no preview yet
    client.seen.length = 0;
    const listed = await lib.getTemplate({ id: 't-open', includeFiles: 'list' });
    expect(listed.contextFiles[0]).toMatchObject({ preview: '# Heading' });
    expect(client.seen.filter((x: string) => x.startsWith('download:'))).toEqual([]);
    expect(client.seen).toContain('update:workspace_files:f-open'); // the preview is still written back
  });

  it('SQEM-500 — read_context_file answers a text file from the store after the first read', async () => {
    const { lib, client } = await buildWithClient();
    expect((await lib.readContextFile('sqemes://files/f-open')).text).toBe('# Heading\n\ncontent');
    expect(client.seen).toContain('upsert:workspace_file_texts:f-open');
    client.seen.length = 0;
    expect((await lib.readContextFile('f-open')).text).toBe('# Heading\n\ncontent');
    expect(client.seen.filter((x: string) => x.startsWith('download:'))).toEqual([]);
  });

  it('SQEM-481 — inline mode still carries the full text and ignores a stored preview', async () => {
    const lib = await build({
      files: [{ id: 'f-open', workspace_id: WORKSPACE, name: 'open.md', mime_type: 'text/markdown', size_bytes: 10,
                storage_path: 'ws-1/open.md', created_by: 'someone', preview: '# Stored', preview_truncated: false }],
    });
    const inline = await lib.getTemplate({ id: 't-open', includeFiles: 'inline' });
    expect(inline.content).toContain('[Context: open.md]\n# Heading\n\ncontent');
    expect(inline.content).not.toContain('# Stored');
  });

  it('SQEM-232 — a listing reports each template\'s OWN files, not the workspace total', async () => {
    // ⚠️ Deliberately not phrased as "stats are computed after the access filter". They are — but a
    // mutation that moves the call before the filter is not caught by any assertion, because the
    // output maps over the visible set and an inaccessible template's entry is never read. The
    // placement is a cost decision (one fewer row set to size), not the thing that keeps the number
    // out of the answer. What IS worth pinning: the count belongs to the template, so the second
    // template's 20 bytes must not appear here.
    const lib = await build();
    const [only] = await lib.listTemplates();
    expect(only).toMatchObject({ contextFileCount: 1, contextBytes: 10 });
  });

  it('a template with no files reports no counts at all', async () => {
    const lib = await build({
      templates: [{ id: 't-open', workspace_id: WORKSPACE, title: 'Bare', description: '', kind: 'skill', content: '', variables: [], context_file_ids: [] }],
    });
    const [only] = await lib.listTemplates();
    expect(only).not.toHaveProperty('contextFileCount');
  });
});

describe('createLibraryReader — files (SQEM-291)', () => {
  it('⛔ a file attached only to an inaccessible template cannot be read', async () => {
    // Enumeration is the sharper half of this: a file name alone can be the disclosure.
    const lib = await build();
    expect(lib.canAccessFile('f-open')).toBe(true);
    expect(lib.canAccessFile('f-shut')).toBe(false);
    await expect(lib.readContextFile('sqemes://files/f-shut')).rejects.toThrow(LibraryNotFound);
  });

  it("⭐ …but a file the caller uploaded themselves is always theirs to read", async () => {
    // Mirrors `can_access_file()`: the uploader clause. Without it, attaching your own file to a
    // template someone later restricted would lock you out of your own upload.
    const lib = await build({
      files: [{ id: 'f-mine', workspace_id: WORKSPACE, name: 'mine.txt', mime_type: 'text/plain', size_bytes: 4, storage_path: 'ws-1/mine.txt', created_by: USER }],
      blobs: { 'ws-1/mine.txt': 'mine' },
    });
    expect(lib.canAccessFile('f-mine')).toBe(true);
    expect((await lib.readContextFile('f-mine')).text).toBe('mine');
  });

  it('⛔ SQEM-492 — a file whose storage path is outside the workspace is never downloaded', async () => {
    // The row is the caller's own and accessible; only its path points elsewhere. The constraint
    // `workspace_files_path_in_workspace` keeps such rows out of the table — this is the second line.
    const lib = await build({
      files: [{ id: 'f-mine', workspace_id: WORKSPACE, name: 'mine.txt', mime_type: 'text/plain', size_bytes: 4, storage_path: 'ws-2/other.txt', created_by: USER }],
      blobs: { 'ws-2/other.txt': 'not yours' },
    });
    await expect(lib.readContextFile('f-mine')).rejects.toThrow(LibraryNotFound);
  });

  it('accepts a bare id as well as a uri', async () => {
    const lib = await build();
    expect((await lib.readContextFile('f-open')).uri).toBe('sqemes://files/f-open');
  });

  it('an empty reference is not found rather than a crash', async () => {
    const lib = await build();
    await expect(lib.readContextFile('')).rejects.toThrow(LibraryNotFound);
  });
});

describe('createLibraryReader — personas (SQEM-324/326)', () => {
  const persona = { id: 'p-open', workspace_id: WORKSPACE, title: 'Open Role', description: 'r', content: 'be helpful' };

  it('⛔ a route to a template the caller cannot open is OMITTED, not marked unavailable', async () => {
    // A model that sees a route it cannot fetch does not skip it, it invents the contents.
    const lib = await build({
      personas: [persona],
      routes: [
        { persona_id: 'p-open', template_id: 't-open', condition: 'drafting', sort_order: 1, prompts: { title: 'Open Brief', kind: 'prompt', description: 'a brief' } },
        { persona_id: 'p-open', template_id: 't-shut', condition: 'secret work', sort_order: 2, prompts: { title: 'Shut Brief', kind: 'prompt', description: 'hidden' } },
      ],
    });
    const { text, routeCount } = await lib.getPersona({ name: 'open_role' });
    expect(routeCount).toBe(1);
    expect(text).toContain('drafting');
    expect(text).not.toContain('secret work');
    expect(text).not.toContain('Shut Brief');
  });

  it('⛔ the route filter is template access, NOT the persona\'s own', async () => {
    // Filtering on the persona would hand out its author's reach along with it — a permission grant
    // by attachment.
    const lib = await build({
      personas: [persona],
      routes: [{ persona_id: 'p-open', template_id: 't-shut', condition: 'x', sort_order: 1, prompts: { title: 'Shut Brief', kind: 'prompt', description: 'hidden' } }],
      accessiblePersonas: ['p-open'],
    });
    // Every route is out of reach ⇒ the persona is not offered at all (SQEM-326).
    await expect(lib.getPersona({ name: 'open_role' })).rejects.toThrow('Persona not found');
    expect(await lib.listPersonas()).toEqual([]);
  });

  it('⭐ a persona with NO routes is still offered — it is a role description', async () => {
    // Its author knows it is empty. That is different from one advertising seven routes it cannot
    // deliver.
    const lib = await build({ personas: [persona], routes: [] });
    const listed = await lib.listPersonas();
    expect(listed).toEqual([{ id: 'p-open', name: 'open_role', title: 'Open Role', description: 'r', routeCount: 0 }]);
    expect((await lib.getPersona({ id: 'p-open' })).text).toContain('no routes available to you');
  });

  it('an inaccessible persona is not found', async () => {
    const lib = await build({ personas: [persona], accessiblePersonas: [] });
    await expect(lib.getPersona({ id: 'p-open' })).rejects.toThrow(LibraryNotFound);
  });
});

describe('the pure helpers, moved with their behaviour intact', () => {
  it('toSlug', () => {
    expect(toSlug('Open Brief!')).toBe('open_brief');
    expect(toSlug('  --Ähm 42--  ')).toBe('hm_42');
  });

  it('buildPreview prefers a markdown outline, and falls back when there is none', () => {
    expect(buildPreview('# A\ntext\n## B\n', 'text/markdown').preview).toBe('# A\n## B');
    // A markdown file with no h1/h2 is an unstructured note; an empty outline would be useless.
    expect(buildPreview('just a note', 'text/markdown').preview).toBe('just a note');
    expect(buildPreview('x'.repeat(600), 'text/plain').truncated).toBe(true);
  });

  it('renderContextBlocks inlines text only in inline mode', () => {
    const files = [{ name: 'a.md', mimeType: 'text/markdown', uri: 'u', text: 'body' }];
    expect(renderContextBlocks(files, 'inline')[0]).toBe('[Context: a.md]\nbody');
    expect(renderContextBlocks(files, 'list')[0]).toContain('read via u');
    // A binary is by reference in BOTH modes.
    expect(renderContextBlocks([{ name: 'a.pdf', mimeType: 'application/pdf', uri: 'u', text: null }], 'inline')[0])
      .toContain('read via u');
  });

  it('composePersona falls back to the description when a condition is empty', () => {
    // ⛔ Not to a stub. SQEM-324 shipped with `the task matches "<title>"`, which carries nothing the
    // title did not already carry.
    const text = composePersona(
      { title: 'Role', description: '', content: '' },
      [{ name: 'brief', title: 'Brief', kind: 'prompt', condition: '', description: 'when drafting' }],
    );
    expect(text).toContain('| when drafting |');
    expect(text).toContain('get_template(name: "brief")');
  });

  it('hiddenFromCaller only fires when there ARE routes and none survive', () => {
    expect(hiddenFromCaller({ total: 3, visible: 0 })).toBe(true);
    expect(hiddenFromCaller({ total: 0, visible: 0 })).toBe(false);
    expect(hiddenFromCaller({ total: 3, visible: 1 })).toBe(false);
    expect(hiddenFromCaller(undefined)).toBe(false);
  });
});

describe('SQEM-499 — progressive disclosure: read by path, assets are resources', () => {
  const skillFiles = [
    { id: 'f-ref', workspace_id: WORKSPACE, name: 'my-skill/references/animation.md', mime_type: 'text/markdown', size_bytes: 9, storage_path: 'ws-1/ref.md', created_by: 'someone' },
    { id: 'f-asset', workspace_id: WORKSPACE, name: 'my-skill/assets/template.html', mime_type: 'text/html', size_bytes: 99, storage_path: 'ws-1/asset.html', created_by: 'someone' },
    { id: 'f-n1', workspace_id: WORKSPACE, name: 'a/notes.md', mime_type: 'text/markdown', size_bytes: 1, storage_path: 'ws-1/n1.md', created_by: 'someone' },
    { id: 'f-n2', workspace_id: WORKSPACE, name: 'b/notes.md', mime_type: 'text/markdown', size_bytes: 1, storage_path: 'ws-1/n2.md', created_by: 'someone' },
    { id: 'f-other', workspace_id: WORKSPACE, name: 'my-skill/references/secret.md', mime_type: 'text/markdown', size_bytes: 1, storage_path: 'ws-1/secret.md', created_by: 'someone' },
  ];
  const templates = [
    { id: 't-skill', workspace_id: WORKSPACE, title: 'My Skill', description: '', kind: 'skill', content: 'SKILL', variables: [], context_file_ids: ['f-ref', 'f-asset', 'f-n1', 'f-n2'] },
    { id: 't-hidden', workspace_id: WORKSPACE, title: 'Hidden Skill', description: '', kind: 'skill', content: 'x', variables: [], context_file_ids: ['f-other'] },
  ];
  const blobs = { 'ws-1/ref.md': '# Animation', 'ws-1/asset.html': '<html>big</html>', 'ws-1/n1.md': 'one', 'ws-1/n2.md': 'two', 'ws-1/secret.md': 'secret' };
  const make = () => buildWithClient({ templates, files: skillFiles, blobs, accessibleTemplates: ['t-skill'] });

  it('reads a file by the path SKILL.md uses, with the skill folder stored in front', async () => {
    const { lib } = await make();
    const f = await lib.readContextFileByPath({ name: 'my_skill', path: 'references/animation.md' });
    expect(f.text).toBe('# Animation');
  });

  it('⛔ a path is resolved among THIS playbook\'s files only — another playbook\'s file is not found', async () => {
    const { lib } = await make();
    await expect(lib.readContextFileByPath({ name: 'my_skill', path: 'references/secret.md' })).rejects.toThrow(LibraryNotFound);
  });

  it('⛔ a playbook the caller cannot see answers not found, whatever the path', async () => {
    const { lib } = await make();
    await expect(lib.readContextFileByPath({ name: 'hidden_skill', path: 'references/secret.md' })).rejects.toThrow(LibraryNotFound);
  });

  it('an ambiguous path names the candidates instead of guessing', async () => {
    const { lib } = await make();
    await expect(lib.readContextFileByPath({ name: 'my_skill', path: 'notes.md' })).rejects.toThrow(/a\/notes\.md, b\/notes\.md/);
    await expect(lib.readContextFileByPath({ name: 'my_skill', path: 'notes.md' })).rejects.toThrow(LibraryBadRequest);
  });

  it('a missing path lists what the playbook does have — context files before assets', async () => {
    const { lib } = await make();
    await expect(lib.readContextFileByPath({ name: 'my_skill', path: 'nope.md' })).rejects.toThrow(/Its files: a\/notes\.md, b\/notes\.md, my-skill\/references\/animation\.md, my-skill\/assets\/template\.html/);
  });

  it('asking for SKILL.md points at get_template — it is the playbook itself, not a file', async () => {
    const { lib } = await make();
    await expect(lib.readContextFileByPath({ name: 'my_skill', path: 'SKILL.md' })).rejects.toThrow(/own content — it comes back from get_template/);
  });

  it('⛔ assets/ files are never inlined, previewed or downloaded by get_template — but readable on demand', async () => {
    const { lib, client } = await make();
    const inline = await lib.getTemplate({ id: 't-skill', includeFiles: 'inline' });
    expect(inline.content).not.toContain('<html>big</html>');
    expect(inline.content).toContain('[Context file: my-skill/assets/template.html');
    const list = await lib.getTemplate({ id: 't-skill', includeFiles: 'list' });
    const asset = list.contextFiles.find((f: any) => f.name === 'my-skill/assets/template.html') as any;
    expect(asset).toBeDefined();
    expect(asset.preview).toBeUndefined();
    expect(asset.byteSize).toBe(99);
    expect(client.seen.filter((x: string) => x === 'download:ws-1/asset.html')).toEqual([]);
    const read = await lib.readContextFileByPath({ id: 't-skill', path: 'assets/template.html' });
    expect(read.text).toBe('<html>big</html>');
  });

  it('⭐ the default follows the KIND: a skill comes back as an outline, a prompt with its files in full', async () => {
    const tpls = [
      { id: 't-sk', workspace_id: WORKSPACE, title: 'A Skill', description: '', kind: 'skill', content: 'S', variables: [], context_file_ids: ['f-ref'] },
      { id: 't-pr', workspace_id: WORKSPACE, title: 'A Prompt', description: '', kind: 'prompt', content: 'P', variables: [], context_file_ids: ['f-ref'] },
    ];
    const { lib } = await buildWithClient({ templates: tpls, files: skillFiles, blobs, accessibleTemplates: ['t-sk', 't-pr'] });
    const skill = await lib.getTemplate({ id: 't-sk', includeFiles: 'auto' });
    expect(skill.content).not.toContain('# Animation');
    expect((skill.contextFiles[0] as any).byteSize).toBe(9);
    const prompt = await lib.getTemplate({ id: 't-pr', includeFiles: 'auto' });
    expect(prompt.content).toContain('[Context: my-skill/references/animation.md]\n# Animation');
    // An explicit choice still wins over the kind.
    const forced = await lib.getTemplate({ id: 't-pr', includeFiles: 'list' });
    expect(forced.content).not.toContain('# Animation');
  });

  it('⛔ an outline carries ONE note saying how to get the text — also for a client whose cached tool list predates read_context_file', async () => {
    const files = [
      { name: 'references/x.md', mimeType: 'text/markdown', uri: 'sqemes://files/1', text: null },
      { name: 'references/y.md', mimeType: 'text/markdown', uri: 'sqemes://files/2', text: null },
    ];
    const out = renderContextBlocks(files, 'list');
    expect(out).toHaveLength(3);
    expect(out[0]).toContain('read_context_file');
    expect(out[0]).toContain('include_files: "inline"');
    expect(out.slice(1).every(l => !l.includes('read_context_file'))).toBe(true);
    // No note when nothing textual is left out (binaries only), and never in inline mode.
    expect(renderContextBlocks([{ name: 'a.pdf', mimeType: 'application/pdf', uri: 'u', text: null }], 'list')).toEqual(['[Context file: a.pdf (application/pdf) — read via u]']);
    expect(renderContextBlocks([{ name: 'a.md', mimeType: 'text/markdown', uri: 'u', text: 'x' }], 'inline')).toEqual(['[Context: a.md]\nx']);
  });
});


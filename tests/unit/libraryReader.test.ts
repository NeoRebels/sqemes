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
function fakeClient(tables: Rows, rpcs: Record<string, any[]>, blobs: Record<string, string> = {}) {
  const seen: string[] = [];
  return {
    seen,
    rpc: async (name: string, args: any) => {
      seen.push(`rpc:${name}`);
      return { data: rpcs[name] ?? [], error: null, args };
    },
    from(table: string) {
      const filters: [string, any][] = [];
      let one = false;
      const rows = () => {
        let out = tables[table] ?? [];
        for (const [col, val] of filters) {
          out = Array.isArray(val)
            ? out.filter(r => val.includes(r[col]))
            : out.filter(r => r[col] === val);
        }
        return out;
      };
      const b: any = {
        select: () => b,
        order:  () => b,
        or:     () => b,
        eq: (c: string, v: any) => { filters.push([c, v]); return b; },
        in: (c: string, v: any) => { filters.push([c, v]); return b; },
        single:      () => { one = true; return b; },
        maybeSingle: () => { one = true; return b; },
        then: (resolve: any) => {
          seen.push(`from:${table}`);
          const r = rows();
          return resolve({ data: one ? (r[0] ?? null) : r, error: null });
        },
      };
      return b;
    },
    storage: {
      from: () => ({
        download: async (path: string) => blobs[path] !== undefined
          ? { data: { text: async () => blobs[path], arrayBuffer: async () => new ArrayBuffer(0) }, error: null }
          : { data: null, error: { message: 'not found' } },
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

function build(overrides: { templates?: any[]; personas?: any[]; routes?: any[]; files?: any[]; accessibleTemplates?: string[]; accessiblePersonas?: string[]; ownFiles?: any[]; blobs?: Record<string, string> } = {}) {
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
        { id: 'f-open', workspace_id: WORKSPACE, name: 'open.md', mime_type: 'text/markdown', size_bytes: 10, storage_path: 'p/open.md', created_by: 'someone' },
        { id: 'f-shut', workspace_id: WORKSPACE, name: 'shut.md', mime_type: 'text/markdown', size_bytes: 20, storage_path: 'p/shut.md', created_by: 'someone' },
      ],
    },
    {
      mcp_accessible_template_ids: (overrides.accessibleTemplates ?? ['t-open']).map(id => ({ id })),
      mcp_accessible_persona_ids:  (overrides.accessiblePersonas  ?? ['p-open']).map(id => ({ id })),
    },
    overrides.blobs ?? { 'p/open.md': '# Heading\n\ncontent', 'p/shut.md': 'secret bytes' },
  );
  return createLibraryReader({ client, workspaceId: WORKSPACE, userId: USER });
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
      files: [{ id: 'f-mine', workspace_id: WORKSPACE, name: 'mine.txt', mime_type: 'text/plain', size_bytes: 4, storage_path: 'p/mine.txt', created_by: USER }],
      blobs: { 'p/mine.txt': 'mine' },
    });
    expect(lib.canAccessFile('f-mine')).toBe(true);
    expect((await lib.readContextFile('f-mine')).text).toBe('mine');
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

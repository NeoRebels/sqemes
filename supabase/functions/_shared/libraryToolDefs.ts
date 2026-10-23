/**
 * SQEM-561 — what each library tool is (`LIBRARY_TOOL_DEFS`, as MCP advertises it) and which right it
 * needs (`TOOL_CAPABILITY`). Import-free on purpose: `_shared/libraryActions.ts` (the handlers) pulls
 * in npm: and jsr: specifiers that vitest cannot load, and both the tests and Chat's adapter
 * (`_shared/libraryTools.ts`) need these two tables, not the handlers.
 */

// ---- Which right each tool needs (SQEM-064) ----
// Each tool requires a capability; a connection grants a subset (MCP), a role grants writing (both).
export type Capability = 'read' | 'create' | 'update' | 'delete';

export const TOOL_CAPABILITY: Record<string, Capability> = {
  list_templates:    'read',
  search_templates:  'read',
  get_template:      'read',
  read_context_file: 'read', // SQEM-499
  download_skill:    'read', // SQEM-514 — links, not bytes; same right as reading the files
  list_files:        'read',
  create_template:   'create',
  import_skill_from_url: 'create',
  upload_file:       'create',
  create_upload_url: 'create',
  finalize_upload:   'create',
  update_template:   'update',
  delete_template:   'delete',
  delete_file:       'delete',
  // SQEM-332 — these two were missing, and the omission failed in **both** directions at once:
  // `tools/list` filters on `scopes.includes(TOOL_CAPABILITY[name])`, so an unmapped tool is never
  // advertised, while `tools/call` guarded with `if (requiredCap && …)`, so an unmapped tool skipped
  // the check entirely. Invisible and ungated from one missing line.
  list_personas:     'read',
  get_persona:       'read',
  // SQEM-337 — the write half personas never had. They are MCP-only
  // (`pm/VISION.md` in the source repository), so read-only tooling left the one object that exists
  // nowhere else as the only one you could not edit where it lives. ⚠️ Adding a tool means adding it HERE and to the `tools/list` array — that pairing is
  // what SQEM-332 cost, and `tests/unit/mcpToolCapability.test.ts` now fails if one half is missed.
  create_persona:    'create',
  update_persona:    'update',
  delete_persona:    'delete',
  // SQEM-338 — the routes. Both are `update` on the PERSONA, not `create`/`delete` of their own:
  // a route has no life outside the role it belongs to, and treating an attach as a creation would
  // let a `create`-only connection reshape a persona it may not otherwise touch.
  attach_template:   'update',
  detach_template:   'update',
};

/**
 * The tool definitions as MCP advertises them (`tools/list`). Chat derives its own from these
 * (`_shared/libraryTools.ts`), so a description is written once.
 * ⚠️ Adding a tool means adding it here AND to `TOOL_CAPABILITY` — `tests/unit/mcpToolCapability.test.ts`.
 */
export const LIBRARY_TOOL_DEFS = [
  {
    name: 'list_templates',
    title: 'List playbooks',
    description: 'Browse every published template in the workspace (prompts and skills) with id, name, kind and description. Use this to see what reusable templates exist before composing something from scratch, or to find a template\'s id/name to pass to get_template. For a targeted lookup by keyword use search_templates instead. Optionally filter by kind.\n\nTemplates with attached context files also report "contextFileCount" and "contextBytes" (absent when there are none). Use them to decide HOW to load the template: when a template has several files or a large total, call get_template with include_files: "list" — you then get each file\'s name, size and a preview instead of its full text, and read only the ones you need via resources/read. For one small file, the default is fine.',
    inputSchema: {
      type: 'object',
      properties: {
        kind: {
          type: 'string',
          enum: ['prompt', 'skill', 'all'],
          description: 'Filter by template kind. Defaults to all.',
        },
      },
    },
  },
  {
    name: 'search_templates',
    title: 'Search playbooks',
    description: 'Find a workspace template by keyword (matches title and description). Useful when the user wants to use, find or check one of their team\'s playbooks, or when the task is one their team keeps a playbook for — a matching prompt or skill can then be used instead of composing from scratch. Returns matching templates with their id and name — pass one to get_template to load its full content. Optionally filter by kind.\n\nMatches with attached context files also report "contextFileCount" and "contextBytes" (absent when there are none). Use them to decide HOW to load the template: when a template has several files or a large total, call get_template with include_files: "list" — you then get each file\'s name, size and a preview instead of its full text, and read only the ones you need via resources/read. For one small file, the default is fine.',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Keyword to search for' },
        kind: {
          type: 'string',
          enum: ['prompt', 'skill'],
          description: 'Optional kind filter',
        },
      },
      required: ['query'],
    },
  },
  {
    name: 'list_personas',
    title: 'List personas',
    description: 'List the workspace\'s personas. A PERSONA is a working role — a general instruction plus conditions saying which template to load when. Use it when the user names a persona ("use the Sales persona from sqemes", "load persona X"), or when a task clearly belongs to a role the workspace has defined. Returns id, name, description and how many routes each one currently offers you.\n\nA persona is not a template and cannot be fetched with get_template; call get_persona.',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'get_persona',
    title: 'Load persona',
    description: 'Load a persona by name or id — a working role with its rules and its routes. Returns markdown: the role and its rules, plus a table of ROUTES — each a condition and the exact get_template call to make when that condition applies.\n\n⚠️ Load a route only when its condition actually applies, and only that one. The routes are deliberately NOT included up front: the persona is small, the templates behind it are not, and fetching them all defeats the purpose.\n\nRoutes you cannot access are already omitted — what you receive is what you may load. If the persona lists no routes, work from the role description and say so if asked for more.',
    inputSchema: {
      type: 'object',
      properties: {
        id:   { type: 'string', description: 'UUID of the persona (from list_personas)' },
        name: { type: 'string', description: 'Slug name of the persona (from list_personas)' },
      },
    },
  },
  {
    name: 'create_persona',
    title: 'Create persona',
    description: 'Create a persona — a standing working role the workspace can adopt: who this role is, how it works, what it refuses.\n\nWRITE THE ROLE, NOT THE ROUTING. A persona holds prose only; which template applies when lives in its routes, attached separately. Do not list templates in the content — a routing table written into the prose goes stale the moment a template is renamed, and nothing corrects it.\n\nA persona is not a template: it has no {{variables}}, no context files, and its text is never sent to a model as a task. Use create_template for those.\n\nNew personas are visible to the whole workspace. That is deliberate and not a gap: a caller only ever receives the routes they already have access to, so an open persona grants nothing.',
    inputSchema: {
      type: 'object',
      properties: {
        title:       { type: 'string', description: 'Name of the role, e.g. "Sales Engineer"' },
        description: { type: 'string', description: 'One line on when to reach for this persona — this is what list_personas shows' },
        content:     { type: 'string', description: 'The role itself: instructions, working style, rules. Markdown. No routing table.' },
        tags:        { type: 'array', items: { type: 'string' }, description: 'Optional tags' },
      },
      required: ['title'],
    },
  },
  {
    name: 'update_persona',
    title: 'Update persona',
    description: 'Change a persona\'s title, description, content or tags. Only the fields you pass are touched; the rest stay as they are, and its routes are never affected.\n\nCall get_persona first if you are editing text you did not just write — this overwrites, it does not merge.\n\nRequires that you created the persona, or that you are an editor or admin: a persona is a shared role, so rewriting it changes it for everyone who uses it.',
    inputSchema: {
      type: 'object',
      properties: {
        id:          { type: 'string', description: 'UUID of the persona (from list_personas)' },
        title:       { type: 'string' },
        description: { type: 'string' },
        content:     { type: 'string', description: 'Replaces the role text entirely. No routing table.' },
        tags:        { type: 'array', items: { type: 'string' } },
      },
      required: ['id'],
    },
  },
  {
    name: 'delete_persona',
    title: 'Delete persona',
    description: 'Delete a persona and its routes. The templates it pointed at are NOT deleted — only the role and its routing.\n\nRequires that you created the persona, or that you are an editor or admin of the workspace.',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'UUID of the persona (from list_personas)' },
      },
      required: ['id'],
    },
  },
  {
    name: 'attach_template',
    title: 'Attach playbook to persona',
    description: 'Add a route to a persona: which template to load, and the condition that says when.\n\nTHE CONDITION IS THE POINT, which is why it is required. It answers what this template means IN THIS persona — the same template plays different parts in different roles, and its own description cannot say that. Write the situation ("the customer asks for a written quote"), not a restatement of the title.\n\nAttaching grants nobody any access. A colleague only ever receives routes they could already open, so attaching a restricted template gives a persona that is quietly smaller for them. The reply tells you when that is the case — pass it on.\n\nRe-attaching a template already on the persona updates its condition rather than failing.',
    inputSchema: {
      type: 'object',
      properties: {
        persona_id:  { type: 'string', description: 'UUID of the persona (from list_personas)' },
        template_id: { type: 'string', description: 'UUID of the template (from list_templates or search_templates)' },
        condition:   { type: 'string', description: 'When this route applies, in the persona\'s own terms. Required.' },
        sort_order:  { type: 'number', description: 'Optional position; appended to the end when omitted' },
      },
      required: ['persona_id', 'template_id', 'condition'],
    },
  },
  {
    name: 'detach_template',
    title: 'Detach playbook from persona',
    description: 'Remove a route from a persona. The template itself is untouched — only the route disappears.\n\nRequires that you created the persona, or that you are an editor or admin of the workspace.',
    inputSchema: {
      type: 'object',
      properties: {
        persona_id:  { type: 'string', description: 'UUID of the persona (from list_personas)' },
        template_id: { type: 'string', description: 'UUID of the template whose route should be removed' },
      },
      required: ['persona_id', 'template_id'],
    },
  },
  {
    name: 'get_template',
    title: 'Load playbook',
    description: 'Load a template\'s full content, variables, and metadata so you can actually use it — e.g. a template found via search_templates or list_templates — by id or name slug. Works for both kinds (prompt or skill). A skill\'s context files come back as an outline by default: each entry in "contextFiles" has its name (a path inside the skill, e.g. references/x.md), uri, mimeType, byteSize and, for text, a preview (markdown gets its heading outline). Read only the files the task needs with read_context_file. Files under assets/ or scripts/ are resources, listed without a preview. A prompt comes back with its text files in full, because they are part of the task. include_files overrides either default. Use this to inspect a template before updating it, or to consume a skill\'s knowledge.',
    inputSchema: {
      type: 'object',
      properties: {
        id:   { type: 'string', description: 'UUID of the template (from list_templates or search_templates)' },
        name: { type: 'string', description: 'Slug name of the template (from list_templates or search_templates)' },
        include_files: {
          type: 'string',
          enum: ['list', 'inline'],
          description: 'How to return TEXT context files. Default: "list" for a skill, "inline" for a prompt. "list" returns an outline: name, uri, mimeType, byteSize and a preview per file, with no file content in the body — then read what you need with read_context_file. "inline" puts the full text of every text file into the template content; use it only when you need all of them anyway.',
        },
      },
    },
  },
  {
    name: 'read_context_file',
    title: 'Read playbook file',
    description: 'Read one context file of a template — after get_template has shown which files exist and what is in them. A file to read (text outside assets/ and scripts/) comes back as text; a file to use (scripts/, assets/, any binary) comes back as a download link valid 15 minutes — pass as: "text" or as: "file" for the other. Address it either by its "uri" from get_template\'s contextFiles, or by "template" (name slug or id) plus "path" — the path inside the skill exactly as SKILL.md writes it (e.g. references/animation.md). Read only the files the task actually needs.\n\nDocs: https://help.sqemes.com/en/articles/54-how-do-i-connect-sqemes-to-claude-desktop-or-another-mcp-client',
    inputSchema: {
      type: 'object',
      properties: {
        uri:      { type: 'string', description: 'The file uri from a template\'s contextFiles entry (sqemes://files/<id>).' },
        template: { type: 'string', description: 'The template\'s name slug (or id), when addressing the file by path.' },
        path:     { type: 'string', description: 'The file\'s path inside the skill, e.g. references/animation.md. Use together with template.' },
        as:       { type: 'string', enum: ['text', 'file'], description: 'Optional. "text" returns the content even for scripts/ and assets/; "file" returns a download link even for a text file.' },
      },
    },
  },
  {
    name: 'download_skill',
    title: 'Download skill',
    description: 'Get a whole skill as the folder it is — to INSTALL it in an agent that runs skills (Claude Code, Codex, a sandbox). Returns SKILL.md as text plus every other file with its path, size and a download link (valid 15 minutes, no auth needed). Create the skill folder, write SKILL.md, then fetch each link to its path. To USE a skill in this conversation, call get_template instead.',
    inputSchema: {
      type: 'object',
      properties: {
        template: { type: 'string', description: 'The skill\'s name slug or id.' },
      },
      required: ['template'],
    },
  },
  {
    name: 'list_files',
    title: 'List files',
    description: 'List all workspace files with their IDs. Use file IDs with create_template or update_template to attach context files to a template.\n\nA name may be a relative path (references/type-bar.md) — that file sits in a folder, and the prefix is part of its name, not decoration.',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'create_template',
    title: 'Create playbook',
    description: 'Create a new template (prompt or skill) in the workspace. A prompt is a task with {{variables}}; a skill is a block of knowledge applied when it fits. For a ROLE — who to be, and which template to load when — create a persona instead (create_persona).\n\nVariables (kind=prompt only): pass a "variables" array of {name, label?, type?} objects. Alternatively, write {{variable_name}} placeholders in content and they are auto-extracted. "type" can be "text" (default) or "textarea" for longer inputs.\nExample: [{"name":"draft","label":"Email Draft","type":"textarea"},{"name":"tone","type":"text"}]\n\nContext files: pass "file_ids" (array of UUIDs from list_files) to attach workspace files as context.\n\nAgent Skills (kind=skill): a skill is a FOLDER, and sqemes holds it whole. Put the SKILL.md body in "content", its frontmatter title/description in "title"/"description", and upload EVERY other file in the folder via upload_file under its relative path (references/…, scripts/…, assets/…), then attach them all through file_ids. Uploading only the SKILL.md leaves a skill that describes files nobody has.\n\nWho can see it: the new template follows the workspace default — open to everyone, or restricted to you if the workspace starts new templates restricted. Change it per template in the sqemes app.',
    inputSchema: {
      type: 'object',
      properties: {
        kind:               { type: 'string', enum: ['prompt', 'skill'], description: 'Template kind' },
        title:              { type: 'string', description: 'Human-readable display name' },
        content:            { type: 'string', description: 'Template body. For kind=prompt, write {{variable_name}} placeholders for user inputs.' },
        description:        { type: 'string', description: 'Short description. Required for kind=skill — AI agents use this for discovery.' },
        variables: {
          type: 'array',
          description: 'Explicit variable definitions (kind=prompt only). Each item: {name: string, label?: string, type?: "text"|"textarea"}. If omitted, variables are auto-extracted from {{placeholders}} in content.',
          items: { type: 'object' },
        },
        file_ids: {
          type: 'array',
          description: 'UUIDs of workspace files to attach as context (from list_files). Works for all kinds.',
          items: { type: 'string' },
        },
      },
      required: ['kind', 'title', 'content'],
    },
  },
  {
    name: 'update_template',
    title: 'Update playbook',
    description: 'Partially update an existing template by id. Only provided fields are changed. Get the id from list_templates or search_templates first.\n\nVariables (kind=prompt only): pass "variables" array to replace all variables, or omit to leave them unchanged. If content is updated without a "variables" array, variables are re-extracted from {{placeholders}} in the new content.\n\nContext files: pass "file_ids" to replace the attached file list.',
    inputSchema: {
      type: 'object',
      properties: {
        id:                 { type: 'string', description: 'UUID of the template to update' },
        title:              { type: 'string', description: 'New title' },
        content:            { type: 'string', description: 'New content' },
        description:        { type: 'string', description: 'New description' },
        variables: {
          type: 'array',
          description: 'Replace all variables (kind=prompt only). Each item: {name: string, label?: string, type?: "text"|"textarea"}.',
          items: { type: 'object' },
        },
        file_ids: {
          type: 'array',
          description: 'Replace the attached context file list (array of file UUIDs from list_files).',
          items: { type: 'string' },
        },
      },
      required: ['id'],
    },
  },
  {
    name: 'delete_template',
    title: 'Delete playbook',
    description: 'Permanently delete a template by id. This cannot be undone. Get the id from list_templates or search_templates first.',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'UUID of the template to delete' },
      },
      required: ['id'],
    },
  },
  {
    name: 'import_skill_from_url',
    title: 'Import skill from GitHub',
    description: 'Import a whole Anthropic Agent Skill from a public GitHub URL in ONE call. The server downloads the archive, unpacks it, stores every file under its relative path and creates the skill template — the file contents never pass through you.\n\nUSE THIS for any skill that lives in a repository. Uploading a real skill file-by-file via upload_file does not work: a skill folder is routinely megabytes, so you run out of room and it arrives half-complete without anything saying so.\n\nAccepted: https://github.com/owner/repo · https://github.com/owner/repo/tree/<ref>/<folder> · any .zip on a GitHub host. If the archive holds several skills, the call names them and you pass "path" to pick one.\n\nEvery file in the folder is kept, whatever its type — scripts, schemas, fonts, templates.\n\nReturns what actually landed: file count, total bytes, and every file that was skipped with the reason. Nothing else in sqemes reports a partial import, so read it.',
    inputSchema: {
      type: 'object',
      properties: {
        url:  { type: 'string', description: 'Public GitHub URL of the repository, the folder, or a .zip archive.' },
        path: { type: 'string', description: 'Folder inside the archive holding SKILL.md — only needed when the archive holds more than one skill (e.g. skills/diagram-design).' },
      },
      required: ['url'],
    },
  },
  {
    name: 'upload_file',
    title: 'Upload text file',
    description: 'Upload a text file into the workspace so it can be attached to templates via file_ids. Any text file, whatever its extension. At most 5 MB per call; larger files go through create_upload_url.\n\nFOLDERS: "name" may be a RELATIVE PATH and it is stored exactly as given — that is how a file keeps its place in a folder. Uploading an Agent Skill or any other folder, send each file under its path relative to the folder root (references/type-bar.md, scripts/extract.py), never the bare filename. Sqemes groups files by that prefix into a folder tree, and a skill whose SKILL.md says "see references/x.md" only works when x.md is actually called references/x.md.\n\nFor anything that is not text — images, PDFs, fonts, Office files, archives — use create_upload_url + finalize_upload (uploaded out of band).\n\nThe returned id can be used directly in file_ids on create_template or update_template without a follow-up list_files call.',
    inputSchema: {
      type: 'object',
      properties: {
        name:    { type: 'string', description: 'Filename with extension, or a relative path when the file belongs to a folder — e.g. schema.json, references/type-bar.md, scripts/extract.py. Paths are preserved verbatim; strip nothing.' },
        content: { type: 'string', description: 'Full file content as plain text' },
      },
      required: ['name', 'content'],
    },
  },
  {
    name: 'create_upload_url',
    title: 'Start file upload',
    description: 'Begin uploading a binary file — any type: image, PDF, font, Office file, archive. Returns a short-lived signed URL and the contentType to send; PUT the raw bytes to it (out of band, with exactly that Content-Type), then call finalize_upload with the returned fileId. The type is then read from the bytes. For text use upload_file.',
    inputSchema: {
      type: 'object',
      properties: {
        name:     { type: 'string', description: 'Filename with extension (e.g. report.pdf, diagram.png)' },
        mimeType: { type: 'string', description: 'The file\'s type as you know it (e.g. application/pdf, image/png, font/ttf). Only used to pick the Content-Type for the PUT.' },
      },
      required: ['name', 'mimeType'],
    },
  },
  {
    name: 'finalize_upload',
    title: 'Finish file upload',
    description: 'Register a binary file after its bytes have been PUT to the create_upload_url signed URL. Confirms the upload landed and records it (size + type read from storage). Returns the file id/name/mimeType, usable in file_ids on create_template or update_template. Call once per create_upload_url, after the PUT succeeds.',
    inputSchema: {
      type: 'object',
      properties: {
        fileId: { type: 'string', description: 'The fileId returned by create_upload_url' },
      },
      required: ['fileId'],
    },
  },
  {
    name: 'delete_file',
    title: 'Delete file',
    description: 'Permanently delete a workspace file (from storage and the file list). Use this to clean up a context file that a template no longer needs — e.g. after replacing it via update_template, the old file stays in the workspace, unattached, until deleted.\n\nSAFETY: if the file is still attached to OTHER templates, the call is BLOCKED by default and returns the list of templates that use it, so you can confirm with the user before touching them. To then proceed, either:\n  • pass force:true to detach the file from every template and delete it, or\n  • pass replaceWith:<fileId> to swap the file for a replacement in each of those templates (detach old, attach new) and then delete the old file.\nAsk the user before using force or replaceWith. This cannot be undone.',
    inputSchema: {
      type: 'object',
      properties: {
        fileId:      { type: 'string', description: 'UUID of the workspace file to delete (from list_files).' },
        force:       { type: 'boolean', description: 'If the file is still attached to other templates, detach it from all of them and delete anyway. Default false — without it (and without replaceWith) the call is blocked and returns the referencing templates so you can confirm with the user first.' },
        replaceWith: { type: 'string', description: 'Optional UUID of a replacement file. When the file is attached to other templates, swap it for this file in each of them (detach old, attach new) instead of just detaching, then delete the old file. Implies force.' },
      },
      required: ['fileId'],
    },
  },
];

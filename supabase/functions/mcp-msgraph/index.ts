// SQEM-158 — generic Microsoft Graph MCP shim, keyed by `?service=` on the connector mcp_url. A stateless
// MCP server (like mcp-outlook) that receives the user's refreshed Graph token as bearer and dispatches to
// a per-service toolset → Microsoft Graph REST. This turn ships `service=calendar`; OneDrive (files),
// Contacts, SharePoint become new SERVICES entries later — no new shim. (mcp-outlook stays for mail so
// existing connectors keep working.)
const GRAPH = 'https://graph.microsoft.com/v1.0';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, content-type, mcp-session-id, mcp-protocol-version',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const clip = (n: unknown, def: number, max: number) => {
  const v = typeof n === 'number' && Number.isFinite(n) ? Math.floor(n) : def;
  return Math.max(1, Math.min(max, v));
};

async function graph(method: string, path: string, token: string, textBody = false): Promise<any> { // eslint-disable-line @typescript-eslint/no-explicit-any
  const headers: Record<string, string> = { Authorization: `Bearer ${token}` };
  if (textBody) headers['Prefer'] = 'outlook.body-content-type="text"';
  const res = await fetch(`${GRAPH}${path}`, { method, headers });
  const text = await res.text();
  const json = text ? JSON.parse(text) : {};
  if (!res.ok) throw new Error(json?.error?.message || `Graph ${res.status}`);
  return json;
}

const attendees = (ev: any) => (ev.attendees ?? []).map((a: any) => a.emailAddress?.address).filter(Boolean); // eslint-disable-line @typescript-eslint/no-explicit-any

const eventSummary = (e: any) => ({ // eslint-disable-line @typescript-eslint/no-explicit-any
  id: e.id,
  subject: e.subject,
  start: e.start?.dateTime, end: e.end?.dateTime, timeZone: e.start?.timeZone,
  isAllDay: e.isAllDay,
  location: e.location?.displayName,
  organizer: e.organizer?.emailAddress?.address,
  webLink: e.webLink,
});

const DRIVE_SELECT = 'id,name,size,webUrl,lastModifiedDateTime,folder,file';
const fileSummary = (i: any) => ({ // eslint-disable-line @typescript-eslint/no-explicit-any
  id: i.id,
  name: i.name,
  type: i.folder ? 'folder' : (i.file?.mimeType || 'file'),
  size: i.size,
  childCount: i.folder?.childCount,
  lastModified: i.lastModifiedDateTime,
  webUrl: i.webUrl,
});

// ---- Services --------------------------------------------------------------------------------------
const CAL_SELECT = 'id,subject,start,end,isAllDay,location,organizer,webLink';

const SERVICES: Record<string, {
  tools: { name: string; description: string; inputSchema: unknown }[];
  run: (name: string, args: Record<string, unknown>, token: string) => Promise<string>;
}> = {
  calendar: {
    tools: [
      {
        name: 'list_events',
        description: 'List upcoming calendar events over the next N days (default 7), earliest first.',
        inputSchema: { type: 'object', properties: { daysAhead: { type: 'number', description: 'Days from now to look ahead (default 7, max 60).' }, limit: { type: 'number', description: 'Max events (default 20, max 50).' } } },
      },
      {
        name: 'find_events',
        description: 'Search calendar events by keyword (subject, attendees, body).',
        inputSchema: { type: 'object', properties: { query: { type: 'string', description: 'Search text.' }, limit: { type: 'number', description: 'Max events (default 10, max 25).' } }, required: ['query'] },
      },
      {
        name: 'get_event',
        description: 'Get one calendar event in full (attendees, location, body) by id.',
        inputSchema: { type: 'object', properties: { id: { type: 'string', description: 'Event id (from list/find results).' } }, required: ['id'] },
      },
    ],
    run: async (name, args, token) => {
      switch (name) {
        case 'list_events': {
          const days = clip(args.daysAhead, 7, 60);
          const start = new Date().toISOString();
          const end = new Date(Date.now() + days * 86400_000).toISOString();
          const top = clip(args.limit, 20, 50);
          const data = await graph('GET', `/me/calendarView?startDateTime=${encodeURIComponent(start)}&endDateTime=${encodeURIComponent(end)}&$orderby=${encodeURIComponent('start/dateTime')}&$top=${top}&$select=${CAL_SELECT}`, token);
          return JSON.stringify((data.value ?? []).map(eventSummary));
        }
        case 'find_events': {
          const q = encodeURIComponent(`"${String(args.query ?? '')}"`);
          const data = await graph('GET', `/me/events?$search=${q}&$top=${clip(args.limit, 10, 25)}&$select=${CAL_SELECT}`, token);
          return JSON.stringify((data.value ?? []).map(eventSummary));
        }
        case 'get_event': {
          const id = encodeURIComponent(String(args.id ?? ''));
          const e = await graph('GET', `/me/events/${id}?$select=${CAL_SELECT},attendees,body`, token, true);
          return JSON.stringify({ ...eventSummary(e), attendees: attendees(e), body: e.body?.content });
        }
        default:
          throw new Error(`Unknown tool: ${name}`);
      }
    },
  },

  // SQEM-159 — OneDrive (Files.Read, no admin consent). Read-only file browse/search/metadata.
  files: {
    tools: [
      {
        name: 'list_files',
        description: 'List files/folders in the user\'s OneDrive. Defaults to the root; pass a folder id to list inside it.',
        inputSchema: { type: 'object', properties: { folderId: { type: 'string', description: 'Folder item id (optional; omit for the drive root).' }, limit: { type: 'number', description: 'Max items (default 20, max 50).' } } },
      },
      {
        name: 'recent_files',
        description: 'List the files the user opened most recently.',
        inputSchema: { type: 'object', properties: { limit: { type: 'number', description: 'Max items (default 20, max 50).' } } },
      },
      {
        name: 'search_files',
        description: 'Search the user\'s OneDrive by name/content.',
        inputSchema: { type: 'object', properties: { query: { type: 'string', description: 'Search text.' }, limit: { type: 'number', description: 'Max items (default 20, max 50).' } }, required: ['query'] },
      },
      {
        name: 'get_file',
        description: 'Get one file/folder\'s metadata (name, size, type, web link) by id.',
        inputSchema: { type: 'object', properties: { id: { type: 'string', description: 'Drive item id.' } }, required: ['id'] },
      },
    ],
    run: async (name, args, token) => {
      const top = clip(args.limit, 20, 50);
      switch (name) {
        case 'list_files': {
          const path = args.folderId ? `/me/drive/items/${encodeURIComponent(String(args.folderId))}/children` : `/me/drive/root/children`;
          const data = await graph('GET', `${path}?$top=${top}&$select=${DRIVE_SELECT}`, token);
          return JSON.stringify((data.value ?? []).map(fileSummary));
        }
        case 'recent_files': {
          const data = await graph('GET', `/me/drive/recent?$top=${top}`, token);
          return JSON.stringify((data.value ?? []).map(fileSummary));
        }
        case 'search_files': {
          const q = encodeURIComponent(String(args.query ?? '').replace(/'/g, "''"));
          const data = await graph('GET', `/me/drive/root/search(q='${q}')?$top=${top}&$select=${DRIVE_SELECT}`, token);
          return JSON.stringify((data.value ?? []).map(fileSummary));
        }
        case 'get_file': {
          const id = encodeURIComponent(String(args.id ?? ''));
          return JSON.stringify(fileSummary(await graph('GET', `/me/drive/items/${id}?$select=${DRIVE_SELECT}`, token)));
        }
        default:
          throw new Error(`Unknown tool: ${name}`);
      }
    },
  },
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405, headers: cors });

  const token = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '').trim();
  const service = SERVICES[(new URL(req.url).searchParams.get('service') ?? '').trim()];
  let msg: { jsonrpc?: string; id?: unknown; method?: string; params?: any }; // eslint-disable-line @typescript-eslint/no-explicit-any
  try { msg = await req.json(); } catch { return new Response('Bad Request', { status: 400, headers: cors }); }

  const json = (id: unknown, payload: Record<string, unknown>) =>
    new Response(JSON.stringify({ jsonrpc: '2.0', id, ...payload }), { headers: { ...cors, 'Content-Type': 'application/json' } });

  if (msg.method?.startsWith('notifications/') || msg.id === undefined || msg.id === null) {
    return new Response(null, { status: 202, headers: cors });
  }

  switch (msg.method) {
    case 'initialize':
      return json(msg.id, {
        result: {
          protocolVersion: typeof msg.params?.protocolVersion === 'string' ? msg.params.protocolVersion : '2025-06-18',
          capabilities: { tools: {} },
          serverInfo: { name: `sqemes-msgraph`, version: '1.0.0' },
        },
      });
    case 'ping':
      return json(msg.id, { result: {} });
    case 'tools/list':
      return json(msg.id, { result: { tools: service?.tools ?? [] } });
    case 'tools/call': {
      if (!service) return json(msg.id, { result: { content: [{ type: 'text', text: 'Unknown or missing ?service on the connector URL.' }], isError: true } });
      if (!token) return json(msg.id, { result: { content: [{ type: 'text', text: 'Not connected: missing Microsoft token.' }], isError: true } });
      try {
        const text = await service.run(String(msg.params?.name ?? ''), (msg.params?.arguments ?? {}) as Record<string, unknown>, token);
        return json(msg.id, { result: { content: [{ type: 'text', text }] } });
      } catch (e) {
        return json(msg.id, { result: { content: [{ type: 'text', text: `Error: ${e instanceof Error ? e.message : String(e)}` }], isError: true } });
      }
    }
    default:
      return json(msg.id, { error: { code: -32601, message: `Method not found: ${msg.method}` } });
  }
});

// SQEM-153 — Outlook MCP shim. A stateless MCP server (streamable-HTTP, JSON-RPC) that a connector
// points at; the provider passthrough (Anthropic/OpenAI) calls it with the user's freshly-refreshed
// Microsoft Graph access token as the bearer, and this shim translates MCP tool calls into Microsoft
// Graph REST calls. Read + draft only (mirrors Gmail 1b); no send. There is no vendor-hosted Outlook
// MCP usable without a Copilot license, so we host this thin translator instead (SQEM-153 research).
const GRAPH = 'https://graph.microsoft.com/v1.0';
const MSG_SELECT = 'id,subject,from,receivedDateTime,bodyPreview,isRead,webLink';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, content-type, mcp-session-id, mcp-protocol-version',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const TOOLS = [
  {
    name: 'search_messages',
    description: 'Full-text search the mailbox for messages matching a query. Returns summaries (subject, sender, date, preview).',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Search text (sender, subject, or body keywords).' },
        limit: { type: 'number', description: 'Max messages to return (default 10, max 25).' },
      },
      required: ['query'],
    },
  },
  {
    name: 'list_messages',
    description: 'List recent messages in a mail folder (default Inbox), newest first. Optionally only unread.',
    inputSchema: {
      type: 'object',
      properties: {
        folder: { type: 'string', description: "Well-known folder name, e.g. 'inbox' (default), 'sentitems', 'drafts'." },
        limit: { type: 'number', description: 'Max messages to return (default 10, max 25).' },
        unreadOnly: { type: 'boolean', description: 'Only messages that are unread.' },
      },
    },
  },
  {
    name: 'get_message',
    description: 'Get one message in full (subject, sender, recipients, date, and plain-text body) by id.',
    inputSchema: {
      type: 'object',
      properties: { id: { type: 'string', description: 'The message id (from search/list results).' } },
      required: ['id'],
    },
  },
  {
    name: 'create_draft',
    description: 'Create a draft email (saved to Drafts, NOT sent). The user reviews and sends it from Outlook.',
    inputSchema: {
      type: 'object',
      properties: {
        to: { type: 'array', items: { type: 'string' }, description: 'Recipient email addresses.' },
        subject: { type: 'string', description: 'Email subject.' },
        body: { type: 'string', description: 'Plain-text body.' },
        cc: { type: 'array', items: { type: 'string' }, description: 'Optional CC email addresses.' },
      },
      required: ['to', 'body'],
    },
  },
  {
    name: 'reply_draft',
    description: 'Create a draft reply to a message (saved to Drafts, NOT sent). The user reviews and sends it.',
    inputSchema: {
      type: 'object',
      properties: {
        messageId: { type: 'string', description: 'The id of the message to reply to.' },
        comment: { type: 'string', description: 'The reply text (plain text).' },
      },
      required: ['messageId', 'comment'],
    },
  },
];

const recipients = (addrs: unknown): { emailAddress: { address: string } }[] =>
  (Array.isArray(addrs) ? addrs : []).filter(a => typeof a === 'string').map(a => ({ emailAddress: { address: a as string } }));

const clip = (n: unknown, def: number, max: number) => {
  const v = typeof n === 'number' && Number.isFinite(n) ? Math.floor(n) : def;
  return Math.max(1, Math.min(max, v));
};

async function graph(method: string, path: string, token: string, body?: unknown, textBody = false): Promise<any> { // eslint-disable-line @typescript-eslint/no-explicit-any
  const headers: Record<string, string> = { Authorization: `Bearer ${token}` };
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (textBody) headers['Prefer'] = 'outlook.body-content-type="text"';
  const res = await fetch(`${GRAPH}${path}`, { method, headers, body: body !== undefined ? JSON.stringify(body) : undefined });
  const text = await res.text();
  const json = text ? JSON.parse(text) : {};
  if (!res.ok) throw new Error(json?.error?.message || `Graph ${res.status}`);
  return json;
}

const summary = (m: any) => ({ // eslint-disable-line @typescript-eslint/no-explicit-any
  id: m.id,
  subject: m.subject,
  from: m.from?.emailAddress?.address,
  fromName: m.from?.emailAddress?.name,
  receivedDateTime: m.receivedDateTime,
  isRead: m.isRead,
  preview: m.bodyPreview,
});

async function runTool(name: string, args: Record<string, unknown>, token: string): Promise<string> {
  switch (name) {
    case 'search_messages': {
      const q = encodeURIComponent(`"${String(args.query ?? '')}"`);
      const data = await graph('GET', `/me/messages?$search=${q}&$top=${clip(args.limit, 10, 25)}&$select=${MSG_SELECT}`, token);
      return JSON.stringify((data.value ?? []).map(summary));
    }
    case 'list_messages': {
      const folder = encodeURIComponent(String(args.folder ?? 'inbox'));
      const top = clip(args.limit, 10, 25);
      // Graph rejects $filter + $orderby together on mail ("restriction or sort order too complex"),
      // so order by date only when not filtering unread.
      const tail = args.unreadOnly ? `&$filter=isRead eq false` : `&$orderby=receivedDateTime desc`;
      const data = await graph('GET', `/me/mailFolders/${folder}/messages?$top=${top}&$select=${MSG_SELECT}${tail}`, token);
      return JSON.stringify((data.value ?? []).map(summary));
    }
    case 'get_message': {
      const id = encodeURIComponent(String(args.id ?? ''));
      const m = await graph('GET', `/me/messages/${id}?$select=id,subject,from,toRecipients,ccRecipients,receivedDateTime,body`, token, undefined, true);
      return JSON.stringify({
        id: m.id, subject: m.subject,
        from: m.from?.emailAddress?.address,
        to: (m.toRecipients ?? []).map((r: any) => r.emailAddress?.address), // eslint-disable-line @typescript-eslint/no-explicit-any
        cc: (m.ccRecipients ?? []).map((r: any) => r.emailAddress?.address), // eslint-disable-line @typescript-eslint/no-explicit-any
        receivedDateTime: m.receivedDateTime,
        body: m.body?.content,
      });
    }
    case 'create_draft': {
      const msg = {
        subject: String(args.subject ?? ''),
        body: { contentType: 'Text', content: String(args.body ?? '') },
        toRecipients: recipients(args.to),
        ccRecipients: recipients(args.cc),
      };
      const d = await graph('POST', `/me/messages`, token, msg);
      return JSON.stringify({ ok: true, draftId: d.id, webLink: d.webLink });
    }
    case 'reply_draft': {
      const id = encodeURIComponent(String(args.messageId ?? ''));
      const d = await graph('POST', `/me/messages/${id}/createReply`, token, { comment: String(args.comment ?? '') });
      return JSON.stringify({ ok: true, draftId: d.id, webLink: d.webLink });
    }
    default:
      throw new Error(`Unknown tool: ${name}`);
  }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405, headers: cors });

  const token = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '').trim();
  let msg: { jsonrpc?: string; id?: unknown; method?: string; params?: any }; // eslint-disable-line @typescript-eslint/no-explicit-any
  try { msg = await req.json(); } catch { return new Response('Bad Request', { status: 400, headers: cors }); }

  const json = (id: unknown, payload: Record<string, unknown>) =>
    new Response(JSON.stringify({ jsonrpc: '2.0', id, ...payload }), { headers: { ...cors, 'Content-Type': 'application/json' } });

  // Notifications (no id) — acknowledge with 202, no body.
  if (msg.method?.startsWith('notifications/') || msg.id === undefined || msg.id === null) {
    return new Response(null, { status: 202, headers: cors });
  }

  switch (msg.method) {
    case 'initialize':
      return json(msg.id, {
        result: {
          protocolVersion: typeof msg.params?.protocolVersion === 'string' ? msg.params.protocolVersion : '2025-06-18',
          capabilities: { tools: {} },
          serverInfo: { name: 'sqemes-outlook', version: '1.0.0' },
        },
      });
    case 'ping':
      return json(msg.id, { result: {} });
    case 'tools/list':
      return json(msg.id, { result: { tools: TOOLS } });
    case 'tools/call': {
      if (!token) {
        return json(msg.id, { result: { content: [{ type: 'text', text: 'Not connected: missing Microsoft token.' }], isError: true } });
      }
      const name = String(msg.params?.name ?? '');
      const args = (msg.params?.arguments ?? {}) as Record<string, unknown>;
      try {
        const text = await runTool(name, args, token);
        return json(msg.id, { result: { content: [{ type: 'text', text }] } });
      } catch (e) {
        return json(msg.id, { result: { content: [{ type: 'text', text: `Error: ${e instanceof Error ? e.message : String(e)}` }], isError: true } });
      }
    }
    default:
      return json(msg.id, { error: { code: -32601, message: `Method not found: ${msg.method}` } });
  }
});

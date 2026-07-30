// SQEM-157 — Shopify Admin MCP shim. Stateless MCP server (like mcp-outlook) that translates MCP tool
// calls into Shopify **Admin GraphQL** calls. The passthrough calls it with the store's custom-app
// Admin API token (`shpat_…`) as the bearer; the shop domain rides the connector's mcp_url as `?shop=`.
// The shim re-sends the token as Shopify's `X-Shopify-Access-Token` header. Read-only.
const API_VERSION = Deno.env.get('SHOPIFY_API_VERSION') ?? '2025-07';
const SHOP_RE = /^[a-zA-Z0-9][a-zA-Z0-9-]*\.myshopify\.com$/; // SSRF guard — Admin API is always here

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, content-type, mcp-session-id, mcp-protocol-version',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const TOOLS = [
  {
    name: 'search_products',
    description: 'Search the store catalog. Supports Shopify query syntax (e.g. "title:shirt", "status:active", "vendor:Acme"). Returns product summaries.',
    inputSchema: { type: 'object', properties: { query: { type: 'string', description: 'Shopify product search query (optional).' }, limit: { type: 'number', description: 'Max products (default 10, max 25).' } } },
  },
  {
    name: 'get_product',
    description: 'Get one product in detail (variants, inventory, price) by id.',
    inputSchema: { type: 'object', properties: { id: { type: 'string', description: 'Product id or gid (from search results).' } }, required: ['id'] },
  },
  {
    name: 'list_orders',
    description: 'List recent orders (newest first). Supports Shopify query syntax (e.g. "financial_status:paid", "fulfillment_status:unfulfilled", "created_at:>2026-01-01").',
    inputSchema: { type: 'object', properties: { query: { type: 'string', description: 'Shopify order search query (optional).' }, limit: { type: 'number', description: 'Max orders (default 10, max 25).' } } },
  },
  {
    name: 'get_order',
    description: 'Get one order in detail (line items, totals, customer, shipping) by id.',
    inputSchema: { type: 'object', properties: { id: { type: 'string', description: 'Order id or gid (from list results).' } }, required: ['id'] },
  },
  {
    name: 'list_customers',
    description: 'List/search customers. Supports Shopify query syntax (e.g. "email:jane@x.com", "orders_count:>5").',
    inputSchema: { type: 'object', properties: { query: { type: 'string', description: 'Shopify customer search query (optional).' }, limit: { type: 'number', description: 'Max customers (default 10, max 25).' } } },
  },
  {
    name: 'get_customer',
    description: 'Get one customer in detail (contact, order count, amount spent) by id.',
    inputSchema: { type: 'object', properties: { id: { type: 'string', description: 'Customer id or gid (from list results).' } }, required: ['id'] },
  },
];

const clip = (n: unknown, def: number, max: number) => {
  const v = typeof n === 'number' && Number.isFinite(n) ? Math.floor(n) : def;
  return Math.max(1, Math.min(max, v));
};
const gid = (type: string, id: unknown) => (String(id).startsWith('gid://') ? String(id) : `gid://shopify/${type}/${id}`);
const nodes = (conn: any) => (conn?.edges ?? []).map((e: any) => e.node); // eslint-disable-line @typescript-eslint/no-explicit-any

const Q = {
  products: `query($q:String,$n:Int!){products(first:$n,query:$q){edges{node{id title handle status totalInventory vendor priceRangeV2{minVariantPrice{amount currencyCode}}}}}}`,
  product: `query($id:ID!){product(id:$id){id title handle status totalInventory vendor descriptionHtml variants(first:20){edges{node{id title sku price inventoryQuantity}}}}}`,
  orders: `query($q:String,$n:Int!){orders(first:$n,query:$q,sortKey:CREATED_AT,reverse:true){edges{node{id name createdAt displayFinancialStatus displayFulfillmentStatus totalPriceSet{shopMoney{amount currencyCode}} customer{displayName email}}}}}`,
  order: `query($id:ID!){order(id:$id){id name createdAt displayFinancialStatus displayFulfillmentStatus totalPriceSet{shopMoney{amount currencyCode}} customer{displayName email} shippingAddress{address1 city province country zip} lineItems(first:50){edges{node{title quantity originalUnitPriceSet{shopMoney{amount currencyCode}}}}}}}`,
  customers: `query($q:String,$n:Int!){customers(first:$n,query:$q){edges{node{id displayName email numberOfOrders amountSpent{amount currencyCode} createdAt}}}}`,
  customer: `query($id:ID!){customer(id:$id){id displayName email phone numberOfOrders amountSpent{amount currencyCode} defaultAddress{address1 city province country zip}}}`,
};

async function graphql(shop: string, token: string, query: string, variables: Record<string, unknown>): Promise<any> { // eslint-disable-line @typescript-eslint/no-explicit-any
  const res = await fetch(`https://${shop}/admin/api/${API_VERSION}/graphql.json`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Shopify-Access-Token': token },
    body: JSON.stringify({ query, variables }),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json?.errors || `Shopify HTTP ${res.status}`);
  if (Array.isArray(json.errors) && json.errors.length) throw new Error(json.errors.map((e: any) => e.message).join('; ')); // eslint-disable-line @typescript-eslint/no-explicit-any
  return json.data;
}

async function runTool(name: string, args: Record<string, unknown>, shop: string, token: string): Promise<string> {
  const q = typeof args.query === 'string' ? args.query : null;
  switch (name) {
    case 'search_products':
      return JSON.stringify(nodes((await graphql(shop, token, Q.products, { q, n: clip(args.limit, 10, 25) })).products));
    case 'get_product':
      return JSON.stringify((await graphql(shop, token, Q.product, { id: gid('Product', args.id) })).product);
    case 'list_orders':
      return JSON.stringify(nodes((await graphql(shop, token, Q.orders, { q, n: clip(args.limit, 10, 25) })).orders));
    case 'get_order':
      return JSON.stringify((await graphql(shop, token, Q.order, { id: gid('Order', args.id) })).order);
    case 'list_customers':
      return JSON.stringify(nodes((await graphql(shop, token, Q.customers, { q, n: clip(args.limit, 10, 25) })).customers));
    case 'get_customer':
      return JSON.stringify((await graphql(shop, token, Q.customer, { id: gid('Customer', args.id) })).customer);
    default:
      throw new Error(`Unknown tool: ${name}`);
  }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405, headers: cors });

  const token = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '').trim();
  const shop = (new URL(req.url).searchParams.get('shop') ?? '').trim().toLowerCase();
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
          serverInfo: { name: 'sqemes-shopify', version: '1.0.0' },
        },
      });
    case 'ping':
      return json(msg.id, { result: {} });
    case 'tools/list':
      return json(msg.id, { result: { tools: TOOLS } });
    case 'tools/call': {
      if (!SHOP_RE.test(shop)) return json(msg.id, { result: { content: [{ type: 'text', text: 'Invalid or missing shop domain (expected {store}.myshopify.com).' }], isError: true } });
      if (!token) return json(msg.id, { result: { content: [{ type: 'text', text: 'Not connected: missing Shopify Admin API token.' }], isError: true } });
      try {
        const text = await runTool(String(msg.params?.name ?? ''), (msg.params?.arguments ?? {}) as Record<string, unknown>, shop, token);
        return json(msg.id, { result: { content: [{ type: 'text', text }] } });
      } catch (e) {
        return json(msg.id, { result: { content: [{ type: 'text', text: `Error: ${e instanceof Error ? e.message : String(e)}` }], isError: true } });
      }
    }
    default:
      return json(msg.id, { error: { code: -32601, message: `Method not found: ${msg.method}` } });
  }
});

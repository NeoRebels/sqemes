// SQEM-082 — parse an edge-function error response, preserving its `code`
// (e.g. 'out_of_credits', 'funded_unavailable') so the UI can show a tailored CTA.
export async function edgeError(res: Response): Promise<Error & { code?: string }> {
  const body = await res.json().catch(() => ({ error: res.statusText }));
  const e = new Error(body?.error || `Error ${res.status}`) as Error & { code?: string };
  if (body?.code) e.code = body.code;
  return e;
}

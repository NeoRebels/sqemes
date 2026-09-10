import { getCorsHeaders } from '../_shared/cors.ts';
import { createAdminClient } from '../_shared/supabase-admin.ts';
import { decryptApiKey } from '../_shared/crypto.ts';
import { getFreshConnectorToken } from '../_shared/connectorToken.ts';
import { checkRateLimit } from '../_shared/rateLimit.ts';
import { fetchWithTimeout } from '../_shared/fetchWithTimeout.ts';
import { broadcastJobResult } from '../_shared/broadcast.ts';
import { withTimeContext } from '../_shared/timeContext.ts';
import { withLibraryPrompt } from '../_shared/libraryPrompt.ts';
import { readSSE, geminiDelta, openAiDelta, claudeDelta } from '../_shared/sseStream.ts';
import { createDeltaBroadcaster } from '../_shared/deltaBroadcast.ts';
import { createLibraryReader } from '../_shared/libraryQueries.ts';
import {
  createLibraryToolRuntime, toolCapNotice, toolsWereRefused, type ToolRuntime,
  toOpenAiTools, toClaudeTools, toGeminiTools, toResponsesTools,
} from '../_shared/libraryTools.ts';
import {
  toResponsesInput, connectorResponsesTools, responsesDelta,
  createResponsesItemCollector, readResponsesText, readResponsesToolCalls, responsesToolResults,
} from '../_shared/openaiResponses.ts';
import {
  createOpenAiToolAccumulator, createClaudeToolAccumulator, createGeminiToolAccumulator,
  readOpenAiToolCalls, openAiAssistantTurn,
  readClaudeToolCalls, claudeAssistantTurn, claudeToolResults,
  readGeminiToolCalls, geminiModelTurn, geminiToolResults,
  parseToolArgs, type StreamedToolCall,
} from '../_shared/toolStream.ts';
import { ensureCreditPeriod, hasCredits, debitCredits } from '../_shared/credits.ts';
import { FUNDED_MODEL } from '../_shared/funded.ts';
import { isWorkspaceSubscriptionActive } from '../_shared/subscription.ts';

// SQEM-082 — keyless chat + editor test-run route through the Sqemes-funded model
// (direct Mistral, EU/GDPR), metered against the workspace's monthly AI credits.
// Cloud-only: absent `MISTRAL_API_KEY` (self-host) → BYOK is the only path.

declare const EdgeRuntime: { waitUntil(p: Promise<unknown>): void };

Deno.serve(async (req) => {
  const cors = getCorsHeaders(req);

  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: cors });
  }

  const MAX_BODY_BYTES = 20 * 1024 * 1024;
  const contentLength = Number(req.headers.get('content-length') ?? 0);
  if (contentLength > MAX_BODY_BYTES) {
    return new Response(JSON.stringify({ error: 'Request body too large. Maximum is 20 MB.' }), {
      status: 413,
      headers: { ...cors, 'Content-Type': 'application/json' },
    });
  }

  try {
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      return new Response(JSON.stringify({ error: 'Missing authorization header' }), {
        status: 401,
        headers: { ...cors, 'Content-Type': 'application/json' },
      });
    }

    const adminClient = createAdminClient();
    const token = authHeader.replace(/^Bearer\s+/i, '');
    const { data: { user }, error: authError } = await adminClient.auth.getUser(token);
    if (authError || !user) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401,
        headers: { ...cors, 'Content-Type': 'application/json' },
      });
    }

    const { workspaceId, modelId, systemInstruction, messages, jobId, funded, connectorIds, timeZone } = await req.json();

    // SQEM-370 — the model is told what day it is, composed HERE and not by the client: built at the
    // instant of the request, it cannot go stale in a session left open overnight. The client only
    // contributes the IANA zone, which is the one fact it alone knows.
    const effectiveSystemInstruction = withTimeContext(systemInstruction, new Date(), timeZone);

    // Funded (Sqemes-credit) calls don't carry a modelId — they use FUNDED_MODEL.
    if (!workspaceId || (!funded && !modelId) || !messages || !Array.isArray(messages) || messages.length === 0) {
      return new Response(JSON.stringify({ error: 'Missing required fields: workspaceId, messages[]' }), {
        status: 400,
        headers: { ...cors, 'Content-Type': 'application/json' },
      });
    }

    const { data: membership } = await adminClient
      .from('workspace_members')
      .select('role')
      .eq('workspace_id', workspaceId)
      .eq('user_id', user.id)
      .single();

    if (!membership) {
      return new Response(JSON.stringify({ error: 'Not a member of this workspace' }), {
        status: 403,
        headers: { ...cors, 'Content-Type': 'application/json' },
      });
    }

    // SQEM-083 — server-side paywall: reject when the workspace has no active subscription.
    if (!(await isWorkspaceSubscriptionActive(adminClient, workspaceId))) {
      return new Response(JSON.stringify({ error: 'This workspace has no active subscription.', code: 'subscription_inactive' }), {
        status: 402,
        headers: { ...cors, 'Content-Type': 'application/json' },
      });
    }

    const allowed = await checkRateLimit(workspaceId);
    if (!allowed) {
      return new Response(JSON.stringify({ error: 'Rate limit exceeded. Please wait before making more requests.' }), {
        status: 429,
        headers: { ...cors, 'Content-Type': 'application/json', 'Retry-After': '60' },
      });
    }

    // Resolve provider, model and key — funded (Sqemes credits) vs BYOK.
    let provider: string;
    let apiKey: string;
    let effectiveModelId: string;
    let fundedCreditLimit = 0;

    if (funded) {
      // Sqemes-funded chat/test: server credential + cheap EU model (direct Mistral).
      // Cloud-only — absent on self-host → tell the user to bring their own key.
      const fundedKey = Deno.env.get('MISTRAL_API_KEY');
      if (!fundedKey) {
        return new Response(JSON.stringify({ error: 'AI credits are not available here. Add your own API key in Settings to use AI.', code: 'funded_unavailable' }), {
          status: 400,
          headers: { ...cors, 'Content-Type': 'application/json' },
        });
      }
      // Roll the monthly period if due, then refuse before spending if the allowance is gone.
      const state = await ensureCreditPeriod(adminClient, workspaceId);
      if (!hasCredits(state)) {
        return new Response(JSON.stringify({ error: "You've used all your AI credits this month. Add your own API key (BYOK) or upgrade your plan.", code: 'out_of_credits' }), {
          status: 402,
          headers: { ...cors, 'Content-Type': 'application/json' },
        });
      }
      provider = 'mistral';
      apiKey = fundedKey;
      effectiveModelId = FUNDED_MODEL;
      fundedCreditLimit = state.limit;
    } else {
      // BYOK: derive the provider from the model id, then fetch + decrypt the workspace key.
      const byokLower = modelId.toLowerCase();
      if (byokLower.includes('/')) {
        // OpenRouter model ids are `vendor/model` — none of the direct providers use a slash.
        provider = 'openrouter';
      } else if (byokLower.startsWith('gpt-') || byokLower.startsWith('o3') || byokLower.startsWith('o4') || byokLower.startsWith('dall-e')) {
        provider = 'openai';
      } else if (byokLower.includes('gemini') || byokLower.includes('veo')) {
        provider = 'gemini';
      } else if (byokLower.includes('claude')) {
        provider = 'claude';
      } else if (byokLower.includes('grok')) {
        provider = 'grok';
      } else if (byokLower.includes('deepseek')) {
        provider = 'deepseek';
      } else if (byokLower.includes('mistral') || byokLower.includes('codestral') || byokLower.includes('ministral') || byokLower.includes('magistral') || byokLower.includes('pixtral')) {
        provider = 'mistral';
      } else {
        return new Response(JSON.stringify({ error: `Unsupported model: ${modelId}` }), {
          status: 400,
          headers: { ...cors, 'Content-Type': 'application/json' },
        });
      }

      const { data: keyRow } = await adminClient
        .from('workspace_api_keys')
        .select('encrypted_key')
        .eq('workspace_id', workspaceId)
        .eq('provider', provider)
        .single();

      if (!keyRow?.encrypted_key) {
        return new Response(JSON.stringify({ error: `No API key configured for ${provider}. Add it in Settings > LLM API Keys.` }), {
          status: 400,
          headers: { ...cors, 'Content-Type': 'application/json' },
        });
      }

      apiKey = await decryptApiKey(keyRow.encrypted_key);
      effectiveModelId = modelId;
    }

    const modelLower = effectiveModelId.toLowerCase();

    // ── Image generation model endpoints ────────────────────────────────────
    const imageGenEndpoints: Record<string, string> = {
      'gpt-image-1': 'https://api.openai.com/v1/images/generations',
      'gpt-image-1-mini': 'https://api.openai.com/v1/images/generations',
      'dall-e-3': 'https://api.openai.com/v1/images/generations',
      'grok-imagine-image': 'https://api.x.ai/v1/images/generations',
    };

    // Gemini image models handle multi-turn image context natively via inlineData.
    // All other providers receive sanitized history with base64 stripped to placeholders.
    const isGeminiImageModel = provider === 'gemini' && modelLower.includes('image');

    // Fix 1: Strip raw base64 image markdown from history for providers that
    // cannot handle it — prevents 429 quota exhaustion and 400 token limit errors.
    const sanitizedMessages: ChatMessage[] = isGeminiImageModel
      ? messages
      : messages.map((msg: ChatMessage) => {
          if (typeof msg.content === 'string' && msg.content.includes('data:image/')) {
            return { ...msg, content: stripBase64ImagesFromText(msg.content) };
          }
          return msg;
        });

    // Image generation models return a single response and take the branch below.
    //
    // ⛔ SQEM-372 — a second line here used to claim "All text models use SSE streaming to avoid the
    // Supabase gateway idle timeout." **Nothing streams.** No request sets `stream: true`, nothing
    // parses SSE, and the model's answer is assembled in full and broadcast in one piece.
    //
    // ⚠️ The line arrived in SQEM-017 — the commit that *introduced* the background-job design and
    // thereby made it false. Before that, the function held the HTTP connection open and needed SSE
    // to survive the gateway's idle timeout; moving the work into `EdgeRuntime.waitUntil()` after
    // the response removed the timeout and the streaming with it. The comment described the
    // mechanism it was replacing, inside the change that replaced it, and outlived it by months.
    //
    // It is corrected rather than deleted because it cost real time: streaming was scoped on the
    // assumption that "the provider side already streams and only the client delta is missing".
    // It does not. Building it means `stream: true` plus SSE parsing in four provider shapes.
    if (imageGenEndpoints[modelLower]) {
      const lastUserMsg = [...sanitizedMessages].reverse().find((m: any) => m.role === 'user');
      const textPrompt = typeof lastUserMsg?.content === 'string'
        ? lastUserMsg.content
        : Array.isArray(lastUserMsg?.content)
          ? lastUserMsg.content.map((p: any) => p.text || '').filter(Boolean).join('\n')
          : '';
      const gptEditableModels = ['gpt-image-1', 'gpt-image-1-mini'];
      let result: string;
      if (gptEditableModels.includes(modelLower)) {
        const prevImage = findLastGeneratedImage(messages);
        result = prevImage
          ? await callGptImageEdit(apiKey, effectiveModelId, textPrompt, prevImage.data, prevImage.mimeType)
          : await callImageGeneration(apiKey, effectiveModelId, imageGenEndpoints[modelLower], textPrompt);
      } else {
        result = await callImageGeneration(apiKey, effectiveModelId, imageGenEndpoints[modelLower], textPrompt);
      }
      return new Response(JSON.stringify({ result }), {
        headers: { ...cors, 'Content-Type': 'application/json' },
      });
    }

    if (isGeminiImageModel) {
      const result = await callGemini(apiKey, effectiveModelId, effectiveSystemInstruction, messages, true);
      return new Response(JSON.stringify({ result }), {
        headers: { ...cors, 'Content-Type': 'application/json' },
      });
    }

    // Text models — run LLM in background, return jobId immediately
    if (!jobId) {
      return new Response(JSON.stringify({ error: 'Missing jobId' }), {
        status: 400,
        headers: { ...cors, 'Content-Type': 'application/json' },
      });
    }
    // SQEM-149 — connectors: Claude (Messages API) and OpenAI (Responses API) call remote MCP
    // servers themselves. Resolve the enabled connectors for those providers; others ignore them.
    const connectors = ((provider === 'claude' || provider === 'openai') && Array.isArray(connectorIds) && connectorIds.length > 0)
      ? await resolveConnectors(adminClient, workspaceId, user.id, connectorIds)
      : null;
    EdgeRuntime.waitUntil(runAndBroadcast({
      jobId, provider, apiKey,
      modelId: effectiveModelId,
      systemInstruction: effectiveSystemInstruction,
      messages: sanitizedMessages,
      funded: !!funded,
      workspaceId,
      creditLimit: fundedCreditLimit,
      connectors,
      // SQEM-373 — the chat user's OWN id, and the only identity the library tools ever run under.
      // No API key is read on this path and none may be introduced: a key belongs to a person, so a
      // workspace-shared one would let anybody act as its owner (SQEM-346).
      userId: user.id,
    }));
    return new Response(JSON.stringify({ jobId }), {
      headers: { ...cors, 'Content-Type': 'application/json' },
    });
  } catch (error: any) {
    const message = error?.message || 'Internal server error';
    const status = (error?.status === 504) ? 504
      : message.includes('API_KEY_ENCRYPTION_KEY') ? 503
      : 500;
    const body = status === 503
      ? { error: 'Server encryption key not configured. Contact your administrator.' }
      : { error: message };
    console.error('chat-message error:', message);
    return new Response(JSON.stringify(body), {
      status,
      headers: { ...getCorsHeaders(req), 'Content-Type': 'application/json' },
    });
  }
});

// ── Connectors (SQEM-149) ────────────────────────────────────────────────────

// A connector resolved for a chat turn (token decrypted). Formatted per-provider at the call site.
type ResolvedConnector = { url: string; name: string; token: string | null; allowedTools: string[] | null };

// Resolve enabled connectors for a turn. Only connectors the caller may see (workspace-shared, or
// their own per-user) are included; the bearer token is decrypted here.
async function resolveConnectors(
  admin: ReturnType<typeof createAdminClient>,
  workspaceId: string,
  userId: string,
  connectorIds: string[],
): Promise<ResolvedConnector[] | null> {
  const { data } = await admin
    .from('workspace_connectors')
    .select('id, mcp_url, user_id, allowed_tools, provider, auth_token_encrypted, refresh_token_encrypted, token_expires_at')
    .eq('workspace_id', workspaceId)
    .in('id', connectorIds);
  const rows = ((data as any[]) || []).filter(r => r.user_id === null || r.user_id === userId);
  if (!rows.length) return null;

  const out: ResolvedConnector[] = [];
  for (const r of rows) {
    out.push({
      url: r.mcp_url,
      name: 'c_' + String(r.id).replace(/[^a-zA-Z0-9]/g, '').slice(0, 28), // unique, valid server label
      token: await getFreshConnectorToken(admin, r), // decrypts; refreshes an expired Google token in place
      allowedTools: Array.isArray(r.allowed_tools) && r.allowed_tools.length ? (r.allowed_tools as string[]) : null,
    });
  }
  return out;
}

// ── Background job helper ────────────────────────────────────────────────────

interface JobRequest {
  jobId: string;
  provider: string;
  apiKey: string;
  modelId: string;
  systemInstruction: string | undefined;
  messages: ChatMessage[];
  funded: boolean;
  workspaceId?: string;
  creditLimit: number;
  connectors: ResolvedConnector[] | null;
  /** SQEM-373 — the signed-in chat user. Library tools run as this person and nobody else. */
  userId: string;
}

/**
 * SQEM-373 — how many rounds of library lookups a message may take before it must answer.
 *
 * ⚠️ **Both numbers are runaway guards, not budgets.** Nothing here is tuned: SQEM-351/352 taught
 * that a limit set before the usage is measured limits the wrong thing, so the stats are logged on
 * every message that uses a tool and the real distribution exists before anyone tightens these.
 *
 * Funded is lower for one reason only: every round is another provider call, and on `FUNDED_MODEL`
 * those are metered against the workspace's credits. A model that loops costs the workspace real
 * allowance rather than the user's own key.
 */
const TOOL_ROUNDS_BYOK   = 6;
const TOOL_ROUNDS_FUNDED = 2;

/**
 * ⛔ **The deadline, and why it exists next to the round cap rather than instead of it.**
 *
 * A Supabase edge function gets ~150 s of wall clock for the whole invocation — `waitUntil` included
 * — and one provider call may take 120 s (`fetchWithTimeout`). Six rounds of a slow model would be
 * killed by the runtime, and a killed function broadcasts nothing: the client then sits on its own
 * 180 s timeout with a spinner. **That is a worse failure than any answer**, so no new tool round is
 * started past this point. 90 s leaves room for the round in flight plus the final answer.
 *
 * The round cap stays because the two catch different things: this catches slow, that catches a
 * model looping on cheap lookups.
 */
const TOOL_BUDGET_MS = 90_000;

async function runAndBroadcast({
  jobId, provider, apiKey, modelId, systemInstruction, messages,
  funded, workspaceId, creditLimit, connectors, userId,
}: JobRequest): Promise<void> {
  /**
   * SQEM-372 — the streaming decision, made ONCE and in one place rather than inside each provider.
   *
   * ⛔ Two cases deliberately do NOT stream, and each has its own reason:
   *
   *   - **funded** — `FUNDED_MODEL` is metered from `usage.total_tokens`. A streamed reply reports
   *     zero tokens unless the provider honours `stream_options`, and a silent under-charge is
   *     invisible in a way an over-charge never is. Lift this after observing usage on staging.
   *   - **connectors** — the reply interleaves remote tool events with text; folding that into a
   *     delta stream is its own problem.
   *
   * (Image models never reach this function.)
   *
   * ⭐ `broadcaster` is created per MESSAGE, not per provider call — so the tool loop below can call
   * a provider several times and the client still sees one continuous stream.
   */
  const streams = !funded && !connectors?.length;
  const broadcaster = streams
    ? createDeltaBroadcaster(text => broadcastJobResult(jobId, { delta: text }))
    : null;
  const onDelta = broadcaster ? (inc: string) => broadcaster.push(inc) : undefined;

  /**
   * SQEM-373 — the library as tools, built for every text message that has somewhere to look.
   *
   * ⭐ **SQEM-377 lifted the connector exclusion here, and each provider now decides for itself.**
   * It used to be `workspaceId && !connectors?.length`, because on chat completions a connector and
   * our tools fought over one `tools` field. On `/v1/responses` they share the array, so OpenAI can
   * have both. ⚠️ `callClaude` still nulls them when connectors are present — its Messages API has
   * the original conflict — and it says so at the point where it matters, rather than being handled
   * silently up here for every provider.
   *
   * ⚠️ The runtime is cheap to create — the reader behind it is a thunk, so a message that never
   * calls a tool pays nothing beyond the tool definitions in the request.
   */
  //
  // ⛔ **SQEM-378 moved Claude's connector rule up here, and that is not tidying.** `callClaude` still
  // nulls the tools when connectors are present — its Messages API has one `tools` field and two
  // writers — but the *prompt* below is decided at this level. If the two disagreed, a Claude
  // connector chat would be told to search a library whose tools were never sent, and a model told to
  // search something it cannot reach invents the answer (SQEM-326, unreachable persona routes). One
  // decision, one place; the provider's own guard stays as a belt-and-braces.
  const toolsBlockedByProvider = provider === 'claude' && !!connectors?.length;
  const tools: ToolRuntime | null = (workspaceId && !toolsBlockedByProvider)
    ? createLibraryToolRuntime(
        () => createLibraryReader({ client: createAdminClient(), workspaceId, userId }),
        { maxRounds: funded ? TOOL_ROUNDS_FUNDED : TOOL_ROUNDS_BYOK, budgetMs: TOOL_BUDGET_MS },
      )
    : null;

  /**
   * SQEM-378 — the standing library instruction, **only when the tools are really in the request.**
   *
   * ⭐ Order is general → specific, and it falls out of the wrapping: the library rule first, then
   * SQEM-370's date line, then whatever assistant and skills the session applied. The date is an
   * environment fact that needs to be *available*, not prominent; the assistant is the most specific
   * thing the user chose, so it sits closest to the task.
   *
   * ⚠️ ~2,000 characters on every message that carries tools. Named rather than discovered: the
   * behaviour rules — say which template you used, ask when several match, do not paste the contents
   * — exist nowhere else, and the tool descriptions alone do not carry them.
   */
  const instruction = tools ? withLibraryPrompt(systemInstruction) : systemInstruction;

  try {
    let result: string;
    let totalTokens = 0;
    if (provider === 'gemini') {
      result = await callGemini(apiKey, modelId, instruction, messages, false, onDelta, tools);
    } else if (provider === 'openai') {
      result = await callOpenAIResponses(apiKey, modelId, instruction, messages, connectors, onDelta, tools);
    } else if (provider === 'claude') {
      result = await callClaude(apiKey, modelId, instruction, messages, connectors, onDelta, tools);
    } else if (provider === 'deepseek') {
      ({ content: result, totalTokens } = await callOpenAICompatible(apiKey, modelId, 'https://api.deepseek.com/v1/chat/completions', instruction, messages, 'deepseek', onDelta, tools));
    } else if (provider === 'mistral') {
      ({ content: result, totalTokens } = await callOpenAICompatible(apiKey, modelId, 'https://api.mistral.ai/v1/chat/completions', instruction, messages, 'mistral', onDelta, tools));
    } else if (provider === 'grok') {
      ({ content: result, totalTokens } = await callOpenAICompatible(apiKey, modelId, 'https://api.x.ai/v1/chat/completions', instruction, messages, 'grok', onDelta, tools));
    } else if (provider === 'openrouter') {
      ({ content: result, totalTokens } = await callOpenAICompatible(apiKey, modelId, 'https://openrouter.ai/api/v1/chat/completions', instruction, messages, 'openrouter', onDelta, tools));
    } else {
      result = `[${provider}] Model ${modelId} is not yet supported.`;
    }

    /**
     * SQEM-373 — **counted before anything is limited** (the lesson of SQEM-351/352).
     *
     * Logged only when a tool was actually used, so the line means something when it appears rather
     * than being one more row per message. `byTool` is what answers the question the cap cannot:
     * whether a long message is one template being read properly or the same search four times.
     */
    // ⚠️ `toolsRefused` matters HERE too: a refusal means zero calls, so a `calls > 0` condition
    // alone would make the one case worth knowing about the one case that logs nothing.
    if (tools && (tools.stats.calls > 0 || tools.stats.toolsRefused)) {
      console.log('[chat-tools]', JSON.stringify({
        jobId, provider, funded, ...tools.stats, maxRounds: tools.maxRounds,
      }));
    }
    // ⛔ The cap must be VISIBLE. A model cut off mid-investigation answers confidently from half the
    // material, and nothing in the reply would say so.
    if (tools?.stats.cappedAt) result += toolCapNotice(tools.stats.cappedAt, tools.stats.cappedBy ?? 'rounds');

    // Funded (Sqemes-credit) calls debit the workspace allowance by tokens used. A
    // metering failure must not fail the user's result — log and move on (COGS is bounded).
    if (funded && workspaceId) {
      try {
        await debitCredits(createAdminClient(), workspaceId, totalTokens, creditLimit);
      } catch (debitErr: any) {
        console.error('credit debit failed:', debitErr?.message ?? debitErr);
      }
    }
    // ⚠️ Flush BEFORE the result. A delta arriving after it would overwrite the finished answer with
    // an earlier, shorter version of itself — the one ordering bug this design can produce.
    await broadcaster?.flush();
    await broadcastJobResult(jobId, { result });
  } catch (err: any) {
    // No flush here on purpose: a partial answer followed by an error reads as if the fragment were
    // the reply. The client drops what it has when an error arrives.
    await broadcastJobResult(jobId, { error: err?.message ?? 'Unknown error' });
  }
}

// ── Image history helpers ───────────────────────────────────────────────────

interface ChatMessage {
  role: 'user' | 'assistant';
  content: string | any[];
}

/** Decode a text/* inlineData part to a plain {type:'text'} part. */
function decodeTextFile(inlineData: { mimeType: string; data: string }): { type: string; text: string } {
  const text = new TextDecoder().decode(Uint8Array.from(atob(inlineData.data), c => c.charCodeAt(0)));
  return { type: 'text', text };
}

/**
 * Extract all base64-encoded images embedded as markdown from a string.
 * Returns cleaned text and an array of {mimeType, data} objects.
 */
function extractBase64Images(content: string): { cleanText: string; images: { mimeType: string; data: string }[] } {
  const images: { mimeType: string; data: string }[] = [];
  const cleanText = content.replace(/!\[.*?\]\(data:(image\/\w+);base64,([A-Za-z0-9+/=]+)\)/g, (_, mimeType, data) => {
    images.push({ mimeType, data });
    return '';
  }).trim();
  return { cleanText, images };
}

/**
 * Replace embedded base64 image markdown with a short placeholder.
 * Prevents token explosion when sending history to text-only providers.
 */
function stripBase64ImagesFromText(content: string): string {
  return content.replace(/!\[.*?\]\(data:image\/[^;]+;base64,[A-Za-z0-9+/=]+\)/g, '[Image generated]');
}

/**
 * Find the most recent assistant-generated image in the conversation history.
 */
function findLastGeneratedImage(messages: ChatMessage[]): { mimeType: string; data: string } | null {
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i];
    if (msg.role === 'assistant' && typeof msg.content === 'string') {
      const match = /!\[.*?\]\(data:(image\/\w+);base64,([A-Za-z0-9+/=]+)\)/.exec(msg.content);
      if (match) return { mimeType: match[1], data: match[2] };
    }
  }
  return null;
}

// ── Provider implementations ────────────────────────────────────────────────

/**
 * Fix 3: For Gemini image models, convert base64 image markdown in assistant
 * messages to proper inlineData parts so Gemini can reference/edit previous
 * images without burning text token quota.
 */
async function callGemini(
  apiKey: string,
  modelId: string,
  systemInstruction: string | undefined,
  messages: ChatMessage[],
  isImageModel: boolean,
  /** SQEM-372 — present ⇒ stream. Absent ⇒ the original single-response path, unchanged. */
  onDelta?: (increment: string) => void,
  /** SQEM-373 — present ⇒ the model may call the workspace library. Never set for image models. */
  tools?: ToolRuntime | null,
): Promise<string> {
  // SQEM-111 — modelId is interpolated into the request path; allow only id-shaped values.
  if (!/^[A-Za-z0-9._-]+$/.test(modelId)) throw new Error('Invalid model id');
  // SQEM-372 — `streamGenerateContent?alt=sse` speaks the same `data:` transport as every other
  // provider; only the JSON differs. ⚠️ Image models never stream — they return one response with
  // inline data, and there is nothing to show progressively.
  const streaming = !!onDelta && !isImageModel;
  const url = streaming
    ? `https://generativelanguage.googleapis.com/v1beta/models/${modelId}:streamGenerateContent?alt=sse`
    : `https://generativelanguage.googleapis.com/v1beta/models/${modelId}:generateContent`;

  const contents: any[] = messages.map(msg => {
    const role = msg.role === 'assistant' ? 'model' : 'user';

    if (typeof msg.content === 'string') {
      if (isImageModel && msg.content.includes('data:image/')) {
        // Convert embedded base64 images to inlineData for proper multi-turn image context
        const { cleanText, images } = extractBase64Images(msg.content);
        const parts: any[] = [];
        if (cleanText.trim()) parts.push({ text: cleanText.trim() });
        for (const img of images) parts.push({ inlineData: img });
        return { role, parts: parts.length > 0 ? parts : [{ text: '[Image]' }] };
      }
      return { role, parts: [{ text: msg.content }] };
    }

    // Array content (user messages with file attachments)
    const parts = msg.content.map((p: any) => {
      if (p.inlineData) return { inlineData: p.inlineData };
      return { text: p.text || String(p) };
    });
    return { role, parts };
  });

  // SQEM-125 — chat sends no temperature; let each model use its own default.
  const generationConfig: any = {};
  if (isImageModel) {
    generationConfig.responseModalities = ['TEXT', 'IMAGE'];
  }

  // SQEM-373 — image models never call tools: they return one response with inline data and there is
  // nothing to look up mid-generation.
  let activeTools = isImageModel ? null : (tools ?? null);
  let answer = '';

  for (;;) {
    const body: any = { contents, generationConfig };
    if (systemInstruction) {
      body.systemInstruction = { parts: [{ text: systemInstruction }] };
    }
    if (activeTools) body.tools = toGeminiTools(activeTools.definitions);

    const response = await fetchWithTimeout(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const errText = await response.text();
      // SQEM-375 — the model cannot do function tools. Retry once without them rather than
      // failing the whole message; `activeTools` is null from here, so this cannot loop.
      if (activeTools && toolsWereRefused(response.status, errText)) {
        console.warn('[chat-tools] provider refused function tools, retrying without:', errText.slice(0, 300));
        activeTools.stats.toolsRefused = true;
        activeTools = null;
        continue;
      }
      throw new Error(`Gemini API error (${response.status}): ${errText}`);
    }

    let text = '';
    let toolCalls: StreamedToolCall[] = [];
    if (streaming) {
      const acc = activeTools ? createGeminiToolAccumulator() : null;
      const r = await readSSE(response.body, geminiDelta, onDelta!, acc ? (chunk) => acc.onChunk(chunk) : undefined);
      text = r.text;
      toolCalls = acc?.calls() ?? [];
    } else {
      const data = await response.json();
      const parts = data.candidates?.[0]?.content?.parts || [];
      for (const part of parts) {
        if (part.text) text += part.text;
        if (part.inlineData) {
          text += `\n\n![Generated Image](data:${part.inlineData.mimeType};base64,${part.inlineData.data})\n\n`;
        }
      }
      toolCalls = readGeminiToolCalls(parts);
    }
    answer += text;

    if (!activeTools || !toolCalls.length) return answer || 'No content generated.';

    contents.push(geminiModelTurn(text, toolCalls) as any);
    const results: { name: string; output: string }[] = [];
    for (const call of toolCalls) {
      results.push({ name: call.name, output: await activeTools.execute(call.name, parseToolArgs(call.args)) });
    }
    contents.push(geminiToolResults(results) as any);
    activeTools = advanceToolRound(activeTools);
  }
}

/**
 * SQEM-377 — the ONE OpenAI path: `/v1/responses`, for plain chat, connectors and library tools.
 *
 * ⛔ **This replaced `callOpenAI` rather than joining it.** There were already two OpenAI paths here —
 * chat completions for plain chat, Responses for connectors (SQEM-149) — and a third for tools would
 * have been the next twin. Folding all three into one **removes** a twin instead of adding one.
 *
 * ⚠️ The reason a working path had to be touched at all: OpenAI's current reasoning models reject
 * function tools on `/v1/chat/completions` outright, because of a `reasoning_effort` we never set and
 * cannot see. SQEM-375's retry-without-tools kept the chat alive but produced a reply that politely
 * told the user their library did not exist — worse than an error, because nothing in it says
 * something is missing.
 *
 * ⭐ Everything shape-related lives in `_shared/openaiResponses.ts`, pure and unit-tested; this
 * function is the wiring and the loop.
 */
async function callOpenAIResponses(
  apiKey: string,
  modelId: string,
  systemInstruction: string | undefined,
  messages: ChatMessage[],
  connectors: ResolvedConnector[] | null = null,
  onDelta?: (increment: string) => void,
  tools?: ToolRuntime | null,
): Promise<string> {
  const input = toResponsesInput(messages, (d) => decodeTextFile(d).text);

  let activeTools = tools ?? null;
  let answer = '';

  for (;;) {
    const body: Record<string, unknown> = { model: modelId, input };
    if (systemInstruction) body.instructions = systemInstruction;
    if (onDelta) body.stream = true;

    // ⭐ SQEM-377 — connectors and library tools now share ONE array. On chat completions they could
    // not: a single `tools` field with two writers, which is why SQEM-373 withheld library tools
    // whenever a connector was active. OpenAI runs the `mcp` entries itself and hands the `function`
    // ones back to us, so the restriction has no cause left on this path.
    const toolList = [
      ...(connectors?.length ? connectorResponsesTools(connectors) : []),
      ...(activeTools ? toResponsesTools(activeTools.definitions) : []),
    ];
    if (toolList.length) body.tools = toolList;

    const response = await fetchWithTimeout('https://api.openai.com/v1/responses', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const errText = await response.text();
      // SQEM-375 — kept even here. Responses fixes OpenAI's reasoning models, not every model a
      // workspace might point at.
      if (activeTools && toolsWereRefused(response.status, errText)) {
        console.warn('[chat-tools] provider refused function tools, retrying without:', errText.slice(0, 300));
        activeTools.stats.toolsRefused = true;
        activeTools = null;
        continue;
      }
      throw new Error(`OpenAI API error (${response.status}): ${errText}`);
    }

    let text = '';
    let items: any[] = [];
    if (onDelta) {
      const collector = createResponsesItemCollector();
      const r = await readSSE(response.body, responsesDelta, onDelta, (chunk) => collector.onChunk(chunk));
      text = r.text;
      items = collector.items();
    } else {
      const data = await response.json();
      items = data.output || [];
      text = readResponsesText(items) || data.output_text || '';
    }
    answer += text;

    const toolCalls = activeTools ? readResponsesToolCalls(items) : [];
    if (!activeTools || !toolCalls.length) return answer || 'No content generated.';

    // ⛔ EVERY item goes back, verbatim — reasoning items included, not just the calls. A reasoning
    // model that does not get its own reasoning back loses the thinking it already charged for, and
    // rebuilding an item is exactly what cost SQEM-376 two hours earlier.
    input.push(...items);
    const results: { id: string; output: string }[] = [];
    for (const call of toolCalls) {
      results.push({ id: call.id, output: await activeTools.execute(call.name, parseToolArgs(call.args)) });
    }
    input.push(...responsesToolResults(results));
    activeTools = advanceToolRound(activeTools);
  }
}

/**
 * SQEM-373 — one round of an OpenAI-shaped response, streamed or not.
 *
 * Shared by `callOpenAI` and `callOpenAICompatible` because the wire format is identical; the two
 * functions differ only in what they put INTO the request (documents, usage) and that stays with
 * them. It is deliberately not a third twin.
 */
async function readOpenAiRound(
  response: Response,
  onDelta: ((increment: string) => void) | undefined,
  activeTools: ToolRuntime | null,
  onUsage?: (totalTokens: number) => void,
): Promise<{ text: string; toolCalls: StreamedToolCall[] }> {
  if (onDelta) {
    const acc = activeTools ? createOpenAiToolAccumulator() : null;
    const { text } = await readSSE(
      response.body,
      (chunk) => {
        // The usage chunk carries no `choices[].delta.content`, so the text extractor ignores it; it
        // is picked up here on the side.
        const usage = (chunk as { usage?: { total_tokens?: number } })?.usage;
        if (usage?.total_tokens) onUsage?.(usage.total_tokens);
        return openAiDelta(chunk);
      },
      onDelta,
      acc ? (chunk) => acc.onChunk(chunk) : undefined,
    );
    return { text, toolCalls: acc?.calls() ?? [] };
  }

  const data = await response.json();
  if (data?.usage?.total_tokens) onUsage?.(data.usage.total_tokens);
  const message = data.choices?.[0]?.message;
  return { text: message?.content || '', toolCalls: readOpenAiToolCalls(message) };
}

/**
 * SQEM-373 — count the round, and drop the tools once the cap is reached.
 *
 * ⛔ Returning `null` is what forces the next round to be an ANSWER: a model asked to stop calling
 * tools while it can still see them calls one anyway. Taking them away is the only instruction it
 * cannot ignore. `cappedAt` then puts a line in the reply, so the user is not left with a confident
 * answer built on half the material and nothing saying so.
 */
function advanceToolRound(tools: ToolRuntime): ToolRuntime | null {
  tools.stats.rounds += 1;
  // ⛔ Time first, because it is the constraint that actually bites: the runtime kills the whole
  // invocation at ~150 s and a killed function broadcasts NOTHING — the user watches a spinner until
  // the client gives up. The round cap only guards a model that loops on cheap calls.
  if (Date.now() >= tools.deadline) {
    tools.stats.cappedAt = tools.stats.rounds;
    tools.stats.cappedBy = 'time';
    return null;
  }
  if (tools.stats.rounds < tools.maxRounds) return tools;
  tools.stats.cappedAt = tools.stats.rounds;
  tools.stats.cappedBy = 'rounds';
  return null;
}

async function callClaude(
  apiKey: string,
  modelId: string,
  systemInstruction: string | undefined,
  messages: ChatMessage[],
  connectors: ResolvedConnector[] | null = null,
  onDelta?: (increment: string) => void,
  /** SQEM-373 — present ⇒ the model may call the workspace library. Never set alongside connectors. */
  tools?: ToolRuntime | null,
): Promise<string> {
  const apiMessages = messages.map(msg => {
    if (typeof msg.content === 'string') {
      return { role: msg.role, content: msg.content };
    }
    const content = msg.content.map((p: any) => {
      if (p.inlineData) {
        if (p.inlineData.mimeType.startsWith('text/')) return decodeTextFile(p.inlineData);
        if (p.inlineData.mimeType === 'application/pdf') {
          return { type: 'document', source: { type: 'base64', media_type: p.inlineData.mimeType, data: p.inlineData.data } };
        }
        return { type: 'image', source: { type: 'base64', media_type: p.inlineData.mimeType, data: p.inlineData.data } };
      }
      return { type: 'text', text: p.text || String(p) };
    });
    return { role: msg.role, content };
  });

  const headers: Record<string, string> = { 'Content-Type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' };

  // ⛔ SQEM-373 — connectors and library tools are mutually exclusive on this path, and the caller
  // already enforces it. Repeated here because both write `body.tools`: a future caller that passes
  // both would silently lose the connectors rather than fail, and a connector that stops working
  // without an error is the hardest kind of bug to trace back to its cause.
  let activeTools = connectors?.length ? null : (tools ?? null);
  let answer = '';

  for (;;) {
    const body: any = { model: modelId, max_tokens: 8192, messages: apiMessages };  // SQEM-125 — no temperature
    // ⚠️ SQEM-372 — connectors are NOT streamed. With `mcp_servers` the reply interleaves tool events
    // with text, and mixing that into the delta stream is a separate problem; the caller withholds
    // `onDelta` in that case rather than this branch guessing.
    if (onDelta) body.stream = true;
    if (systemInstruction) body.system = systemInstruction;
    if (activeTools) body.tools = toClaudeTools(activeTools.definitions);

    // SQEM-149 — remote MCP connectors: Claude calls the connectors' tools server-side.
    if (connectors?.length) {
      body.mcp_servers = connectors.map(c => ({ type: 'url', url: c.url, name: c.name, ...(c.token ? { authorization_token: c.token } : {}) }));
      body.tools = connectors.map(c => {
        const toolset: any = { type: 'mcp_toolset', mcp_server_name: c.name };
        if (c.allowedTools) {
          toolset.default_config = { enabled: false };
          toolset.configs = Object.fromEntries(c.allowedTools.map(t => [t, { enabled: true }]));
        }
        return toolset;
      });
      headers['anthropic-beta'] = 'mcp-client-2025-11-20';
    }

    const response = await fetchWithTimeout('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const errText = await response.text();
      // SQEM-375 — the model cannot do function tools. Retry once without them rather than
      // failing the whole message; `activeTools` is null from here, so this cannot loop.
      if (activeTools && toolsWereRefused(response.status, errText)) {
        console.warn('[chat-tools] provider refused function tools, retrying without:', errText.slice(0, 300));
        activeTools.stats.toolsRefused = true;
        activeTools = null;
        continue;
      }
      throw new Error(`Claude API error (${response.status}): ${errText}`);
    }

    let text = '';
    let toolCalls: StreamedToolCall[] = [];
    if (onDelta) {
      const acc = activeTools ? createClaudeToolAccumulator() : null;
      const r = await readSSE(response.body, claudeDelta, onDelta, acc ? (chunk) => acc.onChunk(chunk) : undefined);
      text = r.text;
      toolCalls = acc?.calls() ?? [];
    } else {
      const data = await response.json();
      text = (data.content || []).map((c: any) => c.text || '').join('');
      toolCalls = readClaudeToolCalls(data.content);
    }
    answer += text;

    if (!activeTools || !toolCalls.length) return answer || 'No content generated.';

    apiMessages.push(claudeAssistantTurn(text, toolCalls) as any);
    const results: { id: string; output: string }[] = [];
    for (const call of toolCalls) {
      results.push({ id: call.id, output: await activeTools.execute(call.name, parseToolArgs(call.args)) });
    }
    // ⚠️ ALL results in ONE user turn. Claude rejects a turn that answers only some of the tool_use
    // blocks in the assistant message before it.
    apiMessages.push(claudeToolResults(results) as any);
    activeTools = advanceToolRound(activeTools);
  }
}

/**
 * ⛔ **SQEM-321 — this is the twin of `execute-step`'s `callOpenAICompatible`, and it was left
 * behind.** SQEM-316 taught that one to forward PDFs to `mistral` and `openrouter`; this one kept
 * dropping every PDF, so **Chat** — the channel people actually attach documents in — answered from
 * a document it had never been given.
 *
 * ⚠️ **The same mistake twice in one day, in the same shape.** SQEM-317 existed because SQEM-316
 * fixed the wizard's upload path and not its attach path; then SQEM-316 itself turned out to have
 * fixed one edge function and not the other. **Two files with the same job, the same structure and
 * the same bug, and nothing in the repo connects them** — no shared module, no test, no type.
 *
 * ⛔ **If you change the provider/document handling here, change it in
 * `supabase/functions/execute-step/index.ts` too.** The matrix behind both is in
 * `pm/DOCUMENTATION.md` → AI Provider Integration **in the source repository** (that file is not
 * part of the public self-host export — SQEM-279). The real fix is a shared module under
 * `_shared/`; until somebody does that, this comment is the only thing linking them.
 */
async function callOpenAICompatible(
  apiKey: string,
  modelId: string,
  endpoint: string,
  systemInstruction: string | undefined,
  messages: ChatMessage[],
  provider?: string,
  /**
   * SQEM-372 — present ⇒ stream.
   *
   * ⛔ **The caller withholds this for FUNDED calls, and that is the single most dangerous decision
   * in this change.** `FUNDED_MODEL` is `mistral-small-latest`, so every credit-metered chat runs
   * through exactly this function, and `debitCredits` is fed from `data.usage.total_tokens`. In a
   * streamed response `usage` is absent unless the provider honours `stream_options` — and if it
   * silently does not, `totalTokens` becomes 0 and **credits stop being debited without any error
   * anywhere**. An under-charge is invisible in a way an over-charge never is.
   *
   * `stream_options: { include_usage: true }` is requested below and the final chunk is read for
   * usage, but "Mistral honours it" is an assertion, not something verified here. Until it is
   * observed on staging, funded stays non-streaming: BYOK users get streaming, metering stays
   * exact. Lifting this needs a measurement, not an opinion.
   */
  onDelta?: (increment: string) => void,
  /** SQEM-373 — present ⇒ the model may call the workspace library. */
  tools?: ToolRuntime | null,
): Promise<{ content: string; totalTokens: number }> {
  const apiMessages: any[] = [];

  if (systemInstruction) {
    apiMessages.push({ role: 'system', content: systemInstruction });
  }

  // Only these two can take a document; for the others a PDF is still dropped. Verified against the
  // providers' own docs on 2026-09-01 — grok takes images only, deepseek's schema has no file part.
  const pdfShape = provider === 'mistral' || provider === 'openrouter' ? provider : null;

  for (const msg of messages) {
    if (typeof msg.content === 'string') {
      apiMessages.push({ role: msg.role, content: msg.content });
    } else {
      const content = msg.content
        .filter((p: any) => !(p.inlineData && p.inlineData.mimeType === 'application/pdf' && !pdfShape))
        .map((p: any) => {
          if (p.inlineData) {
            if (p.inlineData.mimeType.startsWith('text/')) return decodeTextFile(p.inlineData);
            if (p.inlineData.mimeType === 'application/pdf') {
              const dataUrl = `data:application/pdf;base64,${p.inlineData.data}`;
              return pdfShape === 'mistral'
                ? { type: 'document_url', document_url: dataUrl }
                : { type: 'file', file: { filename: 'document.pdf', file_data: dataUrl } };
            }
            return { type: 'image_url', image_url: { url: `data:${p.inlineData.mimeType};base64,${p.inlineData.data}` } };
          }
          return { type: 'text', text: p.text || String(p) };
        });
      apiMessages.push({ role: msg.role, content });
    }
  }

  let activeTools = tools ?? null;
  let answer = '';
  /**
   * ⚠️ **Summed across rounds, never replaced.** With tools a message is several provider calls and
   * every one of them is billed. On `FUNDED_MODEL` this number is what `debitCredits` charges, so
   * keeping only the last round's usage would undercharge a workspace by exactly the lookups the
   * model did on its behalf — silently, which is the failure mode SQEM-372's note warns about.
   */
  let totalTokens = 0;

  for (;;) {
    const body: Record<string, unknown> = onDelta
      // SQEM-372 — `include_usage` puts a final chunk carrying token counts on the stream. Without
      // it a streamed reply reports zero tokens, which reads exactly like a free request.
      ? { model: modelId, messages: apiMessages, stream: true, stream_options: { include_usage: true } }
      : { model: modelId, messages: apiMessages };  // SQEM-125 — no temperature
    if (activeTools) body.tools = toOpenAiTools(activeTools.definitions);

    const response = await fetchWithTimeout(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const errText = await response.text();
      if (response.status === 429) {
        throw new Error('The AI service is busy right now. Please wait a few seconds and try again.');
      }
      // SQEM-375 — the model cannot do function tools. Retry once without them rather than
      // failing the whole message; `activeTools` is null from here, so this cannot loop.
      if (activeTools && toolsWereRefused(response.status, errText)) {
        console.warn('[chat-tools] provider refused function tools, retrying without:', errText.slice(0, 300));
        activeTools.stats.toolsRefused = true;
        activeTools = null;
        continue;
      }
      throw new Error(`API error (${response.status}): ${errText}`);
    }

    const { text, toolCalls } = await readOpenAiRound(
      response, onDelta, activeTools, (t) => { totalTokens += t; },
    );
    answer += text;

    if (!activeTools || !toolCalls.length) {
      return { content: answer || 'No content generated.', totalTokens };
    }

    apiMessages.push(openAiAssistantTurn(text, toolCalls));
    for (const call of toolCalls) {
      apiMessages.push({
        role: 'tool',
        tool_call_id: call.id,
        content: await activeTools.execute(call.name, parseToolArgs(call.args)),
      });
    }
    activeTools = advanceToolRound(activeTools);
  }
}

async function callImageGeneration(
  apiKey: string,
  modelId: string,
  endpoint: string,
  prompt: string
): Promise<string> {
  const body: any = { model: modelId, prompt, n: 1 };
  if (modelId.includes('grok') || modelId.startsWith('dall-e')) {
    body.response_format = 'b64_json';
  }

  const response = await fetchWithTimeout(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`Image generation API error (${response.status}): ${errText}`);
  }

  const data = await response.json();
  const imageData = data.data?.[0];
  if (imageData?.b64_json) {
    const mime = modelId.includes('grok') ? 'image/jpeg' : 'image/png';
    return `![Generated Image](data:${mime};base64,${imageData.b64_json})`;
  }
  if (imageData?.url) {
    return `![Generated Image](${imageData.url})`;
  }
  return 'No image generated.';
}

/**
 * Fix 4: Use the GPT image edits endpoint to modify a previously generated image.
 * Called when gpt-image-1 / gpt-image-1-mini detects a prior image in history.
 */
async function callGptImageEdit(
  apiKey: string,
  modelId: string,
  prompt: string,
  imageBase64: string,
  _imageMimeType: string
): Promise<string> {
  const binaryStr = atob(imageBase64);
  const bytes = new Uint8Array(binaryStr.length);
  for (let i = 0; i < binaryStr.length; i++) {
    bytes[i] = binaryStr.charCodeAt(i);
  }
  const imageBlob = new Blob([bytes], { type: 'image/png' });

  const formData = new FormData();
  formData.append('model', modelId);
  formData.append('image[]', imageBlob, 'image.png');
  formData.append('prompt', prompt);
  formData.append('n', '1');

  const response = await fetchWithTimeout('https://api.openai.com/v1/images/edits', {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${apiKey}` },
    body: formData,
  });

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`OpenAI image edit error (${response.status}): ${errText}`);
  }

  const data = await response.json();
  const imageData = data.data?.[0];
  if (imageData?.b64_json) {
    return `![Generated Image](data:image/png;base64,${imageData.b64_json})`;
  }
  if (imageData?.url) {
    return `![Generated Image](${imageData.url})`;
  }
  return 'No image generated.';
}

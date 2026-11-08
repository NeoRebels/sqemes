import { dropUnsendableInMessages } from '../_shared/messageParts.ts';
import { getCorsHeaders } from '../_shared/cors.ts';
import { createAdminClient } from '../_shared/supabase-admin.ts';
import { decryptApiKey } from '../_shared/crypto.ts';
import { getFreshConnectorToken } from '../_shared/connectorToken.ts';
import { checkChatBudget, budgetMessage } from '../_shared/rateLimit.ts';
import { fetchWithTimeout } from '../_shared/fetchWithTimeout.ts';
import { broadcastJobResult } from '../_shared/broadcast.ts';
import { connectorRefusedNotice } from '../_shared/connectorRefusal.ts';
import { withTimeContext, timeContextLine } from '../_shared/timeContext.ts';
import { withLibraryPrompt } from '../_shared/libraryPrompt.ts';
import { providerTimeoutMs } from '../_shared/chatTimeouts.ts';
import { watchForCancel } from '../_shared/chatCancel.ts';
import { loadConnectorTools, withConnectorTools } from '../_shared/mcpClient.ts';
import { ConnectorPool, withConnectorPool, connectorsFetchedNotice, type AvailableConnector } from '../_shared/connectorPool.ts';
import { claudeUsage, responsesUsage, geminiUsage, chatCompletionsUsage, addUsage, type TokenCount } from '../_shared/tokenUsage.ts';
import { chatErrorKind, errorStatus } from '../_shared/chatErrorKind.ts';
import { readSSE, geminiDelta, openAiDelta, claudeDelta, contentText, stopReasonOf } from '../_shared/sseStream.ts';
import { createDeltaBroadcaster } from '../_shared/deltaBroadcast.ts';
import { createLibraryReader } from '../_shared/libraryQueries.ts';
import { unzipEntries } from '../_shared/officeZip.ts';
import { withAnalysisTool, normalizeAnalysisTables, normalizeAnalyses, analysisLogCounts, ANALYSIS_INSTRUCTION, CONNECTOR_ANALYSIS_INSTRUCTION, type AnalysisRecord } from '../_shared/analysisTool.ts';
import { ConnectorTableStore } from '../_shared/connectorTables.ts';
import { requestBrowserAnalysis } from '../_shared/analysisRoundTrip.ts';
import {
  createLibraryToolRuntime, advanceToolRound, restoreToolRuntime, MAX_TOOL_ROUNDS, countNativeConnectorCalls, toolCapNotice, toolsWereRefused, runToolCall, truncatedNotice, afterToolsRefused, toolsRefusedNotice, noAnswerText, type ToolRuntime,
  toOpenAiTools, toClaudeTools, toGeminiTools, toResponsesTools, chatActionDefinitions,
} from '../_shared/libraryTools.ts';
import { runLibraryTool } from '../_shared/libraryActions.ts';
import { m, m as txt, requestLocale, type Locale } from '../_shared/locale.ts';
import { addChange, type LibraryChange } from '../_shared/libraryChanges.ts';
import {
  toResponsesInput, responsesDelta,
  createResponsesItemCollector, readResponsesText, readResponsesToolCalls, responsesToolResults,
  createResponsesStreamWatcher, responsesBodyState, responsesRoundProblem, type ResponsesRoundState,
} from '../_shared/openaiResponses.ts';
import { imageGenEndpoint, canEditPreviousImage } from '../_shared/imageModels.ts';
import { openRouterImageModel, callOpenRouterImage } from '../_shared/openrouterImage.ts';
import {
  createOpenAiToolAccumulator, createClaudeToolAccumulator, createGeminiToolAccumulator,
  readOpenAiToolCalls, openAiAssistantTurn,
  readClaudeToolCalls, claudeAssistantTurn, claudeToolResults,
  readGeminiToolCalls, geminiModelTurn, geminiToolResults,
  type StreamedToolCall,
} from '../_shared/toolStream.ts';
import { ensureCreditPeriod, hasCredits, debitCredits } from '../_shared/credits.ts';
import {
  ChatContinuation, canContinue, invocationDeadline, containsSecret, signContinuation, openContinuation, splitTokens,
  type ContinuationState, type ContinuationRequest, type LoopSnapshot,
} from '../_shared/chatContinuation.ts';
import { createClaudeBlockCollector, isPauseTurn, MAX_PAUSE_RESUMES } from '../_shared/claudePause.ts';
import { OUTPUT_LIMIT, outputLimit } from '../_shared/outputLimits.ts';
import { FUNDED_MODEL } from '../_shared/funded.ts';
import { isLoadtestRequest, runLoadtestMock, LOADTEST_HEADER } from '../_shared/loadtestMock.ts';
import { isWorkspaceSubscriptionActive } from '../_shared/subscription.ts';
import { countUsage } from '../_shared/usageCounts.ts';
import { MAX_LOADED_IDS } from '../_shared/chatPlaybooks.ts';
import {
  searchWeb, readWebPage, withWebTools, WEB_SEARCH_INSTRUCTION, SEARCH_KEY_PROVIDERS, allowanceNotice, webNotSetUpNotice,
  type SearchProvider, type WebSources, type WebState,
} from '../_shared/webSearch.ts';
import { withFileTool, type GeneratedFile } from '../_shared/fileOutput.ts';

// SQEM-082 — keyless chat + editor test-run route through the Sqemes-funded model
// (direct Mistral, EU/GDPR), metered against the workspace's monthly AI credits.
// Cloud-only: absent `MISTRAL_API_KEY` (self-host) → BYOK is the only path.

declare const EdgeRuntime: { waitUntil(p: Promise<unknown>): void };

// SQEM-381 — the same flag `subscription.ts` reads. On a self-hosted instance the connector timeouts
// stay at the defaults, because the operator's Supabase may be free-tier (150 s wall clock) and a
// 300 s provider call would outlive the worker — silence instead of an honest 504.
const SELF_HOSTED = Deno.env.get('SELF_HOSTED') === 'true';

Deno.serve(async (req) => {
  let locale: Locale = requestLocale(req); // SQEM-612 — refusals before the body is read are in the person's language too
  const cors = getCorsHeaders(req);

  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: cors });
  }

  const MAX_BODY_BYTES = 20 * 1024 * 1024;
  const contentLength = Number(req.headers.get('content-length') ?? 0);
  if (contentLength > MAX_BODY_BYTES) {
    return new Response(JSON.stringify({ error: txt.srv_body_too_large({}, { locale }) }), {
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
      return new Response(JSON.stringify({ error: txt.srv_unauthorized({}, { locale }) }), {
        status: 401,
        headers: { ...cors, 'Content-Type': 'application/json' },
      });
    }

    const body = await req.json();
    /**
     * SQEM-649 — a continuation: this function called itself because one invocation's time was up.
     * ⛔ Everything comes from the SIGNED state, never from the body around it — the request a
     * continuation carries on is the one the person made, and only its own counters say how far it got.
     */
    let continuation: ContinuationState | null = null;
    if (body.continuation) {
      const opened = await openContinuation(body.continuation, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '', user.id, Date.now());
      if (!opened.ok) {
        console.warn('[chat-continue] refused:', opened.reason);
        return new Response(JSON.stringify({ error: 'Invalid continuation' }), {
          status: 400,
          headers: { ...cors, 'Content-Type': 'application/json' },
        });
      }
      continuation = opened.state;
    }
    const src: Record<string, any> = continuation
      ? { ...continuation.request, jobId: continuation.jobId, workspaceId: continuation.workspaceId }
      : body;
    const { workspaceId, modelId, systemInstruction, jobId, funded, connectorIds, timeZone, webSearch } = src;
    const analysisTables = normalizeAnalysisTables(src.analysisTables); // SQEM-660 — metadata only, never rows
    // SQEM-661 — the browser can take connector tables (an older bundle cannot: it would never answer).
    const connectorAnalysis = src.connectorAnalysis === true;
    locale = requestLocale(req, src.locale); // SQEM-599 — the language of the notices sqemes adds (SQEM-612: or the query)
    // SQEM-514 — a file part no provider can take never reaches a provider branch (_shared/messageParts.ts).
    // SQEM-649 — a continuation brings the provider's own message list in the state instead.
    const messages = continuation ? [] : Array.isArray(body.messages) ? dropUnsendableInMessages(body.messages) : body.messages;

    // SQEM-370 — the model is told what day it is, composed HERE and not by the client: built at the
    // instant of the request, it cannot go stale in a session left open overnight. The client only
    // contributes the IANA zone, which is the one fact it alone knows.
    const effectiveSystemInstruction = withTimeContext(systemInstruction, new Date(), timeZone);
    // SQEM-654 — the same line on its own, for text answers: it goes at the END of the system
    // instruction there, after everything that stays the same, so the providers can cache the start.
    const timeLine = timeContextLine(new Date(), timeZone);

    // Funded (Sqemes-credit) calls don't carry a modelId — they use FUNDED_MODEL.
    if (!workspaceId || (!funded && !modelId) || (!continuation && (!messages || !Array.isArray(messages) || messages.length === 0))) {
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
      return new Response(JSON.stringify({ error: txt.srv_not_member({}, { locale }) }), {
        status: 403,
        headers: { ...cors, 'Content-Type': 'application/json' },
      });
    }

    // SQEM-083 — server-side paywall: reject when the workspace has no active subscription.
    if (!(await isWorkspaceSubscriptionActive(adminClient, workspaceId))) {
      return new Response(JSON.stringify({ error: txt.srv_no_subscription({}, { locale }), code: 'subscription_inactive' }), {
        status: 402,
        headers: { ...cors, 'Content-Type': 'application/json' },
      });
    }

    // SQEM-501 — per person, with a per-workspace ceiling (was: 60/min for the whole workspace).
    // SQEM-649 — a continuation is the same message, already counted; it is not counted again.
    const budget = continuation ? { ok: true as const } : await checkChatBudget(workspaceId, user.id);
    if (!budget.ok) {
      return new Response(JSON.stringify({ error: budgetMessage(budget, locale), code: 'rate_limited', scope: budget.scope }), {
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
        return new Response(JSON.stringify({ error: txt.srv_funded_unavailable({}, { locale }), code: 'funded_unavailable' }), {
          status: 400,
          headers: { ...cors, 'Content-Type': 'application/json' },
        });
      }
      // Roll the monthly period if due, then refuse before spending if the allowance is gone.
      const state = await ensureCreditPeriod(adminClient, workspaceId);
      if (!hasCredits(state)) {
        return new Response(JSON.stringify({ error: txt.srv_out_of_credits({}, { locale }), code: 'out_of_credits' }), {
          status: 402,
          headers: { ...cors, 'Content-Type': 'application/json' },
        });
      }
      provider = 'mistral';
      apiKey = fundedKey;
      effectiveModelId = FUNDED_MODEL;
      fundedCreditLimit = state.limit;
    } else if (isLoadtestRequest(modelId, req.headers.get(LOADTEST_HEADER), Deno.env.get('CHAT_LOADTEST_SECRET'))) {
      // SQEM-500 — simulated provider for load tests on staging; see _shared/loadtestMock.ts for why it
      // is unreachable wherever CHAT_LOADTEST_SECRET is not set (production, self-host).
      provider = 'loadtest';
      apiKey = '';
      effectiveModelId = modelId;
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
        return new Response(JSON.stringify({ error: txt.srv_unsupported_model({ model: modelId }, { locale }) }), {
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
        return new Response(JSON.stringify({ error: txt.srv_no_key({ provider }, { locale }) }), {
          status: 400,
          headers: { ...cors, 'Content-Type': 'application/json' },
        });
      }

      apiKey = await decryptApiKey(keyRow.encrypted_key);
      effectiveModelId = modelId;
    }

    const modelLower = effectiveModelId.toLowerCase();

    // ── Image generation model endpoints ────────────────────────────────────
    // SQEM-560 — by prefix (`_shared/imageModels.ts`): the exact-id map here missed `gpt-image-2` and
    // `grok-imagine-image-2.0` from SQEM-275 on, and those went to the text API.
    const imageEndpoint = imageGenEndpoint(modelLower);

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
    if (imageEndpoint && !continuation) {
      const lastUserMsg = [...sanitizedMessages].reverse().find((m: any) => m.role === 'user');
      const textPrompt = typeof lastUserMsg?.content === 'string'
        ? lastUserMsg.content
        : Array.isArray(lastUserMsg?.content)
          ? lastUserMsg.content.map((p: any) => p.text || '').filter(Boolean).join('\n')
          : '';
      let result: string;
      if (canEditPreviousImage(modelLower)) {
        const prevImage = findLastGeneratedImage(messages);
        result = prevImage
          ? await callGptImageEdit(apiKey, effectiveModelId, textPrompt, prevImage.data, prevImage.mimeType)
          : await callImageGeneration(apiKey, effectiveModelId, imageEndpoint, textPrompt);
      } else {
        result = await callImageGeneration(apiKey, effectiveModelId, imageEndpoint, textPrompt);
      }
      return new Response(JSON.stringify({ result }), {
        headers: { ...cors, 'Content-Type': 'application/json' },
      });
    }

    if (isGeminiImageModel && !continuation) {
      const result = await callGemini(apiKey, effectiveModelId, effectiveSystemInstruction, messages, true);
      return new Response(JSON.stringify({ result }), {
        headers: { ...cors, 'Content-Type': 'application/json' },
      });
    }

    // SQEM-574 — an OpenRouter image model answers through chat completions with `modalities`; on the
    // text path its picture was dropped and Chat showed nothing. Same synchronous `{ result }` as above.
    const orImage = provider === 'openrouter' && !continuation ? await openRouterImageModel(effectiveModelId) : null;
    if (orImage) {
      const lastUser = [...messages].reverse().find((m: any) => m.role === 'user');
      const parts: any[] = Array.isArray(lastUser?.content) ? lastUser.content : [];
      const prompt = typeof lastUser?.content === 'string'
        ? stripBase64ImagesFromText(lastUser.content)
        : parts.map((p: any) => p.text || '').filter(Boolean).join('\n');
      // An image the person attached wins; otherwise the last picture in the chat, so "make it blue" edits it.
      const uploaded = parts
        .filter((p: any) => p.inlineData?.mimeType?.startsWith('image/'))
        .map((p: any) => `data:${p.inlineData.mimeType};base64,${p.inlineData.data}`);
      const prev = uploaded.length ? null : findLastGeneratedImage(messages);
      const images = uploaded.length ? uploaded : prev ? [`data:${prev.mimeType};base64,${prev.data}`] : [];
      const result = await callOpenRouterImage(apiKey, effectiveModelId, orImage, prompt, images);
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
    // servers themselves. SQEM-584 — every other text provider gets them too, through our own MCP
    // client (`_shared/mcpClient.ts`), so they are resolved for every provider now.
    const connectors = (Array.isArray(connectorIds) && connectorIds.length > 0)
      ? await resolveConnectors(adminClient, workspaceId, user.id, connectorIds)
      : null;
    // SQEM-651 — every connector this person may use, by name; the model fetches the one a task needs.
    const availableConnectors = await listAvailableConnectors(adminClient, workspaceId, user.id);
    // SQEM-594 — web search, only when the person switched it on for THIS message. The workspace's own
    // search key wins over ours; without either (self-host without a key) the tools are not offered.
    const web = webSearch === true ? await resolveWebSearch(adminClient, workspaceId) : null;
    EdgeRuntime.waitUntil(runAndBroadcast({
      jobId, provider, apiKey,
      modelId: effectiveModelId,
      systemInstruction, // SQEM-654 — without the time line; `timeLine` goes at the end
      timeLine,
      messages: sanitizedMessages,
      funded: !!funded,
      workspaceId,
      creditLimit: fundedCreditLimit,
      connectors,
      availableConnectors,
      // SQEM-373 — the chat user's OWN id, and the only identity the library tools ever run under.
      // No API key is read on this path and none may be introduced: a key belongs to a person, so a
      // workspace-shared one would let anybody act as its owner (SQEM-346).
      userId: user.id,
      role: (membership as { role?: string }).role ?? null, // SQEM-561
      web,
      webRequested: webSearch === true,
      locale,
      // SQEM-649 — what a hand-over needs: the person's own JWT (header only, never in the state), the
      // request to carry on, and — on a continuation — where the last invocation stopped.
      authHeader,
      request: { modelId, funded: !!funded, systemInstruction, timeZone, connectorIds, webSearch: webSearch === true, locale, ...(analysisTables.length ? { analysisTables } : {}), ...(connectorAnalysis ? { connectorAnalysis: true } : {}) } satisfies ContinuationRequest,
      continuation,
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
      ? { error: txt.srv_encryption_missing({}, { locale }) }
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
// SQEM-466 — `name` is the label we send to the provider (`c_<id>`); `displayName` is what the
// person called it. The provider echoes the former back when it refuses, so we need both to say
// which connector dropped out in words anybody can act on.
type ResolvedConnector = { id: string; url: string; name: string; displayName: string; token: string | null; allowedTools: string[] | null };

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
    .select('id, name, mcp_url, user_id, allowed_tools, provider, auth_token_encrypted, refresh_token_encrypted, token_expires_at, oauth_client_id, oauth_client_secret_encrypted')
    .eq('workspace_id', workspaceId)
    .in('id', connectorIds);
  const rows = ((data as any[]) || []).filter(r => r.user_id === null || r.user_id === userId);
  if (!rows.length) return null;

  const out: ResolvedConnector[] = [];
  for (const r of rows) {
    out.push({
      id: r.id, // SQEM-651 — the session keeps fetched connectors by id
      url: r.mcp_url,
      name: 'c_' + String(r.id).replace(/[^a-zA-Z0-9]/g, '').slice(0, 28), // unique, valid server label
      displayName: r.name || 'a connector', // SQEM-466 — what the person sees if it has to be dropped
      token: await getFreshConnectorToken(admin, r), // decrypts; refreshes an expired Google token in place
      allowedTools: Array.isArray(r.allowed_tools) && r.allowed_tools.length ? (r.allowed_tools as string[]) : null,
    });
  }
  return out;
}

/**
 * SQEM-651 — the connectors a person may use in Chat: shared ones and their own. Names and addresses
 * only — no token is decrypted for a connector the model never fetches (a Google refresh is a request).
 */
async function listAvailableConnectors(
  admin: ReturnType<typeof createAdminClient>,
  workspaceId: string,
  userId: string,
): Promise<AvailableConnector[]> {
  const { data, error } = await admin
    .from('workspace_connectors')
    .select('id, name, mcp_url, provider, user_id, created_at')
    .eq('workspace_id', workspaceId)
    .order('created_at', { ascending: true });
  if (error) { console.warn('[chat-connectors] could not list connectors:', error.message); return []; }
  return ((data as any[]) || [])
    .filter(r => r.user_id === null || r.user_id === userId)
    .map(r => ({ id: String(r.id), name: String(r.name || 'Connector'), mcp_url: String(r.mcp_url), provider: r.provider ?? null, user_id: r.user_id ?? null }));
}

// ── Background job helper ────────────────────────────────────────────────────

interface JobRequest {
  jobId: string;
  provider: string;
  apiKey: string;
  modelId: string;
  systemInstruction: string | undefined;
  /** SQEM-370/654 — the date line, appended after the stable part (see `instruction` below). */
  timeLine: string | null;
  messages: ChatMessage[];
  funded: boolean;
  workspaceId?: string;
  creditLimit: number;
  connectors: ResolvedConnector[] | null;
  /** SQEM-651 — every connector the person may use; the model fetches from these (`use_connector`). */
  availableConnectors: AvailableConnector[];
  /** SQEM-373 — the signed-in chat user. Library tools run as this person and nobody else. */
  userId: string;
  /**
   * SQEM-561 — their role in the workspace, read with the membership check above. It decides which
   * tools are OFFERED (writes to editors and admins); the shared handlers check it again, and the
   * edit right per object (`can_edit_*`) on top.
   */
  role: string | null;
  /** SQEM-594 — the search key for this message, or null (not switched on, or none available). */
  web: WebSearchConfig | null;
  /** SQEM-594 — switched on by the person, whether or not a key was found (to say so if not). */
  webRequested: boolean;
  /** SQEM-599 — the language of the notices sqemes adds to a reply. */
  locale: Locale;
  /** SQEM-649 — the person's `Authorization` header, for the self-call. ⛔ Never put into the state. */
  authHeader: string;
  /** SQEM-649 — the original request, signed into the state so a continuation cannot change it. */
  request: ContinuationRequest;
  /** SQEM-649 — set when this invocation continues an answer an earlier one started. */
  continuation: ContinuationState | null;
}

interface WebSearchConfig {
  provider: SearchProvider;
  key: string;
  /** Our Cloud key — counted against the plan's monthly allowance (consume_web_search). */
  hosted: boolean;
}

/**
 * SQEM-594 — which search key this message uses: the workspace's own (Linkup or Brave, one per
 * workspace) before ours (Linkup, Cloud only). Self-host sets no LINKUP_API_KEY, so there it is the
 * workspace's own key or nothing.
 */
async function resolveWebSearch(adminClient: ReturnType<typeof createAdminClient>, workspaceId: string): Promise<WebSearchConfig | null> {
  const { data: rows } = await adminClient
    .from('workspace_api_keys')
    .select('provider, encrypted_key')
    .eq('workspace_id', workspaceId)
    .in('provider', Object.values(SEARCH_KEY_PROVIDERS));
  const own = (rows ?? [])[0] as { provider: string; encrypted_key: string } | undefined;
  if (own?.encrypted_key) {
    const provider = (Object.keys(SEARCH_KEY_PROVIDERS) as SearchProvider[]).find(p => SEARCH_KEY_PROVIDERS[p] === own.provider)!;
    return { provider, key: await decryptApiKey(own.encrypted_key), hosted: false };
  }
  const hostedKey = Deno.env.get('LINKUP_API_KEY');
  return hostedKey ? { provider: 'linkup', key: hostedKey, hosted: true } : null;
}

/** A–AAAA lookup for the page reader's private-address check; absent where the runtime cannot resolve. */
async function resolveHost(host: string): Promise<string[]> {
  const [a, aaaa] = await Promise.all([
    Deno.resolveDns(host, 'A').catch(() => [] as string[]),
    Deno.resolveDns(host, 'AAAA').catch(() => [] as string[]),
  ]);
  return [...a, ...aaaa];
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
// ⛔ SQEM-650 — there are no per-kind round limits any more. SQEM-648 had 6 rounds of work (4 on
// credits) and 8 of library lookups; with an answer able to go on for 10 minutes (SQEM-649) a round
// count protects nothing a person cares about, and those limits stopped honest work (Chief of Staff,
// „Alles“, 2026-11-04). What is stopped now is a model REPEATING a call (`runToolCall`, third time →
// the earlier result, fourth → the answer), plus one emergency cap, `MAX_TOOL_ROUNDS` (40), for a loop
// that varies its arguments. Credits are charged by tokens either way, so funded needs no lower cap.
// The SQEM-595 lesson stays true: a cap that fires on finished work is worse than none.

// SQEM-649 — the chat-completions providers, in one place, so a hand-over can call the same one again.
const OPENAI_COMPATIBLE: Record<string, string> = {
  deepseek: 'https://api.deepseek.com/v1/chat/completions',
  mistral: 'https://api.mistral.ai/v1/chat/completions',
  grok: 'https://api.x.ai/v1/chat/completions',
  openrouter: 'https://openrouter.ai/api/v1/chat/completions',
};

/**
 * ⛔ **The deadline, and why it exists next to the round cap rather than instead of it.**
 *
 * One provider call may take 120 s (`fetchWithTimeout`), and the CLIENT gives up at 180 s
 * (`CLIENT_JOB_TIMEOUT_MS.default`) — for a turn without connectors that is the binding limit, not
 * the platform's wall clock (400 s on a paid plan, 150 s free; see `_shared/chatTimeouts.ts`). Six
 * rounds of a slow model would run past the client, which then shows a timeout while the worker is
 * still busy. So no new tool round is started past this point. 90 s leaves room for the round in
 * flight plus the final answer, inside the client's 180 s.
 *
 * ⚠️ SQEM-381 corrected this comment: it used to reason from the free-plan wall clock (150 s) as if it were ours, which is
 * the free-plan number. The 90 s figure survives because the client's 180 s binds first anyway.
 *
 * The round cap stays because the two catch different things: this catches slow, that catches a
 * model looping on cheap lookups.
 */
// ⛔ SQEM-648 looked at raising this for Cloud (the client waits 330 s there) and did NOT: the budget
// plus one provider call (≤ 300 s) must stay under the 400 s wall clock (`_shared/chatTimeouts.ts`).
// 90 + 300 = 390. More time per message needs a shorter per-call timeout first.
// ⭐ SQEM-649 — per INVOCATION since then: past it the answer goes on in a new one while the chain's
// 10 minutes last (`_shared/chatContinuation.ts`), so this no longer limits how long an answer may work.
const TOOL_BUDGET_MS = 90_000;


async function runAndBroadcast({
  jobId, provider, apiKey, modelId, systemInstruction, timeLine, messages,
  funded, workspaceId, creditLimit, connectors, availableConnectors, userId, role, web, webRequested, locale,
  authHeader, request, continuation,
}: JobRequest): Promise<void> {
  /**
   * SQEM-372 — the streaming decision, made ONCE and in one place rather than inside each provider.
   *
   * ⛔ **One** case deliberately does not stream: **funded**. `FUNDED_MODEL` is metered from
   * `usage.total_tokens`, a streamed reply reports zero tokens unless the provider honours
   * `stream_options`, and a silent under-charge is invisible in a way an over-charge never is. Lift
   * that only after observing usage on staging.
   *
   * ⭐ **SQEM-435 — connectors used to be the second case, and are not any more.** The reason on
   * record (SQEM-372) was that "the reply interleaves remote tool events with text, and folding that
   * into a delta stream is its own problem". True when it was written; solved since, by the readers
   * themselves rather than by anything aimed at this:
   *
   *   `claudeDelta`                   — only `content_block_delta` + `delta.type === 'text_delta'`
   *   `createClaudeToolAccumulator`   — opens only `content_block.type === 'tool_use'` blocks, and
   *                                     discards an `input_json_delta` with no matching entry
   *   `responsesDelta`                — only `type === 'response.output_text.delta'`
   *   `readResponsesToolCalls`        — only `type === 'function_call'`
   *
   * An `mcp_tool_use` block therefore cannot reach the text stream and cannot be executed as one of
   * ours. ⛔ Those four filters are what make this safe — `tests/unit/connectorStreaming.test.ts`
   * pins all of them, and loosening any one of them breaks this line, not just itself.
   *
   * ⚠️ The stream has GAPS with connectors: while the provider runs a remote tool server-side, no
   * text flows. "Text — pause — text" is the honest expectation, and it is still far better than a
   * silent wait of up to 300 s (SQEM-381).
   *
   * (Image models never reach this function.)
   *
   * ⭐ `broadcaster` is created per MESSAGE, not per provider call — so the tool loop below can call
   * a provider several times and the client still sees one continuous stream.
   */
  const streams = !funded;
  // SQEM-649 — a continued answer starts from the text the earlier invocations already streamed.
  const broadcaster = streams
    ? createDeltaBroadcaster(text => broadcastJobResult(jobId, { delta: text }), { initial: continuation?.loop.answer ?? '' })
    : null;
  const onDelta = broadcaster ? (inc: string) => broadcaster.push(inc) : undefined;

  /**
   * SQEM-373 — the library as tools, built for every text message that has somewhere to look.
   *
   * ⭐ **No provider excludes the library any more.** It used to be `workspaceId && !connectors?.length`,
   * because on chat completions a connector and our tools fought over one `tools` field. SQEM-377 gave
   * OpenAI the shared array on `/v1/responses`, and **SQEM-428 established that Claude never had the
   * conflict either**: its connectors live in `mcp_servers`, and what sits in `tools` alongside our
   * definitions is only the `mcp_toolset` entries pointing at them. One array, both writers, no loss.
   *
   * ⚠️ The runtime is cheap to create — the reader behind it is a thunk, so a message that never
   * calls a tool pays nothing beyond the tool definitions in the request.
   */
  //
  // ⚠️ **SQEM-378's rule still holds, it just no longer excludes anything:** the *prompt* is decided
  // here, the tools are sent below, and the two must agree. A model told to search a library whose
  // tools were never sent invents the answer (SQEM-326, unreachable persona routes). `tools` is the
  // single source for both — keep it that way.
  // SQEM-551 — what the model loaded for THIS answer, in order, sent back with the result so the
  // client can store it with the message ("Used" chips). Ids only; titles are resolved per viewer.
  const loadedTemplateIds: string[] = [];
  // SQEM-561 — what the model changed for THIS answer, for the card under it. Same ride as the ids.
  const libraryChanges: LibraryChange[] = [];
  // SQEM-594 — what this answer searched for and read. Queries and URLs only, never page content.
  const webSources: WebSources = { queries: [], pages: [] };
  const webState: WebState = { allowanceExhausted: false };
  // SQEM-595 — files the model handed out with this answer (built in the browser, never here).
  const generatedFiles: GeneratedFile[] = [];
  // SQEM-660 — the programs run_analysis ran for this answer (code and ok, never the data).
  const analyses: AnalysisRecord[] = [];
  const analysisTables = normalizeAnalysisTables(request.analysisTables);
  // SQEM-649 — what earlier invocations of this answer collected comes back first.
  const collected = continuation?.collected;
  if (collected) {
    loadedTemplateIds.push(...collected.loadedTemplateIds);
    libraryChanges.push(...(collected.libraryChanges as LibraryChange[]));
    webSources.queries.push(...(collected.webSources.queries as WebSources['queries']));
    webSources.pages.push(...(collected.webSources.pages as WebSources['pages']));
    webState.allowanceExhausted = collected.webAllowanceExhausted;
    generatedFiles.push(...(collected.generatedFiles as GeneratedFile[]));
    analyses.push(...normalizeAnalyses(collected.analyses));
  }
  /**
   * ⚠️ SQEM-661 — only the LAST invocation of an answer writes `[chat-tools]`: a hand-over returns before
   * the log (measured 2026-11-07: three invocations, one line). Until then the line counted
   * only this invocation's analyses ("the carried ones were logged before" — they never were), so a
   * chain lost the counts of every invocation but the last. It counts the whole chain now.
   */
  const connectorTablesCarried = Number.isInteger(collected?.connectorTables) ? collected!.connectorTables! : 0;
  // SQEM-649 — the 10 minutes count from the person's message, not from this invocation.
  const invocationStartedAt = Date.now();
  const chainStartedAt = continuation?.chainStartedAt ?? invocationStartedAt;
  const gen = continuation?.gen ?? 1;
  // SQEM-651 — built below, once the runtime exists; the persona hook reaches it through this binding.
  let pool: ConnectorPool<ResolvedConnector> | null = null;
  const tools: ToolRuntime | null = workspaceId
    ? createLibraryToolRuntime(
        () => createLibraryReader({ client: createAdminClient(), workspaceId, userId, unzip: unzipEntries }), // SQEM-658
        {
          maxRounds: MAX_TOOL_ROUNDS, // SQEM-650
          // SQEM-649 — this invocation's budget, but never past the chain's end.
          budgetMs: invocationDeadline(invocationStartedAt, chainStartedAt, TOOL_BUDGET_MS) - invocationStartedAt,
          /**
           * SQEM-561 — every MCP tool, by role, through the SAME handlers MCP runs
           * (`_shared/libraryActions.ts`): one implementation of "may this person change this".
           * ⛔ Still the chat user's own id — never a key (SQEM-346).
           */
          actions: {
            definitions: chatActionDefinitions(role, { selfHosted: SELF_HOSTED }), // SQEM-663
            run: (name, args, lib) => runLibraryTool(
              { adminClient: createAdminClient(), workspaceId, userId, role, lib, surface: 'chat' }, name, args),
          },
          onChange: (change) => addChange(libraryChanges, change),
          // SQEM-651 — a persona loaded mid-answer fetches its connector services.
          onPersonaLoaded: (services) => pool ? pool.fetchForPersona(services, userId) : Promise.resolve(''),
          // SQEM-517 — counted per workspace and day, never per person; fire-and-forget.
          onTemplateLoaded: (templateId) => {
            if (!loadedTemplateIds.includes(templateId) && loadedTemplateIds.length < MAX_LOADED_IDS) loadedTemplateIds.push(templateId);
            countUsage(createAdminClient(), workspaceId, 'chat', 'playbook_loaded', templateId);
          },
        },
      )
    : null;
  // SQEM-649 — past the budget, the answer goes on in a new invocation while the chain has time.
  if (tools) tools.mayContinue = () => canContinue(chainStartedAt, gen, Date.now());

  /**
   * SQEM-378 — the standing library instruction, **only when the tools are really in the request.**
   *
   * ⭐ Order since SQEM-654 is stable → changing: the library rule, then whatever assistant and skills
   * the session applied, then the web line and SQEM-370's date line. The date is an environment fact
   * that needs to be *available*, not prominent — at the end it is both, and the start of the request
   * stays the same from message to message, which is what a provider's prompt cache needs.
   *
   * ⚠️ ~2,000 characters on every message that carries tools. Named rather than discovered: the
   * behaviour rules — say which template you used, ask when several match, do not paste the contents
   * — exist nowhere else, and the tool descriptions alone do not carry them.
   */
  // SQEM-594 — the web line goes OUTSIDE the library prompt: it is about this one message, the
  // library rule about every message.
  //
  // ⭐ SQEM-654 — stable first, changing last. Providers cache the START of a request only while it stays
  // byte-identical: the library rule and the session's persona and skills are the same on every message,
  // the date line changes by the minute and the web line by the message. Until 654 both stood in FRONT,
  // so nothing after them could be reused from one message to the next. Same text, other position.
  /**
   * SQEM-661 — connector results that are lists become tables for run_analysis, for this answer only.
   * Only when the browser can take them (`connectorAnalysis`) and the model has connectors at all.
   */
  const connectorTables = tools && request.connectorAnalysis === true && ((connectors?.length ?? 0) > 0 || availableConnectors.length > 0)
    ? new ConnectorTableStore((info, outcome) => {
      // SQEM-661 — which result became which tables (keys, rows, column count; never a value), or why
      // none. Edge log only: connector names are customer data and stay out of the monitor (SQEM-653).
      console.log('[chat-tables]', JSON.stringify({
        jobId, connector: info.connector, tool: info.tool, chars: info.chars,
        ...('tables' in outcome
          ? { tables: outcome.tables.map(t => ({ key: t.key, rows: t.rows, columns: t.columns.length })) }
          : { none: outcome.reason }),
      }));
    }) : undefined;
  const stableInstruction = tools ? withLibraryPrompt(systemInstruction) : systemInstruction;
  const changingInstruction = [tools && web ? WEB_SEARCH_INSTRUCTION : null, tools && analysisTables.length ? ANALYSIS_INSTRUCTION : null, connectorTables ? CONNECTOR_ANALYSIS_INSTRUCTION : null, timeLine].filter(Boolean).join('\n\n');
  const instruction = [stableInstruction, changingInstruction].filter(Boolean).join('\n\n') || undefined;

  // SQEM-381 — measured, so the next timeout decision rests on a distribution rather than on the
  // observation "the more connectors, the more often it times out". Logged below only for connector
  // turns; the plain path has never been the problem.
  const startedAt = invocationStartedAt;

  // SQEM-583 — Stop. The browser writes a row; this job looks for it and aborts every provider request.
  const cancel = new AbortController();
  const cancelWatch = watchForCancel(jobId, userId, async (j, u) => {
    const admin = createAdminClient();
    const { data } = await admin.from('chat_job_cancellations').select('job_id').eq('job_id', j).eq('user_id', u).maybeSingle();
    if (!data) return false;
    await admin.from('chat_job_cancellations').delete().eq('job_id', j);
    return true;
  }, cancel);

  /**
   * SQEM-649 — call this function again with the state, as the person (their JWT in the header). True
   * when the next invocation accepted it. ⛔ A state with a secret in it is never sent.
   */
  const handOver = async (state: ContinuationState, secrets: (string | null)[]): Promise<boolean> => {
    try {
      await broadcaster?.flush(); // ⚠️ before the next invocation streams on from the same text
      const signed = await signContinuation(state, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '');
      if (containsSecret(signed.state, secrets)) {
        console.error('[chat-continue] state carried a secret — not handed over', JSON.stringify({ jobId }));
        return false;
      }
      // SQEM-656 — `?handover=1`: the self-host router starts a fresh worker for it (Cloud ignores it).
      const res = await fetch(`${Deno.env.get('SUPABASE_URL')}/functions/v1/chat-message?handover=1`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': authHeader },
        body: JSON.stringify({ continuation: signed }),
        signal: cancel.signal,
      });
      const ok = res.ok;
      await res.body?.cancel();
      console.log('[chat-continue]', JSON.stringify({
        jobId, provider, gen: state.gen, status: res.status, bytes: signed.state.length,
        rounds: state.tools?.stats.rounds ?? null, invocationMs: Date.now() - invocationStartedAt, chainMs: Date.now() - chainStartedAt,
      }));
      if (ok) await broadcastJobResult(jobId, { continued: state.gen });
      return ok;
    } catch (e: any) {
      if (cancel.signal.aborted) throw e; // Stop during the hand-over: the cancel branch below
      console.error('[chat-continue] hand-over failed:', e?.message ?? e);
      return false;
    }
  };

  try {
    let result: string;
    // SQEM-649 — starts with what the last invocation used and did not charge (`tokenCarry`).
    let totalTokens = continuation?.tokenCarry ?? 0;
    // SQEM-584 — providers without their own MCP support get the connectors' tools as functions in the
    // same loop as the library. A connector whose tool list cannot be fetched is left out and named
    // under the answer, as Claude and OpenAI do (SQEM-466/572) — never the whole answer lost.
    // SQEM-594 — the web tools go into the BASE runtime: Claude and OpenAI get `base` (they run
    // connectors themselves), every other provider gets it wrapped with the connectors on top.
    let base = tools;
    if (base && web) {
      base = withWebTools(base, {
        search: (q, signal) => searchWeb(web.provider, web.key, q, fetch, signal),
        read: (url, signal) => readWebPage(url, fetch, typeof Deno.resolveDns === 'function' ? resolveHost : undefined, signal),
        allowSearch: web.hosted && workspaceId
          ? async () => {
              // SQEM-594 — the allowance comes from the plan, decided in the database (one source of truth).
              const { data, error } = await createAdminClient().rpc('consume_web_search', { p_workspace_id: workspaceId });
              if (error) { console.error('[chat-web] consume failed:', error.message); return false; }
              return data === true;
            }
          : undefined,
      }, webSources, cancel.signal, webState);
    }
    // SQEM-595 — create_file for every text model, always: it costs nothing until it is used.
    if (base) base = withFileTool(base, generatedFiles);
    // SQEM-660 — run_analysis only with attached tables; the program runs in the person's browser.
    if (base) base = withAnalysisTool(base, analysisTables, (code, pending) => requestBrowserAnalysis(jobId, code, cancel.signal, pending), analyses, connectorTables);
    let runtime = base;
    let unreachable: string[] = [];
    /**
     * ⭐ SQEM-652 — EVERY provider calls connectors through sqemes, Claude and OpenAI included, so every
     * result is bounded (`MCP_RESULT_MAX_CHARS`). Through the provider (`mcp_servers`, `tools[type:mcp]`)
     * a result came back whole and unseen: one customer, 2026-10-29, over Claude's 1M tokens.
     * Measured once per model before the switch: about as fast, one model request more per connector call
     * (the history is sent again) — which is what prompt caching (SQEM-654) is for.
     */
    if (base && connectors?.length) {
      const loaded = await loadConnectorTools(connectors.map(c => ({
        url: c.url, token: c.token, displayName: c.displayName, allowedTools: c.allowedTools,
      })), { signal: cancel.signal, onResult: connectorTables?.hook() });
      runtime = withConnectorTools(base!, loaded, cancel.signal);
      unreachable = loaded.failed;
    }
    // SQEM-649 — a continuation: the counters, refusals and collected names of the earlier invocations.
    if (continuation) {
      unreachable = [...new Set([...continuation.collected.unreachable, ...unreachable])];
      if (continuation.tools) {
        base = base && restoreToolRuntime(base, continuation.tools);
        runtime = runtime && restoreToolRuntime(runtime, continuation.tools);
      }
    }
    /**
     * SQEM-651 — the connectors the model may fetch. Wrapped LAST, after `restoreToolRuntime`, because
     * fetched tools are pushed into the array this wrapper creates (`_shared/connectorPool.ts`).
     * The fetched connector's tools are listed here and offered as functions, on every provider (SQEM-652).
     */
    if (tools && availableConnectors.length) {
      const admin = createAdminClient();
      pool = new ConnectorPool<ResolvedConnector>(availableConnectors, connectors ?? [], {
        resolve: async (ids) => (await resolveConnectors(admin, workspaceId!, userId, ids)) ?? [],
        load: (cs, offset) => loadConnectorTools(cs.map(c => ({
          url: c.url, token: c.token, displayName: c.displayName, allowedTools: c.allowedTools,
        })), { signal: cancel.signal, offset, onResult: connectorTables?.hook() }),
      }, { fetchedNames: continuation?.collected.fetchedConnectors ?? [] });
      runtime = runtime && withConnectorPool(runtime, pool, cancel.signal);
    }

    // One provider call chain. Called once — and a second time only when a hand-over failed (below).
    const dispatch = async (base: ToolRuntime | null, runtime: ToolRuntime | null, resume?: LoopSnapshot): Promise<string> => {
      if (provider === 'gemini') return callGemini(apiKey, modelId, instruction, messages, false, onDelta, runtime, cancel.signal, locale, resume);
      // SQEM-652 — every provider gets `runtime`: the library plus the connectors' functions.
      if (provider === 'openai') return callOpenAIResponses(apiKey, modelId, instruction, messages, onDelta, runtime, cancel.signal, locale, resume);
      if (provider === 'claude') return callClaude(apiKey, modelId, instruction, messages, onDelta, runtime, cancel.signal, locale, resume, { stable: stableInstruction, changing: changingInstruction });
      const endpoint = OPENAI_COMPATIBLE[provider];
      if (endpoint) {
        const r = await callOpenAICompatible(apiKey, modelId, endpoint, instruction, messages, provider, onDelta, runtime, cancel.signal, locale, resume);
        totalTokens += r.totalTokens;
        return r.content;
      }
      if (provider === 'loadtest') return runLoadtestMock(onDelta, tools);
      return `[${provider}] Model ${modelId} is not yet supported.`;
    };

    try {
      result = await dispatch(base, runtime, continuation?.loop);
    } catch (err) {
      if (!(err instanceof ChatContinuation)) throw err;
      /**
       * SQEM-649 — this invocation's time is up and the chain's is not. Charge what this invocation
       * used, hand the state to a new one, and end here; the new one broadcasts the result.
       */
      totalTokens += err.totalTokens;
      const { charge, carry } = splitTokens(totalTokens);
      const state: ContinuationState = {
        // SQEM-651 — the connectors fetched so far ride on as part of the request the next one resolves.
        v: 1, jobId, userId, workspaceId: workspaceId!, chainStartedAt, gen: gen + 1, provider,
        request: pool ? { ...request, connectorIds: pool.activeIds() } : request,
        loop: err.loop, tokenCarry: carry,
        // SQEM-650 — the repeat counts travel too, so a loop is still a loop after a hand-over.
        tools: tools ? { stats: { ...tools.stats }, callCounts: { ...(tools.callCounts ?? {}) } } : null,
        collected: {
          loadedTemplateIds, libraryChanges, webSources,
          webAllowanceExhausted: webState.allowanceExhausted, generatedFiles, analyses,
          connectorTables: connectorTablesCarried + (connectorTables?.built ?? 0), // SQEM-661
          unreachable: [...new Set([...unreachable, ...(pool?.failed ?? [])])],
          fetchedConnectors: pool?.fetchedNames ?? [],
        },
      };
      const handed = await handOver(state, [apiKey, authHeader.replace(/^Bearer\s+/i, ''), ...(pool?.active ?? connectors ?? []).map(c => c.token)]);
      if (handed) {
        if (funded && workspaceId) {
          try { await debitCredits(createAdminClient(), workspaceId, charge, creditLimit); } catch (debitErr: any) {
            console.error('credit debit failed:', debitErr?.message ?? debitErr);
          }
        }
        return;
      }
      // The hand-over failed (an expired login, a refused request): answer here, as before 649 —
      // the next round is the last one, with the time notice.
      result = await dispatch(
        base && restoreToolRuntime(base, { stats: tools!.stats }, { forceFinal: true }),
        runtime && restoreToolRuntime(runtime, { stats: tools!.stats }, { forceFinal: true }),
        err.loop,
      );
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
    if (pool?.failed.length) unreachable = [...new Set([...unreachable, ...pool.failed])]; // SQEM-651 — before the logs, so [chat-tools] counts them (SQEM-653)
    const carried = pool?.active ?? connectors ?? [];
    if (carried.length) {
      console.log('[chat-connectors]', JSON.stringify({
        jobId, provider, connectors: carried.length, durationMs: Date.now() - startedAt,
        // SQEM-651 — how many the person could use, and which the model fetched in this answer.
        available: availableConnectors.length, fetched: pool?.fetchedNames.length ?? 0,
        timeoutMs: providerTimeoutMs({ selfHosted: SELF_HOSTED }),
      }));
    }
    // SQEM-616 — a cut-off call is not executed, so it does not count in `calls`; it must still be logged.
    if (tools && (tools.stats.calls > 0 || tools.stats.toolsRefused || tools.stats.refusedConnectors.length > 0 || Object.keys(tools.stats.truncated).length > 0)) {
      console.log('[chat-tools]', JSON.stringify({
        jobId, provider, funded, ...tools.stats, maxRounds: tools.maxRounds,
        // SQEM-648 — how many connectors this turn carried; with `nativeConnectorCalls` it tells a turn
        // without connectors from one whose connectors were never called.
        connectorsOffered: connectors?.length ?? 0,
        connectorsAvailable: availableConnectors.length, connectorsFetched: pool?.fetchedNames.length ?? 0, // SQEM-651
        unreachable: unreachable.length, // SQEM-653 — a count for the monitor; the names stay in [chat-mcp]
        // SQEM-648 — the time per message, so the 90 s budget can be judged against real rounds.
        // SQEM-649 — per invocation; `chainMs` is the whole answer across hand-overs.
        durationMs: Date.now() - startedAt, chainMs: Date.now() - chainStartedAt, gen,
        // SQEM-660 step C — analyses run, failed, and never started (Python did not load): the monitor's counts.
        ...(analyses.length ? analysisLogCounts(analyses) : {}), // the whole chain (SQEM-661)
        ...(connectorTablesCarried + (connectorTables?.built ?? 0) ? { connectorTables: connectorTablesCarried + (connectorTables?.built ?? 0) } : {}), // SQEM-661
      }));
    }
    // ⛔ The cap must be VISIBLE. A model cut off mid-investigation answers confidently from half the
    // material, and nothing in the reply would say so.
    if (tools?.stats.cappedAt) result += toolCapNotice(tools.stats.cappedAt, tools.stats.cappedBy ?? 'rounds', locale);
    if (tools) result += truncatedNotice(tools.stats, locale); // SQEM-616 — a cut-off call is said, not swallowed
    if (tools) result += toolsRefusedNotice(tools.stats, locale); // SQEM-638 — a refused tool list is said too
    if (unreachable.length) result += connectorRefusedNotice(unreachable, locale); // SQEM-584
    if (pool) result += connectorsFetchedNotice(pool.fetchedNames, locale); // SQEM-651
    // SQEM-594 — switched on but no key anywhere (self-host without a search key): say so, once.
    if (webRequested && !web) result += webNotSetUpNotice(locale);
    // SQEM-594 — the model is told too, but says it in its own words (seen in testing: "I cannot search
    // right now") — the reason has to be stated, once, in ours.
    if (webState.allowanceExhausted) result += allowanceNotice(locale);
    if (webSources.queries.length || webSources.pages.length) {
      console.log('[chat-web]', JSON.stringify({ jobId, provider, hosted: web?.hosted ?? null, searches: webSources.queries.length, pages: webSources.pages.length }));
    }

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
    // SQEM-551 — `loadedTemplateIds` rides on the same message as the text, so the two cannot be
    // separated by a dropped broadcast. A client from before 551 ignores the extra key.
    // SQEM-561 — `libraryChanges` the same way; an older client ignores the key.
    await broadcastJobResult(jobId, {
      result,
      ...(loadedTemplateIds.length ? { loadedTemplateIds } : {}),
      ...(libraryChanges.length ? { libraryChanges } : {}),
      // SQEM-594 — an older client ignores the key.
      ...(webSources.queries.length || webSources.pages.length ? { webSources } : {}),
      // SQEM-595 — the file descriptions; an older client ignores the key.
      ...(generatedFiles.length ? { generatedFiles } : {}),
      // SQEM-660 — what run_analysis ran, for the "Analysis run" line; an older client ignores it.
      ...(analyses.length ? { analyses } : {}),
      // SQEM-651 — what the session carries on with; the browser stores it. An older client ignores it.
      ...(pool?.fetchedNames.length ? { connectorIds: pool.activeIds() } : {}),
    });
  } catch (err: any) {
    // SQEM-583 — stopped by the person: nobody is listening any more, and an error would be a lie.
    if (cancel.signal.aborted) {
      console.log('[chat-cancel]', JSON.stringify({ jobId, provider, funded, durationMs: Date.now() - startedAt }));
      return;
    }
    // SQEM-653 — counted by the ops monitor. The kind and the status only, ⛔ never the message: a
    // provider may quote the request back in it.
    const message = String(err?.message ?? '');
    console.error('[chat-error]', JSON.stringify({ jobId, provider, model: modelId, funded, kind: chatErrorKind(message), status: errorStatus(message) }));
    // No flush here on purpose: a partial answer followed by an error reads as if the fragment were
    // the reply. The client drops what it has when an error arrives.
    await broadcastJobResult(jobId, { error: err?.message ?? 'Unknown error' });
  } finally {
    cancelWatch.stop();
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
  /** SQEM-583 — aborted when the person presses Stop; reaches every provider request below. */
  signal?: AbortSignal,
  /** SQEM-604 — the language of the notices this function adds to an answer. */
  locale: Locale = 'en',
  /** SQEM-649 — where an earlier invocation stopped; its message list replaces the one built here. */
  resume?: LoopSnapshot,
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

  const contents: any[] = resume ? resume.convo as any[] : messages.map(msg => {
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
  } else {
    generationConfig.maxOutputTokens = OUTPUT_LIMIT.gemini; // SQEM-616 — a tool call is output too
  }

  // SQEM-373 — image models never call tools: they return one response with inline data and there is
  // nothing to look up mid-generation.
  let activeTools = isImageModel ? null : (tools ?? null);
  let answer = resume?.answer ?? '';

  for (;;) {
    const body: any = { contents, generationConfig };
    if (systemInstruction) {
      body.systemInstruction = { parts: [{ text: systemInstruction }] };
    }
    if (activeTools) body.tools = toGeminiTools(activeTools.definitions);
    // SQEM-637 — the last round: the declarations stay (the history holds calls to them), calling is off.
    if (activeTools?.final) body.toolConfig = { functionCallingConfig: { mode: 'NONE' } };

    const response = await fetchWithTimeout(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
      body: JSON.stringify(body),
      signal,
    }, providerTimeoutMs({ selfHosted: SELF_HOSTED })); // SQEM-582 — was the 120 s image default

    if (!response.ok) {
      const errText = await response.text();
      // SQEM-375 — the model cannot do function tools. Retry once without them rather than
      // failing the whole message; `activeTools` is null from here, so this cannot loop.
      if (activeTools && toolsWereRefused(response.status, errText)) {
        // SQEM-638 — 2000, not 300: the log of 2026-11-03 ended mid-list and hid every reason after the first.
        console.warn('[chat-tools] provider refused function tools:', errText.slice(0, 2000));
        // SQEM-637 — refused in the last round: the provider will not take "no calls"; answer the old way.
        activeTools = activeTools.final ? null : afterToolsRefused(activeTools); // connectors first, the library last
        continue;
      }
      throw new Error(`Gemini API error (${response.status}): ${errText}`);
    }

    let text = '';
    let toolCalls: StreamedToolCall[] = [];
    if (streaming) {
      const acc = activeTools ? createGeminiToolAccumulator() : null;
      let roundUsage: TokenCount | null = null; // SQEM-654 — cumulative per round: keep the last
      const r = await readSSE(response.body, geminiDelta, onDelta!, tools ? (chunk) => {
        acc?.onChunk(chunk);
        tools.stats.stopReason = stopReasonOf(chunk) ?? tools.stats.stopReason; // SQEM-637
        roundUsage = geminiUsage(chunk) ?? roundUsage;
      } : undefined);
      addUsage(tools?.stats, roundUsage);
      text = r.text;
      toolCalls = acc?.calls() ?? [];
    } else {
      const data = await response.json();
      addUsage(tools?.stats, geminiUsage(data)); // SQEM-654
      const parts = data.candidates?.[0]?.content?.parts || [];
      for (const part of parts) {
        if (part.text) text += part.text;
        if (part.inlineData) {
          text += `\n\n![Generated Image](data:${part.inlineData.mimeType};base64,${part.inlineData.data})\n\n`;
        }
      }
      toolCalls = readGeminiToolCalls(parts);
      if (tools) tools.stats.stopReason = stopReasonOf(data) ?? tools.stats.stopReason; // SQEM-637
    }
    answer += text;

    if (!activeTools || activeTools.final || !toolCalls.length) return answer || noAnswerText(tools?.stats, locale);

    contents.push(geminiModelTurn(text, toolCalls) as any);
    const results: { name: string; output: string }[] = [];
    for (const call of toolCalls) {
      results.push({ name: call.name, output: await runToolCall(activeTools, call) });
    }
    contents.push(geminiToolResults(results) as any);
    activeTools = advanceToolRound(activeTools, toolCalls.map(c => c.name));
    if (activeTools?.handoff) throw new ChatContinuation({ convo: contents, answer }); // SQEM-649
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
  onDelta?: (increment: string) => void,
  /** SQEM-373 — the library; since SQEM-652 also the connectors' tools, run through sqemes. */
  tools?: ToolRuntime | null,
  /** SQEM-583 — aborted when the person presses Stop; reaches every provider request below. */
  signal?: AbortSignal,
  /** SQEM-604 — the language of the notices this function adds to an answer. */
  locale: Locale = 'en',
  /** SQEM-649 — where an earlier invocation stopped; its message list replaces the one built here. */
  resume?: LoopSnapshot,
): Promise<string> {
  const input = resume ? resume.convo as any[] : toResponsesInput(messages, (d) => decodeTextFile(d).text);

  let activeTools = tools ?? null;
  let answer = resume?.answer ?? '';
  // ⛔ SQEM-652 — no `tools[type:mcp]` any more: connectors arrive as functions in `tools` and run
  // through sqemes, so their results are bounded. A connector that cannot list its tools is left out and
  // named under the answer by the caller (SQEM-584); OpenAI never sees it, so there is nothing to refuse.

  for (;;) {
    const body: Record<string, unknown> = { model: modelId, input, max_output_tokens: OUTPUT_LIMIT.openai }; // SQEM-616
    if (systemInstruction) body.instructions = systemInstruction;
    if (onDelta) body.stream = true;

    // SQEM-377/652 — one array of functions: the library, files, web and the connectors' tools.
    if (activeTools) body.tools = toResponsesTools(activeTools.definitions);
    if (activeTools?.final) body.tool_choice = 'none'; // SQEM-637 — the last round answers

    const response = await fetchWithTimeout('https://api.openai.com/v1/responses', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
      body: JSON.stringify(body),
      signal,
    }, providerTimeoutMs({ selfHosted: SELF_HOSTED })); // SQEM-652 — one model call; connectors run between rounds

    if (!response.ok) {
      const errText = await response.text();
      // SQEM-375 — kept even here. Responses fixes OpenAI's reasoning models, not every model a
      // workspace might point at.
      if (activeTools && toolsWereRefused(response.status, errText)) {
        // SQEM-638 — 2000, not 300: the log of 2026-11-03 ended mid-list and hid every reason after the first.
        console.warn('[chat-tools] provider refused function tools:', errText.slice(0, 2000));
        // SQEM-637 — refused in the last round: the provider will not take "no calls"; answer the old way.
        activeTools = activeTools.final ? null : afterToolsRefused(activeTools); // connectors first, the library last
        continue;
      }
      throw new Error(`OpenAI API error (${response.status}): ${errText}`);
    }

    let text = '';
    let items: any[] = [];
    let round: ResponsesRoundState;
    if (onDelta) {
      const collector = createResponsesItemCollector();
      // SQEM-572 — the round's own status rides the same chunks: a stream can fail after the 200.
      const watcher = createResponsesStreamWatcher();
      const r = await readSSE(response.body, responsesDelta, onDelta, (chunk) => { collector.onChunk(chunk); watcher.onChunk(chunk); addUsage(tools?.stats, responsesUsage(chunk)); }); // SQEM-652 — usage
      text = r.text;
      items = collector.items();
      round = watcher.state();
    } else {
      const data = await response.json();
      addUsage(tools?.stats, responsesUsage(data)); // SQEM-652
      items = data.output || [];
      text = readResponsesText(items) || data.output_text || '';
      round = responsesBodyState(data);
    }
    // ⛔ SQEM-572 — a failed or empty-incomplete round is an ERROR with OpenAI's own words, not an empty
    // answer: "No content generated." told nobody why.
    const problem = responsesRoundProblem(round, text);
    if (problem) {
      console.error('[chat-openai]', JSON.stringify({ model: modelId, ...round, itemTypes: items.map((i: any) => i?.type) }));
      throw new Error(problem);
    }
    if (round.incomplete) console.warn('[chat-openai] incomplete answer kept', JSON.stringify({ model: modelId, reason: round.incomplete }));
    if (tools) tools.stats.stopReason = round.incomplete ?? round.status ?? tools.stats.stopReason; // SQEM-637
    if (tools) tools.stats.nativeConnectorCalls += countNativeConnectorCalls(items); // SQEM-648
    answer += text;

    const toolCalls = activeTools ? readResponsesToolCalls(items) : [];
    if (!activeTools || activeTools.final || !toolCalls.length) {
      // SQEM-572 — if it is still empty, say in the log what the round looked like; the user still gets
      // the old sentence, but the next case is no longer a guess.
      if (!answer) console.warn('[chat-openai] empty answer', JSON.stringify({ model: modelId, ...round, itemTypes: items.map((i: any) => i?.type) }));
      return answer || noAnswerText(tools?.stats, locale);
    }

    // ⛔ EVERY item goes back, verbatim — reasoning items included, not just the calls. A reasoning
    // model that does not get its own reasoning back loses the thinking it already charged for, and
    // rebuilding an item is exactly what cost SQEM-376 two hours earlier.
    input.push(...items);
    const results: { id: string; output: string }[] = [];
    for (const call of toolCalls) {
      results.push({ id: call.id, output: await runToolCall(activeTools, call) });
    }
    input.push(...responsesToolResults(results));
    activeTools = advanceToolRound(activeTools, toolCalls.map(c => c.name));
    if (activeTools?.handoff) { // SQEM-649
      throw new ChatContinuation({ convo: input, answer });
    }
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
  /** The round's total (credits) and, SQEM-654, the whole `usage` object for the log. */
  onUsage?: (totalTokens: number, usage?: unknown) => void,
  /** SQEM-637 — the provider's `finish_reason`, for the log. */
  onStop?: (reason: string) => void,
): Promise<{ text: string; toolCalls: StreamedToolCall[] }> {
  if (onDelta) {
    const acc = activeTools ? createOpenAiToolAccumulator() : null;
    const { text } = await readSSE(
      response.body,
      (chunk) => {
        // The usage chunk carries no `choices[].delta.content`, so the text extractor ignores it; it
        // is picked up here on the side.
        const usage = (chunk as { usage?: { total_tokens?: number } })?.usage;
        if (usage?.total_tokens) onUsage?.(usage.total_tokens, usage);
        const stop = stopReasonOf(chunk);
        if (stop) onStop?.(stop);
        return openAiDelta(chunk);
      },
      onDelta,
      acc ? (chunk) => acc.onChunk(chunk) : undefined,
    );
    return { text, toolCalls: acc?.calls() ?? [] };
  }

  const data = await response.json();
  if (data?.usage?.total_tokens) onUsage?.(data.usage.total_tokens, data.usage);
  const stop = stopReasonOf(data);
  if (stop) onStop?.(stop);
  const message = data.choices?.[0]?.message;
  return { text: contentText(message?.content), toolCalls: readOpenAiToolCalls(message) }; // SQEM-594 — may be an array of parts
}

// SQEM-373/637/648 — `advanceToolRound` lives in `_shared/libraryTools.ts` (pure, so it is tested there).

async function callClaude(
  apiKey: string,
  modelId: string,
  systemInstruction: string | undefined,
  messages: ChatMessage[],
  onDelta?: (increment: string) => void,
  /** SQEM-373 — the library; since SQEM-652 also the connectors' tools, run through sqemes. */
  tools?: ToolRuntime | null,
  /** SQEM-583 — aborted when the person presses Stop; reaches every provider request below. */
  signal?: AbortSignal,
  /** SQEM-604 — the language of the notices this function adds to an answer. */
  locale: Locale = 'en',
  /** SQEM-649 — where an earlier invocation stopped; its message list replaces the one built here. */
  resume?: LoopSnapshot,
  /** SQEM-654 — the system instruction in its two halves, so the stable one gets its own cache point. */
  systemParts?: { stable?: string; changing?: string },
): Promise<string> {
  const apiMessages: any[] = resume ? resume.convo as any[] : messages.map(msg => {
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

  /**
   * ⭐ SQEM-652 — connectors are ordinary functions in `tools` now, run through sqemes and bounded
   * (`MCP_RESULT_MAX_CHARS`). Until then they went in `body.mcp_servers` (one `mcp_toolset` each, SQEM-428)
   * and Anthropic ran them itself, appending every result whole — one customer, 2026-10-29: past Claude's 1M tokens.
   * Two things went with that path: the refused-server retry (SQEM-466; a connector that cannot list its
   * tools is now left out before the request, SQEM-584) and the loss that Claude did not see its own
   * connector results in the next round (they are tool results in the history now).
   */
  let activeTools = tools ?? null;
  let answer = resume?.answer ?? '';
  let pauses = 0; // SQEM-649 — `pause_turn` resumes in this invocation

  for (;;) {
    const body: any = { model: modelId, max_tokens: OUTPUT_LIMIT.claude, messages: apiMessages };  // SQEM-125 — no temperature
    // ⭐ SQEM-435 — connector turns stream too. The caller decides (one place, see `streams`); this
    // branch has never guessed and still does not. `claudeDelta` takes only `text_delta`, the
    // accumulator only opens `tool_use` blocks.
    if (onDelta) body.stream = true;
    /**
     * ⭐ SQEM-654 — prompt caching. The top-level `cache_control` lets Anthropic place the cache point on
     * the last block and move it forward round by round, so a tool loop pays the repeated history at
     * ~0.1× (5-minute entries; the rounds of one answer are seconds apart). The explicit point after the
     * STABLE half of the system instruction survives from one message to the next — the changing half
     * (date line, web line) sits after it. Below the model's minimum length nothing is cached: no error.
     */
    body.cache_control = { type: 'ephemeral' };
    if (systemParts?.stable) {
      body.system = [
        { type: 'text', text: systemParts.stable, cache_control: { type: 'ephemeral' } },
        ...(systemParts.changing ? [{ type: 'text', text: systemParts.changing }] : []),
      ];
    } else if (systemInstruction) {
      body.system = systemInstruction;
    }
    // SQEM-428/652 — ONE array of functions: the library, files, web and the connectors' tools.
    if (activeTools) body.tools = toClaudeTools(activeTools.definitions);
    if (activeTools?.final) body.tool_choice = { type: 'none' }; // SQEM-637 — the last round answers

    const response = await fetchWithTimeout('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
      signal,
    }, providerTimeoutMs({ selfHosted: SELF_HOSTED })); // SQEM-652 — one model call; connectors run between rounds

    if (!response.ok) {
      const errText = await response.text();
      // SQEM-375 — the model cannot do function tools. Retry once without them rather than
      // failing the whole message; `activeTools` is null from here, so this cannot loop.
      if (activeTools && toolsWereRefused(response.status, errText)) {
        // SQEM-638 — 2000, not 300: the log of 2026-11-03 ended mid-list and hid every reason after the first.
        console.warn('[chat-tools] provider refused function tools:', errText.slice(0, 2000));
        // SQEM-637 — refused in the last round: the provider will not take "no calls"; answer the old way.
        activeTools = activeTools.final ? null : afterToolsRefused(activeTools); // connectors first, the library last
        continue;
      }
      throw new Error(`Claude API error (${response.status}): ${errText}`);
    }

    let text = '';
    let toolCalls: StreamedToolCall[] = [];
    // SQEM-649 — the turn's own stop reason and every block of it, for `pause_turn` (_shared/claudePause.ts).
    let stop: string | null = null;
    let turnBlocks: unknown[] = [];
    if (onDelta) {
      const acc = activeTools ? createClaudeToolAccumulator() : null;
      // SQEM-649/652 — kept although no server tool is sent any more: a pause resumes cheaply if one returns.
      const blocks = createClaudeBlockCollector();
      const r = await readSSE(response.body, claudeDelta, onDelta, (chunk) => {
        acc?.onChunk(chunk);
        blocks?.onChunk(chunk);
        stop = stopReasonOf(chunk) ?? stop;
        addUsage(tools?.stats, claudeUsage(chunk)); // SQEM-652 — usage, for the measurement
        if (tools) {
          tools.stats.stopReason = stopReasonOf(chunk) ?? tools.stats.stopReason; // SQEM-637
          tools.stats.nativeConnectorCalls += countNativeConnectorCalls([(chunk as any)?.content_block]); // SQEM-648
        }
      });
      text = r.text;
      toolCalls = acc?.calls() ?? [];
      turnBlocks = blocks?.blocks() ?? [];
    } else {
      const data = await response.json();
      addUsage(tools?.stats, claudeUsage(data)); // SQEM-652
      if (tools) tools.stats.nativeConnectorCalls += countNativeConnectorCalls(data.content); // SQEM-648
      text = (data.content || []).map((c: any) => c.text || '').join('');
      toolCalls = readClaudeToolCalls(data.content);
      stop = stopReasonOf(data);
      turnBlocks = data.content || [];
      if (tools) tools.stats.stopReason = stopReasonOf(data) ?? tools.stats.stopReason; // SQEM-637
    }
    answer += text;

    /**
     * SQEM-649 — Anthropic paused its own connector loop. The turn goes back EXACTLY as it came, with
     * no extra message, and Anthropic resumes it. Bounded per invocation; past the bound the text so
     * far is the answer, as before.
     */
    if (isPauseTurn(stop) && !toolCalls.length && turnBlocks.length && pauses < MAX_PAUSE_RESUMES) {
      pauses += 1;
      apiMessages.push({ role: 'assistant', content: turnBlocks });
      if (activeTools && !activeTools.final) {
        activeTools = advanceToolRound(activeTools, []);
        if (activeTools?.handoff) {
          throw new ChatContinuation({ convo: apiMessages, answer });
        }
      }
      continue;
    }

    if (!activeTools || activeTools.final || !toolCalls.length) {
      // ⛔ The drop must be VISIBLE — the same argument as `toolCapNotice`. Somebody who asks about
      // their Shopify orders and gets an answer without Shopify will believe the answer.
      return answer || noAnswerText(tools?.stats, locale);
    }

    apiMessages.push(claudeAssistantTurn(text, toolCalls) as any);
    const results: { id: string; output: string }[] = [];
    for (const call of toolCalls) {
      results.push({ id: call.id, output: await runToolCall(activeTools, call) });
    }
    // ⚠️ ALL results in ONE user turn. Claude rejects a turn that answers only some of the tool_use
    // blocks in the assistant message before it.
    apiMessages.push(claudeToolResults(results) as any);
    activeTools = advanceToolRound(activeTools, toolCalls.map(c => c.name));
    if (activeTools?.handoff) { // SQEM-649
      throw new ChatContinuation({ convo: apiMessages, answer });
    }
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
  /** SQEM-583 — aborted when the person presses Stop; reaches every provider request below. */
  signal?: AbortSignal,
  /** SQEM-604 — the language of the notices this function adds to an answer. */
  locale: Locale = 'en',
  /** SQEM-649 — where an earlier invocation stopped; its message list replaces the one built here. */
  resume?: LoopSnapshot,
): Promise<{ content: string; totalTokens: number }> {
  const apiMessages: any[] = resume ? resume.convo as any[] : [];

  // SQEM-649 — a resumed list already starts with the system message and holds every turn.
  if (systemInstruction && !resume) {
    apiMessages.push({ role: 'system', content: systemInstruction });
  }

  // Only these two can take a document; for the others a PDF is still dropped. Verified against the
  // providers' own docs on 2026-09-01 — grok takes images only, deepseek's schema has no file part.
  const pdfShape = provider === 'mistral' || provider === 'openrouter' ? provider : null;

  for (const msg of resume ? [] : messages) {
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
  let answer = resume?.answer ?? '';
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
    if (activeTools?.final) body.tool_choice = 'none'; // SQEM-637 — the last round answers
    // SQEM-616 — per provider, decided in `_shared/outputLimits.ts` (null = the provider's default is better).
    const limit = outputLimit(provider);
    if (limit) body.max_tokens = limit;

    const response = await fetchWithTimeout(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
      body: JSON.stringify(body),
      signal,
    }, providerTimeoutMs({ selfHosted: SELF_HOSTED })); // SQEM-582 — was the 120 s image default

    if (!response.ok) {
      const errText = await response.text();
      if (response.status === 429) {
        throw new Error('The AI service is busy right now. Please wait a few seconds and try again.');
      }
      // SQEM-375 — the model cannot do function tools. Retry once without them rather than
      // failing the whole message; `activeTools` is null from here, so this cannot loop.
      if (activeTools && toolsWereRefused(response.status, errText)) {
        // SQEM-638 — 2000, not 300: the log of 2026-11-03 ended mid-list and hid every reason after the first.
        console.warn('[chat-tools] provider refused function tools:', errText.slice(0, 2000));
        // SQEM-637 — refused in the last round: the provider will not take "no calls"; answer the old way.
        activeTools = activeTools.final ? null : afterToolsRefused(activeTools); // connectors first, the library last
        continue;
      }
      throw new Error(`API error (${response.status}): ${errText}`);
    }

    const { text, toolCalls } = await readOpenAiRound(
      response, onDelta, activeTools, (t, usage) => { totalTokens += t; addUsage(tools?.stats, chatCompletionsUsage(usage)); }, // SQEM-654
      tools ? (r) => { tools.stats.stopReason = r; } : undefined, // SQEM-637
    );
    answer += text;

    if (!activeTools || activeTools.final || !toolCalls.length) {
      return { content: answer || noAnswerText(tools?.stats, locale), totalTokens };
    }

    apiMessages.push(openAiAssistantTurn(text, toolCalls));
    for (const call of toolCalls) {
      apiMessages.push({
        role: 'tool',
        tool_call_id: call.id,
        content: await runToolCall(activeTools, call),
      });
    }
    activeTools = advanceToolRound(activeTools, toolCalls.map(c => c.name));
    // SQEM-649 — the tokens of THIS invocation go with it and are charged before the hand-over.
    if (activeTools?.handoff) throw new ChatContinuation({ convo: apiMessages, answer }, totalTokens);
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

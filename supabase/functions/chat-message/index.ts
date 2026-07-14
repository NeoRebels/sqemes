import { getCorsHeaders } from '../_shared/cors.ts';
import { createAdminClient } from '../_shared/supabase-admin.ts';
import { decryptApiKey } from '../_shared/crypto.ts';
import { checkRateLimit } from '../_shared/rateLimit.ts';
import { fetchWithTimeout } from '../_shared/fetchWithTimeout.ts';
import { broadcastJobResult } from '../_shared/broadcast.ts';
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

    const { workspaceId, modelId, systemInstruction, messages, temperature = 1, jobId, funded } = await req.json();

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

    // Image generation models return a single response — keep them non-streaming.
    // All text models use SSE streaming to avoid the Supabase gateway idle timeout.
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
      const result = await callGemini(apiKey, effectiveModelId, systemInstruction, messages, temperature, true);
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
    EdgeRuntime.waitUntil(runAndBroadcast(jobId, provider, apiKey, effectiveModelId, systemInstruction, sanitizedMessages, temperature, !!funded, workspaceId, fundedCreditLimit));
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

// ── Background job helper ────────────────────────────────────────────────────

async function runAndBroadcast(
  jobId: string,
  provider: string,
  apiKey: string,
  modelId: string,
  systemInstruction: string | undefined,
  messages: ChatMessage[],
  temperature: number,
  funded = false,
  workspaceId?: string,
  creditLimit = 0,
): Promise<void> {
  try {
    let result: string;
    let totalTokens = 0;
    if (provider === 'gemini') {
      result = await callGemini(apiKey, modelId, systemInstruction, messages, temperature, false);
    } else if (provider === 'openai') {
      result = await callOpenAI(apiKey, modelId, systemInstruction, messages, temperature);
    } else if (provider === 'claude') {
      result = await callClaude(apiKey, modelId, systemInstruction, messages, temperature);
    } else if (provider === 'deepseek') {
      ({ content: result, totalTokens } = await callOpenAICompatible(apiKey, modelId, 'https://api.deepseek.com/v1/chat/completions', systemInstruction, messages, temperature));
    } else if (provider === 'mistral') {
      ({ content: result, totalTokens } = await callOpenAICompatible(apiKey, modelId, 'https://api.mistral.ai/v1/chat/completions', systemInstruction, messages, temperature));
    } else if (provider === 'grok') {
      ({ content: result, totalTokens } = await callOpenAICompatible(apiKey, modelId, 'https://api.x.ai/v1/chat/completions', systemInstruction, messages, temperature));
    } else if (provider === 'openrouter') {
      ({ content: result, totalTokens } = await callOpenAICompatible(apiKey, modelId, 'https://openrouter.ai/api/v1/chat/completions', systemInstruction, messages, temperature));
    } else {
      result = `[${provider}] Model ${modelId} is not yet supported.`;
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
    await broadcastJobResult(jobId, { result });
  } catch (err: any) {
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
  temperature: number,
  isImageModel: boolean
): Promise<string> {
  // SQEM-111 — modelId is interpolated into the request path; allow only id-shaped values.
  if (!/^[A-Za-z0-9._-]+$/.test(modelId)) throw new Error('Invalid model id');
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${modelId}:generateContent`;

  const contents = messages.map(msg => {
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

  const generationConfig: any = { temperature };
  if (isImageModel) {
    generationConfig.responseModalities = ['TEXT', 'IMAGE'];
  }

  const body: any = { contents, generationConfig };
  if (systemInstruction) {
    body.systemInstruction = { parts: [{ text: systemInstruction }] };
  }

  const response = await fetchWithTimeout(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`Gemini API error (${response.status}): ${errText}`);
  }

  const data = await response.json();
  const parts = data.candidates?.[0]?.content?.parts || [];
  let text = '';
  for (const part of parts) {
    if (part.text) text += part.text;
    if (part.inlineData) {
      text += `\n\n![Generated Image](data:${part.inlineData.mimeType};base64,${part.inlineData.data})\n\n`;
    }
  }
  return text || 'No content generated.';
}

async function callOpenAI(
  apiKey: string,
  modelId: string,
  systemInstruction: string | undefined,
  messages: ChatMessage[],
  temperature: number
): Promise<string> {
  const apiMessages: any[] = [];

  if (systemInstruction) {
    apiMessages.push({ role: 'system', content: systemInstruction });
  }

  for (const msg of messages) {
    if (typeof msg.content === 'string') {
      apiMessages.push({ role: msg.role, content: msg.content });
    } else {
      const content = msg.content.map((p: any) => {
        if (p.inlineData) {
          if (p.inlineData.mimeType.startsWith('text/')) return decodeTextFile(p.inlineData);
          if (p.inlineData.mimeType === 'application/pdf') {
            return { type: 'file', file: { filename: 'document.pdf', file_data: `data:application/pdf;base64,${p.inlineData.data}` } };
          }
          return { type: 'image_url', image_url: { url: `data:${p.inlineData.mimeType};base64,${p.inlineData.data}` } };
        }
        return { type: 'text', text: p.text || String(p) };
      });
      apiMessages.push({ role: msg.role, content });
    }
  }

  // GPT-5 and o-series (o1/o3/o4…) models reject a non-default temperature
  // ("Only the default (1) value is supported") — only send it for models that accept it.
  const mLower = modelId.toLowerCase();
  const supportsTemperature = !(mLower.startsWith('gpt-5') || /^o\d/.test(mLower));
  const openaiBody: Record<string, unknown> = { model: modelId, messages: apiMessages };
  if (supportsTemperature) openaiBody.temperature = temperature;

  const response = await fetchWithTimeout('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
    body: JSON.stringify(openaiBody),
  });

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`OpenAI API error (${response.status}): ${errText}`);
  }

  const data = await response.json();
  return data.choices?.[0]?.message?.content || 'No content generated.';
}

async function callClaude(
  apiKey: string,
  modelId: string,
  systemInstruction: string | undefined,
  messages: ChatMessage[],
  temperature: number
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

  const body: any = { model: modelId, max_tokens: 8192, temperature, messages: apiMessages };
  if (systemInstruction) body.system = systemInstruction;

  const response = await fetchWithTimeout('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`Claude API error (${response.status}): ${errText}`);
  }

  const data = await response.json();
  return data.content?.map((c: any) => c.text || '').join('') || 'No content generated.';
}

async function callOpenAICompatible(
  apiKey: string,
  modelId: string,
  endpoint: string,
  systemInstruction: string | undefined,
  messages: ChatMessage[],
  temperature: number
): Promise<{ content: string; totalTokens: number }> {
  const apiMessages: any[] = [];

  if (systemInstruction) {
    apiMessages.push({ role: 'system', content: systemInstruction });
  }

  for (const msg of messages) {
    if (typeof msg.content === 'string') {
      apiMessages.push({ role: msg.role, content: msg.content });
    } else {
      const content = msg.content
        .filter((p: any) => !(p.inlineData && p.inlineData.mimeType === 'application/pdf'))
        .map((p: any) => {
          if (p.inlineData) {
            if (p.inlineData.mimeType.startsWith('text/')) return decodeTextFile(p.inlineData);
            return { type: 'image_url', image_url: { url: `data:${p.inlineData.mimeType};base64,${p.inlineData.data}` } };
          }
          return { type: 'text', text: p.text || String(p) };
        });
      apiMessages.push({ role: msg.role, content });
    }
  }

  const response = await fetchWithTimeout(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
    body: JSON.stringify({ model: modelId, messages: apiMessages, temperature }),
  });

  if (!response.ok) {
    const errText = await response.text();
    if (response.status === 429) {
      throw new Error('The AI service is busy right now. Please wait a few seconds and try again.');
    }
    throw new Error(`API error (${response.status}): ${errText}`);
  }

  const data = await response.json();
  return {
    content: data.choices?.[0]?.message?.content || 'No content generated.',
    totalTokens: data.usage?.total_tokens ?? 0,
  };
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

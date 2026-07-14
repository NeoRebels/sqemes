import { getCorsHeaders } from '../_shared/cors.ts';
import { createAdminClient } from '../_shared/supabase-admin.ts';
import { decryptApiKey } from '../_shared/crypto.ts';
import { checkRateLimit } from '../_shared/rateLimit.ts';
import { fetchWithTimeout } from '../_shared/fetchWithTimeout.ts';
import { broadcastJobResult } from '../_shared/broadcast.ts';
import { ensureCreditPeriod, hasCredits, debitCredits } from '../_shared/credits.ts';
import { FUNDED_MODEL } from '../_shared/funded.ts';
import { isWorkspaceSubscriptionActive } from '../_shared/subscription.ts';

// SQEM-082 — Sqemes-funded authoring. Keyless Enhance/Generate route through a
// server-side Mistral credential (GDPR/EU: direct api.mistral.ai, no US hop) on a
// single cheap model, metered against the workspace's monthly AI-credit allowance.
// Cloud-only: absent `MISTRAL_API_KEY` (self-host) → BYOK is the only path.

declare const EdgeRuntime: { waitUntil(p: Promise<unknown>): void };

Deno.serve(async (req) => {
  const cors = getCorsHeaders(req);

  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: cors });
  }

  // Reject oversized payloads (20 MB limit — base64 files inflate ~33%)
  const MAX_BODY_BYTES = 20 * 1024 * 1024;
  const contentLength = Number(req.headers.get('content-length') ?? 0);
  if (contentLength > MAX_BODY_BYTES) {
    return new Response(JSON.stringify({ error: 'Request body too large. Maximum is 20 MB.' }), {
      status: 413,
      headers: { ...cors, 'Content-Type': 'application/json' },
    });
  }

  try {
    // 1. Verify caller auth
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

    // 2. Parse request body
    const { workspaceId, modelId, systemInstruction, promptContent, temperature = 1, jobId, promptId, funded } = await req.json();

    // Funded (Sqemes-credit) calls don't carry a modelId — they use FUNDED_MODEL.
    if (!workspaceId || !promptContent || (!funded && !modelId)) {
      return new Response(JSON.stringify({ error: 'Missing required fields: workspaceId, promptContent' }), {
        status: 400,
        headers: { ...cors, 'Content-Type': 'application/json' },
      });
    }

    // 3. Verify workspace membership
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

    // 4. Rate limit check
    const allowed = await checkRateLimit(workspaceId);
    if (!allowed) {
      return new Response(JSON.stringify({ error: 'Rate limit exceeded. Please wait before making more requests.' }), {
        status: 429,
        headers: { ...cors, 'Content-Type': 'application/json', 'Retry-After': '60' },
      });
    }

    // 5. Resolve provider, model and key — funded (Sqemes credits) vs BYOK.
    let provider: string;
    let apiKey: string;
    let effectiveModelId: string;
    let fundedCreditLimit = 0;

    if (funded) {
      // Sqemes-funded authoring: server credential + cheap EU model (direct Mistral).
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
      const modelLower = modelId.toLowerCase();
      if (modelLower.includes('/')) {
        // OpenRouter model ids are `vendor/model` — none of the direct providers use a slash.
        provider = 'openrouter';
      } else if (modelLower.startsWith('gpt-') || modelLower.startsWith('o3') || modelLower.startsWith('o4') || modelLower.startsWith('dall-e')) {
        provider = 'openai';
      } else if (modelLower.includes('gemini') || modelLower.includes('veo')) {
        provider = 'gemini';
      } else if (modelLower.includes('claude')) {
        provider = 'claude';
      } else if (modelLower.includes('grok')) {
        provider = 'grok';
      } else if (modelLower.includes('deepseek')) {
        provider = 'deepseek';
      } else if (modelLower.includes('mistral') || modelLower.includes('codestral') || modelLower.includes('ministral') || modelLower.includes('magistral') || modelLower.includes('pixtral')) {
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

    // 7. Call LLM provider
    // Image generation models return a single response — keep them non-streaming.
    // All text models use SSE streaming to avoid the Supabase gateway idle timeout.
    const imageGenModels: Record<string, string> = {
      'gpt-image-1': 'https://api.openai.com/v1/images/generations',
      'gpt-image-1-mini': 'https://api.openai.com/v1/images/generations',
      'dall-e-3': 'https://api.openai.com/v1/images/generations',
      'grok-imagine-image': 'https://api.x.ai/v1/images/generations',
    };

    const isGeminiImageModel = provider === 'gemini' && modelLower.includes('image');

    if (imageGenModels[modelLower]) {
      const textPrompt = Array.isArray(promptContent)
        ? promptContent.map((p: any) => p.text || '').filter(Boolean).join('\n')
        : promptContent;
      const result = await callImageGeneration(apiKey, effectiveModelId, imageGenModels[modelLower], textPrompt);
      return new Response(JSON.stringify({ result }), {
        headers: { ...cors, 'Content-Type': 'application/json' },
      });
    }

    if (isGeminiImageModel) {
      const result = await callGemini(apiKey, effectiveModelId, systemInstruction, promptContent, temperature);
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
    EdgeRuntime.waitUntil(runAndBroadcast(jobId, provider, apiKey, effectiveModelId, systemInstruction, promptContent, temperature, promptId, !!funded, workspaceId, fundedCreditLimit));
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
    console.error('execute-step error:', message);
    return new Response(JSON.stringify(body), {
      status,
      headers: { ...getCorsHeaders(req), 'Content-Type': 'application/json' },
    });
  }
});

// ---- Background job helper ----

async function runAndBroadcast(
  jobId: string,
  provider: string,
  apiKey: string,
  modelId: string,
  systemInstruction: string | undefined,
  promptContent: string | any[],
  temperature: number,
  promptId?: string,
  funded = false,
  workspaceId?: string,
  creditLimit = 0,
): Promise<void> {
  try {
    let result: string;
    let totalTokens = 0;
    if (provider === 'gemini') {
      result = await callGemini(apiKey, modelId, systemInstruction, promptContent, temperature);
    } else if (provider === 'openai') {
      result = await callOpenAI(apiKey, modelId, systemInstruction, promptContent, temperature);
    } else if (provider === 'claude') {
      result = await callClaude(apiKey, modelId, systemInstruction, promptContent, temperature);
    } else if (provider === 'deepseek') {
      ({ content: result, totalTokens } = await callOpenAICompatible(apiKey, modelId, 'https://api.deepseek.com/v1/chat/completions', systemInstruction, promptContent, temperature));
    } else if (provider === 'mistral') {
      ({ content: result, totalTokens } = await callOpenAICompatible(apiKey, modelId, 'https://api.mistral.ai/v1/chat/completions', systemInstruction, promptContent, temperature));
    } else if (provider === 'grok') {
      ({ content: result, totalTokens } = await callOpenAICompatible(apiKey, modelId, 'https://api.x.ai/v1/chat/completions', systemInstruction, promptContent, temperature));
    } else if (provider === 'openrouter') {
      ({ content: result, totalTokens } = await callOpenAICompatible(apiKey, modelId, 'https://openrouter.ai/api/v1/chat/completions', systemInstruction, promptContent, temperature));
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

// ---- Provider implementations ----

/** Decode a text/* inlineData part to a plain {type:'text'} part. */
function decodeTextFile(inlineData: { mimeType: string; data: string }): { type: string; text: string } {
  const text = new TextDecoder().decode(Uint8Array.from(atob(inlineData.data), c => c.charCodeAt(0)));
  return { type: 'text', text };
}

async function callGemini(
  apiKey: string,
  modelId: string,
  systemInstruction: string | undefined,
  promptContent: string | any[],
  temperature: number
): Promise<string> {
  // SQEM-111 — modelId is interpolated into the request path; allow only id-shaped values.
  if (!/^[A-Za-z0-9._-]+$/.test(modelId)) throw new Error('Invalid model id');
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${modelId}:generateContent`;

  const contents: any[] = [];

  if (typeof promptContent === 'string') {
    contents.push({ role: 'user', parts: [{ text: promptContent }] });
  } else if (Array.isArray(promptContent)) {
    const parts = promptContent.map((p: any) => {
      if (p.text) return { text: p.text };
      if (p.inlineData) return { inlineData: p.inlineData };
      return { text: String(p) };
    });
    contents.push({ role: 'user', parts });
  }

  const generationConfig: any = { temperature };

  // Enable image output for image-capable Gemini models
  const isImageModel = modelId.includes('image');
  if (isImageModel) {
    generationConfig.responseModalities = ['TEXT', 'IMAGE'];
  }

  const body: any = {
    contents,
    generationConfig,
  };

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
  let text = '';

  const parts = data.candidates?.[0]?.content?.parts || [];
  for (const part of parts) {
    if (part.text) {
      text += part.text;
    }
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
  promptContent: string | any[],
  temperature: number
): Promise<string> {
  const messages: any[] = [];

  if (systemInstruction) {
    messages.push({ role: 'system', content: systemInstruction });
  }

  if (Array.isArray(promptContent)) {
    const content = promptContent.map((p: any) => {
      if (p.inlineData) {
        if (p.inlineData.mimeType.startsWith('text/')) return decodeTextFile(p.inlineData);
        if (p.inlineData.mimeType === 'application/pdf') {
          return { type: 'file', file: { filename: 'document.pdf', file_data: `data:application/pdf;base64,${p.inlineData.data}` } };
        }
        return { type: 'image_url', image_url: { url: `data:${p.inlineData.mimeType};base64,${p.inlineData.data}` } };
      }
      return { type: 'text', text: p.text || String(p) };
    });
    messages.push({ role: 'user', content });
  } else {
    messages.push({ role: 'user', content: promptContent });
  }

  // GPT-5 and o-series (o1/o3/o4…) models reject a non-default temperature — only send it
  // for models that accept it (gpt-4o, gpt-4, …).
  const mLower = modelId.toLowerCase();
  const supportsTemperature = !(mLower.startsWith('gpt-5') || /^o\d/.test(mLower));
  const openaiBody: Record<string, unknown> = { model: modelId, messages };
  if (supportsTemperature) openaiBody.temperature = temperature;

  const response = await fetchWithTimeout('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
    },
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
  promptContent: string | any[],
  temperature: number
): Promise<string> {
  let userContent: string | any[];
  if (Array.isArray(promptContent)) {
    userContent = promptContent.map((p: any) => {
      if (p.inlineData) {
        if (p.inlineData.mimeType.startsWith('text/')) return decodeTextFile(p.inlineData);
        if (p.inlineData.mimeType === 'application/pdf') {
          return { type: 'document', source: { type: 'base64', media_type: p.inlineData.mimeType, data: p.inlineData.data } };
        }
        return { type: 'image', source: { type: 'base64', media_type: p.inlineData.mimeType, data: p.inlineData.data } };
      }
      return { type: 'text', text: p.text || String(p) };
    });
  } else {
    userContent = promptContent;
  }

  const body: any = {
    model: modelId,
    max_tokens: 8192,
    temperature,
    messages: [{ role: 'user', content: userContent }],
  };

  if (systemInstruction) {
    body.system = systemInstruction;
  }

  const response = await fetchWithTimeout('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
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
  promptContent: string | any[],
  temperature: number
): Promise<{ content: string; totalTokens: number }> {
  const messages: any[] = [];

  if (systemInstruction) {
    messages.push({ role: 'system', content: systemInstruction });
  }

  if (Array.isArray(promptContent)) {
    const content = promptContent
      .filter((p: any) => !(p.inlineData && p.inlineData.mimeType === 'application/pdf'))
      .map((p: any) => {
        if (p.inlineData) {
          if (p.inlineData.mimeType.startsWith('text/')) return decodeTextFile(p.inlineData);
          return { type: 'image_url', image_url: { url: `data:${p.inlineData.mimeType};base64,${p.inlineData.data}` } };
        }
        return { type: 'text', text: p.text || String(p) };
      });
    messages.push({ role: 'user', content });
  } else {
    messages.push({ role: 'user', content: promptContent });
  }

  const response = await fetchWithTimeout(endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: modelId,
      messages,
      temperature,
    }),
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
  // gpt-image-1 returns b64_json by default and doesn't accept response_format
  // grok and dall-e models require response_format: 'b64_json' explicitly
  if (modelId.includes('grok') || modelId.startsWith('dall-e')) {
    body.response_format = 'b64_json';
  }

  const response = await fetchWithTimeout(endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
    },
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

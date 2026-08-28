
import { PlanTier } from './types';

// SQEM-082 — decided monthly AI-credit allowances per tier (1 credit = 1,000 tokens).
// Used for the Dashboard "AI credits" display when the workspace has no provisioned
// `credits_limit` yet. SQEM-057 will rename tiers (Solo/Team/Business), set paid
// prices, and provision these same numbers as `workspaces.credits_limit` (enforcement).
// SQEM-057 — free-trial length (days) for all paid tiers. Mirrors the edge function.
export const TRIAL_DAYS = 14;

export const PLAN_AI_CREDITS: Record<PlanTier, number> = {
  Solo: 2000,
  Team: 25000,
  Business: 100000,
};

// SQEM-204/287 — one sentence per template kind, and it lives here so there is exactly one of them.
//
// Written for the point where somebody chooses, so it avoids the words that need explaining
// themselves: no "system instruction", no "variables", no "context injection". Each example is a
// real marketplace listing, so the explanation someone meets here matches the one they meet while
// browsing.
//
// ⚠️ **Used in two places on purpose, and that is the whole reason it moved.** It began inside
// `TemplateEditor` — which is *after* the decision. The empty state on the Templates page names the
// same three words bare, and that is the first screen every new user sees, because a library is
// necessarily empty on day one. Two copies of this text would drift; one copy cannot.
//
// The confusion is measured, not hypothetical: a customer had **assistant and skill the wrong way
// round** after using the product.
export const KIND_HELP: Record<'prompt' | 'assistant' | 'skill', string> = {
  prompt: 'A task you reuse and fill in each time. Example: \u201cCold Outreach Email\u201d \u2014 you supply the customer and the product.',
  assistant: 'A persona to work with, with its own instructions and context files. Example: \u201cEditor-in-Chief\u201d \u2014 sharpens clarity, flow and structure.',
  skill: 'A piece of your company\u2019s knowledge that AI applies whenever it fits \u2014 no filling in. Example: \u201cAIDA Copywriting Framework\u201d, or your brand voice.',
};

// SQEM-283 — the tax line that has to sit beside every price we show.
//
// Stripe's prices are `automatic` tax behaviour: **inclusive in the euro/EU case**, exclusive for USD
// and CAD, where sales tax is customarily added on top. Everything we display is in euro, so for the
// price a visitor reads here, the number IS the total.
//
// ⚠️ **This is not decoration.** The published Terms tell consumers that "prices shown to you include
// VAT". A price rendered without this line leaves that promise unstated at the one moment it matters,
// and § 3 PAngV attaches to advertising a price — not to the checkout that follows it.
//
// Business customers with a valid VAT ID are reverse-charged at checkout and pay less than the number
// shown. That is why the line says *includes*, not *plus* — and why it names the exception rather
// than pretending everyone pays the same.
export const VAT_NOTE = 'Includes VAT. Business customers with a valid VAT ID are charged net.';

// SQEM-057 — `price` is the monthly (billed-monthly) price; `priceYearly` is the
// per-month price when billed annually (≈20% off, rounded). All tiers are paid;
// MCP + AI credits ship on every tier (differentiation is seats/credits/team features).
export const PLANS: Record<PlanTier, { users: number; price: string; priceYearly: number; tagline: string; features: string[]; libraryAccess: boolean; mcpAccess: boolean }> = {
  Solo: {
    users: 1,
    price: '€12/mo',
    priceYearly: 9,
    tagline: 'For individuals getting started',
    libraryAccess: true,
    mcpAccess: true,
    features: [
      '1 team member',
      '2,000 AI credits / month',
      'MCP server access',
      'Unlimited AI with your own key (BYOK)',
      'Unlimited templates',
      'Marketplace access',
    ],
  },
  Team: {
    users: 10,
    price: '€99/mo',
    priceYearly: 79,
    tagline: 'For teams that move fast',
    libraryAccess: true,
    mcpAccess: true,
    features: [
      'Up to 10 team members',
      '25,000 AI credits / month',
      'MCP server access',
      'Roles & permissions',
      'Unlimited AI with your own key (BYOK)',
      'Unlimited templates',
      'Marketplace access',
    ],
  },
  Business: {
    users: 30,
    price: '€249/mo',
    priceYearly: 199,
    tagline: 'For teams that need more room',
    libraryAccess: true,
    mcpAccess: true,
    features: [
      'Up to 30 team members',
      '100,000 AI credits / month',
      'MCP server access',
      'Roles & permissions',
      'Unlimited AI with your own key (BYOK)',
      'Unlimited templates',
      'Marketplace access',
      'Priority support',
    ],
  },
};

export const AVAILABLE_MODELS = [
  // ── Google Gemini ──────────────────────────────────────────────
  //
  // SQEM-275 — one entry per JOB, not per version. The list had grown to nine Gemini entries across
  // three generations, several of them near-identical, which asks a person to choose between things
  // they cannot tell apart. Checked against ai.google.dev on 2026-08-26.
  {
    id: 'gemini-3.7-flash',
    name: 'Gemini 3.7 Flash',
    description: 'Latest Gemini, fast and capable',
    provider: 'gemini',
    specs: {
      description: 'Newest-generation Flash model — frontier-class quality at Flash speed. The default choice for chat, summarisation and extraction. 1M context window.',
      cost: 3,
      speed: 9,
      thinking: 8
    }
  },
  {
    id: 'gemini-3.5-flash-lite',
    name: 'Gemini 3.5 Flash Lite',
    description: 'Cheapest and fastest Gemini',
    provider: 'gemini',
    specs: {
      description: 'Built for high-volume, low-latency work — classification, routing, bulk processing. 1M context window.',
      cost: 1,
      speed: 10,
      thinking: 5
    }
  },
  {
    id: 'gemini-3.1-pro-preview',
    name: 'Gemini 3.1 Pro',
    description: 'Best Gemini for complex reasoning (Preview)',
    provider: 'gemini',
    specs: {
      description: 'Deep reasoning and coding. Still preview at Google — no stable id exists yet, which is why this one keeps the suffix. 1M context window.',
      cost: 5,
      speed: 6,
      thinking: 10
    }
  },

  // ── Google Gemini (Image Generation) ─────────────────────────
  {
    id: 'gemini-3.1-flash-image',
    name: 'Gemini 3.1 Flash Image',
    description: 'Fast image generation',
    provider: 'gemini',
    specs: {
      description: 'High-efficiency image generation and editing.',
      cost: 3,
      speed: 9,
      thinking: 6
    }
  },
  {
    id: 'gemini-3-pro-image',
    name: 'Gemini 3 Pro Image',
    description: 'Studio-quality image generation',
    provider: 'gemini',
    specs: {
      description: 'Highest-fidelity image generation and editing.',
      cost: 6,
      speed: 5,
      thinking: 8
    }
  },

  // ── OpenAI ─────────────────────────────────────────────────────
  //
  // SQEM-275 — the GPT-5.6 family, all three variants (owner's decision 2026-08-26). They differ by
  // intent rather than by generation, so all three earn a place; `gpt-5.6` is an alias for Sol and is
  // deliberately NOT listed as a fourth entry pointing at the same model.
  {
    id: 'gpt-5.6-sol',
    name: 'GPT-5.6 Sol',
    description: 'OpenAI Most Capable',
    provider: 'openai',
    specs: {
      description: 'Advanced reasoning and coding — the one to reach for on hard problems.',
      cost: 9,
      speed: 5,
      thinking: 10
    }
  },
  {
    id: 'gpt-5.6-terra',
    name: 'GPT-5.6 Terra',
    description: 'OpenAI Best Balance',
    provider: 'openai',
    specs: {
      description: 'Balanced intelligence and cost. The sensible default for everyday work.',
      cost: 5,
      speed: 7,
      thinking: 8
    }
  },
  {
    id: 'gpt-5.6-luna',
    name: 'GPT-5.6 Luna',
    description: 'OpenAI Cost-Optimised',
    provider: 'openai',
    specs: {
      description: 'Cost-optimised for high-volume workloads where throughput matters more than depth.',
      cost: 2,
      speed: 9,
      thinking: 6
    }
  },
  {
    id: 'gpt-image-2',
    name: 'GPT Image 2',
    description: 'OpenAI image generation',
    provider: 'openai',
    specs: {
      description: 'Image generation and editing.',
      cost: 5,
      speed: 6,
      thinking: 7
    }
  },
  // ── Anthropic Claude ───────────────────────────────────────────
  {
    id: 'claude-fable-5',
    name: 'Claude Fable 5',
    description: 'Anthropic Latest',
    provider: 'claude',
    specs: {
      description: 'Newest-generation Anthropic model — top-tier reasoning, coding, and analysis.',
      cost: 10,
      speed: 5,
      thinking: 10
    }
  },
  {
    id: 'claude-opus-5',
    name: 'Claude Opus 5',
    description: 'Anthropic Most Powerful',
    provider: 'claude',
    specs: {
      description: 'Maximum intelligence for the hardest tasks. Exceptional at coding, analysis, and complex reasoning. 200K context.',
      cost: 10,
      speed: 4,
      thinking: 10
    }
  },
  {
    id: 'claude-sonnet-5',
    name: 'Claude Sonnet 5',
    description: 'Anthropic Best Balance',
    provider: 'claude',
    specs: {
      description: 'High performance for coding and reasoning with excellent speed-to-quality ratio. 200K context.',
      cost: 5,
      speed: 7,
      thinking: 9
    }
  },
  {
    id: 'claude-haiku-4-5-20251001',
    name: 'Claude Haiku 4.5',
    description: 'Anthropic Fast & Affordable',
    provider: 'claude',
    specs: {
      description: 'Near-frontier performance at low cost. Ideal for real-time applications and high-volume processing. 200K context.',
      cost: 2,
      speed: 10,
      thinking: 7
    }
  },

  // ── xAI Grok ───────────────────────────────────────────────────
  //
  // ⚠️ SQEM-275 — `grok-4.6` supersedes `grok-4.20`, and the numbering is a trap: 4.20 READS higher
  // than 4.6 and is older. xAI's own docs name 4.6 'the most intelligent and fastest model'.
  {
    id: 'grok-4.6',
    name: 'Grok 4.6',
    description: 'xAI Latest',
    provider: 'grok',
    specs: {
      description: 'xAI\'s most capable model for code and chat, with real-time knowledge.',
      cost: 6,
      speed: 8,
      thinking: 9
    }
  },
  {
    id: 'grok-imagine-image-2.0',
    name: 'Grok Imagine 2.0',
    description: 'xAI image generation',
    provider: 'grok',
    specs: {
      description: 'Image generation.',
      cost: 4,
      speed: 8,
      thinking: 6
    }
  },
  // ── DeepSeek ───────────────────────────────────────────────────
  //
  // SQEM-275 — the V4 family. The old `deepseek-chat` / `deepseek-reasoner` aliases named the V3.2
  // generation; DeepSeek's own docs now list v4-flash and v4-pro, both with thinking mode by default.
  // Note these two also appear in the OpenRouter shortlist below — same models, different key. That
  // is not duplication: a customer holds one key or the other, rarely both.
  {
    id: 'deepseek-v4-flash',
    name: 'DeepSeek V4 Flash',
    description: 'DeepSeek Fast',
    provider: 'deepseek',
    specs: {
      description: 'Highly efficient model rivaling top-tier proprietary models in coding and math. Exceptional value. 128K context.',
      cost: 1,
      speed: 8,
      thinking: 9
    }
  },
  {
    id: 'deepseek-v4-pro',
    name: 'DeepSeek V4 Pro',
    description: 'DeepSeek Reasoning',
    provider: 'deepseek',
    specs: {
      description: 'Specialized reasoning model that thinks step-by-step. Competitive with top reasoning models at a fraction of the cost. 128K context.',
      cost: 2,
      speed: 5,
      thinking: 10
    }
  },

  // ── Mistral AI ─────────────────────────────────────────────────
  //
  // SQEM-275 — the `-latest` aliases are kept deliberately (owner's decision 2026-08-26). They track
  // the current generation on their own, which is what someone picking "Mistral Large" means. Only
  // the labels were stale: they now resolve to Large 3, Small 4 and Codestral 25.08.
  //
  // ⚠️ The same alias in `_shared/funded.ts` is a different matter — there **we** pay, so a moving
  // target is a moving cost. Kept as well, knowingly; see SQEM-276.
  {
    id: 'mistral-large-latest',
    name: 'Mistral Large 3',
    description: 'Mistral Flagship',
    provider: 'mistral',
    specs: {
      description: 'State-of-the-art open-weight multimodal model with strong reasoning and multilingual capabilities. 128K context.',
      cost: 6,
      speed: 6,
      thinking: 9
    }
  },
  {
    id: 'mistral-small-latest',
    name: 'Mistral Small 4',
    description: 'Mistral Fast & Capable',
    provider: 'mistral',
    specs: {
      description: 'Efficient model with strong multimodal performance. Great balance of speed and quality. 128K context.',
      cost: 2,
      speed: 9,
      thinking: 7
    }
  },
  {
    id: 'codestral-latest',
    name: 'Codestral 25.08',
    description: 'Mistral Code Specialist',
    provider: 'mistral',
    specs: {
      description: 'Purpose-built for code completion and generation. Optimized for developer workflows. 256K context.',
      cost: 3,
      speed: 8,
      thinking: 8
    }
  },

  // ⚠️ SQEM-275 — `inclusionai/ling-2.6-flash` and `ibm-granite/granite-4.1-8b` were NOT verified on
  // 2026-08-26: they do not appear among OpenRouter's newest models, which proves nothing either way.
  // They are left as they are rather than removed on a hunch — OpenRouter answers an unknown slug with
  // a clear error, so the cost of a stale entry here is one confused attempt, not silent breakage.
  //
  // ── OpenRouter (BYOK) — curated shortlist. Users can add more model ids in
  //    Settings → Integrations → OpenRouter. Model ids are `vendor/model`.
  {
    id: 'inclusionai/ling-2.6-flash',
    name: 'Ling 2.6 Flash',
    description: 'Ultra-cheap, fast workhorse',
    provider: 'openrouter',
    specs: { description: 'Very low cost and fast — good default for high-frequency, low-stakes tasks. 256K context.', cost: 1, speed: 9, thinking: 5 }
  },
  {
    id: 'ibm-granite/granite-4.1-8b',
    name: 'Granite 4.1 8B',
    description: 'Cheap, small, reliable',
    provider: 'openrouter',
    specs: { description: 'Small IBM Granite instruct model — cheap and dependable for everyday assistance. 131K context.', cost: 1, speed: 9, thinking: 4 }
  },
  {
    id: 'deepseek/deepseek-v4-flash',
    name: 'DeepSeek V4 Flash',
    description: 'Cheap with a 1M context',
    provider: 'openrouter',
    specs: { description: 'Fast DeepSeek model with a 1M-token context — strong value for long inputs. ', cost: 2, speed: 8, thinking: 6 }
  },
  {
    id: 'deepseek/deepseek-v4-pro',
    name: 'DeepSeek V4 Pro',
    description: 'Stronger reasoning, 1M context',
    provider: 'openrouter',
    specs: { description: 'Higher-capability DeepSeek model for harder reasoning tasks. 1M-token context.', cost: 4, speed: 6, thinking: 9 }
  },
  {
    id: 'qwen/qwen3.8-27b',
    name: 'Qwen3.8 27B',
    description: 'Strong general-purpose open model',
    provider: 'openrouter',
    // SQEM-275 — the context window is deliberately not claimed here. The predecessor's entry said
    // "1M context"; that was about a different model, and repeating it for this one would be a
    // number carried across a rename rather than a fact about what ships.
    specs: { description: 'Capable general-purpose Qwen model, current generation on OpenRouter.', cost: 4, speed: 7, thinking: 8 }
  },
];

// Mock assistants removed — assistants are now stored in the database

export const CACHE_VERSION = '2';
export const CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

// SQEM-106 — function-based marketplace taxonomy (spans prompts/assistants/skills).
// 'General' is kept only as the DB default / uncategorised fallback, not a browse tab.
export const TEMPLATE_CATEGORIES = ['Marketing & Sales', 'Writing & Content', 'Engineering & Product', 'Data & Research', 'Business & Ops', 'Support & Success', 'Creative & Design'] as const;

export const CATEGORY_COLORS: Record<string, { bg: string; text: string }> = {
  'Marketing & Sales': { bg: 'bg-pink-50 dark:bg-pink-900/30', text: 'text-pink-600 dark:text-pink-400' },
  'Writing & Content': { bg: 'bg-violet-50 dark:bg-violet-900/30', text: 'text-violet-600 dark:text-violet-400' },
  'Engineering & Product': { bg: 'bg-blue-50 dark:bg-blue-900/30', text: 'text-blue-600 dark:text-blue-400' },
  'Data & Research': { bg: 'bg-emerald-50 dark:bg-emerald-900/30', text: 'text-emerald-600 dark:text-emerald-400' },
  'Business & Ops': { bg: 'bg-amber-50 dark:bg-amber-900/30', text: 'text-amber-600 dark:text-amber-400' },
  'Support & Success': { bg: 'bg-teal-50 dark:bg-teal-900/30', text: 'text-teal-600 dark:text-teal-400' },
  'Creative & Design': { bg: 'bg-purple-50 dark:bg-purple-900/30', text: 'text-purple-600 dark:text-purple-400' },
  General: { bg: 'bg-slate-100 dark:bg-slate-700', text: 'text-slate-600 dark:text-slate-300' },
};

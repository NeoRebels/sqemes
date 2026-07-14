
import { PlanTier } from './types';

// SQEM-082 — decided monthly AI-credit allowances per tier (1 credit = 1,000 tokens).
// Used for the Dashboard "AI credits" display when the workspace has no provisioned
// `credits_limit` yet. SQEM-057 will rename tiers (Solo/Team/Business), set paid
// prices, and provision these same numbers as `workspaces.credits_limit` (enforcement).
// SQEM-057 — free-trial length (days) for all paid tiers. Mirrors the edge function.
export const TRIAL_DAYS = 14;

export const PLAN_AI_CREDITS: Record<PlanTier, number> = {
  Solo: 5000,
  Team: 25000,
  Business: 100000,
};

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
      '5,000 AI credits / month',
      'MCP server access',
      'Bring Your Own API Keys',
      'Unlimited templates',
      'Marketplace access',
    ],
  },
  Team: {
    users: 10,
    price: '€62/mo',
    priceYearly: 49,
    tagline: 'For teams that move fast',
    libraryAccess: true,
    mcpAccess: true,
    features: [
      'Up to 10 team members',
      '25,000 AI credits / month',
      'MCP server access',
      'Roles & permissions',
      'Bring Your Own API Keys',
      'Unlimited templates',
      'Marketplace access',
    ],
  },
  Business: {
    users: 30,
    price: '€124/mo',
    priceYearly: 99,
    tagline: 'For teams that need more room',
    libraryAccess: true,
    mcpAccess: true,
    features: [
      'Up to 30 team members',
      '100,000 AI credits / month',
      'MCP server access',
      'Roles & permissions',
      'Bring Your Own API Keys',
      'Unlimited templates',
      'Marketplace access',
      'Priority support',
    ],
  },
};

export const AVAILABLE_MODELS = [
  // ── Google Gemini ──────────────────────────────────────────────
  {
    id: 'gemini-2.5-flash',
    name: 'Gemini 2.5 Flash',
    description: 'Fast and efficient for most tasks',
    provider: 'gemini',
    specs: {
      description: 'The fastest multimodal model for high-frequency tasks. Ideal for summarization, chat, and data extraction. 1M context window.',
      cost: 2,
      speed: 10,
      thinking: 7
    }
  },
  {
    id: 'gemini-2.5-flash-lite',
    name: 'Gemini 2.5 Flash Lite',
    description: 'Ultra-fast and cheapest Gemini',
    provider: 'gemini',
    specs: {
      description: 'Extremely cost-efficient model for simple tasks, classification, and high-throughput workloads. 1M context window.',
      cost: 1,
      speed: 10,
      thinking: 5
    }
  },
  {
    id: 'gemini-2.5-pro',
    name: 'Gemini 2.5 Pro',
    description: 'Best Gemini for complex reasoning',
    provider: 'gemini',
    specs: {
      description: 'Top-tier reasoning and coding model with deep thinking capabilities. 1M context window.',
      cost: 5,
      speed: 6,
      thinking: 10
    }
  },
  {
    id: 'gemini-3-flash-preview',
    name: 'Gemini 3 Flash',
    description: 'Next-gen fast model (Preview)',
    provider: 'gemini',
    specs: {
      description: 'Fast frontier-class performance rivaling larger models at a fraction of the cost. 1M context window.',
      cost: 3,
      speed: 9,
      thinking: 8
    }
  },
  {
    id: 'gemini-3.1-flash-lite-preview',
    name: 'Gemini 3.1 Flash Lite',
    description: 'Ultra-fast next-gen model (Preview)',
    provider: 'gemini',
    specs: {
      description: 'Cost-efficient next-gen model built for high-volume tasks and low-latency workloads. 1M context window.',
      cost: 2,
      speed: 10,
      thinking: 7
    }
  },
  {
    id: 'gemini-3.1-pro-preview',
    name: 'Gemini 3.1 Pro',
    description: 'Next-gen flagship (Preview)',
    provider: 'gemini',
    specs: {
      description: 'Reasoning-first flagship with adaptive thinking, agentic workflows, and coding capabilities. 1M context window.',
      cost: 7,
      speed: 5,
      thinking: 10
    }
  },
  {
    id: 'gemini-3-pro-image-preview',
    name: 'Gemini 3 Pro Image',
    description: 'High quality image generation',
    provider: 'gemini',
    specs: {
      description: 'Produces photorealistic, high-fidelity images with excellent prompt adherence.',
      cost: 6,
      speed: 5,
      thinking: 6
    }
  },

  // ── Google Gemini (Image Generation) ─────────────────────────
  {
    id: 'gemini-3.1-flash-image-preview',
    name: 'Gemini 3.1 Flash Image',
    description: 'Fastest Gemini image generation (new)',
    provider: 'gemini',
    specs: {
      description: 'Newest and fastest Gemini image model. Combines Gemini 3 Pro image quality with Flash speed. Supports generation, editing, and multi-turn iteration. Includes Google Search grounding.',
      cost: 4,
      speed: 9,
      thinking: 6
    }
  },

  {
    id: 'gemini-2.5-flash-image',
    name: 'Gemini 2.5 Flash Image',
    description: 'Gemini fast image generation',
    provider: 'gemini',
    specs: {
      description: 'Fast image generation model optimized for high-volume, low-latency tasks. Can create and edit images from text prompts. 1M context window.',
      cost: 3,
      speed: 8,
      thinking: 6
    }
  },


  // ── OpenAI ─────────────────────────────────────────────────────
  {
    id: 'gpt-5.2',
    name: 'GPT-5.2',
    description: 'OpenAI Latest Flagship',
    provider: 'openai',
    specs: {
      description: 'OpenAI flagship model for coding and agentic tasks. Best-in-class reasoning with thinking capabilities.',
      cost: 8,
      speed: 5,
      thinking: 10
    }
  },
  {
    id: 'gpt-5.3-chat-latest',
    name: 'GPT-5.3',
    description: 'OpenAI Latest & Fastest',
    provider: 'openai',
    specs: {
      description: 'Newest OpenAI release. Speed-optimized with more accurate answers and 3x faster inference. 500K context window.',
      cost: 6,
      speed: 9,
      thinking: 9
    }
  },
  {
    id: 'gpt-5-mini',
    name: 'GPT-5 Mini',
    description: 'OpenAI Fast & Smart',
    provider: 'openai',
    specs: {
      description: 'Faster, cost-efficient reasoning model. Great for well-defined tasks and precise prompts.',
      cost: 4,
      speed: 8,
      thinking: 8
    }
  },
  {
    id: 'o3',
    name: 'OpenAI o3',
    description: 'OpenAI Deep Reasoning',
    provider: 'openai',
    specs: {
      description: 'Advanced reasoning model for math, science, and coding. Thinks step-by-step for complex problems. 200K context.',
      cost: 9,
      speed: 3,
      thinking: 10
    }
  },

  {
    id: 'gpt-image-1',
    name: 'GPT Image 1',
    description: 'OpenAI Image Generation',
    provider: 'openai',
    specs: {
      description: 'Native multimodal image generation model. Creates high-quality images from text prompts with excellent instruction following.',
      cost: 6,
      speed: 5,
      thinking: 6
    }
  },
  {
    id: 'gpt-image-1-mini',
    name: 'GPT Image 1 Mini',
    description: 'OpenAI fast image generation',
    provider: 'openai',
    specs: {
      description: 'Faster, more affordable variant of GPT Image 1. Great for high-volume image generation tasks with good quality.',
      cost: 3,
      speed: 8,
      thinking: 4
    }
  },
  {
    id: 'dall-e-3',
    name: 'DALL-E 3',
    description: 'OpenAI high-quality image generation',
    provider: 'openai',
    specs: {
      description: 'OpenAI flagship image generation model. Produces highly detailed, accurate images with superior prompt adherence and coherent text rendering.',
      cost: 5,
      speed: 6,
      thinking: 5
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
    id: 'claude-opus-4-8',
    name: 'Claude Opus 4.8',
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
    id: 'claude-sonnet-4-6',
    name: 'Claude Sonnet 4.6',
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
  {
    id: 'grok-4.20-0309-reasoning',
    name: 'Grok 4',
    description: 'xAI Flagship',
    provider: 'grok',
    specs: {
      description: 'xAI flagship model with strong reasoning capabilities. 256K context window.',
      cost: 6,
      speed: 6,
      thinking: 9
    }
  },
  {
    id: 'grok-4-1-fast-reasoning',
    name: 'Grok 4 Fast',
    description: 'xAI Fast & Affordable',
    provider: 'grok',
    specs: {
      description: 'Extremely cost-efficient multimodal model with reasoning capabilities. 2M context window.',
      cost: 1,
      speed: 9,
      thinking: 8
    }
  },
  {
    id: 'grok-3',
    name: 'Grok 3',
    description: 'xAI Reliable',
    provider: 'grok',
    specs: {
      description: 'Proven general-purpose model with real-time knowledge access. 131K context window.',
      cost: 5,
      speed: 7,
      thinking: 8
    }
  },

  {
    id: 'grok-imagine-image',
    name: 'Grok Image (Aurora)',
    description: 'xAI Image Generation',
    provider: 'grok',
    specs: {
      description: 'Aurora image generation model. Creates high-quality, photorealistic images with accurate text rendering and logos.',
      cost: 4,
      speed: 6,
      thinking: 5
    }
  },

  // ── DeepSeek ───────────────────────────────────────────────────
  {
    id: 'deepseek-chat',
    name: 'DeepSeek V3.2',
    description: 'DeepSeek Flagship',
    provider: 'deepseek',
    specs: {
      description: 'Highly efficient model rivaling top-tier proprietary models in coding and math. Exceptional value. 128K context.',
      cost: 1,
      speed: 8,
      thinking: 9
    }
  },
  {
    id: 'deepseek-reasoner',
    name: 'DeepSeek V3.2 Reasoner',
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
    name: 'Mistral Small 3.2',
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
    name: 'Codestral',
    description: 'Mistral Code Specialist',
    provider: 'mistral',
    specs: {
      description: 'Purpose-built for code completion and generation. Optimized for developer workflows. 256K context.',
      cost: 3,
      speed: 8,
      thinking: 8
    }
  },

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
    id: 'qwen/qwen3.7-plus',
    name: 'Qwen3.7 Plus',
    description: 'Strong general model, 1M context',
    provider: 'openrouter',
    specs: { description: 'Capable general-purpose Qwen model with a 1M-token context.', cost: 4, speed: 7, thinking: 8 }
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

import type { PromptKind, UserRole } from '../types';
import { m, getLocale } from './i18n';

/**
 * SQEM-605 — the shared labels in the user's language: role names, what a kind is, category names.
 *
 * ⛔ **Not in constants.ts, and that is deliberate.** `constants.ts` is loaded by the Vercel function
 * `api/extension-config.ts` under Node, which resolves import specifiers exactly as written; an
 * import of `./lib/i18n` there would 500 the endpoint every extension setup fetches first — the
 * SQEM-398 outage (`tests/unit/extensionConfigLeaf.test.ts` keeps it a leaf). Its English
 * `ROLE_LABELS` also stays what `lib/gleap.ts` sends to support, so the role reads the same there
 * whatever language someone uses.
 *
 * Functions, not constants: evaluated when rendered.
 */
const ROLE: Record<UserRole, () => string> = { admin: m.role_admin, editor: m.role_editor, member: m.role_member };
export function roleLabel(role: UserRole): string {
  return ROLE[role]?.() ?? role;
}

const KIND: Record<PromptKind, () => string> = { prompt: m.kind_help_prompt, skill: m.kind_help_skill };
/** What a playbook kind is, for tooltips and the empty state (was KIND_HELP in constants.ts). */
export function kindHelp(kind: PromptKind): string {
  return KIND[kind]?.() ?? '';
}

/**
 * A category's NAME. The values in TEMPLATE_CATEGORIES are what is stored (prompts, library
 * templates, marketplace filters) and stay English. ⛔ Never store a label: a select shows
 * `categoryLabel(c)` and keeps `value={c}`.
 */
const CATEGORY: Record<string, () => string> = {
  'Marketing & Sales': m.category_marketing_sales,
  'Writing & Content': m.category_writing_content,
  'Engineering & Product': m.category_engineering_product,
  'Data & Research': m.category_data_research,
  'Business & Ops': m.category_business_ops,
  'Support & Success': m.category_support_success,
  'Creative & Design': m.category_creative_design,
};
export function categoryLabel(value: string): string {
  return CATEGORY[value]?.() ?? value;
}

/**
 * SQEM-609 — the plan texts from `constants.ts`, translated for display. The constants stay English
 * (a leaf, and the values the tests and PRICING.md are checked against); this maps each English text
 * to its message. ⛔ A feature line without an entry here shows in English — `planLabels.test.ts`
 * fails for that, and checks that each English message is exactly the constant.
 */
const PLAN_FEATURE: Record<string, () => string> = {
  '1 team member': m.plan_f_1_team_member,
  'Up to 10 team members': m.plan_f_up_to_10_team_members,
  'Up to 30 team members': m.plan_f_up_to_30_team_members,
  '2,000 AI credits / month': m.plan_f_2_000_ai_credits_month,
  '25,000 AI credits / month': m.plan_f_25_000_ai_credits_month,
  '100,000 AI credits / month': m.plan_f_100_000_ai_credits_month,
  '1 GB file storage': m.plan_f_1_gb_file_storage,
  '10 GB file storage': m.plan_f_10_gb_file_storage,
  '50 GB file storage': m.plan_f_50_gb_file_storage,
  '100 web searches / month': m.plan_f_100_web_searches_month,
  '1,000 web searches / month': m.plan_f_1_000_web_searches_month,
  '3,000 web searches / month': m.plan_f_3_000_web_searches_month,
  'MCP server access': m.plan_f_mcp_server_access,
  'Roles & permissions': m.plan_f_roles_permissions,
  'Unlimited AI with your own key (BYOK)': m.plan_f_unlimited_ai_with_your_own_key_byok,
  'Unlimited playbooks': m.plan_f_unlimited_playbooks,
  'Marketplace access': m.plan_f_marketplace_access,
  'Priority support': m.plan_f_priority_support,
};
const PLAN_TAGLINE: Record<string, () => string> = {
  Solo: m.plan_tagline_solo,
  Team: m.plan_tagline_team,
  Business: m.plan_tagline_business,
};

export function planFeature(text: string): string {
  return PLAN_FEATURE[text]?.() ?? text;
}

export function planTagline(tier: string, fallback: string): string {
  return PLAN_TAGLINE[tier]?.() ?? fallback;
}

/** `€12/mo`, `12 €/Monat` — the amount in the app's currency format, per month. */
export function planMonthly(amount: number): string {
  return m.plan_per_month({ price: formatEuro(amount) });
}

/** The amount as euros in the app language (no decimals; plan prices are whole euros). */
export function formatEuro(amount: number): string {
  return new Intl.NumberFormat(getLocale(), { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 }).format(amount);
}

/** The monthly price as a number, read from the display string in `constants.ts` (`'€12/mo'`). */
export function planMonthlyAmount(price: string): number {
  return Number(price.replace(/[^0-9]/g, ''));
}

/**
 * SQEM-609 — the MCP client guides (`lib/mcpClients.ts`, pure data, English) in the app language.
 * Keyed by the English text, like the plan features. The vendors' menu names inside a step
 * (Customize → Connectors …) stay English on purpose: their German menus are not documented in the
 * sources the steps were checked against, and a wrong path is worse than an English one.
 * ⛔ `planLabels.test.ts` fails for a step without an entry and checks each English message.
 */
const MCP_CLIENT_TEXT: Record<string, () => string> = {
  "In Claude (web or desktop app): Customize → Connectors → + Add → Add custom connector.": m.mcpc_claude_1,
  "Name it \"sqemes\" and paste the endpoint URL above. Continue.": m.mcpc_claude_2,
  "Choose to sign in, then sign in with your sqemes account and pick the workspace.": m.mcpc_claude_3,
  "On Claude Team or Enterprise an owner adds the connector once under Organization settings → Connectors → Add → Custom → Web; everyone then connects it under Customize → Connectors.": m.mcpc_claude_note,
  "Open chatgpt.com/plugins, select the plus button, then Add custom MCP server.": m.mcpc_chatgpt_1,
  "Name it \"sqemes\" and paste the endpoint URL above.": m.mcpc_chatgpt_2,
  "Sign in with your sqemes account when ChatGPT asks.": m.mcpc_chatgpt_3,
  "Your ChatGPT workspace’s policies decide whether custom MCP servers are allowed; on a business plan an admin may have to enable it.": m.mcpc_chatgpt_note,
  "Run the command below in your terminal.": m.mcpc_cc_1,
  "In Claude Code, run /mcp, choose sqemes and sign in with your sqemes account.": m.mcpc_cc_2,
  "Add --scope user to use it in every project. Without a browser, add --header \"Authorization: Bearer $SQEMES_MCP_KEY\" with a key instead.": m.mcpc_cc_note,
  "Add the table below to ~/.codex/config.toml.": m.mcpc_codex_1,
  "Run codex mcp login sqemes and sign in with your sqemes account.": m.mcpc_codex_2,
  "To use a key instead, add bearer_token_env_var = \"SQEMES_MCP_KEY\" to the table and set that variable.": m.mcpc_codex_note,
  "Create a key above and set it as the environment variable SQEMES_MCP_KEY.": m.mcpc_cursor_1,
  "Add the block below to ~/.cursor/mcp.json (or .cursor/mcp.json in one project).": m.mcpc_cursor_2,
  "Restart Cursor and switch the sqemes server on in its MCP settings.": m.mcpc_cursor_3,
  "Create a key above.": m.mcpc_vscode_1,
  "Add the file below as .vscode/mcp.json in your project (or in your user profile).": m.mcpc_vscode_2,
  "Start the server from the file; VS Code asks for the key once and stores it.": m.mcpc_vscode_3,
  "Add the endpoint URL above as a remote (HTTP) MCP server.": m.mcpc_other_1,
  "If the client offers to sign in, do that. Otherwise send a key as Authorization: Bearer <key>.": m.mcpc_other_2,
  "Keep a file that holds a key out of version control.": m.mcpc_other_note,
  "Other": m.mcpc_other,
  "Many clients read this shape": m.mcpc_shape,
};

export function mcpClientText(text: string): string {
  return MCP_CLIENT_TEXT[text]?.() ?? text;
}

/**
 * SQEM-611 — the model picker's hover text (`specs.description` in `AVAILABLE_MODELS`, constants.ts —
 * a leaf, English) in the app language. Keyed by the English text, like the plan features. Model and
 * company names stay as they are; the short `description` beside it is shown nowhere and stays English.
 * ⛔ `germanRestOfUi.test.ts` fails for a model without an entry and checks each English message.
 */
const MODEL_TEXT: Record<string, () => string> = {
  "Google's most intelligent Flash model — frontier-class quality at Flash speed. The default choice for chat, summarisation and extraction.": m.md_gemini_flash,
  "Built for high-volume, low-latency work — classification, routing, bulk processing. 1M context window.": m.md_gemini_lite,
  "Google's flagship reasoning model — deep reasoning and coding, stable. 1M context window.": m.md_gemini_pro,
  "High-efficiency image generation and editing.": m.md_image_efficient,
  "Highest-fidelity image generation and editing.": m.md_image_fidelity,
  "Advanced reasoning and coding — the one to reach for on hard problems.": m.md_openai_top,
  "Balanced intelligence and cost. The sensible default for everyday work.": m.md_openai_balance,
  "Cost-optimised for high-volume workloads where throughput matters more than depth.": m.md_openai_cost,
  "Image generation and editing.": m.md_image_edit,
  "For demanding reasoning and long-horizon agentic work. 1M context.": m.md_claude_deep,
  "Anthropic's recommended starting point — long-running coding and knowledge work. 1M context.": m.md_claude_recommended,
  "The best combination of speed and intelligence. 1M context.": m.md_claude_balance,
  "For high-volume, latency-sensitive work such as classification, extraction and routing. 1M context.": m.md_claude_fast,
  "xAI's most capable model for code and chat, with real-time knowledge.": m.md_grok,
  "Image generation.": m.md_image,
  "Highly efficient model rivaling top-tier proprietary models in coding and math. Exceptional value. 128K context.": m.md_deepseek_fast,
  "Specialized reasoning model that thinks step-by-step. Competitive with top reasoning models at a fraction of the cost. 128K context.": m.md_deepseek_reason,
  "State-of-the-art open-weight multimodal model with strong reasoning and multilingual capabilities. 128K context.": m.md_mistral_large,
  "Efficient model with strong multimodal performance. Great balance of speed and quality. 128K context.": m.md_mistral_medium,
  "Purpose-built for code completion and generation. Optimized for developer workflows. 256K context.": m.md_mistral_code,
};

export function modelDescription(text: string): string {
  return MODEL_TEXT[text]?.() ?? text;
}

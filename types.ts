
export type UserRole = 'admin' | 'editor' | 'member';

export interface User {
  id: string;
  name: string;
  email: string;
  avatar: string;
  role: UserRole;
}

export type PlanTier = 'Solo' | 'Team' | 'Business';

export interface Workspace {
  id: string;
  name: string;
  plan: PlanTier;
  isManaged: boolean;
  stripeSubscriptionId?: string;
  billingCycle?: 'monthly' | 'yearly';
  creditsUsed: number;
  creditsLimit: number;
  /** SQEM-057 — Stripe subscription state: 'trialing' | 'active' | 'past_due' | 'canceled' | null. */
  subscriptionStatus?: string | null;
  /** SQEM-057 — ISO timestamp the trial ends (null if not trialing). */
  trialEndsAt?: string | null;
  /** SQEM-057 — subscription set to cancel at period end (canceled via portal but still active until then). */
  cancelAtPeriodEnd?: boolean;
  /** SQEM-082 — Sqemes-funded AI available (Cloud has MISTRAL_API_KEY). From getApiKeyStatus, not the DB row. */
  fundedAvailable?: boolean;
  /**
   * SQEM-311 — the model used for AI *authoring* (enhance, descriptions, both wizards, brand
   * adaptation). Null/absent ⇒ pick the first text model with a key, which is what happened
   * unconditionally before this existed. Validated against `AVAILABLE_MODELS` on read — see
   * `authoringModelState()`; never trusted just because it is stored.
   */
  authoringModelId?: string | null;
  apiKeys: {
    gemini?: string;
    openai?: string;
    claude?: string;
    grok?: string;
    deepseek?: string;
    mistral?: string;
    openrouter?: string;
    ollama?: string;
  };
  members: User[];
  blacklistedTerms: string[];
  blockEmails: boolean;
  blockIban: boolean;
  blockPhone: boolean;
  tags: string[];
  /** SQEM-031 — user-pasted OpenRouter model ids (BYOK), shown in the picker alongside the curated set. */
  openrouterModels: string[];
  /** SQEM-106 — brand profile captured from onboarding; powers marketplace adaptation. */
  brandProfile?: BrandProfile;
  /** SQEM-142 — default access (roles) applied to newly-created templates. Empty/undefined = open to everyone. */
  defaultTemplateAccess?: UserRole[];
}

/** SQEM-106 — workspace-level brand context, seeded from the onboarding wizard. */
export interface BrandProfile {
  brandName: string;
  whatItDoes: string;
  audience: string;
  tone: ToneLevel;
  useCase?: string;
  website?: string;
  updatedAt?: string;
}

export type PromptKind = 'prompt' | 'assistant' | 'skill';

export type ToneLevel = 1 | 2 | 3 | 4 | 5;

export interface BrandVoiceExample {
  id: string;
  input: string;
  output: string;
}

export interface AssistantBrandConfig {
  tone: ToneLevel;
  brandContext: string;
  examples: BrandVoiceExample[];
}

export type VariableType = 'text' | 'textarea' | 'select' | 'file';

export interface Variable {
  id: string;
  name: string; // key used in prompt {{name}}
  label: string;
  type: VariableType;
  options?: string[]; // for select
  defaultValue?: string;
}

export interface Step {
  id: string;
  title: string;
  content: string; // Rich text or markdown with {{variables}}
  model: string;
  assistantId?: string;
  includePreviousResult?: boolean;
  temperature?: number;
}

export interface Prompt {
  id: string;
  workspaceId: string;
  kind: PromptKind;
  title: string;
  description: string;
  tag: string | null;
  variables: Variable[];
  content: string;
  systemInstruction?: string;
  contextFileIds: string[];
  model?: string;
  /**
   * SQEM-265 — set when the setup wizard created this template from AI output (EU AI Act
   * Art. 50(2)). **NULL means "not known to be generated", not "written by a person"** — it is
   * never backfilled, because nothing in an old row can tell us which it was.
   */
  aiGeneratedAt?: string | null;
  createdAt: string;
  updatedAt: string;
  createdBy: string;
  usageCount: number;
  isFavorite?: boolean;
  sourceTemplateId?: string;
  published?: boolean;
  hadMultipleSteps?: boolean;
  brandConfig?: AssistantBrandConfig;
}

/**
 * SQEM-324 — one route of a persona: a template, and the condition under which a client should load
 * it.
 *
 * ⚠️ `condition` is prose written for a model to judge ("the user wants an offer laid out"), not a
 * rule we evaluate. Nothing in this codebase branches on it, and nothing should: the moment we
 * execute the routing ourselves, a persona stops being a document and becomes a multi-step prompt
 * chain — a shape this product removed on purpose and does not reintroduce.
 */
export interface PersonaRoute {
  templateId: string;
  /** Denormalised for rendering — the archive card and the editor both want it without a join. */
  templateTitle?: string;
  templateKind?: PromptKind;
  condition: string;
  /** Ascending. The order the routes appear in the composed orchestrator. */
  sortOrder: number;
}

export interface Persona {
  id: string;
  workspaceId: string;
  title: string;
  description: string;
  /**
   * The orchestrator PROSE only — role, working style, rules. **Never the routing table**: that
   * lives in `routes`, so deleting a template cannot leave a route pointing at nothing. What MCP
   * serves is composed from both at read time.
   */
  content: string;
  tags: string[];
  routes: PersonaRoute[];
  /** SQEM-265 — set when the wizard generated it. NULL is "not known to be generated". */
  aiGeneratedAt?: string | null;
  createdAt: string;
  updatedAt: string;
  createdBy: string;
  usageCount: number;
}

export interface WorkspaceFile {
  id: string;
  workspaceId: string;
  name: string;
  mimeType: string;
  sizeBytes: number;
  storagePath: string;
  tags: string[];
  createdBy: string;
  createdAt: string;
}

export type TemplateCategory =
  | 'Marketing & Sales'
  | 'Writing & Content'
  | 'Engineering & Product'
  | 'Data & Research'
  | 'Business & Ops'
  | 'Support & Success'
  | 'Creative & Design'
  | 'General'; // internal default / uncategorised fallback — not a browse tab

export interface LibraryTemplate {
  id: string;
  kind: PromptKind;
  title: string;
  description: string;
  category: TemplateCategory;
  tags: string[];
  variables: Variable[];
  steps: Step[];
  systemInstruction?: string;
  brandConfig?: AssistantBrandConfig;
  createdBy: string;
  usageCount: number;
  published: boolean;
  createdAt: string;
  updatedAt: string;
  content?: string;              // SQEM-163 — display body for UGC listings
  // SQEM-163 — user-contributed marketplace fields (null/undefined for curated rows)
  workspaceId?: string | null;   // source workspace (provenance)
  status?: 'pending' | 'published' | 'rejected';
  bundlePath?: string | null;    // the .sqemes.zip snapshot in the library-files bucket (Cloud only)
  hasBundle?: boolean;           // whether a bundle exists — set from bundle_path (Cloud) or has_bundle (self-host public feed, SQEM-178)
  source?: string;               // 'cloud' | 'self-host' — where a submission came from (SQEM-179/180)
  publisherName?: string | null; // attributed publisher display name for self-host submissions (SQEM-180)
  preview?: { fileNames?: string[]; fileCount?: number };
  // SQEM-169 — votes + scan verdict
  score?: number;                // net votes (up - down)
  voteCount?: number;
  scanRisk?: 'low' | 'medium' | 'high' | null;
  scanReasons?: string[];
}

export interface ChatSession {
  id: string;
  workspaceId: string;
  userId: string;
  title: string;
  model: string;
  assistantId?: string;
  visibility: 'private' | 'workspace';
  createdAt: string;
  lastActiveAt: string;
  isOwner: boolean; // derived: userId === currentUser.id
  isGenerating: boolean;
  pinned: boolean; // SQEM-038/085 — pinned chats are exempt from the retention cap
  ownerName?: string;
  ownerAvatar?: string;
}

export interface StoredChatMessage {
  id: string;
  sessionId: string;
  role: 'user' | 'assistant';
  content: string;
  model?: string;
  createdAt: string;
  userId?: string;
  userName?: string;
  userAvatar?: string;
}

export interface Invitation {
  id: string;
  workspaceId: string;
  email: string;
  role: UserRole;
  token: string;
  invitedBy: string | null;
  status: 'pending' | 'accepted' | 'expired';
  createdAt: string;
  expiresAt: string;
}

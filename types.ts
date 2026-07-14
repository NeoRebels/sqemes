
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
  skillIds: string[];
  model?: string;
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

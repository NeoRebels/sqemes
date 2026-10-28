import React, { useState, useEffect, useRef } from 'react';
import { useUI, useWorkspace, useData } from '../store';
import DocumentStyleCard from '../components/DocumentStyleCard';
import { can } from '../lib/permissions';
import { useLocation, useNavigate } from 'react-router';
import { PLANS, ROLE_LABELS, TRIAL_DAYS } from '../constants';
import PlanStorageUsage from '../components/PlanStorageUsage';
import { LIBRARY_SYSTEM_PROMPT } from '../lib/libraryPrompt';
import { hasActiveSubscription, isTrialing } from '../lib/subscription';
import { IS_SELF_HOSTED, functionsUrl, functionCallUrl } from '../lib/env';
import { getWorkspaceStorageUsage } from '../lib/api/files';
import { copyToClipboard } from '../lib/clipboard';
import { fetchCanPublish, setPublisherToken } from '../lib/api/library';
import { UserRole, type Workspace } from '../types';
import { BrandProfileForm, brandFormFromProfile, type BrandFormValue } from '../components/BrandProfileForm';
import { TemplateAccessControl, workspaceDefaultToValue, valueToWorkspaceDefault, type TemplateAccessValue } from '../components/TemplateAccessControl';
import { supabase } from '../lib/supabase';
import { saveApiKey, deleteApiKey, getApiKeyStatus } from '../lib/api/apiKeys';
import {
  countRestrictedContentForMember,
  handoverContentFromMember,
  releaseRestrictedContent,
} from '../lib/api/members';
import { mcpKeyExpiry, isMcpKeyExpired } from '../lib/mcpKeys';
import { ProviderIcon } from '../components/ProviderIcon';
import McpIcon from '../components/McpIcon';
import ConnectorsCard from '../components/ConnectorsCard';
import Card from '../components/ui/Card';
import PageHeader from '../components/ui/PageHeader';
import SettingsCardHeader, { SETTINGS_FIELD_LABEL } from '../components/ui/SettingsCardHeader';
import { Input } from '../components/ui/Input';
import Switch from '../components/ui/Switch';
import AccessGroupsCard from '../components/AccessGroupsCard';
import AuthoringModelCard from '../components/AuthoringModelCard';
import { isMultiSeat } from '../lib/templateAccessScope';
import Modal from '../components/ui/Modal';
import Button from '../components/ui/Button';
import ConfirmModal from '../components/ui/ConfirmModal';
import CardSaveBar from '../components/ui/CardSaveBar';
import LanguageCard, { WORKSPACE_LANGUAGE_OPTIONS, PROFILE_LANGUAGE_OPTIONS } from '../components/LanguageCard';
import { m, canChooseLanguage, getLocale } from '../lib/i18n';
import { roleLabel, planFeature, planTagline, planMonthly, planMonthlyAmount, formatEuro } from '../lib/labels';
import { authErrorText } from '../lib/authErrors';
import AboutSection from '../components/AboutSection';
import Avatar, { randomAvatarDataUri } from '../components/ui/Avatar';
import McpClientGuide from '../components/McpClientGuide';
import { buildAccountExport, accountExportFilename } from '../lib/accountExport';
import { downloadBlob } from '../lib/templateBundle';
import {
  ApiKeyScopeFields,
  defaultScopeFor,
  clampScopeToAuthority,
  scopeArrayFromValue,
  expiresAtFromValue,
  valueFromKey,
  type KeyScopeValue,
} from '../components/ApiKeyScopeFields';
import { 
  CreditCard,
  Plug,
  Trash2,
  Key,
  Save,
  Users,
  Building,
  User,
  ShieldAlert,
  Plus,
  X,
  Check,
  Mail,
  Lock,
  Camera,
  RefreshCw,
  Upload,
  Server,
  LogOut,
  DoorOpen,
  ExternalLink,
  Zap,
  Clock,
  Copy,
  Shield,
  RotateCw,
  Loader2,
  Download,
  SlidersHorizontal,
  Sparkles,
  ArrowUpRight,
  Globe,
} from 'lucide-react';
import Select from '../components/ui/Select';

// SQEM-539 — the Content Governance switches, saved together by their card's Save button.
type GovernanceKey = 'blockEmails' | 'blockIban' | 'blockPhone';
/** Same role set, order ignored — a draft equal to the saved default is no draft. */
const sameRoles = (a: readonly string[], b: readonly string[]) =>
  a.length === b.length && [...a].sort().join() === [...b].sort().join();

type TabId = 'general' | 'brand' | 'team' | 'security' | 'plans' | 'api' | 'connectors' | 'profile';

const MASKED_KEY_RE = /(?:\u2022){4,}|^\*{4,}$/;

const isPlaceholderKey = (value: string) => {
  const trimmed = value.trim();
  if (!trimmed) return false;
  return MASKED_KEY_RE.test(trimmed) || /enter new key to replace/i.test(trimmed);
};

// SQEM-554 (c) — a numbered step of the MCP card: the number, a heading, the content.
const McpStep = ({ n, title, children }: { n: number; title: string; children: React.ReactNode }) => (
  <li className="flex gap-3">
    <span aria-hidden className="w-6 h-6 shrink-0 rounded-full bg-accent-soft text-accent text-xs font-bold flex items-center justify-center mt-0.5">{n}</span>
    <div className="min-w-0 flex-1">
      <h3 className="text-sm font-semibold text-ink-strong mb-2">{title}</h3>
      {children}
    </div>
  </li>
);

const McpServerCard = ({ locked, onUpgrade }: { locked: boolean; onUpgrade?: () => void }) => {
  const mcpUrl = functionsUrl('mcp-server');
  const [mcpUrlCopied, setMcpUrlCopied] = useState(false);
  const [promptCopied, setPromptCopied] = useState(false);
  const [promptOpen, setPromptOpen] = useState(false);
  return (
    // SQEM-554 (c) — first card of the tab (MCP is one of the three channels; it was third, under two
    // key cards), three numbered steps, the client tabs with logos.
    <Card className="p-6 md:p-8 relative overflow-hidden">
      <div className="mb-6">
        <h2 className="font-display text-xl font-semibold text-ink-strong flex items-center gap-2">
          <McpIcon className="w-5 h-5 text-accent" />
          {m.mcp_title()}
        </h2>
        <p className="text-sm text-ink-muted mt-1">
          {m.mcp_desc()}
        </p>
      </div>
      {locked ? (
        <div className="flex flex-col items-center justify-center py-8 text-center gap-3">
          <div className="w-12 h-12 rounded-full bg-surface-sunken flex items-center justify-center">
            <Lock className="w-5 h-5 text-ink-subtle" />
          </div>
          <div>
            <p className="text-sm font-semibold text-ink">{m.mcp_locked_title()}</p>
            <p className="text-xs text-ink-subtle mt-1">{m.mcp_locked_body()}</p>
          </div>
          <button
            onClick={onUpgrade}
            className="inline-flex items-center gap-1.5 px-4 py-2 bg-accent-strong hover:opacity-90 text-white rounded-control text-sm font-bold transition-opacity"
          >
            {m.mcp_upgrade()}
          </button>
        </div>
      ) : (
        <ol className="space-y-6">
          <McpStep n={1} title={m.mcp_step1()}>
            <div className="flex items-center gap-2 bg-surface-sunken border border-line-strong rounded-control px-3 py-2.5 overflow-hidden">
              <span className="text-xs font-mono text-ink truncate flex-1 min-w-0">{mcpUrl}</span>
              <button
                type="button"
                onClick={async () => { await copyToClipboard(mcpUrl); setMcpUrlCopied(true); setTimeout(() => setMcpUrlCopied(false), 2000); }}
                className="shrink-0 text-ink-subtle hover:text-accent transition-colors"
                title={m.mcp_copy_url()}
                aria-label={m.mcp_copy_url_label()}
              >
                {mcpUrlCopied ? <Check className="w-3.5 h-3.5 text-success" /> : <Copy className="w-3.5 h-3.5" />}
              </button>
            </div>
          </McpStep>

          {/* SQEM-533 — one tab per client instead of one JSON block for all of them; the steps and
              snippets live in lib/mcpClients.ts, shared with the setup wizard. */}
          <McpStep n={2} title={m.mcp_step2()}>
            <McpClientGuide url={mcpUrl} />
          </McpStep>

          {/* SQEM-303 — the system prompt lives here, inside the MCP card, and not as a feature of
              its own. It instructs a model to use tools it can only reach through the connection set
              up directly above; on its own it achieves nothing. Somewhere else in the product it
              would be a text people copy and then wonder why nothing changed. */}
          {/* ⛔ SQEM-468 — this said "(optional)" until 2026-09-26, and the measurement says the
              opposite. Six typical requests, custom instructions switched off: only two reached
              the library through the server alone. The same text pasted into the client's standing
              instructions is what covers the other four, so on this screen it is the step that
              decides whether any of this works — not a nicety.
              SQEM-554 (c): therefore NOT collapsed away (the audit's first idea). The step, its
              "paste this too" and the Copy button always show; only the long text is cut to a few
              lines until "Show full text". */}
          <McpStep n={3} title={m.mcp_step3()}>
            {/* SQEM-378 — the same text the Sqemes chat works under. SQEM-526: the MCP server no longer
                hands it out (MCP client guidelines), so pasting it is the only way it reaches a client. Saying so matters: it is the difference between "a snippet we offer" and
                "the rule this product already follows", and the second is what makes someone paste
                it. One source, so this claim cannot quietly stop being true. */}
            <p className="text-xs text-ink-muted mb-2">
              {m.mcp_prompt_body()}
            </p>
            <div className="relative bg-surface-sunken border border-line-strong rounded-control p-4">
              {/* Collapsed: exactly five lines (text-xs = 1rem lines), fading out, so the cut never lands mid-line. */}
              <pre id="mcp-system-prompt" className={`text-xs leading-4 text-ink whitespace-pre-wrap pr-20 ${promptOpen ? 'max-h-80 overflow-y-auto' : 'max-h-20 overflow-hidden [mask-image:linear-gradient(to_bottom,black_60%,transparent)]'}`}>{LIBRARY_SYSTEM_PROMPT}</pre>
              <button
                type="button"
                onClick={async () => { await copyToClipboard(LIBRARY_SYSTEM_PROMPT); setPromptCopied(true); setTimeout(() => setPromptCopied(false), 2000); }}
                className="absolute top-3 right-3 inline-flex items-center gap-1 px-2 py-1 rounded-control bg-surface-raised border border-line text-xs font-semibold text-ink hover:text-accent transition-colors"
                title={m.mcp_copy_prompt()}
              >
                {promptCopied ? <><Check className="w-3.5 h-3.5 text-success" /> {m.mcp_copied()}</> : <><Copy className="w-3.5 h-3.5" /> {m.mcp_copy()}</>}
              </button>
              <button
                type="button"
                onClick={() => setPromptOpen(o => !o)}
                aria-expanded={promptOpen}
                aria-controls="mcp-system-prompt"
                className="mt-2 text-xs font-semibold text-accent hover:underline"
              >
                {promptOpen ? m.mcp_show_less() : m.mcp_show_full()}
              </button>
            </div>
            {/* Two places, not one — and they are genuinely different settings, so naming only the
                personal one would leave a team lead to discover the other by accident. */}
            <dl className="mt-2.5 space-y-1.5 text-xs text-ink-subtle">
              <div>
                <dt className="inline font-bold text-ink-muted">{m.mcp_just_you()}</dt>
                <dd className="inline">{m.mcp_just_you_where()}</dd>
              </div>
              <div>
                <dt className="inline font-bold text-ink-muted">{m.mcp_everyone()}</dt>
                {/* Checked against both vendors' own documentation on 2026-08-31. Claude states that
                    organization instructions apply "in every conversation across your organization";
                    OpenAI documents nothing equivalent, so this says what its nearest option actually
                    does — applied when judged relevant — rather than implying it is the same thing. */}
                <dd className="inline">{m.mcp_everyone_where()}</dd>
              </div>
            </dl>
          </McpStep>
        </ol>
      )}
    </Card>
  );
};

const Settings = () => {
  const { workspace, updateWorkspace, setWorkspaceManaged, currentUser, updateUser,
    addMember, removeMember, updateMemberRole, pendingInvitations, fetchInvitations,
    cancelInvitation, resendInvitation, deleteWorkspace, leaveWorkspace, deleteAccount,
    isSqemesAdmin } = useWorkspace();
  const { workspaceFiles } = useData(); // SQEM-597 — the logo choices of the document style
  const { showToast } = useUI();

  const location = useLocation();
  const navigate = useNavigate();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [activeTab, setActiveTab] = useState<TabId>(!can(currentUser, workspace, 'settings:general') ? 'profile' : 'general');
  // SQEM-568 — the phone tab row scrolls sideways; the active tab is kept in view so it can never be the
  // one that is cut off (the reason SQEM-540 once made the row wrap instead).
  const mobileTabsRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const active = mobileTabsRef.current?.querySelector<HTMLElement>('[aria-pressed="true"]');
    active?.scrollIntoView?.({ block: 'nearest', inline: 'nearest' });
  }, [activeTab]);
  const [billingCycle, setBillingCycle] = useState<'monthly' | 'yearly'>(workspace.billingCycle ?? 'yearly');
  const [checkoutLoadingTier, setCheckoutLoadingTier] = useState<string | null>(null);
  const [isPortalLoading, setIsPortalLoading] = useState(false);
  
  // LLM API Keys State
  const [apiKeys, setApiKeys] = useState<Record<string, string>>({});
  // SQEM-594 — the workspace's own search key: ONE per workspace, Linkup or Brave.
  const [searchProvider, setSearchProvider] = useState<'linkup' | 'brave'>('linkup');
  const [searchKey, setSearchKey] = useState('');
  const [newOrModelId, setNewOrModelId] = useState(''); // OpenRouter "add custom model id" repeater input

  // Public API Keys State
  type SqemesApiKey = { id: string; name: string; key_prefix: string; created_at: string; last_used_at: string | null; scopes: string[] | null; expires_at: string | null; connection_expires_at: string | null; is_oauth: boolean; user_id: string | null };
  const [sqemesApiKeys, setSqemesApiKeys] = useState<SqemesApiKey[]>([]);
  const [sqemesApiKeysLoaded, setSqemesApiKeysLoaded] = useState(false);
  const [showGenerateKeyModal, setShowGenerateKeyModal] = useState(false);
  const [newKeyName, setNewKeyName] = useState('');
  /**
   * SQEM-349 — may this person grant write scopes on a connection at all?
   *
   * ⛔ Deliberately `prompts:edit` and not a new action. It already means "may change content" and is
   * exactly `admin || editor` — the same predicate `mcp-server` derives its `mayWrite` from. A second,
   * nearly-identical action is how two definitions of one rule start drifting apart.
   *
   * ⚠️ Declared ABOVE the scope state on purpose (SQEM-353). The initial value of that state used to
   * be the unclamped default, which was harmless only because the one button that opens the dialog
   * happens to reset it first. That is a property of a call site, not of the code — and a second
   * entry point would silently bring the ticked-but-unusable boxes back.
   */
  const canWriteContent = can(currentUser, workspace, 'prompts:edit');

  const [newKeyScope, setNewKeyScope] = useState<KeyScopeValue>(defaultScopeFor(canWriteContent));
  // SQEM-143 — new keys are bound to their creator by default (the key only exposes templates
  // the creator may access). Admins can opt into a workspace-wide key (all templates).
  const [isGeneratingKey, setIsGeneratingKey] = useState(false);
  const [generatedKeyValue, setGeneratedKeyValue] = useState<string | null>(null);
  const [deletingKeyId, setDeletingKeyId] = useState<string | null>(null);
  // SQEM-183 — self-host marketplace publisher token (write-only; stored encrypted server-side)
  const [pubToken, setPubToken] = useState('');
  const [pubConfigured, setPubConfigured] = useState(false);
  const [pubSaving, setPubSaving] = useState(false);
  useEffect(() => {
    if (IS_SELF_HOSTED) fetchCanPublish().then(setPubConfigured).catch(() => {});
  }, []);
  const savePublisherToken = async (override?: string) => {
    const t = (override ?? pubToken).trim();
    setPubSaving(true);
    try {
      await setPublisherToken(t);
      setPubConfigured(!!t);
      setPubToken('');
      showToast(t ? m.st_pub_saved() : m.st_pub_cleared(), 'success');
    } catch (e) {
      showToast(e instanceof Error ? e.message : m.st_pub_failed(), 'error');
    } finally {
      setPubSaving(false);
    }
  };
  const [keyCopied, setKeyCopied] = useState(false);
  // Editing scope/expiry of an existing connection (no re-issue).
  const [editingKey, setEditingKey] = useState<SqemesApiKey | null>(null);
  const [editKeyName, setEditKeyName] = useState('');
  const [editKeyScope, setEditKeyScope] = useState<KeyScopeValue>(defaultScopeFor(canWriteContent));
  const [isSavingScope, setIsSavingScope] = useState(false);

  const loadSqemesApiKeys = async () => {
    const { data } = await supabase
      .from('sqemes_api_keys')
      .select('id, name, key_prefix, created_at, last_used_at, scopes, expires_at, connection_expires_at, is_oauth, user_id')
      .eq('workspace_id', workspace.id)
      .order('created_at', { ascending: false });
    if (data) setSqemesApiKeys(data);
    setSqemesApiKeysLoaded(true);
  };

  const handleGenerateKey = async () => {
    if (!newKeyName.trim()) return;
    setIsGeneratingKey(true);
    try {
      const randomBytes = crypto.getRandomValues(new Uint8Array(16));
      const hex = Array.from(randomBytes).map(b => b.toString(16).padStart(2, '0')).join('');
      const key = `sqm_live_${hex}`;
      const keyPrefix = key.substring(0, 16) + '...';
      const hashBuffer = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(key));
      const keyHash = Array.from(new Uint8Array(hashBuffer)).map(b => b.toString(16).padStart(2, '0')).join('');

      // SQEM-143 → 346 — the key is bound to its creator, always. `mcp-server` filters templates to
      // that person's access, and since SQEM-346 there is no other kind: `user_id` is NOT NULL and
      // the workspace-wide option is gone. It was the last place where authority hung on a secret
      // instead of a person, and `on delete set null` meant a member's read-only key could fall into
      // it by having its profile deleted.
      const { error } = await supabase.from('sqemes_api_keys').insert({
        workspace_id: workspace.id,
        name: newKeyName.trim(),
        key_hash: keyHash,
        key_prefix: keyPrefix,
        // SQEM-353 — clamped, not trusted. The checkboxes are disabled for a member, but a disabled
        // checkbox prevents the click and not the value: the default carried create+update, so a
        // member's key was written with scopes they can never use. ⚠️ Kept here as well as in the
        // form's starting value, because the UI is never the boundary — the same reason SQEM-349's
        // real fix sat in the server rather than in this dialog.
        scopes: scopeArrayFromValue(clampScopeToAuthority(newKeyScope, canWriteContent)),
        expires_at: expiresAtFromValue(newKeyScope),
        user_id: currentUser.id,
      });

      if (error) throw error;

      setGeneratedKeyValue(key);
      setShowGenerateKeyModal(false);
      setNewKeyName('');
      setNewKeyScope(defaultScopeFor(canWriteContent));
      await loadSqemesApiKeys();
    } catch (err: any) {
      // SQEM-293 — a denied insert surfaces as "new row violates row-level security policy for table
      // …", which tells the person nothing they can act on: not that a permission is missing, not
      // who to ask. Translate the one case we can recognise and pass everything else through
      // unchanged rather than guessing at it.
      const denied = /row-level security/i.test(err?.message ?? '');
      showToast(
        denied
          ? m.stk_denied()
          : (err.message || m.stk_generate_failed()),
        'error',
      );
    } finally {
      setIsGeneratingKey(false);
    }
  };

  const handleDeleteApiKey = async (id: string) => {
    setDeletingKeyId(id);
    const { error } = await supabase.from('sqemes_api_keys').delete().eq('id', id);
    if (error) {
      // SQEM-287 — the key is still there, and that is the part worth saying: somebody who wanted
      // it gone needs to know it is not.
      showToast(m.stk_delete_active(), 'error');
    } else {
      setSqemesApiKeys(prev => prev.filter(k => k.id !== id));
    }
    setDeletingKeyId(null);
  };

  const openEditKeyScope = (k: SqemesApiKey) => {
    setEditingKey(k);
    setEditKeyName(k.name);
    // OAuth connections show the connection lifetime (connection_expires_at), not the
    // short access-token TTL in expires_at.
    setEditKeyScope(valueFromKey(k.scopes, k.is_oauth ? k.connection_expires_at : k.expires_at));
  };

  const handleSaveKeyScope = async () => {
    if (!editingKey) return;
    const trimmedName = editKeyName.trim();
    if (!trimmedName) {
      showToast(m.stk_name_empty(), 'error');
      return;
    }
    setIsSavingScope(true);
    // For OAuth connections, expiry is the connection lifetime carried by the refresh token
    // (managed by the OAuth flow), not editable here — only name + scopes update in place.
    const updates: Record<string, unknown> = {
      name: trimmedName,
      // SQEM-353 — clamped on save as well. ⚠️ An existing key that carries write scopes from a time
      // when its owner was an editor keeps SHOWING them (the row really does hold them), but they
      // fall away the next time a member saves it. That is the honest direction: a scope beyond the
      // role is inert, and letting it quietly persist is how it becomes live again on a promotion
      // without anyone ever having chosen it.
      scopes: scopeArrayFromValue(clampScopeToAuthority(editKeyScope, canWriteContent)),
    };
    if (editingKey.is_oauth) {
      // OAuth: the lifetime is connection_expires_at (the refresh grant reads it); expires_at
      // stays the short access-token TTL, rotated by the OAuth flow.
      updates.connection_expires_at = expiresAtFromValue(editKeyScope);
    } else {
      updates.expires_at = expiresAtFromValue(editKeyScope);
    }
    const { error } = await supabase
      .from('sqemes_api_keys')
      .update(updates)
      .eq('id', editingKey.id);
    if (error) {
      showToast(error.message || m.stk_update_failed(), 'error');
    } else {
      showToast(m.stk_updated(), 'success');
      setEditingKey(null);
      await loadSqemesApiKeys();
    }
    setIsSavingScope(false);
  };



  // Buffered workspace name (only saved on button click)
  const [wsName, setWsName] = useState(workspace.name);
  const [wsNameDirty, setWsNameDirty] = useState(false);

  // SQEM-106 — buffered brand-profile form (saved on button click)
  const [brandForm, setBrandForm] = useState<BrandFormValue>(brandFormFromProfile(workspace.brandProfile));
  const [bpDirty, setBpDirty] = useState(false);

  const handleSaveBrand = () => {
    updateWorkspace({
      brandProfile: {
        brandName: brandForm.brandName.trim(),
        whatItDoes: brandForm.whatItDoes.trim(),
        audience: brandForm.audience.trim(),
        website: brandForm.website.trim(),
        updatedAt: new Date().toISOString(),
      },
    });
    setBpDirty(false);
    // SQEM-310 — the four other save buttons on this page confirm; this one did not. It matters more
    // here than elsewhere: the Template Wizard button reads "Set up brand" until the required fields
    // are filled, so somebody who saves and sees nothing cannot tell whether it was enough.
    showToast(m.st_brand_saved(), 'success');
  };

  // Buffered profile fields (only saved on button click)
  const [profileName, setProfileName] = useState(currentUser.name);
  const [profileEmail, setProfileEmail] = useState(currentUser.email);
  const [profileAvatar, setProfileAvatar] = useState(currentUser.avatar);
  const [, setProfileDirty] = useState(false);

  const [blacklistedTerm, setBlacklistedTerm] = useState('');
  const [newTag, setNewTag] = useState('');

  // Invite State
  const [isInviteModalOpen, setIsInviteModalOpen] = useState(false);
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteRole, setInviteRole] = useState<UserRole>('member');
  const [isInviteSending, setIsInviteSending] = useState(false);
  const [resendingIds, setResendingIds] = useState<Set<string>>(new Set());

  // Confirm dialog state
  const [confirmDialog, setConfirmDialog] = useState<{
    title: string;
    message: string;
    onConfirm: () => void;
    /** SQEM-539 — typed confirmation, for deleting the whole workspace only. */
    confirmText?: string;
    confirmLabel?: string;
  } | null>(null);

  // SQEM-539 — settings save on a click, never as a side effect of choosing.
  // Each card that edits a value keeps a draft here; `null`/empty = untouched. Settings knows all of
  // them so that a tab change can ask before throwing one away.
  const [accessDraft, setAccessDraft] = useState<TemplateAccessValue | null>(null);
  const [editDraft, setEditDraft] = useState<boolean | null>(null);
  const [governanceDraft, setGovernanceDraft] = useState<Partial<Record<GovernanceKey, boolean>>>({});
  const [authoringDirty, setAuthoringDirty] = useState(false);
  const [authoringResetKey, setAuthoringResetKey] = useState(0);
  const [savingCard, setSavingCard] = useState<'access' | 'edit' | 'governance' | null>(null);
  const [pendingTab, setPendingTab] = useState<TabId | null>(null);
  const hasUnsaved = accessDraft !== null || editDraft !== null || Object.keys(governanceDraft).length > 0 || authoringDirty;
  const discardDrafts = () => {
    setAccessDraft(null);
    setEditDraft(null);
    setGovernanceDraft({});
    setAuthoringDirty(false);
    setAuthoringResetKey(k => k + 1); // remounts AuthoringModelCard, which drops its own draft
  };
  /** A tab change the person asked for. Deep-link effects call `setActiveTab` directly. */
  const requestTab = (id: TabId) => {
    if (id === activeTab) return;
    if (hasUnsaved) setPendingTab(id);
    else setActiveTab(id);
  };
  const saveCard = async (card: 'access' | 'edit' | 'governance', updates: Partial<Workspace>, clear: () => void) => {
    setSavingCard(card);
    try { await updateWorkspace(updates); clear(); } finally { setSavingCard(null); }
  };
  // Leaving the page (reload, close) with a draft gets the browser's own question. Leaving through
  // the sidebar does not: HashRouter has no navigation blocker, and the drafts are small enough that
  // a tab-change guard plus the visible "Unsaved changes" line carry it.
  useEffect(() => {
    if (!hasUnsaved) return;
    const onBeforeUnload = (e: BeforeUnloadEvent) => { e.preventDefault(); };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, [hasUnsaved]);

  // Profile State
  const [passwords, setPasswords] = useState({ new: '', confirm: '' });

  // Plan Limits
  const currentPlan = PLANS[workspace.plan];
  const hasActiveSub = hasActiveSubscription(workspace);
  const memberLimit = currentPlan.users;
  /**
   * SQEM-343 — a demotion to `member` is not a one-click change any more.
   *
   * ⛔ Since SQEM-341 the write policies require visibility, and two individually sensible rules then
   * combine into a dead object: the demoted creator still SEES their restricted template (the creator
   * branch) but may no longer write; editors and admins may write but do not see it (SQEM-292). Nobody
   * can edit it.
   *
   * So the admin is asked, with the number in front of them, and picks one of three named ways. ⚠️
   * "Leave as is" is a legitimate outcome — the person is still here and can ask — but it must be
   * chosen, not defaulted into. On DEPARTURE the same situation fires a trigger with no question,
   * because there is nobody left to ask.
   */
  type DemoteChoice = 'handover' | 'release' | 'leave';
  const [demoteTarget, setDemoteTarget] = useState<
    { id: string; name: string; templates: number; personas: number } | null
  >(null);
  const [demoteChoice, setDemoteChoice] = useState<DemoteChoice | null>(null);
  const [isDemoting, setIsDemoting] = useState(false);

  const handleRoleChange = async (member: { id: string; name: string; role: UserRole }, next: UserRole) => {
    // Only a step DOWN to member can strand anything. admin → editor changes nothing: both still write.
    if (next !== 'member' || member.role === 'member') {
      updateMemberRole(member.id, next);
      return;
    }
    try {
      const counts = await countRestrictedContentForMember(workspace.id, member.id);
      if (counts.templates === 0 && counts.personas === 0) {
        updateMemberRole(member.id, next);
        return;
      }
      setDemoteChoice(null);
      setDemoteTarget({ id: member.id, name: member.name, ...counts });
    } catch (err: any) {
      // ⚠️ Demote anyway rather than blocking on a failed count: a role change the admin asked for is
      // not something to refuse because a follow-up question could not be prepared. Say so, though.
      showToast(err?.message || m.st_demote_check_failed(), 'error');
      updateMemberRole(member.id, next);
    }
  };

  const confirmDemotion = async () => {
    if (!demoteTarget || !demoteChoice) return;
    setIsDemoting(true);
    try {
      // ⛔ The custody move runs FIRST, while the person is still an editor. Reversed, there is a
      // window in which they are a member and the objects are already unreachable for everyone.
      if (demoteChoice === 'handover') await handoverContentFromMember(workspace.id, demoteTarget.id);
      if (demoteChoice === 'release')  await releaseRestrictedContent(workspace.id, demoteTarget.id);
      updateMemberRole(demoteTarget.id, 'member');
      setDemoteTarget(null);
    } catch (err: any) {
      showToast(err?.message || m.st_demote_failed(), 'error');
    } finally {
      setIsDemoting(false);
    }
  };

  /**
   * SQEM-348 — how close a connection is to the 90-day idle cut-off (SQEM-346).
   *
   * ⛔ The rule already ships and refuses silently: `mcp-server` stops answering and the refresh
   * grant stops renewing. Nothing tells the owner beforehand, so a connection someone still needs
   * dies on a Tuesday for no visible reason. This is the warning that makes the rule fair.
   *
   * ⚠️ Counts from `last_used_at`, falling back to `created_at` — exactly what the server does. A
   * different clock here would be worse than no badge: it would say "fine" about a key already
   * being refused.
   */
  const IDLE_LIMIT_DAYS = 90;
  // SQEM-609 — the stored scope values stay English (the server checks them); only the badge is translated.
  const SCOPE_LABEL: Record<string, () => string> = { create: m.ks_scope_create, update: m.ks_scope_update, delete: m.ks_scope_delete };
  const idleDays = (k: SqemesApiKey): number => {
    const since = k.last_used_at ?? k.created_at;
    if (!since) return 0;
    return Math.floor((Date.now() - new Date(since).getTime()) / 86_400_000);
  };

  const memberCount = workspace.members.length;

  // SQEM-515 — storage used / allowed (Cloud; the server reads it, admins see it on the Team tab).
  const [storageUsage, setStorageUsage] = useState<{ used: number; limit: number | null } | null>(null);
  useEffect(() => {
    if (IS_SELF_HOSTED || activeTab !== 'team' || !can(currentUser, workspace, 'settings:general')) return;
    let cancelled = false;
    getWorkspaceStorageUsage(workspace.id).then(u => { if (!cancelled) setStorageUsage(u); }).catch(() => {});
    return () => { cancelled = true; };
  }, [activeTab, workspace.id, currentUser, workspace]);
  const fmtBytes = (n: number) => n >= 1073741824 ? `${(n / 1073741824).toLocaleString(getLocale(), { maximumFractionDigits: n % 1073741824 ? 1 : 0, minimumFractionDigits: n % 1073741824 ? 1 : 0 })} GB` : `${Math.round(n / 1048576)} MB`; // SQEM-608 — decimal separator in the app language
  // SQEM-119 — self-host has no subscription model: unlimited seats + all features (like managed).
  const isLimitReached = !workspace.isManaged && !IS_SELF_HOSTED && memberCount >= memberLimit;
  const hasMcpAccess = workspace.isManaged || IS_SELF_HOSTED || currentPlan.mcpAccess;

  const tabs: { id: TabId; label: string; icon: any }[] = [
    // SQEM-608 — the id is the deep-link key (`initialTab`) and stays; only the label is translated.
    { id: 'general', label: m.st_tab_general(), icon: Building },
    { id: 'brand', label: m.st_tab_brand(), icon: Sparkles },
    { id: 'team', label: m.st_tab_team(), icon: Users },
    { id: 'security', label: m.st_tab_security(), icon: Shield },
    { id: 'plans', label: m.st_tab_plans(), icon: CreditCard },
    { id: 'api', label: m.st_tab_api(), icon: Key },
    { id: 'connectors', label: m.st_tab_connectors(), icon: Plug },
    { id: 'profile', label: m.st_tab_profile(), icon: User },
  ];

  // SQEM-480 — the Security tab holds only cards with their own conditions; it is shown when one of
  // them would be. Cloud: Content Governance is for admins and editors (as it was in General), the
  // access cards for admins. Self-host: only the admins' access card exists there.
  const securityTabVisible = IS_SELF_HOSTED
    ? can(currentUser, workspace, 'team:manage')
    : can(currentUser, workspace, 'settings:general');

  const visibleTabs = tabs.filter(tab => {
    if (IS_SELF_HOSTED && tab.id === 'plans') return false; // SQEM-119 — no billing on self-host
    // SQEM-170 made Brand Cloud-only (the brand profile feeds the Cloud wizard). SQEM-597 — the Document
    // style card lives here too and works on self-host, so the tab stays; only the profile card is Cloud.
    if (tab.id === 'security' && !securityTabVisible) return false;
    // Members (no settings:general) still get their Profile + Connectors (they may add personal ones)
    // and, since SQEM-328, **API & MCP** — the only place to obtain the key their own MCP client
    // needs. ⚠️ The tab is not the permission: the provider-keys card inside it stays behind
    // `api-keys:manage`, so what a member reaches is their own connection and nothing else.
    if (!can(currentUser, workspace, 'settings:general')) {
      return tab.id === 'profile' || tab.id === 'connectors' || tab.id === 'api';
    }
    if (!can(currentUser, workspace, 'plans:manage')) return tab.id !== 'plans';
    return true;
  });

  // Reset buffered state when workspace changes
  useEffect(() => {
    setWsName(workspace.name);
    setWsNameDirty(false);
    setBrandForm(brandFormFromProfile(workspace.brandProfile));
    setBpDirty(false);
    setApiKeys({});
    setBlacklistedTerm('');
    setNewTag('');
    setIsInviteModalOpen(false);
    setInviteEmail('');
    fetchInvitations();
  }, [workspace.id]);

  // Reset profile fields when user changes
  useEffect(() => {
    setProfileName(currentUser.name);
    setProfileEmail(currentUser.email);
    setProfileAvatar(currentUser.avatar);
    setProfileDirty(false);
  }, [currentUser.id]);

  useEffect(() => {
    if (!can(currentUser, workspace, 'settings:general')) {
      if (activeTab !== 'profile' && activeTab !== 'connectors') setActiveTab('profile');
      return;
    }

    // Redirect non-admins away from plans if they somehow land on it
    if (!can(currentUser, workspace, 'plans:manage') && activeTab === 'plans') {
      setActiveTab('general');
      return;
    }

    if (location.state && (location.state as any).initialTab) {
      const requestedTab = (location.state as any).initialTab;
      // SQEM-480 — a link into Security for someone who would find it empty lands on General.
      if (requestedTab === 'security' && !securityTabVisible) {
        if (activeTab !== 'general') setActiveTab('general');
      } else if (!can(currentUser, workspace, 'plans:manage') && requestedTab === 'plans') {
        if (activeTab !== 'general') setActiveTab('general');
      } else {
        if (activeTab !== requestedTab) setActiveTab(requestedTab);
      }
      return;
    }

    // Deep-link via URL query (e.g. opened in a new tab): ?tab=plans
    const urlTab = new URLSearchParams(location.search).get('tab');
    if (urlTab && ['general', 'brand', 'team', 'security', 'plans', 'api', 'connectors', 'profile'].includes(urlTab) && !(IS_SELF_HOSTED && urlTab === 'brand')) {
      if ((!can(currentUser, workspace, 'plans:manage') && urlTab === 'plans') || (urlTab === 'security' && !securityTabVisible)) {
        if (activeTab !== 'general') setActiveTab('general');
      } else if (activeTab !== urlTab) {
        setActiveTab(urlTab as TabId);
      }
    }
  }, [location, currentUser.role]); // Removed activeTab to fix navigation loop

  // SQEM-123 — deep-link from the sidebar footer version indicator: once the General tab is
  // active, scroll to the About card. No-op on Cloud (AboutSection renders nothing → no #about).
  useEffect(() => {
    if ((location.state as any)?.scrollTo === 'about' && activeTab === 'general') {
      const t = setTimeout(() => {
        document.getElementById('about')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }, 100);
      return () => clearTimeout(t);
    }
  }, [location, activeTab]);

  // Load public API keys when api tab is first opened
  useEffect(() => {
    if (activeTab === 'api' && !sqemesApiKeysLoaded) {
      loadSqemesApiKeys();
    }
  }, [activeTab]);

  // Handlers
  // SQEM-090 — remove a saved provider key, then refresh key + funded status.
  const handleRemoveKey = async (providerId: string) => {
    try {
      await deleteApiKey(workspace.id, providerId);
      const { keys: status, fundedAvailable, webSearchHosted } = await getApiKeyStatus(workspace.id);
      const updatedKeys: Record<string, string> = {};
      for (const [provider, configured] of Object.entries(status)) {
        if (configured) updatedKeys[provider] = '••••••••';
      }
      updateWorkspace({ apiKeys: updatedKeys, fundedAvailable, webSearchHosted });
      setApiKeys(prev => { const next = { ...prev }; delete next[providerId]; return next; });
      showToast(m.stk_removed(), 'success');
    } catch (err: any) {
      showToast(err.message || m.stk_remove_failed(), 'error');
    }
  };

  const handleSaveKeys = async () => {
    try {
      const entries = Object.entries(apiKeys)
        .map(([provider, value]) => [provider, value.trim()] as const)
        .filter(([_, value]) => value.length > 0);

      if (entries.length === 0) {
        showToast(m.stk_enter_new(), 'info');
        return;
      }

      for (const [provider, key] of entries) {
        if (isPlaceholderKey(key)) {
          throw new Error(m.stk_invalid({ provider }));
        }
        await saveApiKey(workspace.id, provider, key);
      }

      // Refresh API key status so the model selector updates
      const { keys: status, fundedAvailable, webSearchHosted } = await getApiKeyStatus(workspace.id);
      const updatedKeys: Record<string, string> = {};
      for (const [provider, configured] of Object.entries(status)) {
        if (configured) updatedKeys[provider] = '••••••••';
      }
      updateWorkspace({ apiKeys: updatedKeys, fundedAvailable, webSearchHosted });

      showToast(m.stk_saved(), 'success');
      // Clear the local key inputs after saving (keys are now server-side)
      setApiKeys({});
    } catch (err: any) {
      showToast(err.message || m.stk_save_failed(), 'error');
    }
  };

  // SQEM-594 — save the search key. The server removes the other provider's key, so the
  // workspace never has two.
  const handleSaveSearchKey = async () => {
    const key = searchKey.trim();
    if (!key) { showToast(m.stk_search_paste(), 'info'); return; }
    if (isPlaceholderKey(key)) { showToast(m.stk_search_original(), 'error'); return; }
    try {
      await saveApiKey(workspace.id, `search_${searchProvider}`, key);
      const { keys: status, fundedAvailable, webSearchHosted } = await getApiKeyStatus(workspace.id);
      const updatedKeys: Record<string, string> = {};
      for (const [provider, configured] of Object.entries(status)) {
        if (configured) updatedKeys[provider] = '••••••••';
      }
      updateWorkspace({ apiKeys: updatedKeys, fundedAvailable, webSearchHosted });
      setSearchKey('');
      showToast(m.stk_search_saved(), 'success');
    } catch (err: any) {
      showToast(err.message || m.stk_search_failed(), 'error');
    }
  };

  const handleUpgrade = async (tier: string) => {
    setCheckoutLoadingTier(tier);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) throw new Error(m.ov_not_authenticated());
      const res = await fetch(functionCallUrl('create-checkout-session'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${session.access_token}` },
        body: JSON.stringify({ workspaceId: workspace.id, plan: tier, billingCycle }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || m.stl_checkout_failed());
      window.location.href = data.url;
    } catch (err: any) {
      showToast(err.message || m.stl_start_failed(), 'error');
      setCheckoutLoadingTier(null);
    }
  };

  const handleManageSubscription = async () => {
    setIsPortalLoading(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) throw new Error(m.ov_not_authenticated());
      const res = await fetch(functionCallUrl('create-portal-session'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${session.access_token}` },
        body: JSON.stringify({ workspaceId: workspace.id }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || m.ov_portal_failed());
      window.location.href = data.url;
    } catch (err: any) {
      showToast(err.message || m.ov_portal_failed(), 'error');
      setIsPortalLoading(false);
    }
  };

  const addTerm = () => {
    if(blacklistedTerm && !workspace.blacklistedTerms.includes(blacklistedTerm)) {
      updateWorkspace({ blacklistedTerms: [...workspace.blacklistedTerms, blacklistedTerm] });
      setBlacklistedTerm('');
    }
  };

  const removeTerm = (term: string) => {
    updateWorkspace({ blacklistedTerms: workspace.blacklistedTerms.filter(t => t !== term) });
  };

  const handleAddTag = () => {
    if (newTag && !workspace.tags.includes(newTag)) {
      updateWorkspace({ tags: [...workspace.tags, newTag] });
      setNewTag('');
    }
  };

  const removeTag = (tag: string) => {
    updateWorkspace({ tags: workspace.tags.filter(t => t !== tag) });
  };

  // OpenRouter custom model ids (BYOK) — SQEM-031
  const addOrModel = () => {
    const id = newOrModelId.trim();
    if (!id) return;
    if (!id.includes('/')) { showToast(m.stk_or_format(), 'error'); return; }
    if (!workspace.openrouterModels.includes(id)) {
      updateWorkspace({ openrouterModels: [...workspace.openrouterModels, id] });
    }
    setNewOrModelId('');
  };

  const handleInvite = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!inviteEmail) {
      showToast(m.stp_email_required(), "error");
      return;
    }
    setIsInviteSending(true);
    try {
      await addMember(inviteEmail, inviteRole);
      setInviteEmail('');
      setIsInviteModalOpen(false);
    } finally {
      setIsInviteSending(false);
    }
  };

  const handleUpdateProfile = async () => {
    if (passwords.new && passwords.new !== passwords.confirm) {
      showToast(m.stp_passwords_mismatch(), "error");
      return;
    }

    // Save buffered profile changes
    const updates: Partial<{ name: string; avatar: string }> = {};
    if (profileName !== currentUser.name) updates.name = profileName;
    if (profileAvatar !== currentUser.avatar) updates.avatar = profileAvatar;

    if (Object.keys(updates).length > 0) {
      await updateUser(updates);
    }

    // SQEM-491 — an email change is a change of the LOGIN address, confirmed by GoTrue with both
    // the old and the new address (secure email change is on). Until then nothing changes: the
    // profile email mirrors auth.users via a trigger, so the field goes back to the current address.
    // It used to write `profiles.email` directly — unconfirmed, and without touching the login.
    const newEmail = profileEmail.trim();
    const emailChangeRequested = !!newEmail && newEmail.toLowerCase() !== currentUser.email.toLowerCase();
    if (emailChangeRequested) {
      const { error } = await supabase.auth.updateUser(
        { email: newEmail },
        { emailRedirectTo: window.location.origin },
      );
      setProfileEmail(currentUser.email);
      if (error) {
        showToast(authErrorText(error) || m.stp_email_change_failed(), 'error');
      } else {
        showToast(m.stp_email_change_sent({ old: currentUser.email, new: newEmail }), 'info');
      }
    }

    if (passwords.new) {
      // SQEM-608 — the result used to be ignored: a password GoTrue refused (too weak, same as before)
      // was reported as "Profile updated". Now the refusal is shown, in the user's language, and the
      // fields keep their values so the person can correct them.
      const { error } = await supabase.auth.updateUser({ password: passwords.new });
      if (error) {
        showToast(authErrorText(error), 'error');
        return;
      }
      setPasswords({ new: '', confirm: '' });
    }

    setProfileDirty(false);
    // The email toast above says more than "updated" — and "updated" would be untrue for the email.
    if (!emailChangeRequested) showToast(m.stp_saved(), "success");
  };

  const handleLogout = () => {
    setConfirmDialog({
      title: m.stp_signout_title(),
      message: m.stp_signout_body(),
      onConfirm: async () => {
        await supabase.auth.signOut();
        showToast(m.stp_signed_out(), 'info');
      },
    });
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onloadend = () => {
        setProfileAvatar(reader.result as string);
        setProfileDirty(true);
      };
      reader.readAsDataURL(file);
    }
  };

  // SQEM-205 — account-level data export, next to (and above) account deletion.
  const [exporting, setExporting] = useState(false);
  const [exportStep, setExportStep] = useState('');
  const handleExportAccount = async () => {
    setExporting(true);
    setExportStep('');
    try {
      const blob = await buildAccountExport(workspace, currentUser, p => setExportStep(p.step));
      downloadBlob(blob, accountExportFilename(workspace.name));
      showToast(m.stp_export_done(), 'success');
    } catch (err: any) {
      showToast(err.message || m.stp_export_failed(), 'error');
    } finally {
      setExporting(false);
      setExportStep('');
    }
  };

  // SQEM-205 — drawn locally as a data: URI. This used to mint an api.dicebear.com URL, creating a
  // fresh external dependency on every click: broken behind a corporate proxy or ad blocker, and
  // never loading at all on a self-hosted instance without internet access.
  const handleRandomizeAvatar = () => {
    setProfileAvatar(randomAvatarDataUri());
    setProfileDirty(true);
  };

  const PROVIDERS = [
    { id: 'gemini', name: 'Google Gemini', placeholder: 'AIza...', link: 'https://aistudio.google.com/app/apikey' },
    { id: 'openai', name: 'OpenAI', placeholder: 'sk-...', link: 'https://platform.openai.com/settings/organization/api-keys' },
    { id: 'claude', name: 'Anthropic Claude', placeholder: 'sk-ant-...', link: 'https://console.anthropic.com/settings/keys' },
    { id: 'grok', name: 'xAI Grok', placeholder: 'xai-...', link: 'https://console.x.ai/' },
    { id: 'deepseek', name: 'DeepSeek', placeholder: 'sk-...', link: 'https://platform.deepseek.com/api_keys' },
    { id: 'mistral', name: 'Mistral AI', placeholder: 'os-...', link: 'https://console.mistral.ai/api-keys/' },
    { id: 'openrouter', name: 'OpenRouter', placeholder: 'sk-or-v1-...', link: 'https://openrouter.ai/keys' },
    { id: 'ollama', name: 'Ollama', placeholder: 'http://localhost:11434', label: 'Base URL / Key' },
  ];

  return (
    <div className="p-4 md:p-8 max-w-6xl mx-auto min-h-screen">
      {/* SQEM-554 (d1) — the page head every other page has (display face). */}
      <PageHeader title={m.st_title()} subtitle={m.st_subtitle()} />

      <div className="flex flex-col lg:flex-row gap-8">
        {/* Sidebar Navigation — sticky on md+ (SQEM-147). Sticky must live on this wrapper flex-item,
            which stretches with the content column, not on the Card (whose parent is Card-height). */}
        <div className="lg:w-64 shrink-0 md:sticky md:top-4 lg:self-start z-10">
          {/* SQEM-568 — below lg: one horizontally scrollable row in the look of the Files page's tabs
              ⚠️ This reverses SQEM-540, which had made the row WRAP because the
              scrolling row cut "Team Members" in half and hid Security and everything after it with nothing
              to say there was more. Two things answer that now: the active tab is always scrolled into
              view, and the row ends in a half-visible tab, which says there is more. */}
          <div ref={mobileTabsRef} className="lg:hidden overflow-x-auto -mx-1 px-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
            <div role="group" aria-label={m.st_sections()} className="flex gap-1 w-max bg-surface-sunken rounded-xl p-1">
              {visibleTabs.map(tab => (
                <button
                  key={tab.id}
                  type="button"
                  aria-pressed={activeTab === tab.id}
                  onClick={() => requestTab(tab.id)}
                  className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg whitespace-nowrap transition-all ${
                    activeTab === tab.id
                      ? 'bg-surface-raised text-ink-strong shadow-soft'
                      : 'text-ink-muted hover:text-ink-strong'
                  }`}
                >
                  <tab.icon className="w-3.5 h-3.5" />
                  {tab.label}
                </button>
              ))}
            </div>
          </div>
          <Card overflow className="hidden lg:block p-2">
            {visibleTabs.map(tab => (
              <button
                key={tab.id}
                onClick={() => requestTab(tab.id)}
                className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl text-sm font-medium transition-all duration-200 whitespace-nowrap ${
                  activeTab === tab.id
                    ? 'bg-accent-soft text-accent shadow-sm'
                    : 'text-ink-muted hover:bg-surface-sunken hover:text-ink-strong'
                }`}
              >
                <tab.icon className={`w-5 h-5 ${activeTab === tab.id ? 'text-accent' : 'text-ink-subtle'}`} />
                {tab.label}
              </button>
            ))}
          </Card>
        </div>

        {/* Content Area */}
        <div className="flex-1 min-w-0">
          
          {/* --- General Tab --- */}
          {activeTab === 'general' && can(currentUser, workspace, 'settings:general') && (
            <div className="space-y-6 animate-fade-in">
              <Card className="p-6 md:p-8">
                <SettingsCardHeader title={m.stg_details()} />
                <div className="space-y-6">
                  {can(currentUser, workspace, 'team:manage') && (
                    <div>
                      <label htmlFor="settings-workspace-name" className={SETTINGS_FIELD_LABEL}>{m.stg_name()}</label>
                      <div className="flex gap-2">
                        <Input id="settings-workspace-name"
                          className="flex-1 !w-auto min-w-0"
                          value={wsName}
                          onChange={e => { setWsName(e.target.value); setWsNameDirty(true); }}
                        />
                        <Button
                          onClick={() => { updateWorkspace({ name: wsName }); setWsNameDirty(false); }}
                          disabled={!wsNameDirty || !wsName.trim()}
                          className="px-5"
                        >
                          <Save className="w-4 h-4" /> {m.st_save()}
                        </Button>
                      </div>
                    </div>
                  )}
                  {isSqemesAdmin && (
                    <div className="flex items-center justify-between gap-4 p-4 bg-accent-soft border border-accent/20 rounded-control">
                      <div className="flex items-center gap-3">
                        <Shield className="w-5 h-5 text-accent" />
                        <div>
                          <p id="settings-managed-label" className="text-sm font-bold text-ink-strong">{m.stg_managed()}</p>
                          <p id="settings-managed-hint" className="text-xs text-accent mt-0.5">{m.stg_managed_hint()}</p>
                        </div>
                      </div>
                      {/* SQEM-554 (d1) — the shared Switch (SQEM-545) instead of a hand-built one: same
                          on/off, and now a real `role="switch"` named by the label beside it. */}
                      <Switch
                        checked={!!workspace.isManaged}
                        onChange={() => setWorkspaceManaged(workspace.id, !workspace.isManaged)}
                        labelledBy="settings-managed-label"
                        describedBy="settings-managed-hint"
                      />
                    </div>
                  )}

                  <div>
                    <label htmlFor="settings-workspace-tags" className={SETTINGS_FIELD_LABEL}>{m.stg_tags()}</label>
                    <div className="flex gap-2 mb-3">
                      <Input id="settings-workspace-tags"
                        className="flex-1 !w-auto min-w-0"
                        placeholder={m.stg_add_tag_placeholder()}
                        value={newTag}
                        onChange={e => setNewTag(e.target.value)}
                        onKeyDown={e => e.key === 'Enter' && handleAddTag()}
                      />
                      <Button variant="secondary" onClick={handleAddTag} aria-label={m.tag_add()} className="px-4">
                        <Plus className="w-5 h-5" />
                      </Button>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      {workspace.tags.map(tag => (
                        <span key={tag} className="inline-flex items-center gap-1 px-3 py-1 bg-surface-sunken text-ink rounded-lg text-sm font-medium">
                          {tag}
                          <button onClick={() => removeTag(tag)} aria-label={m.stg_remove_tag({ tag })} className="p-0.5 hover:text-danger rounded-full transition-colors"><X className="w-3 h-3" /></button>
                        </span>
                      ))}
                    </div>
                  </div>
                </div>
              </Card>

              {/* SQEM-600 — the workspace's default language. Admins only, enforced twice: hidden here for
                  everyone else, and guard_workspace_language keeps the old value for any other writer.
                  Until German shipped (GERMAN_RELEASED, SQEM-613), only sqemes admins saw it at all. */}
              {canChooseLanguage(isSqemesAdmin) && can(currentUser, workspace, 'team:manage') && (
                <LanguageCard
                  title={m.settings_language_workspace_title()}
                  description={m.settings_language_workspace_description()}
                  value={workspace.language ?? 'en'}
                  options={WORKSPACE_LANGUAGE_OPTIONS}
                  onSave={async language => { await updateWorkspace({ language }); }}
                />
              )}

              {/* SQEM-311 — which model does the writing. Deliberately NOT gated on Cloud: self-host is
                  BYOK-only, so there is no funded fallback there and the choice matters more, not less. */}
              {can(currentUser, workspace, 'api-keys:manage') && (
                <AuthoringModelCard
                  key={authoringResetKey}
                  workspace={workspace}
                  onSave={modelId => updateWorkspace({ authoringModelId: modelId })}
                  onDirtyChange={setAuthoringDirty}
                  onOpenApiKeys={() => requestTab('api')}
                />
              )}

              {/* SQEM-183 — self-host marketplace publisher token (Cloud publishes directly; self-host only) */}
              {IS_SELF_HOSTED && can(currentUser, workspace, 'team:manage') && (
                <Card className="p-6 md:p-8">
                  <SettingsCardHeader
                    className="mb-4"
                    title={m.stg_pub_title()}
                    description={<>
                      {m.stg_pub_desc_1()} <span className="font-semibold">{m.stg_pub_desc_submit()}</span> {m.stg_pub_desc_2()}{' '}
                      <a href="https://sqemes.com/publisher" target="_blank" rel="noopener noreferrer" className="text-accent font-semibold hover:underline">{m.stg_pub_apply()}</a>
                    </>}
                  />
                  <div className="mb-2">
                    <span className={`text-xs font-bold px-2 py-1 rounded-lg ${pubConfigured ? 'bg-success-soft text-success' : 'bg-surface-sunken text-ink-muted'}`}>
                      {pubConfigured ? m.stg_pub_configured() : m.stg_pub_not_configured()}
                    </span>
                  </div>
                  <div className="flex gap-2">
                    <Input
                      type="password"
                      aria-label={m.stg_pub_token()}
                      value={pubToken}
                      onChange={e => setPubToken(e.target.value)}
                      placeholder={pubConfigured ? m.stg_pub_replace() : 'smp_…'}
                      autoComplete="off"
                      className="flex-1 !w-auto min-w-0 font-mono"
                    />
                    <Button
                      onClick={() => savePublisherToken()}
                      disabled={pubSaving || !pubToken.trim()}
                      className="px-5"
                    >
                      {pubSaving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />} {m.st_save()}
                    </Button>
                  </div>
                  {pubConfigured && (
                    <button onClick={() => savePublisherToken('')} disabled={pubSaving} className="mt-3 text-xs font-semibold text-danger hover:underline disabled:opacity-50">
                      {m.stg_pub_clear()}
                    </button>
                  )}
                </Card>
              )}

              {/* Self-host only — version + update notice (SQEM-118); renders nothing on Cloud */}
              <AboutSection />

              {/* SQEM-554 — no link to /design from the app. The page stays, reached by
                  its URL only, under the same access rule (lib/designAccess.ts). */}

              {/* SQEM-121 — self-host is a single-instance deployment: no deleting the workspace */}
              {!IS_SELF_HOSTED && can(currentUser, workspace, 'team:manage') && (
                <div className="bg-danger-soft rounded-card border border-danger/30 p-6 md:p-8">
                  <SettingsCardHeader tone="danger" title={m.stg_danger()} description={m.stg_danger_desc()} />
                  <button
                    onClick={() => setConfirmDialog({
                      title: m.stg_delete_title({ name: workspace.name }),
                      // SQEM-213 — the subscription part belongs in the dialog, not in the small
                      // print afterwards: this is the moment the money decision is actually made.
                      // Keyed on the subscription id, not `hasActiveSubscription` — that is also
                      // true for managed workspaces, which have no Stripe subscription to cancel.
                      message: workspace.stripeSubscriptionId
                        ? m.stg_delete_body_sub()
                        : m.stg_delete_body(),
                      // SQEM-539 — typed, because this one cannot be undone at any scale; a playbook is not.
                      confirmText: workspace.name,
                      confirmLabel: m.stg_delete_confirm(),
                      onConfirm: async () => { await deleteWorkspace(workspace.id); navigate('/'); },
                    })}
                    className="px-4 py-2 bg-surface-raised border border-danger/40 text-danger font-bold text-sm rounded-control hover:bg-danger hover:text-surface-raised hover:border-danger transition-all shadow-sm"
                  >
                    {m.stg_delete_button()}
                  </button>
                </div>
              )}
            </div>
          )}

          {/* --- Security Tab --- */}
          {/* SQEM-480 — who may see what, and what is blocked: moved here from General, where they sat
              beside the workspace's name and the danger zone. Every card keeps the condition it had there;
              the tab itself is shown only when at least one of them is (`securityTabVisible`). */}
          {activeTab === 'security' && securityTabVisible && (
            <div className="space-y-6 animate-fade-in">
              {/* SQEM-170 — Template Access (default) is a Cloud-only feature.
                  SQEM-314 — and a Solo-plan one is a setting with nothing to set: it decides whether
                  *new* templates start restricted, and with one seat there is nobody to restrict them
                  from. ⚠️ Unlike the per-template control there is no "unless rules exist" escape
                  here, and none is needed — this default is not a rule on anything, so hiding it
                  hides no state. The templates it created keep their own control. */}
              {!IS_SELF_HOSTED && isMultiSeat(workspace) && can(currentUser, workspace, 'team:manage') && (
                <Card className="p-6 md:p-8">
                  {/* SQEM-211 — this setting decides *whether* new templates start restricted, not
                      who may use them. Who may use a template is chosen in the template itself, by
                      name; a workspace-wide list of people would be a second place to maintain the
                      same thing and would drift from the first. */}
                  <SettingsCardHeader title={m.sts_access_title()} description={m.sts_access_desc()} />
                  <TemplateAccessControl
                    label={m.sts_access_label()}
                    hint={m.sts_access_hint()}
                    value={accessDraft ?? workspaceDefaultToValue(workspace.defaultTemplateAccess ?? [])}
                    onChange={v => {
                      const same = sameRoles(valueToWorkspaceDefault(v), workspace.defaultTemplateAccess ?? []);
                      setAccessDraft(same ? null : v);
                    }}
                  />
                  <CardSaveBar
                    dirty={accessDraft !== null}
                    saving={savingCard === 'access'}
                    onCancel={() => setAccessDraft(null)}
                    onSave={() => accessDraft && saveCard('access', { defaultTemplateAccess: valueToWorkspaceDefault(accessDraft) }, () => setAccessDraft(null))}
                  />
                </Card>
              )}

              {/* SQEM-534 — the same question for CHANGING: do new playbooks and personas start open to
                  every editor who can see them, or with "Who can edit" restricted to their creator? Same
                  conditions as the card above, and as "Who can edit" in the editors (Cloud, several
                  seats). The database applies it on every insert, MCP included, and lets only an admin
                  change it — this card is the one place it is chosen, not the place it is enforced. */}
              {!IS_SELF_HOSTED && isMultiSeat(workspace) && can(currentUser, workspace, 'team:manage') && (
                <Card className="p-6 md:p-8">
                  <SettingsCardHeader title={m.sts_edit_title()} description={m.sts_edit_desc()} />
                  <div role="radiogroup" aria-label={m.sts_edit_title()} className="space-y-3">
                    {([
                      [false, m.sts_edit_anyone(), m.sts_edit_anyone_desc()],
                      [true, m.sts_edit_creator(), m.sts_edit_creator_desc()],
                    ] as const).map(([value, label, description]) => {
                      const saved = workspace.defaultEditRestricted ?? false;
                      const selected = (editDraft ?? saved) === value;
                      return (
                        <button
                          key={String(value)}
                          type="button"
                          role="radio"
                          aria-checked={selected}
                          onClick={() => setEditDraft(value === saved ? null : value)}
                          className={`w-full text-left p-4 rounded-xl border transition-colors ${selected ? 'border-accent bg-accent-soft' : 'border-line-strong hover:border-ink-subtle'}`}
                        >
                          <p className="text-sm font-semibold text-ink-strong">{label}</p>
                          <p className="text-xs text-ink-muted mt-0.5">{description}</p>
                        </button>
                      );
                    })}
                  </div>
                  <CardSaveBar
                    dirty={editDraft !== null}
                    saving={savingCard === 'edit'}
                    onCancel={() => setEditDraft(null)}
                    onSave={() => editDraft !== null && saveCard('edit', { defaultEditRestricted: editDraft }, () => setEditDraft(null))}
                  />
                </Card>
              )}

              {/* SQEM-292/304 — Access groups. Admins only, enforced twice: the card is hidden here,
                  and the RLS policies reject writes from anyone else. Hiding alone would be a
                  suggestion; the policy is the rule.

                  SQEM-304 — moved here from the Team tab. It sat there because *a group is a set of
                  people*, which describes what one is made of, not what it is for: a group exists to
                  grant template access and appears nowhere else in the product. Whoever creates one
                  is thinking about a template, so it belongs beside the setting that makes it useful.

                  ⛔ **Cloud-only since SQEM-323, and the comment that stood here argued the exact
                  opposite.** It read: *"Its own condition, deliberately outside the `!IS_SELF_HOSTED`
                  block. Access groups are not Cloud-only — the migration ships with the bundle and
                  the policies apply there identically."* Both of those sentences are true and the
                  conclusion did not follow from them. **A group has exactly one consumer** —
                  `TemplateAccessControl` — and that control is `!IS_SELF_HOSTED` in the block above
                  *and* in `pages/TemplateEditor.tsx`. With no way to attach a group to a template,
                  a self-hoster was maintaining objects that could never grant anything.

                  ⚠️ That is worse than a missing feature: it is a feature that pretends to work.
                  **The tables and policies still ship** — schema parity across Cloud and self-host is
                  worth more than two unused tables, and rows an instance already created are left
                  untouched rather than dropped: they have no consumer, so nothing is gained by a
                  migration that cannot be undone.

                  No `mt-*` here: this tab spaces its cards with `space-y-6`, unlike the Team tab. */}
              {!IS_SELF_HOSTED && can(currentUser, workspace, 'team:manage') && (
                <AccessGroupsCard workspaceId={workspace.id} members={workspace.members} />
              )}

              {/* SQEM-323 — the self-host counterpart of both blocks above, and deliberately **one**
                  card for them. The default and the groups are two controls in the code and a single
                  idea to a reader — *who may use a template* — so two CTAs would nag where one
                  informs.

                  The shape is copied from the Apps CTA in `ConnectorsCard` (SQEM-155) on purpose:
                  two upsells that look different read as two features.

                  ⚠️ Gated on `team:manage`, not shown to everyone. A member cannot change template
                  access on Cloud either, so advertising it to them would be an offer they could not
                  act on. And the first line states what *does* apply here — an upsell that only
                  says what is missing leaves the actual rule unsaid. */}
              {IS_SELF_HOSTED && can(currentUser, workspace, 'team:manage') && (
                <Card className="p-6 md:p-8">
                  <SettingsCardHeader icon={<Lock />} title={m.sts_access_title()} description={m.sts_selfhost_desc()} />
                  {/* SQEM-554 (d2) — a plain accent surface instead of the brand gradient (C uses no gradients). */}
                  <div className="rounded-card border border-accent/20 bg-accent-soft p-6 text-center">
                    <div className="flex items-center justify-center gap-1.5 mb-4">
                      {[Users, Lock, User].map((Icon, i) => (
                        <div key={i} className="w-9 h-9 rounded-xl bg-surface-raised border border-line flex items-center justify-center shadow-sm">
                          <Icon className="w-5 h-5 text-accent" />
                        </div>
                      ))}
                    </div>
                    <h3 className="text-base font-bold text-ink-strong">{m.sts_selfhost_title()}</h3>
                    <p className="text-sm text-ink-muted mt-1.5 max-w-md mx-auto">
                      {m.sts_selfhost_body()}
                    </p>
                    <a
                      href="https://sqemes.com"
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-2 mt-4 px-5 py-2.5 bg-accent-strong hover:opacity-90 text-white rounded-xl text-sm font-bold transition-all shadow-lg"
                    >
                      {m.sts_selfhost_cta()} <ArrowUpRight className="w-4 h-4" />
                    </a>
                  </div>
                </Card>
              )}

              {/* SQEM-170 — Content Governance is a Cloud-only feature */}
              {!IS_SELF_HOSTED && (
              <Card className="p-8">
                <h2 className="font-display text-xl font-semibold text-ink-strong flex items-center gap-2 mb-6">
                  <ShieldAlert className="w-5 h-5 text-danger" />
                  {m.sts_governance()}
                </h2>
                <div className="mb-6">
                  <label htmlFor="settings-blacklisted-terms" className={SETTINGS_FIELD_LABEL}>{m.sts_blacklist()}</label>
                  <div className="flex gap-3 max-w-xl mb-4">
                     <Input id="settings-blacklisted-terms"
                       className="flex-1"
                       placeholder={m.sts_blacklist_placeholder()}
                       value={blacklistedTerm}
                       onChange={e => setBlacklistedTerm(e.target.value)}
                       onKeyDown={e => e.key === 'Enter' && addTerm()}
                     />
                     <button onClick={addTerm} className="px-6 bg-surface-sunken text-ink hover:bg-line-strong rounded-xl text-sm font-bold transition-colors">{m.sts_add()}</button>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {workspace.blacklistedTerms.map(term => (
                      <span key={term} className="bg-danger-soft text-danger border border-danger/20 px-3 py-1.5 rounded-lg text-xs font-bold flex items-center gap-2">
                        {term}
                        <button onClick={() => removeTerm(term)} aria-label={m.sts_remove_term({ term })} className="hover:opacity-70"><X className="w-3 h-3" /></button>
                      </span>
                    ))}
                    {workspace.blacklistedTerms.length === 0 && <span className="text-sm text-ink-subtle italic">{m.sts_no_terms()}</span>}
                  </div>
                </div>

                <div className="border-t border-line pt-6 space-y-4">
                  <p className="block text-xs font-bold text-ink-subtle uppercase tracking-wider mb-4">{m.sts_pii()}</p>
                  {([
                    { key: 'blockEmails', label: m.sts_pii_email(), description: m.sts_pii_email_desc() },
                    { key: 'blockIban',   label: m.sts_pii_iban(),  description: m.sts_pii_iban_desc() },
                    { key: 'blockPhone',  label: m.sts_pii_phone(), description: m.sts_pii_phone_desc() },
                  ] as const).map(({ key, label, description }) => (
                    <div key={key} className="flex items-center justify-between max-w-xl">
                      <div>
                        <p id={`governance-${key}`} className="text-sm font-semibold text-ink">{label}</p>
                        <p id={`governance-${key}-hint`} className="text-xs text-ink-subtle mt-0.5">{description}</p>
                      </div>
                      {/* SQEM-554 (d2) — the shared Switch (SQEM-545 named this one as the first to move onto
                          it); the same draft logic, the same names. */}
                      <Switch
                        checked={!!(governanceDraft[key] ?? workspace[key])}
                        labelledBy={`governance-${key}`}
                        describedBy={`governance-${key}-hint`}
                        onChange={() => setGovernanceDraft(prev => {
                          const next = { ...prev };
                          const value = !(prev[key] ?? workspace[key]);
                          if (value === workspace[key]) delete next[key]; else next[key] = value;
                          return next;
                        })}
                      />
                    </div>
                  ))}
                  <CardSaveBar
                    dirty={Object.keys(governanceDraft).length > 0}
                    saving={savingCard === 'governance'}
                    onCancel={() => setGovernanceDraft({})}
                    onSave={() => saveCard('governance', governanceDraft, () => setGovernanceDraft({}))}
                  />
                </div>
              </Card>
              )}
            </div>
          )}
          {/* --- Brand Tab --- */}
          {activeTab === 'brand' && can(currentUser, workspace, 'settings:general') && (
            <div className="space-y-6 animate-fade-in">
              {!IS_SELF_HOSTED && (
              <Card className="p-6 md:p-8">
                <SettingsCardHeader
                  title={m.stb_title()}
                  description={m.stb_desc()}
                  actions={
                    <Button onClick={handleSaveBrand} disabled={!bpDirty} className="px-5">
                      <Save className="w-4 h-4" /> {m.st_save()}
                    </Button>
                  }
                />
                <BrandProfileForm
                  value={brandForm}
                  onChange={patch => { setBrandForm(f => ({ ...f, ...patch })); setBpDirty(true); }}
                />
              </Card>
              )}
              {/* SQEM-597 — admins edit (guard_document_style enforces it in the database too). */}
              <DocumentStyleCard
                value={workspace.documentStyle}
                files={workspaceFiles}
                canEdit={can(currentUser, workspace, 'team:manage')}
                onSave={async (style) => {
                  await updateWorkspace({ documentStyle: style });
                  showToast(m.stb_doc_saved(), 'success');
                }}
              />
            </div>
          )}

          {/* --- Team Tab --- */}
          {activeTab === 'team' && can(currentUser, workspace, 'settings:general') && (<>
            <Card overflow className="animate-fade-in">
              <div className="p-6 md:p-8 border-b border-line flex flex-col md:flex-row md:items-center justify-between gap-4">
                <div>
                  <h2 className="font-display text-xl font-semibold text-ink-strong">{m.st_tab_team()}</h2>
                  <p className="text-sm text-ink-muted mt-1">
                    {m.stt_active_members({ count: memberCount })}{(workspace.isManaged || IS_SELF_HOSTED) ? m.stt_unlimited_seats() : m.stt_of_seats({ limit: memberLimit })}
                  </p>
                  {storageUsage && (
                    <p className="text-sm text-ink-muted mt-0.5" data-testid="storage-usage">
                      {m.stt_storage({ used: fmtBytes(storageUsage.used) })}{storageUsage.limit == null ? m.stt_storage_unlimited() : m.stt_storage_of({ limit: fmtBytes(storageUsage.limit) })}
                    </p>
                  )}
                </div>
                {can(currentUser, workspace, 'team:manage') && (isLimitReached ? (
                   <button
                     onClick={() => requestTab('plans')}
                     className="flex items-center gap-2 bg-warning hover:opacity-90 text-white px-4 py-2 rounded-control font-medium text-sm transition-all shadow-raised w-full md:w-auto justify-center"
                   >
                     <Zap className="w-4 h-4" /> {m.stt_upgrade_invite()}
                   </button>
                ) : (
                   <Button
                     onClick={() => setIsInviteModalOpen(true)}
                     className="shadow-lg w-full md:w-auto justify-center"
                   >
                     <Mail className="w-4 h-4" /> {m.stt_invite()}
                   </Button>
                ))}
              </div>
              
              <div className="overflow-x-auto">
                <table className="w-full text-left text-sm min-w-[600px]">
                  <thead className="bg-surface-sunken text-ink-muted font-medium border-b border-line">
                    <tr>
                      <th className="px-6 py-4 w-1/2">{m.stt_col_user()}</th>
                      <th className="px-6 py-4">{m.stt_col_role()}</th>
                      {can(currentUser, workspace, 'team:manage') && <th className="px-6 py-4 text-right">{m.stt_col_actions()}</th>}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-line">
                    {workspace.members.map(member => (
                      <tr key={member.id} className="hover:bg-surface-sunken/60 transition-colors">
                        <td className="px-6 py-4">
                          <div className="flex items-center gap-3">
                            <Avatar src={member.avatar} name={member.name} className="w-10 h-10" />
                            <div>
                              <p className="font-bold text-ink-strong">{member.name}</p>
                              <p className="text-ink-muted">{member.email}</p>
                            </div>
                          </div>
                        </td>
                        <td className="px-6 py-4">
                          {can(currentUser, workspace, 'team:manage') ? (
                            <select
                              className="bg-surface-field border border-line-strong text-ink text-xs font-bold uppercase tracking-wider rounded-lg py-1.5 px-3 outline-none focus:border-accent cursor-pointer hover:border-line-strong transition-colors"
                              value={member.role}
                              onChange={(e) => handleRoleChange(member, e.target.value as UserRole)}
                              disabled={member.id === currentUser.id}
                            >
                              {(Object.keys(ROLE_LABELS) as UserRole[]).map(r => (
                                <option key={r} value={r}>{roleLabel(r)}</option>
                              ))}
                            </select>
                          ) : (
                            <span className="text-xs font-bold uppercase tracking-wider text-ink-muted bg-surface-sunken px-2.5 py-1 rounded-lg">
                              {roleLabel(member.role)}
                            </span>
                          )}
                        </td>
                        <td className="px-6 py-4 text-right">
                          {can(currentUser, workspace, 'team:manage') && member.id !== currentUser.id && (
                            <button
                              onClick={() => setConfirmDialog({
                                title: m.stt_remove_title({ name: member.name }),
                                message: m.stt_remove_body({ name: member.name }),
                                onConfirm: () => removeMember(member.id),
                              })}
                              className="text-ink-subtle hover:text-danger p-2 hover:bg-danger-soft rounded-lg transition-colors"
                            >
                              <Trash2 className="w-4 h-4" />
                            </button>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>

            {/* Pending Invitations */}
            {pendingInvitations.length > 0 && (
              <Card overflow className="animate-fade-in mt-6">
                <div className="p-6 md:p-8 border-b border-line">
                  <h2 className="font-display text-xl font-semibold text-ink-strong flex items-center gap-2">
                    <Clock className="w-5 h-5 text-warning" />
                    {m.stt_pending({ count: pendingInvitations.length })}
                  </h2>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-sm min-w-[600px]">
                    <thead className="bg-surface-sunken text-ink-muted font-medium border-b border-line">
                      <tr>
                        <th className="px-6 py-4 w-1/2">{m.stt_col_email()}</th>
                        <th className="px-6 py-4">{m.stt_col_role()}</th>
                        <th className="px-6 py-4">{m.stt_col_expires()}</th>
                        <th className="px-6 py-4 text-right">{m.stt_col_actions()}</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-line">
                      {pendingInvitations.map(inv => (
                        <tr key={inv.id} className="hover:bg-surface-sunken/60 transition-colors">
                          <td className="px-6 py-4">
                            <div className="flex items-center gap-3">
                              <div className="w-10 h-10 rounded-full bg-warning-soft flex items-center justify-center">
                                <Mail className="w-5 h-5 text-warning" />
                              </div>
                              <p className="font-bold text-ink-strong">{inv.email}</p>
                            </div>
                          </td>
                          <td className="px-6 py-4">
                            <span className="text-xs font-bold uppercase tracking-wider text-ink-muted bg-surface-sunken px-2.5 py-1 rounded-lg">
                              {roleLabel(inv.role)}
                            </span>
                          </td>
                          <td className="px-6 py-4 text-ink-muted text-sm">
                            {new Date(inv.expiresAt).toLocaleDateString(getLocale())}
                          </td>
                          <td className="px-6 py-4 text-right">
                            {can(currentUser, workspace, 'team:manage') && (
                              <div className="flex items-center justify-end gap-1">
                                <button
                                  onClick={async () => {
                                    // SQEM-112 — share the invite link directly (esp. when email delivery fails).
                                    const link = `${window.location.origin}/#/invite/${inv.token}?email=${encodeURIComponent(inv.email)}`;
                                    const ok = await copyToClipboard(link);
                                    showToast(ok ? m.stt_link_copied() : m.stt_link_copy_failed(), ok ? 'success' : 'error');
                                  }}
                                  className="flex items-center gap-1.5 whitespace-nowrap shrink-0 text-ink-muted hover:text-accent px-2.5 py-1.5 hover:bg-accent-soft rounded-lg transition-colors text-xs font-medium"
                                  title={m.stt_copy_link_title()}
                                >
                                  <Copy className="w-3.5 h-3.5" />
                                  {m.stt_copy_link()}
                                </button>
                                <button
                                  onClick={async () => {
                                    setResendingIds(prev => new Set(prev).add(inv.id));
                                    await resendInvitation(inv.id);
                                    setResendingIds(prev => { const s = new Set(prev); s.delete(inv.id); return s; });
                                  }}
                                  disabled={resendingIds.has(inv.id)}
                                  className="flex items-center gap-1.5 text-ink-muted hover:text-accent px-2.5 py-1.5 hover:bg-accent-soft rounded-lg transition-colors text-xs font-medium disabled:opacity-50 disabled:cursor-not-allowed"
                                  title={m.stt_resend_title()}
                                >
                                  <RotateCw className={`w-3.5 h-3.5 ${resendingIds.has(inv.id) ? 'animate-spin' : ''}`} />
                                  {m.stt_resend()}
                                </button>
                                <button
                                  onClick={() => setConfirmDialog({
                                    title: m.stt_cancel_inv_title(),
                                    message: m.stt_cancel_inv_body({ email: inv.email }),
                                    onConfirm: () => cancelInvitation(inv.id),
                                  })}
                                  className="text-ink-subtle hover:text-danger p-2 hover:bg-danger-soft rounded-lg transition-colors"
                                  title={m.stt_cancel_inv()}
                                >
                                  <X className="w-4 h-4" />
                                </button>
                              </div>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </Card>
            )}

          </>)}

          {/* --- Plans Tab --- */}
          {activeTab === 'plans' && !IS_SELF_HOSTED && can(currentUser, workspace, 'plans:manage') && (
            <Card className="p-6 md:p-8 animate-fade-in">
              {workspace.isManaged ? (
                <div className="flex flex-col items-center text-center py-8">
                  <div className="w-16 h-16 bg-accent-soft rounded-2xl flex items-center justify-center mb-4">
                    <Shield className="w-8 h-8 text-accent" />
                  </div>
                  <h2 className="font-display text-xl font-semibold text-ink-strong mb-2">{m.stg_managed()}</h2>
                  <p className="text-sm text-ink-muted max-w-sm">
                    {m.stl_managed_body()}
                  </p>
                  <div className="mt-6 flex gap-6 text-center">
                    <div className="bg-accent-soft border border-accent/20 rounded-xl px-6 py-4">
                      <p className="text-2xl font-bold text-accent">∞</p>
                      <p className="text-xs text-ink-muted mt-1 font-medium">{m.st_tab_team()}</p>
                    </div>
                    <div className="bg-accent-soft border border-accent/20 rounded-xl px-6 py-4">
                      <p className="text-2xl font-bold text-accent">{formatEuro(0)}</p>
                      <p className="text-xs text-ink-muted mt-1 font-medium">{m.stl_monthly_cost()}</p>
                    </div>
                  </div>
                </div>
              ) : (<>
              <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center mb-8 gap-4">
                 <div>
                    <h2 className="font-display text-xl font-semibold text-ink-strong">{m.stl_title()}</h2>
                    <p className="text-sm text-ink-muted mt-1">{m.stl_current()} <span className="font-bold text-accent">{workspace.plan}</span></p>
                 </div>

                 {/* Only show billing cycle toggle for Solo — paid users manage billing via portal */}
                 {!hasActiveSub && (
                   <div className="flex bg-surface-sunken p-1 rounded-xl self-start sm:self-auto">
                      <button
                          onClick={() => setBillingCycle('monthly')}
                          className={`px-6 py-2 rounded-lg text-sm font-bold transition-all ${billingCycle === 'monthly' ? 'bg-surface-raised shadow-sm text-ink-strong' : 'text-ink-muted hover:text-ink-strong'}`}
                      >
                          {m.stl_monthly()}
                      </button>
                      <button
                          onClick={() => setBillingCycle('yearly')}
                          className={`px-6 py-2 rounded-lg text-sm font-bold transition-all flex items-center gap-2 ${billingCycle === 'yearly' ? 'bg-surface-raised shadow-sm text-ink-strong' : 'text-ink-muted hover:text-ink-strong'}`}
                      >
                          {m.stl_yearly()}
                          <span className="text-2xs bg-success-soft text-ink-strong px-1.5 py-0.5 rounded-md uppercase tracking-wide hidden sm:inline-block">{m.stl_save20()}</span>
                      </button>
                   </div>
                 )}
              </div>
              
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {(Object.keys(PLANS) as Array<keyof typeof PLANS>).map(tier => {
                  // The currently-subscribed tier (only meaningful with an active sub).
                  const isActivePlan = hasActiveSub && workspace.plan === tier;
                  // No active subscription → can start a trial on any tier; with a sub,
                  // tier changes go through the Stripe portal.
                  const canSubscribe = !hasActiveSub;

                  // SQEM-609 — the amounts come from constants (display only — Stripe charges), the format
                  // from the app language: "€12/mo" in English, "12 €/Monat" in German.
                  let displayPrice = planMonthly(planMonthlyAmount(PLANS[tier].price));
                  let billingText = m.stl_billed_monthly();

                  if (billingCycle === 'yearly') {
                    const yearlyMonthly = PLANS[tier].priceYearly;
                    displayPrice = planMonthly(yearlyMonthly);
                    billingText = m.stl_billed_yearly({ amount: formatEuro(yearlyMonthly * 12) });
                  }

                  const isLoading = checkoutLoadingTier === tier;

                  return (
                    <div
                      key={tier}
                      className={`relative p-6 rounded-2xl border transition-all flex flex-col ${
                        isActivePlan
                          ? 'border-accent bg-accent-soft ring-2 ring-accent/20 shadow-md'
                          : !canSubscribe
                            ? 'border-line-strong bg-surface-sunken/60 opacity-60'
                            : 'border-line-strong bg-surface-raised hover:border-accent/50 hover:shadow-soft-lg'
                      }`}
                    >
                      {isActivePlan && (
                        <span className="absolute top-3 right-3 text-2xs font-bold uppercase tracking-wider text-accent bg-surface-raised border border-accent/30 px-2 py-0.5 rounded-full flex items-center gap-1">
                          <Check className="w-2.5 h-2.5" /> {isTrialing(workspace) ? m.stl_trial_badge() : m.stl_active()}
                        </span>
                      )}

                      <h3 className="font-bold text-lg text-ink-strong">{tier}</h3>
                      <p className="text-xs mt-0.5 mb-4 text-ink-muted">{planTagline(tier, PLANS[tier].tagline)}</p>

                      <div className="mb-6">
                        <p className="text-3xl font-bold text-ink-strong">{displayPrice}</p>
                        <p className="text-xs text-ink-muted font-medium mt-1">{billingText}</p>
                        {/* SQEM-283 — see VAT_NOTE: the Terms promise consumers a shown price includes VAT. SQEM-609: the text is stl_vat, held equal to VAT_NOTE by planLabels.test.ts. */}
                        <p className="text-2xs text-ink-subtle mt-1">{m.stl_vat()}</p>
                      </div>

                      <ul className="space-y-2.5 text-sm flex-1 text-ink">
                        {PLANS[tier].features.map(feature => (
                          <li key={feature} className="flex items-center gap-2.5">
                            <Check className={`w-3.5 h-3.5 shrink-0 ${isActivePlan ? 'text-accent' : 'text-ink-subtle'}`} />
                            {planFeature(feature)}
                          </li>
                        ))}
                      </ul>
                      {/* SQEM-556 — what this workspace uses of the plan's storage, on its own plan's card. */}
                      {isActivePlan && <div className="mt-5"><PlanStorageUsage workspaceId={workspace.id} /></div>}

                      {/* SQEM-207 (A-01) — this used to render a disabled button labelled
                          "Switch via Portal" with no explanation of why it was dead, while the
                          control that actually works sat four plan cards further down. A disabled
                          control that gives no reason is an error message without any text. Existing
                          subscribers now get a working button straight to the portal. */}
                      <button
                        disabled={isActivePlan || isLoading}
                        onClick={() => (canSubscribe ? handleUpgrade(tier) : handleManageSubscription())}
                        className={`w-full mt-6 py-2.5 rounded-xl text-sm font-bold transition-colors flex items-center justify-center gap-2 ${
                          isActivePlan
                            ? 'bg-accent-strong text-white shadow-lg cursor-default'
                            : canSubscribe
                              ? 'bg-ink-strong text-surface-raised hover:opacity-90'
                              : 'bg-surface-field border border-line-strong text-ink hover:bg-surface-sunken'
                        }`}
                      >
                        {isLoading && <Loader2 className="w-4 h-4 animate-spin" />}
                        {isActivePlan ? m.stl_current_plan() : canSubscribe ? (isLoading ? m.stl_redirecting() : m.stl_start_trial({ days: TRIAL_DAYS })) : m.stl_change_portal()}
                      </button>
                    </div>
                  );
                })}

                {/* SQEM-095 — Enterprise: not a Stripe plan; contact-sales card linking out. */}
                <div className="relative p-6 rounded-2xl border transition-all flex flex-col border-line-strong bg-surface-raised hover:border-accent/50 hover:shadow-soft-lg">
                  <h3 className="font-bold text-lg text-ink-strong">Enterprise</h3>
                  <p className="text-xs mt-0.5 mb-4 text-ink-muted">{m.stl_enterprise_tagline()}</p>

                  <div className="mb-6">
                    <p className="text-3xl font-bold text-ink-strong">{m.stl_lets_talk()}</p>
                    <p className="text-xs text-ink-muted font-medium mt-1">{m.stl_custom_pricing()}</p>
                  </div>

                  <ul className="space-y-2.5 text-sm flex-1 text-ink">
                    {[m.stl_ent_1(), m.stl_ent_2(), m.stl_ent_3(), m.stl_ent_4(), m.stl_ent_5()].map(feature => (
                      <li key={feature} className="flex items-center gap-2.5">
                        <Check className="w-3.5 h-3.5 shrink-0 text-ink-subtle" />
                        {feature}
                      </li>
                    ))}
                  </ul>

                  <a
                    href="https://sqemes.com/enterprise"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="w-full mt-6 py-2.5 rounded-xl text-sm font-bold transition-colors flex items-center justify-center gap-2 bg-ink-strong text-surface-raised hover:opacity-90"
                  >
                    {m.stl_talk()} <ExternalLink className="w-4 h-4" />
                  </a>
                </div>
              </div>

              {/* Manage Subscription — shown for paid plans */}
              {hasActiveSub && !workspace.isManaged && (
                <div className="mt-6 p-5 bg-surface-sunken border border-line-strong rounded-2xl flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
                  <div>
                    <p className="text-sm font-bold text-ink-strong">{m.stl_manage_sub()}</p>
                    <p className="text-xs text-ink-muted mt-0.5">{m.stl_manage_sub_desc()}</p>
                  </div>
                  <button
                    onClick={handleManageSubscription}
                    disabled={isPortalLoading}
                    className="flex items-center gap-2 px-5 py-2.5 bg-ink-strong text-surface-raised text-sm font-bold rounded-xl hover:opacity-90 transition-colors whitespace-nowrap disabled:opacity-50 disabled:cursor-not-allowed shrink-0"
                  >
                    {isPortalLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <ExternalLink className="w-4 h-4" />}
                    {isPortalLoading ? m.stl_opening() : m.stl_open_portal()}
                  </button>
                </div>
              )}

              </>)}
            </Card>
          )}

          {/* --- Integrations Tab --- */}
          {activeTab === 'api' && can(currentUser, workspace, 'api-keys:own') && (
            <div className="space-y-6 animate-fade-in">
              {/* SQEM-554 (c) — MCP first: one of the three channels, and the card most people come here for. */}
              <McpServerCard locked={!hasMcpAccess} onUpgrade={() => setActiveTab('plans')} />

              {/* ⛔ SQEM-328 — AI provider keys stay closed to members, and the difference from the
                  cards below is not a matter of degree. A provider key is a workspace-wide
                  credential that costs money on every call and serves everybody; a public API key
                  is one person's own connection. They shared this tab by accident of layout, which
                  is exactly why the whole tab was closed to members until now — the coarse gate was
                  hiding a fine distinction rather than making one. */}
              {can(currentUser, workspace, 'api-keys:manage') && (
              <Card className="p-6 md:p-8">
                <div className="flex items-center justify-between mb-6">
                  <div>
                    <h2 className="font-display text-xl font-semibold text-ink-strong flex items-center gap-2">
                      <Key className="w-5 h-5 text-accent" />
                      {/* SQEM-287 — was "LLM API Configuration". Two problems in three words: "LLM"
                          is never explained anywhere in the product, and this was the *third* name
                          for one thing — the Dashboard says "Provider keys", the setup wizard says
                          "AI provider key". Somebody sent here by the wizard arrived at a heading
                          that did not match what sent them. One name now, and it is the plain one. */}
                      {m.sta_provider_title()}
                    </h2>
                    <p className="text-sm text-ink-muted mt-1">
                      {m.sta_provider_desc()}
                    </p>
                  </div>
                  <Button onClick={handleSaveKeys} className="px-5 py-2 shadow-lg">
                    {/* SQEM-301 — "Save", and the label is no longer hidden on small screens. It
                        was `hidden sm:inline` because "Save Changes" did not fit; at four characters
                        it does, and an icon-only button had no accessible name at all. */}
                    <Save className="w-4 h-4" /> {m.st_save()}
                  </Button>
                </div>
                
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  {PROVIDERS.map(provider => {
                    const hasExistingKey = !!workspace.apiKeys[provider.id as keyof typeof workspace.apiKeys];
                    const localValue = apiKeys[provider.id as keyof typeof apiKeys] || '';
                    return (
                    <div key={provider.id} className="relative group">
                      <label htmlFor={`provider-key-${provider.id}`} className="block text-xs font-bold text-ink-muted uppercase tracking-wider mb-2 flex items-center gap-2">
                        <ProviderIcon provider={provider.id} className="w-5 h-5" />
                        {provider.name}
                        {hasExistingKey && !localValue && (
                          <>
                            <span className="text-2xs bg-success-soft text-ink-strong px-1.5 py-0.5 rounded-md font-bold">{m.sta_configured()}</span>
                            <button
                              type="button"
                              onClick={() => setConfirmDialog({
                                title: m.sta_remove_key_title({ provider: provider.name }),
                                message: m.sta_remove_key_body({ provider: provider.name }),
                                onConfirm: () => handleRemoveKey(provider.id),
                              })}
                              className="ml-auto text-2xs font-bold text-ink-subtle hover:text-danger normal-case transition-colors"
                            >
                              {m.sta_remove()}
                            </button>
                          </>
                        )}
                      </label>
                      <div className="relative">
                         <Input id={`provider-key-${provider.id}`}
                           type={provider.id === 'ollama' ? "text" : "password"}
                           value={localValue}
                           onChange={(e) => setApiKeys({...apiKeys, [provider.id]: e.target.value})}
                           placeholder={hasExistingKey ? m.sta_replace_placeholder() : provider.placeholder}
                           className="font-mono"
                           tone={hasExistingKey && !localValue ? 'success' : 'default'}
                         />
                         {provider.id === 'ollama' && (
                            <div className="absolute right-3 top-1/2 -translate-y-1/2">
                               <Server className="w-4 h-4 text-ink-subtle" />
                            </div>
                         )}
                      </div>
                      {provider.link && (
                          <div className="mt-1.5 ml-1">
                              <a 
                                href={provider.link} 
                                target="_blank" 
                                rel="noopener noreferrer"
                                className="text-2xs text-accent hover:opacity-80 font-bold hover:underline inline-flex items-center gap-1 group/link"
                              >
                                {m.sta_get_key()} <ExternalLink className="w-3 h-3 transition-transform group-hover/link:-translate-y-0.5 group-hover/link:translate-x-0.5" />
                              </a>
                          </div>
                      )}
                      {provider.id === 'ollama' && (
                        <p className="text-2xs text-ink-subtle mt-1.5 ml-1">
                           {m.sta_ollama_hint()}
                        </p>
                      )}
                      {provider.id === 'openrouter' && (
                        <div className="mt-3 pt-3 border-t border-line">
                          <p className="text-2xs font-bold text-ink-muted uppercase tracking-wider mb-2">{m.sta_models()}</p>
                          {workspace.openrouterModels.length > 0 && (
                            <div className="flex flex-wrap gap-1.5 mb-2">
                              {workspace.openrouterModels.map(mid => (
                                <span key={mid} className="inline-flex items-center gap-1 text-2xs font-mono px-2 py-1 bg-surface-sunken text-ink rounded-lg">
                                  {mid}
                                  <button type="button" onClick={() => updateWorkspace({ openrouterModels: workspace.openrouterModels.filter(x => x !== mid) })} className="text-ink-subtle hover:text-danger">
                                    <X className="w-3 h-3" />
                                  </button>
                                </span>
                              ))}
                            </div>
                          )}
                          <div className="flex gap-1.5">
                            <input
                              value={newOrModelId}
                              onChange={e => setNewOrModelId(e.target.value)}
                              onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addOrModel(); } }}
                              placeholder={m.sta_or_placeholder()}
                              className="flex-1 p-2 border border-line-strong bg-surface-field rounded-lg text-2xs font-mono outline-none focus:border-accent text-ink-strong placeholder:text-ink-subtle"
                            />
                            <button type="button" onClick={addOrModel} className="px-3 py-2 bg-ink-strong text-surface-raised rounded-lg text-2xs font-bold shrink-0">{m.sts_add()}</button>
                          </div>
                          <p className="text-2xs text-ink-subtle mt-1.5">
                            {/* SQEM-573 — no built-in OpenRouter models: only what is added here appears in the picker. */}
                            {m.sta_or_hint()}{' '}
                            <a href="https://openrouter.ai/models" target="_blank" rel="noopener noreferrer" className="text-accent hover:underline">{m.sta_browse_models()}</a>
                          </p>
                        </div>
                      )}
                    </div>
                    );
                  })}
                </div>
              </Card>
              )}

              {/* SQEM-594 — web search in Chat. ONE search key per workspace: Linkup or
                  Brave, chosen here; saving one removes the other. On Cloud sqemes provides Linkup with a
                  monthly allowance per plan, and the workspace's own key always wins over it. */}
              {can(currentUser, workspace, 'api-keys:manage') && (() => {
                const configured: 'linkup' | 'brave' | null = workspace.apiKeys.search_linkup ? 'linkup' : workspace.apiKeys.search_brave ? 'brave' : null;
                const SEARCH = {
                  linkup: { name: 'Linkup', link: 'https://app.linkup.so' },
                  brave: { name: 'Brave Search', link: 'https://api-dashboard.search.brave.com' },
                } as const;
                return (
              <Card className="p-6 md:p-8">
                <div className="flex items-center justify-between mb-6 gap-4">
                  <div>
                    <h2 className="font-display text-xl font-semibold text-ink-strong flex items-center gap-2">
                      <Globe className="w-5 h-5 text-accent" />
                      {m.sta_search_title()}
                    </h2>
                    <p className="text-sm text-ink-muted mt-1">
                      {workspace.webSearchHosted
                        ? m.sta_search_hosted()
                        : m.sta_search_add()}
                    </p>
                  </div>
                  <Button onClick={handleSaveSearchKey} className="px-5 py-2 shadow-lg shrink-0">
                    <Save className="w-4 h-4" /> {m.st_save()}
                  </Button>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-[12rem_1fr] gap-4 items-start">
                  <div>
                    <label htmlFor="search-provider" className="block text-xs font-bold text-ink-muted uppercase tracking-wider mb-2">{m.sta_provider()}</label>
                    <Select
                      id="search-provider"
                      value={searchProvider}
                      onChange={(e) => setSearchProvider(e.target.value as 'linkup' | 'brave')}
                    >
                      <option value="linkup">Linkup</option>
                      <option value="brave">Brave Search</option>
                    </Select>
                  </div>
                  <div>
                    <label htmlFor="search-key" className="block text-xs font-bold text-ink-muted uppercase tracking-wider mb-2 flex items-center gap-2">
                      {m.sta_key()}
                      {configured && !searchKey && (
                        <>
                          <span className="text-2xs bg-success-soft text-ink-strong px-1.5 py-0.5 rounded-md font-bold normal-case">{m.sta_search_configured({ name: SEARCH[configured].name })}</span>
                          <button
                            type="button"
                            onClick={() => setConfirmDialog({
                              title: m.sta_search_remove_title(),
                              message: workspace.webSearchHosted
                                ? m.sta_search_remove_hosted()
                                : m.sta_search_remove_stops(),
                              onConfirm: () => handleRemoveKey(`search_${configured}`),
                            })}
                            className="ml-auto text-2xs font-bold text-ink-subtle hover:text-danger normal-case transition-colors"
                          >
                            {m.sta_remove()}
                          </button>
                        </>
                      )}
                    </label>
                    <Input
                      id="search-key"
                      type="password"
                      value={searchKey}
                      onChange={(e) => setSearchKey(e.target.value)}
                      placeholder={configured ? m.sta_search_replace() : m.sta_search_key_placeholder({ name: SEARCH[searchProvider].name })}
                      className="font-mono"
                      tone={configured && !searchKey ? 'success' : 'default'}
                    />
                    <div className="mt-1.5 ml-1 flex flex-wrap items-center gap-x-3 gap-y-1">
                      <a href={SEARCH[searchProvider].link} target="_blank" rel="noopener noreferrer" className="text-2xs text-accent hover:opacity-80 font-bold hover:underline inline-flex items-center gap-1">
                        {m.sta_get_key()} <ExternalLink className="w-3 h-3" />
                      </a>
                      <span className="text-2xs text-ink-subtle">
                        {m.sta_search_one()}
                        {searchProvider === 'brave' && m.sta_brave_terms()}
                      </span>
                    </div>
                  </div>
                </div>
              </Card>
                );
              })()}

              {/* Public API Keys */}
              <Card className="p-6 md:p-8">
                <div className="flex items-center justify-between mb-6">
                  <div>
                    <h2 className="font-display text-xl font-semibold text-ink-strong flex items-center gap-2">
                      <Zap className="w-5 h-5 text-accent" />
                      {m.sta_public_title()}
                    </h2>
                    <p className="text-sm text-ink-muted mt-1">
                      {m.sta_public_desc()}
                    </p>
                  </div>
                  <button
                    onClick={() => { setNewKeyName(''); setNewKeyScope(defaultScopeFor(canWriteContent)); setShowGenerateKeyModal(true); }}
                    disabled={!hasMcpAccess}
                    title={!hasMcpAccess ? m.sta_upgrade_for_keys() : undefined}
                    className="flex items-center gap-2 px-4 py-2 bg-accent-strong hover:opacity-90 text-white rounded-xl text-sm font-bold transition-all shadow-lg disabled:opacity-50 disabled:cursor-not-allowed disabled:shadow-none"
                  >
                    <Plus className="w-4 h-4" /> {m.sta_generate()}
                  </button>
                </div>

                {sqemesApiKeys.length === 0 ? (
                  <div className="text-center py-10 border-2 border-dashed border-line-strong rounded-2xl">
                    <Zap className="w-8 h-8 text-ink-subtle mx-auto mb-3" />
                    <p className="text-sm font-semibold text-ink-muted">{m.sta_no_keys()}</p>
                    <p className="text-xs text-ink-subtle mt-1">{m.sta_no_keys_hint()}</p>
                  </div>
                ) : (
                  <div className="space-y-3">
                    {sqemesApiKeys.map(k => {
                      const scopes = k.scopes && k.scopes.length > 0 ? k.scopes : ['read', 'create', 'update', 'delete'];
                      const writeScopes = scopes.filter(s => s !== 'read');
                      // SQEM-226 — shared with the Dashboard's connection count so the two surfaces
                      // cannot disagree about which keys are still usable. (OAuth rows expire on
                      // connection_expires_at, not on the short access-token TTL in expires_at.)
                      const displayExpiry = mcpKeyExpiry(k);
                      const expired = isMcpKeyExpired(k);
                      return (
                      <div key={k.id} className="flex items-center justify-between gap-4 p-4 bg-surface-sunken rounded-xl border border-line">
                        <div className="min-w-0">
                          <p className="text-sm font-bold text-ink-strong truncate">{k.name}</p>
                          <p className="text-xs font-mono text-ink-subtle mt-0.5">{k.key_prefix}</p>
                          <div className="flex flex-wrap items-center gap-1.5 mt-2">
                            {k.is_oauth && (
                              <span className="text-2xs font-bold uppercase tracking-wide px-1.5 py-0.5 rounded-md bg-accent-soft text-accent">OAuth</span>
                            )}
                            {/* SQEM-143 — which templates this key exposes. */}
                            {k.user_id
                              ? (
                                <span className="text-2xs font-bold uppercase tracking-wide px-1.5 py-0.5 rounded-md bg-success-soft text-ink-strong">
                                  {k.user_id === currentUser.id ? m.sta_you() : (workspace.members?.find(member => member.id === k.user_id)?.name || m.sta_member())}
                                </span>
                              )
                              : (
                                <span className="text-2xs font-bold uppercase tracking-wide px-1.5 py-0.5 rounded-md bg-warning-soft text-ink-strong">{m.sta_workspace_wide()}</span>
                              )}
                            <span className="text-2xs font-bold uppercase tracking-wide px-1.5 py-0.5 rounded-md bg-line-strong text-ink">{m.ks_scope_read()}</span>
                            {writeScopes.map(s => (
                              <span key={s} className="text-2xs font-bold uppercase tracking-wide px-1.5 py-0.5 rounded-md bg-accent-soft text-accent">{SCOPE_LABEL[s]?.() ?? s}</span>
                            ))}
                            {displayExpiry && (
                              <span className={`text-2xs font-bold px-1.5 py-0.5 rounded-md ${expired ? 'bg-danger-soft text-danger' : 'bg-warning-soft text-ink-strong'}`}>
                                {expired ? m.sta_expired() : m.sta_expires({ date: new Date(displayExpiry).toLocaleDateString(getLocale()) })}
                              </span>
                            )}
                          </div>
                        </div>
                        <div className="text-right shrink-0 hidden sm:block">
                          <p className="text-xs text-ink-subtle">{m.sta_created({ date: new Date(k.created_at).toLocaleDateString(getLocale()) })}</p>
                          <p className="text-xs text-ink-subtle mt-0.5">
                            {k.last_used_at ? m.sta_last_used({ date: new Date(k.last_used_at).toLocaleDateString(getLocale()) }) : m.sta_never_used()}
                          </p>
                          {idleDays(k) >= 60 && (
                            <p className={`text-2xs font-bold mt-0.5 ${idleDays(k) >= IDLE_LIMIT_DAYS ? 'text-danger' : 'text-warning'}`}>
                              {idleDays(k) >= IDLE_LIMIT_DAYS
                                ? m.sta_idle_stopped()
                                : m.sta_idle({ days: idleDays(k), limit: IDLE_LIMIT_DAYS })}
                            </p>
                          )}
                        </div>
                        <div className="flex items-center gap-1 shrink-0">
                          <button
                            onClick={() => openEditKeyScope(k)}
                            className="p-2 text-ink-subtle hover:text-accent hover:bg-accent-soft rounded-lg transition-colors"
                            title={m.sta_edit_connection()}
                          >
                            <SlidersHorizontal className="w-4 h-4" />
                          </button>
                          <button
                            onClick={() => handleDeleteApiKey(k.id)}
                            disabled={deletingKeyId === k.id}
                            className="p-2 text-ink-subtle hover:text-danger hover:bg-danger-soft rounded-lg transition-colors"
                            title={m.sta_revoke()}
                          >
                            {deletingKeyId === k.id ? <Loader2 className="w-4 h-4 animate-spin" /> : <Trash2 className="w-4 h-4" />}
                          </button>
                        </div>
                      </div>
                      );
                    })}
                  </div>
                )}
              </Card>

            </div>
          )}

          {/* --- Connectors Tab (SQEM-149) — accessible to all members (personal connectors) --- */}
          {activeTab === 'connectors' && (
            <div className="space-y-6 animate-fade-in">
              <ConnectorsCard workspaceId={workspace.id} currentUser={currentUser} showToast={showToast} />
            </div>
          )}

          {/* --- Profile Tab --- */}
          {activeTab === 'profile' && (
            <div className="space-y-6 animate-fade-in max-w-2xl">
              <Card className="p-6 md:p-8">
                <h2 className="font-display text-xl font-semibold text-ink-strong mb-6">{m.stp_title()}</h2>
                
                <div className="flex flex-col sm:flex-row items-start gap-8 mb-8 border-b border-line pb-8">
                   {/* SQEM-538 — a button, so the picture can be changed by keyboard and is announced. */}
                   <button type="button" aria-label={m.stp_change_picture()} className="shrink-0 relative group cursor-pointer mx-auto sm:mx-0 rounded-full" onClick={() => fileInputRef.current?.click()}>
                     <Avatar src={profileAvatar} name={profileName} className="w-24 h-24 ring-4 ring-surface-sunken" />
                     <div className="absolute inset-0 bg-ink-strong/50 rounded-full flex items-center justify-center opacity-0 group-hover:opacity-100 group-focus-visible:opacity-100 transition-opacity">
                        <Camera className="w-8 h-8 text-white" />
                     </div>
                   </button>
                     <input 
                      type="file" 
                      ref={fileInputRef} 
                      className="hidden" 
                      accept="image/*"
                      onChange={handleFileUpload}
                     />
                   <div className="flex-1 space-y-5 w-full">
                     <div>
                        <label htmlFor="settings-full-name" className={SETTINGS_FIELD_LABEL}>{m.stp_full_name()}</label>
                        <Input id="settings-full-name"
                          value={profileName}
                          onChange={e => { setProfileName(e.target.value); setProfileDirty(true); }}
                        />
                     </div>
                     <div>
                        <label htmlFor="settings-email-address" className={SETTINGS_FIELD_LABEL}>{m.stp_email()}</label>
                        <Input id="settings-email-address"
                          type="email"
                          value={profileEmail}
                          onChange={e => { setProfileEmail(e.target.value); setProfileDirty(true); }}
                        />
                        <p className="text-xs text-ink-muted mt-1.5">{m.stp_email_hint()}</p>
                     </div>

                     <div>
                        <p className={SETTINGS_FIELD_LABEL}>{m.stp_avatar_actions()}</p>
                        <div className="flex gap-2">
                          <button
                            onClick={() => fileInputRef.current?.click()}
                            className="px-4 py-2 bg-surface-sunken hover:bg-line-strong text-ink rounded-lg text-xs font-bold flex items-center gap-2 transition-colors border border-line-strong flex-1 justify-center"
                          >
                            <Upload className="w-3 h-3" /> {m.stp_upload()}
                          </button>
                          <button
                            onClick={handleRandomizeAvatar}
                            className="px-4 py-2 bg-surface-sunken hover:bg-line-strong text-ink rounded-lg text-xs font-bold flex items-center gap-2 transition-colors border border-line-strong flex-1 justify-center"
                          >
                            <RefreshCw className="w-3 h-3" /> {m.stp_randomize()}
                          </button>
                        </div>
                     </div>

                      <div>
                        <label htmlFor="settings-avatar-url-optional" className={SETTINGS_FIELD_LABEL}>{m.stp_avatar_url()}</label>
                        <Input id="settings-avatar-url-optional"
                          value={profileAvatar}
                          onChange={e => { setProfileAvatar(e.target.value); setProfileDirty(true); }}
                          placeholder="https://..."
                        />
                     </div>
                   </div>
                </div>

                <div className="space-y-5">
                   <h3 className="text-sm font-bold text-ink-strong flex items-center gap-2">
                     <Lock className="w-4 h-4 text-ink-subtle" />
                     {m.stp_change_password()}
                   </h3>
                   <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                     <div>
                        <label htmlFor="settings-new-password" className={SETTINGS_FIELD_LABEL}>{m.stp_new_password()}</label>
                        <Input id="settings-new-password" autoComplete="new-password" 
                          type="password"
                          value={passwords.new}
                          onChange={e => setPasswords({...passwords, new: e.target.value})}
                        />
                     </div>
                     <div>
                        <label htmlFor="settings-confirm-password" className={SETTINGS_FIELD_LABEL}>{m.stp_confirm_password()}</label>
                        <Input id="settings-confirm-password" autoComplete="new-password" 
                          type="password"
                          value={passwords.confirm}
                          onChange={e => setPasswords({...passwords, confirm: e.target.value})}
                        />
                     </div>
                   </div>
                </div>

                <div className="mt-8 pt-8 border-t border-line flex flex-col sm:flex-row justify-between items-center gap-4">
                  <div className="flex gap-3 w-full sm:w-auto">
                    <button
                      onClick={handleLogout}
                      className="px-4 py-2 text-ink bg-surface-sunken border border-line-strong rounded-xl text-sm font-bold hover:bg-line-strong transition-colors flex items-center justify-center gap-2 flex-1 sm:flex-none"
                    >
                      <LogOut className="w-4 h-4" /> {m.stp_sign_out()}
                    </button>
                    <button
                      onClick={() => setConfirmDialog({
                        title: m.stp_leave_title(),
                        // SQEM-214 — alone in the workspace, leaving takes it with you. That has to
                        // be said *before* the click, not discovered after it.
                        message: workspace.members.length === 1
                          ? (workspace.stripeSubscriptionId ? m.stp_leave_only_sub({ name: workspace.name }) : m.stp_leave_only({ name: workspace.name }))
                          : m.stp_leave_body({ name: workspace.name }),
                        onConfirm: leaveWorkspace,
                      })}
                      className="px-4 py-2 text-ink bg-surface-sunken border border-line-strong rounded-xl text-sm font-bold hover:bg-danger-soft hover:text-danger hover:border-danger/30 transition-colors flex items-center justify-center gap-2 flex-1 sm:flex-none"
                    >
                      <DoorOpen className="w-4 h-4" /> {m.stp_leave()}
                    </button>
                  </div>

                  <Button
                    onClick={handleUpdateProfile}
                    className="w-full sm:w-auto px-6 py-3 shadow-lg"
                  >
                    {m.stp_save_changes()}
                  </Button>
                </div>
              </Card>

              {/* SQEM-600 — the personal override; "Workspace default" (null) follows the workspace. */}
              {canChooseLanguage(isSqemesAdmin) && (
                <LanguageCard
                  title={m.settings_language_profile_title()}
                  description={m.settings_language_profile_description()}
                  value={currentUser.language ?? null}
                  options={PROFILE_LANGUAGE_OPTIONS}
                  workspaceLanguage={workspace.language}
                  onSave={async language => { await updateUser({ language }); }}
                />
              )}

              {/* SQEM-205 — deliberately directly above the Danger Zone. The product could delete an
                  account but not hand the data over first, and deletion is the half of that pair
                  which costs the user something. Whoever is about to leave passes this on the way. */}
              <Card className="p-8">
                <h2 className="font-display text-xl font-semibold text-ink-strong mb-2">{m.stp_your_data()}</h2>
                <p className="text-sm text-ink-muted mb-6">
                  {m.stp_data_1()} <strong>{workspace.name}</strong> {m.stp_data_2()}
                  {(workspace.members?.length ?? 0) > 0 && m.stp_data_several()}
                </p>
                <button
                  onClick={handleExportAccount}
                  disabled={exporting}
                  className="inline-flex items-center gap-2 px-4 py-2 bg-surface-field border border-line-strong text-ink font-bold text-sm rounded-xl hover:bg-surface-sunken transition-all shadow-sm disabled:opacity-60 disabled:cursor-not-allowed"
                >
                  {exporting
                    ? <><Loader2 className="w-4 h-4 animate-spin" /> {exportStep || m.stp_preparing()}</>
                    : <><Download className="w-4 h-4" /> {m.stp_download_data()}</>}
                </button>
              </Card>

              <div className="bg-danger-soft rounded-card border border-danger/30 p-6 md:p-8">
                <h2 className="font-display text-xl font-semibold text-danger mb-2">{m.stp_danger()}</h2>
                <p className="text-sm text-danger mb-6">{m.stp_danger_desc()}</p>
                <button
                  onClick={() => setConfirmDialog({
                    title: m.stp_delete_title(),
                    // SQEM-214 — this used to *warn* that workspaces would be left without an
                    // admin. That state is dead (nobody can manage members or reach billing, and
                    // the subscription keeps running), so it is refused now instead of announced.
                    // The server does the refusing and names the workspaces; saying "will be
                    // blocked" here would be a second, weaker copy of that rule.
                    message: m.stp_delete_body(),
                    onConfirm: deleteAccount,
                  })}
                  className="px-4 py-2 bg-surface-raised border border-danger/40 text-danger font-bold text-sm rounded-xl hover:bg-danger hover:text-surface-raised hover:border-danger transition-all shadow-sm"
                >
                  {m.stp_delete()}
                </button>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Invite Modal */}
      {/* SQEM-343 — demoting to member, when it would strand something. */}
      <Modal open={!!demoteTarget} onClose={() => !isDemoting && setDemoteTarget(null)} size="md" className="p-6">
        <h3 className="font-display text-xl font-semibold text-ink-strong mb-2">
          {m.stt_demote_title({ name: demoteTarget?.name ?? '' })}
        </h3>
        <p className="text-sm text-ink-muted mb-5">
          {m.stt_demote_intro({ name: demoteTarget?.name ?? '' })}{' '}
          <span className="font-semibold text-ink">
            {m.stt_demote_playbooks({ count: demoteTarget?.templates ?? 0 })}
            {(demoteTarget?.personas ?? 0) > 0 ? m.stt_demote_personas({ count: demoteTarget?.personas ?? 0 }) : ''}
          </span>
          {m.stt_demote_after({ count: (demoteTarget?.templates ?? 0) + (demoteTarget?.personas ?? 0) })}
        </p>

        <div className="space-y-2 mb-5">
          {([
            {
              key: 'handover' as const,
              title: m.stt_handover(),
              body: m.stt_handover_body({ name: demoteTarget?.name ?? '' }),
            },
            {
              key: 'release' as const,
              title: m.stt_release(),
              body: m.stt_release_body(),
            },
            {
              key: 'leave' as const,
              title: m.stt_leave_as_is(),
              body: m.stt_leave_as_is_body({ name: demoteTarget?.name ?? '' }),
            },
          ]).map(opt => (
            <button
              key={opt.key}
              type="button"
              onClick={() => setDemoteChoice(opt.key)}
              className={`w-full px-3 py-2.5 rounded-xl border text-sm text-left transition-all ${demoteChoice === opt.key ? 'border-accent bg-accent-soft text-ink-strong' : 'border-line-strong text-ink hover:bg-surface-sunken'}`}
            >
              <span className="font-semibold block">{opt.title}</span>
              <span className="block text-xs text-ink-subtle mt-0.5">{opt.body}</span>
            </button>
          ))}
        </div>

        <div className="flex gap-2">
          <button
            onClick={() => setDemoteTarget(null)}
            disabled={isDemoting}
            className="flex-1 py-2.5 text-ink bg-surface-sunken rounded-xl hover:bg-line-strong text-xs font-bold transition-colors disabled:opacity-50"
          >
            {m.pb_cancel()}
          </button>
          {/* ⛔ Disabled until a choice is made. No preselection: "leave as is" is the cheapest to
              click and the one that quietly builds the dead end, so it must be picked deliberately. */}
          <button
            onClick={confirmDemotion}
            disabled={!demoteChoice || isDemoting}
            className="flex-1 py-2.5 bg-accent-strong hover:opacity-90 text-white rounded-xl text-xs font-bold transition-all disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {isDemoting ? m.stt_applying() : m.stt_make_member()}
          </button>
        </div>
      </Modal>

      <Modal open={isInviteModalOpen} onClose={() => setIsInviteModalOpen(false)} size="md" className="p-6 md:p-8">
        <h3 className="font-display text-xl font-semibold text-ink-strong mb-6">{m.stt_invite_title()}</h3>
        <form onSubmit={handleInvite} className="space-y-5">
          <div>
            <label htmlFor="settings-invite-email" className="block text-xs font-bold text-ink-muted uppercase tracking-wider mb-1.5">{m.stp_email()}</label>
            <Input id="settings-invite-email"
              type="email"
              required
              placeholder={m.stt_invite_placeholder()}
              value={inviteEmail}
              onChange={e => setInviteEmail(e.target.value)}
            />
          </div>
          <div>
            <label htmlFor="settings-role" className="block text-xs font-bold text-ink-muted uppercase tracking-wider mb-1.5">{m.stt_col_role()}</label>
            <Select id="settings-role"
              value={inviteRole}
              onChange={(e) => setInviteRole(e.target.value as UserRole)}
            >
              {/* ⚠️ SQEM-432 — the label comes from roleLabel (SQEM-608: translated), the explanation stays here. */}
              <option value="admin">{m.stt_role_admin_hint({ role: roleLabel('admin') })}</option>
              <option value="editor">{m.stt_role_editor_hint({ role: roleLabel('editor') })}</option>
              <option value="member">{m.stt_role_member_hint({ role: roleLabel('member') })}</option>
            </Select>
          </div>
          <div className="flex gap-3 mt-8">
            <button type="button" onClick={() => setIsInviteModalOpen(false)} disabled={isInviteSending} className="flex-1 px-4 py-3 text-ink bg-surface-sunken rounded-xl hover:bg-line-strong font-medium transition-colors disabled:opacity-60 disabled:cursor-not-allowed">{m.pb_cancel()}</button>
            <Button type="submit" loading={isInviteSending} className="flex-1 px-4 py-3 shadow-lg">
              {!isInviteSending && m.stt_send_invite()}
            </Button>
          </div>
        </form>
      </Modal>

      {/* Generic Confirm Dialog */}
      {/* Generate API Key Modal */}
      <Modal open={showGenerateKeyModal} onClose={() => setShowGenerateKeyModal(false)} size="sm" className="p-6">
        <h3 className="font-display text-xl font-semibold text-ink-strong mb-2">{m.stk_gen_title()}</h3>
        <p className="text-sm text-ink-muted mb-5">{m.stk_gen_desc()}</p>
        <Input
          type="text"
          value={newKeyName}
          onChange={e => setNewKeyName(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && handleGenerateKey()}
          placeholder={m.stk_name_placeholder()}
          className="mb-5"
          autoFocus
        />
        <div className="mb-5">
          <ApiKeyScopeFields value={newKeyScope} onChange={setNewKeyScope} canWrite={canWriteContent} />
        </div>
        {/* SQEM-143 → 346 — a key carries its creator's access, and there is no other option.
            The two-way picker that stood here offered admins "Whole workspace"; that key is gone.
            ⚠️ Its own label was already wrong — it promised "every template, ignoring per-template
            restrictions", which stopped being true with SQEM-210 three months before it was removed. */}
        <div className="mb-5">
          <p className="block text-xs font-bold text-ink-muted uppercase tracking-wider mb-2">{m.stk_access()}</p>
          <p className="text-xs text-ink-subtle">{m.stk_access_body()}</p>
        </div>
        <div className="flex gap-2">
          <button onClick={() => setShowGenerateKeyModal(false)} className="flex-1 py-2.5 text-ink bg-surface-sunken rounded-xl hover:bg-line-strong text-xs font-bold transition-colors">{m.pb_cancel()}</button>
          <button
            onClick={handleGenerateKey}
            disabled={!newKeyName.trim() || isGeneratingKey}
            className="flex-1 py-2.5 bg-accent-strong hover:opacity-90 text-white rounded-xl text-xs font-bold transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
          >
            {isGeneratingKey ? <><Loader2 className="w-3.5 h-3.5 animate-spin" /> {m.stk_generating()}</> : m.sta_generate()}
          </button>
        </div>
      </Modal>

      {/* Edit Connection Permissions Modal (SQEM-064) */}
      <Modal open={!!editingKey} onClose={() => setEditingKey(null)} size="sm" className="p-6">
        <h3 className="font-display text-xl font-semibold text-ink-strong mb-1">{m.stk_edit_title()}</h3>
        <p className="text-sm font-mono text-ink-muted mb-5 truncate">{editingKey?.key_prefix}</p>
        <label htmlFor="settings-name" className="block text-xs font-bold text-ink-muted uppercase tracking-wider mb-2">{m.stk_name()}</label>
        <Input id="settings-name"
          type="text"
          value={editKeyName}
          onChange={e => setEditKeyName(e.target.value)}
          placeholder={m.stk_name_placeholder()}
          className="mb-5"
        />
        <ApiKeyScopeFields value={editKeyScope} onChange={setEditKeyScope} canWrite={canWriteContent} />
        <div className="flex gap-2 mt-6">
          <button onClick={() => setEditingKey(null)} className="flex-1 py-2.5 text-ink bg-surface-sunken rounded-xl hover:bg-line-strong text-xs font-bold transition-colors">{m.pb_cancel()}</button>
          <button
            onClick={handleSaveKeyScope}
            disabled={isSavingScope || !editKeyName.trim()}
            className="flex-1 py-2.5 bg-accent-strong hover:opacity-90 text-white rounded-xl text-xs font-bold transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
          >
            {isSavingScope ? <><Loader2 className="w-3.5 h-3.5 animate-spin" /> {m.stk_saving()}</> : m.stk_save_changes()}
          </button>
        </div>
      </Modal>

      {/* New Key — Show Once Modal */}
      <Modal open={!!generatedKeyValue} onClose={() => { setGeneratedKeyValue(null); setKeyCopied(false); }} size="sm" className="p-6">
        <h3 className="font-display text-xl font-semibold text-ink-strong mb-2">{m.stk_copy_title()}</h3>
        <p className="text-sm text-ink-muted mb-4">{m.stk_copy_desc()}</p>
        <div className="flex items-center gap-2 p-3 bg-surface-sunken border border-line-strong rounded-xl mb-5">
          <code className="text-xs font-mono text-ink flex-1 break-all">{generatedKeyValue}</code>
          <button
            onClick={() => { navigator.clipboard.writeText(generatedKeyValue || ''); setKeyCopied(true); }}
            className="shrink-0 p-1.5 text-ink-subtle hover:text-accent transition-colors"
            title={m.mcp_copy()}
          >
            {keyCopied ? <Check className="w-4 h-4 text-success" /> : <Copy className="w-4 h-4" />}
          </button>
        </div>
        <button
          onClick={() => { setGeneratedKeyValue(null); setKeyCopied(false); }}
          className="w-full py-2.5 bg-ink-strong text-surface-raised rounded-xl text-xs font-bold transition-colors hover:opacity-90"
        >
          {m.stk_saved_key()}
        </button>
      </Modal>

      <ConfirmModal
        open={!!confirmDialog}
        title={confirmDialog?.title ?? ''}
        confirmLabel={confirmDialog?.confirmLabel}
        confirmText={confirmDialog?.confirmText}
        onClose={() => setConfirmDialog(null)}
        onConfirm={() => { confirmDialog?.onConfirm(); setConfirmDialog(null); }}
      >
        <p>{confirmDialog?.message}</p>
      </ConfirmModal>

      {/* SQEM-539 — a tab change with an unsaved card. Same words as the editor's leave guard. */}
      <ConfirmModal
        open={pendingTab !== null}
        title={m.st_unsaved_title()}
        confirmLabel={m.ed_discard()}
        cancelLabel={m.pe_keep_editing()}
        onClose={() => setPendingTab(null)}
        onConfirm={() => { discardDrafts(); if (pendingTab) setActiveTab(pendingTab); setPendingTab(null); }}
      >
        <p>{m.st_unsaved_body()}</p>
      </ConfirmModal>
    </div>
  );
};

export default Settings;

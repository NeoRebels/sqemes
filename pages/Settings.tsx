import React, { useState, useEffect, useRef } from 'react';
import { useUI, useWorkspace, usePrompts } from '../store';
import { can } from '../lib/permissions';
import { useLocation, useNavigate } from 'react-router-dom';
import { PLANS, TRIAL_DAYS } from '../constants';
import { hasActiveSubscription, isTrialing } from '../lib/subscription';
import { IS_SELF_HOSTED } from '../lib/env';
import { UserRole } from '../types';
import { BrandProfileForm, brandFormFromProfile, type BrandFormValue } from '../components/BrandProfileForm';
import { supabase } from '../lib/supabase';
import { saveApiKey, deleteApiKey, getApiKeyStatus } from '../lib/api/apiKeys';
import { ProviderIcon } from '../components/ProviderIcon';
import McpIcon from '../components/McpIcon';
import Card from '../components/ui/Card';
import Modal from '../components/ui/Modal';
import Button from '../components/ui/Button';
import AboutSection from '../components/AboutSection';
import {
  ApiKeyScopeFields,
  DEFAULT_KEY_SCOPE,
  scopeArrayFromValue,
  expiresAtFromValue,
  valueFromKey,
  type KeyScopeValue,
} from '../components/ApiKeyScopeFields';
import { 
  CreditCard,
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
  MoreHorizontal,
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
  ChevronUp,
  SlidersHorizontal,
  Sparkles,
} from 'lucide-react';

type TabId = 'general' | 'brand' | 'team' | 'plans' | 'api' | 'profile';

const MASKED_KEY_RE = /(?:\u2022){4,}|^\*{4,}$/;

const isPlaceholderKey = (value: string) => {
  const trimmed = value.trim();
  if (!trimmed) return false;
  return MASKED_KEY_RE.test(trimmed) || /enter new key to replace/i.test(trimmed);
};

const copyToClipboard = async (text: string): Promise<boolean> => {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    try {
      const el = document.createElement('textarea');
      el.value = text;
      el.style.position = 'fixed';
      el.style.opacity = '0';
      document.body.appendChild(el);
      el.select();
      const ok = document.execCommand('copy');
      document.body.removeChild(el);
      return ok;
    } catch {
      return false;
    }
  }
};

const McpServerCard = ({ locked, onUpgrade }: { locked: boolean; onUpgrade?: () => void }) => {
  const mcpUrl = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/mcp-server`;
  const snippet = `{\n  "mcpServers": {\n    "sqemes": {\n      "url": "${mcpUrl}",\n      "headers": {\n        "Authorization": "Bearer sqm_live_YOUR_KEY"\n      }\n    }\n  }\n}`;
  const [mcpUrlCopied, setMcpUrlCopied] = useState(false);
  const [snippetCopied, setSnippetCopied] = useState(false);
  return (
    <Card className="p-6 md:p-8 relative overflow-hidden">
      <div className="mb-6">
        <h2 className="text-lg font-bold text-slate-900 dark:text-slate-100 flex items-center gap-2">
          <McpIcon className="w-5 h-5 text-violet-500" />
          MCP Server
        </h2>
        <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">
          Connect any MCP-compatible AI client (Claude Desktop, Cursor) to your full template library — prompts, skills, and assistants.
        </p>
      </div>
      {locked ? (
        <div className="flex flex-col items-center justify-center py-8 text-center gap-3">
          <div className="w-12 h-12 rounded-full bg-slate-100 dark:bg-slate-700 flex items-center justify-center">
            <Lock className="w-5 h-5 text-slate-400 dark:text-slate-500" />
          </div>
          <div>
            <p className="text-sm font-semibold text-slate-700 dark:text-slate-300">MCP access requires Team or Business</p>
            <p className="text-xs text-slate-400 dark:text-slate-500 mt-1">Upgrade your plan to connect Claude Desktop, Cursor, and other MCP clients.</p>
          </div>
          <button
            onClick={onUpgrade}
            className="inline-flex items-center gap-1.5 px-4 py-2 bg-violet-600 hover:bg-violet-700 text-white rounded-xl text-sm font-bold transition-all shadow-lg shadow-violet-200 dark:shadow-none"
          >
            Upgrade plan
          </button>
        </div>
      ) : (
        <div className="space-y-4">
          <div>
            <p className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-1.5">Endpoint URL</p>
            <div className="flex items-center gap-2 bg-slate-50 dark:bg-slate-700/50 border border-slate-200 dark:border-slate-600 rounded-xl px-3 py-2.5 overflow-hidden">
              <span className="text-xs font-mono text-slate-600 dark:text-slate-300 truncate flex-1 min-w-0">{mcpUrl}</span>
              <button
                type="button"
                onClick={async () => { await copyToClipboard(mcpUrl); setMcpUrlCopied(true); setTimeout(() => setMcpUrlCopied(false), 2000); }}
                className="shrink-0 text-slate-400 hover:text-violet-500 transition-colors"
                title="Copy URL"
              >
                {mcpUrlCopied ? <Check className="w-3.5 h-3.5 text-emerald-500" /> : <Copy className="w-3.5 h-3.5" />}
              </button>
            </div>
          </div>
          <div>
            <p className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-1.5">Client Config (Claude Desktop / Cursor)</p>
            <div className="relative bg-slate-900 dark:bg-slate-950 rounded-xl p-4 overflow-hidden">
              <pre className="text-xs font-mono text-slate-300 overflow-x-auto whitespace-pre">{snippet}</pre>
              <button
                type="button"
                onClick={async () => { await copyToClipboard(snippet); setSnippetCopied(true); setTimeout(() => setSnippetCopied(false), 2000); }}
                className="absolute top-3 right-3 p-1.5 text-slate-500 hover:text-slate-200 transition-colors"
                title="Copy snippet"
              >
                {snippetCopied ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
              </button>
            </div>
            <p className="text-xs text-slate-400 dark:text-slate-500 mt-2">Replace <code className="font-mono text-xs bg-slate-100 dark:bg-slate-700 px-1 py-0.5 rounded">sqm_live_YOUR_KEY</code> with one of your API keys above.</p>
          </div>
        </div>
      )}
    </Card>
  );
};

const Settings = () => {
  const { workspace, updateWorkspace, setWorkspaceManaged, currentUser, updateUser,
    addMember, removeMember, updateMemberRole, pendingInvitations, fetchInvitations,
    cancelInvitation, resendInvitation, deleteWorkspace, leaveWorkspace, deleteAccount,
    isSqemesAdmin } = useWorkspace();
  const { showToast } = useUI();
  const { prompts } = usePrompts();
  
  const location = useLocation();
  const navigate = useNavigate();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [activeTab, setActiveTab] = useState<TabId>(!can(currentUser, workspace, 'settings:general') ? 'profile' : 'general');
  const [billingCycle, setBillingCycle] = useState<'monthly' | 'yearly'>(workspace.billingCycle ?? 'yearly');
  const [checkoutLoadingTier, setCheckoutLoadingTier] = useState<string | null>(null);
  const [isPortalLoading, setIsPortalLoading] = useState(false);
  
  // LLM API Keys State
  const [apiKeys, setApiKeys] = useState<Record<string, string>>({});
  const [newOrModelId, setNewOrModelId] = useState(''); // OpenRouter "add custom model id" repeater input

  // Public API Keys State
  type SqemesApiKey = { id: string; name: string; key_prefix: string; created_at: string; last_used_at: string | null; scopes: string[] | null; expires_at: string | null; connection_expires_at: string | null; is_oauth: boolean };
  const [sqemesApiKeys, setSqemesApiKeys] = useState<SqemesApiKey[]>([]);
  const [sqemesApiKeysLoaded, setSqemesApiKeysLoaded] = useState(false);
  const [showGenerateKeyModal, setShowGenerateKeyModal] = useState(false);
  const [newKeyName, setNewKeyName] = useState('');
  const [newKeyScope, setNewKeyScope] = useState<KeyScopeValue>(DEFAULT_KEY_SCOPE);
  const [isGeneratingKey, setIsGeneratingKey] = useState(false);
  const [generatedKeyValue, setGeneratedKeyValue] = useState<string | null>(null);
  const [deletingKeyId, setDeletingKeyId] = useState<string | null>(null);
  const [keyCopied, setKeyCopied] = useState(false);
  // Editing scope/expiry of an existing connection (no re-issue).
  const [editingKey, setEditingKey] = useState<SqemesApiKey | null>(null);
  const [editKeyName, setEditKeyName] = useState('');
  const [editKeyScope, setEditKeyScope] = useState<KeyScopeValue>(DEFAULT_KEY_SCOPE);
  const [isSavingScope, setIsSavingScope] = useState(false);

  const loadSqemesApiKeys = async () => {
    const { data } = await supabase
      .from('sqemes_api_keys')
      .select('id, name, key_prefix, created_at, last_used_at, scopes, expires_at, connection_expires_at, is_oauth')
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

      const { error } = await supabase.from('sqemes_api_keys').insert({
        workspace_id: workspace.id,
        name: newKeyName.trim(),
        key_hash: keyHash,
        key_prefix: keyPrefix,
        scopes: scopeArrayFromValue(newKeyScope),
        expires_at: expiresAtFromValue(newKeyScope),
      });

      if (error) throw error;

      setGeneratedKeyValue(key);
      setShowGenerateKeyModal(false);
      setNewKeyName('');
      setNewKeyScope(DEFAULT_KEY_SCOPE);
      await loadSqemesApiKeys();
    } catch (err: any) {
      showToast(err.message || 'Failed to generate key', 'error');
    } finally {
      setIsGeneratingKey(false);
    }
  };

  const handleDeleteApiKey = async (id: string) => {
    setDeletingKeyId(id);
    const { error } = await supabase.from('sqemes_api_keys').delete().eq('id', id);
    if (error) {
      showToast('Failed to delete key', 'error');
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
      showToast('Name cannot be empty', 'error');
      return;
    }
    setIsSavingScope(true);
    // For OAuth connections, expiry is the connection lifetime carried by the refresh token
    // (managed by the OAuth flow), not editable here — only name + scopes update in place.
    const updates: Record<string, unknown> = {
      name: trimmedName,
      scopes: scopeArrayFromValue(editKeyScope),
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
      showToast(error.message || 'Failed to update connection', 'error');
    } else {
      showToast('Connection updated', 'success');
      setEditingKey(null);
      await loadSqemesApiKeys();
    }
    setIsSavingScope(false);
  };


  const copyWithFeedback = (text: string, setter: (id: string | null) => void, id: string) => {
    navigator.clipboard.writeText(text);
    setter(id);
    setTimeout(() => setter(null), 2000);
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
        tone: brandForm.tone,
        useCase: brandForm.useCase.trim(),
        website: brandForm.website.trim(),
        updatedAt: new Date().toISOString(),
      },
    });
    setBpDirty(false);
  };

  // Buffered profile fields (only saved on button click)
  const [profileName, setProfileName] = useState(currentUser.name);
  const [profileEmail, setProfileEmail] = useState(currentUser.email);
  const [profileAvatar, setProfileAvatar] = useState(currentUser.avatar);
  const [profileDirty, setProfileDirty] = useState(false);

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
  } | null>(null);

  // Profile State
  const [passwords, setPasswords] = useState({ new: '', confirm: '' });

  // Plan Limits
  const currentPlan = PLANS[workspace.plan];
  const hasActiveSub = hasActiveSubscription(workspace);
  const memberLimit = currentPlan.users;
  const memberCount = workspace.members.length;
  // SQEM-119 — self-host has no subscription model: unlimited seats + all features (like managed).
  const isLimitReached = !workspace.isManaged && !IS_SELF_HOSTED && memberCount >= memberLimit;
  const hasMcpAccess = workspace.isManaged || IS_SELF_HOSTED || currentPlan.mcpAccess;

  const tabs: { id: TabId; label: string; icon: any }[] = [
    { id: 'general', label: 'General', icon: Building },
    { id: 'brand', label: 'Brand', icon: Sparkles },
    { id: 'team', label: 'Team Members', icon: Users },
    { id: 'plans', label: 'Plans & Billing', icon: CreditCard },
    { id: 'api', label: 'Integrations', icon: Key },
    { id: 'profile', label: 'My Profile', icon: User },
  ];

  const visibleTabs = tabs.filter(tab => {
    if (IS_SELF_HOSTED && tab.id === 'plans') return false; // SQEM-119 — no billing on self-host
    if (!can(currentUser, workspace, 'settings:general')) return tab.id === 'profile';
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
      if (activeTab !== 'profile') setActiveTab('profile');
      return;
    }

    // Redirect non-admins away from plans if they somehow land on it
    if (!can(currentUser, workspace, 'plans:manage') && activeTab === 'plans') {
      setActiveTab('general');
      return;
    }

    if (location.state && (location.state as any).initialTab) {
      const requestedTab = (location.state as any).initialTab;
      if (!can(currentUser, workspace, 'plans:manage') && requestedTab === 'plans') {
        if (activeTab !== 'general') setActiveTab('general');
      } else {
        if (activeTab !== requestedTab) setActiveTab(requestedTab);
      }
      return;
    }

    // Deep-link via URL query (e.g. opened in a new tab): ?tab=plans
    const urlTab = new URLSearchParams(location.search).get('tab');
    if (urlTab && ['general', 'brand', 'team', 'plans', 'api', 'profile'].includes(urlTab)) {
      if (!can(currentUser, workspace, 'plans:manage') && urlTab === 'plans') {
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
      const { keys: status, fundedAvailable } = await getApiKeyStatus(workspace.id);
      const updatedKeys: Record<string, string> = {};
      for (const [provider, configured] of Object.entries(status)) {
        if (configured) updatedKeys[provider] = '••••••••';
      }
      updateWorkspace({ apiKeys: updatedKeys, fundedAvailable });
      setApiKeys(prev => { const next = { ...prev }; delete next[providerId]; return next; });
      showToast('Key removed', 'success');
    } catch (err: any) {
      showToast(err.message || 'Failed to remove key', 'error');
    }
  };

  const handleSaveKeys = async () => {
    try {
      const entries = Object.entries(apiKeys)
        .map(([provider, value]) => [provider, value.trim()] as const)
        .filter(([_, value]) => value.length > 0);

      if (entries.length === 0) {
        showToast('Enter at least one new key before saving.', 'info');
        return;
      }

      for (const [provider, key] of entries) {
        if (isPlaceholderKey(key)) {
          throw new Error(`Invalid key for ${provider}. Paste the original provider key.`);
        }
        await saveApiKey(workspace.id, provider, key);
      }

      // Refresh API key status so the model selector updates
      const { keys: status, fundedAvailable } = await getApiKeyStatus(workspace.id);
      const updatedKeys: Record<string, string> = {};
      for (const [provider, configured] of Object.entries(status)) {
        if (configured) updatedKeys[provider] = '••••••••';
      }
      updateWorkspace({ apiKeys: updatedKeys, fundedAvailable });

      showToast('API Configuration updated successfully', 'success');
      // Clear the local key inputs after saving (keys are now server-side)
      setApiKeys({});
    } catch (err: any) {
      showToast(err.message || 'Failed to save API keys', 'error');
    }
  };

  const handleUpgrade = async (tier: string) => {
    setCheckoutLoadingTier(tier);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) throw new Error('Not authenticated');
      const FUNCTIONS_URL = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1`;
      const res = await fetch(`${FUNCTIONS_URL}/create-checkout-session`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${session.access_token}` },
        body: JSON.stringify({ workspaceId: workspace.id, plan: tier, billingCycle }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to create checkout session');
      window.location.href = data.url;
    } catch (err: any) {
      showToast(err.message || 'Failed to start checkout', 'error');
      setCheckoutLoadingTier(null);
    }
  };

  const handleManageSubscription = async () => {
    setIsPortalLoading(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) throw new Error('Not authenticated');
      const FUNCTIONS_URL = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1`;
      const res = await fetch(`${FUNCTIONS_URL}/create-portal-session`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${session.access_token}` },
        body: JSON.stringify({ workspaceId: workspace.id }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to open billing portal');
      window.location.href = data.url;
    } catch (err: any) {
      showToast(err.message || 'Failed to open billing portal', 'error');
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
    if (!id.includes('/')) { showToast('OpenRouter model ids look like "vendor/model".', 'error'); return; }
    if (!workspace.openrouterModels.includes(id)) {
      updateWorkspace({ openrouterModels: [...workspace.openrouterModels, id] });
    }
    setNewOrModelId('');
  };

  const handleInvite = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!inviteEmail) {
      showToast("Email address is required", "error");
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
      showToast("Passwords do not match", "error");
      return;
    }

    // Save buffered profile changes
    const updates: Partial<{ name: string; email: string; avatar: string }> = {};
    if (profileName !== currentUser.name) updates.name = profileName;
    if (profileEmail !== currentUser.email) updates.email = profileEmail;
    if (profileAvatar !== currentUser.avatar) updates.avatar = profileAvatar;

    if (Object.keys(updates).length > 0) {
      await updateUser(updates);
    }

    if (passwords.new) {
      await supabase.auth.updateUser({ password: passwords.new });
      setPasswords({ new: '', confirm: '' });
    }

    setProfileDirty(false);
    showToast("Profile updated successfully", "success");
  };

  const handleLogout = () => {
    setConfirmDialog({
      title: 'Sign out',
      message: 'Are you sure you want to sign out?',
      onConfirm: async () => {
        await supabase.auth.signOut();
        showToast('Signed out successfully', 'info');
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

  const handleRandomizeAvatar = () => {
    const randomSeed = Math.random().toString(36).substring(7);
    const newAvatar = `https://api.dicebear.com/7.x/notionists/svg?seed=${randomSeed}`;
    setProfileAvatar(newAvatar);
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
      <div className="mb-8 md:mb-10">
        <h1 className="text-2xl md:text-3xl font-bold text-slate-900 dark:text-slate-100 tracking-tight">Workspace Settings</h1>
        <p className="text-slate-500 dark:text-slate-400 mt-2">Manage your workspace preferences and team</p>
      </div>

      <div className="flex flex-col lg:flex-row gap-8">
        {/* Sidebar Navigation */}
        <div className="lg:w-64 shrink-0">
          <Card overflow className="p-2 flex lg:block overflow-x-auto lg:overflow-visible">
            {visibleTabs.map(tab => (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`flex-1 lg:w-full flex items-center gap-3 px-4 py-3 rounded-xl text-sm font-medium transition-all duration-200 whitespace-nowrap ${
                  activeTab === tab.id
                    ? 'bg-brand-50 dark:bg-brand-900/20 text-brand-700 dark:text-brand-400 shadow-sm'
                    : 'text-slate-500 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-700 hover:text-slate-900 dark:hover:text-slate-100'
                }`}
              >
                <tab.icon className={`w-5 h-5 ${activeTab === tab.id ? 'text-brand-600' : 'text-slate-400'}`} />
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
                <h2 className="text-lg font-bold text-slate-900 dark:text-slate-100 mb-6">Workspace Details</h2>
                <div className="space-y-6">
                  {can(currentUser, workspace, 'team:manage') && (
                    <div>
                      <label className="block text-xs font-bold text-slate-400 uppercase tracking-wider mb-2">Workspace Name</label>
                      <div className="flex gap-2">
                        <input
                          className="flex-1 p-3 bg-white dark:bg-slate-700 border border-slate-200 dark:border-slate-600 text-slate-900 dark:text-slate-100 placeholder:text-slate-400 dark:placeholder:text-slate-500 rounded-xl text-sm outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-500/20 transition-all"
                          value={wsName}
                          onChange={e => { setWsName(e.target.value); setWsNameDirty(true); }}
                        />
                        <button
                          onClick={() => { updateWorkspace({ name: wsName }); setWsNameDirty(false); }}
                          disabled={!wsNameDirty || !wsName.trim()}
                          className="px-5 py-3 bg-brand-600 text-white rounded-xl text-sm font-bold hover:bg-brand-700 transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
                        >
                          <Save className="w-4 h-4" /> Save
                        </button>
                      </div>
                    </div>
                  )}
                  {isSqemesAdmin && (
                    <div className="flex items-center justify-between p-4 bg-violet-50 dark:bg-violet-900/20 border border-violet-200 dark:border-violet-800/50 rounded-xl">
                      <div className="flex items-center gap-3">
                        <Shield className="w-5 h-5 text-violet-600 dark:text-violet-400" />
                        <div>
                          <p className="text-sm font-bold text-violet-900 dark:text-violet-300">Managed Workspace</p>
                          <p className="text-xs text-violet-600 dark:text-violet-400 mt-0.5">Unlimited seats, no plan restrictions</p>
                        </div>
                      </div>
                      <button
                        onClick={() => setWorkspaceManaged(workspace.id, !workspace.isManaged)}
                        className={`relative w-12 h-6 rounded-full transition-colors duration-200 focus:outline-none ${workspace.isManaged ? 'bg-violet-600' : 'bg-slate-200 dark:bg-slate-600'}`}
                        title={workspace.isManaged ? 'Disable managed mode' : 'Enable managed mode'}
                      >
                        <span className={`absolute top-1 left-1 w-4 h-4 bg-white rounded-full shadow transition-transform duration-200 ${workspace.isManaged ? 'translate-x-6' : 'translate-x-0'}`} />
                      </button>
                    </div>
                  )}

                  <div>
                    <label className="block text-xs font-bold text-slate-400 uppercase tracking-wider mb-2">Workspace Tags</label>
                    <div className="flex gap-2 mb-3">
                      <input 
                        className="flex-1 p-3 bg-white dark:bg-slate-700 border border-slate-200 dark:border-slate-600 text-slate-900 dark:text-slate-100 placeholder:text-slate-400 dark:placeholder:text-slate-500 rounded-xl text-sm outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-500/20 transition-all" 
                        placeholder="Add a tag..."
                        value={newTag}
                        onChange={e => setNewTag(e.target.value)}
                        onKeyDown={e => e.key === 'Enter' && handleAddTag()}
                      />
                      <button onClick={handleAddTag} className="px-4 bg-slate-900 dark:bg-slate-700 text-white rounded-xl hover:bg-slate-800 dark:hover:bg-slate-600 transition-colors">
                        <Plus className="w-5 h-5" />
                      </button>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      {workspace.tags.map(tag => (
                        <span key={tag} className="inline-flex items-center gap-1 px-3 py-1 bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-300 rounded-lg text-sm font-medium">
                          {tag}
                          <button onClick={() => removeTag(tag)} className="p-0.5 hover:text-red-500 rounded-full transition-colors"><X className="w-3 h-3" /></button>
                        </span>
                      ))}
                    </div>
                  </div>
                </div>
              </Card>

              <Card className="p-8">
                <h2 className="text-lg font-bold text-slate-900 dark:text-slate-100 flex items-center gap-2 mb-6">
                  <ShieldAlert className="w-5 h-5 text-red-500" />
                  Content Governance
                </h2>
                <div className="mb-6">
                  <label className="block text-xs font-bold text-slate-400 uppercase tracking-wider mb-2">Blacklisted Terms</label>
                  <div className="flex gap-3 max-w-xl mb-4">
                     <input
                       className="flex-1 p-3 bg-white dark:bg-slate-700 border border-slate-200 dark:border-slate-600 text-slate-900 dark:text-slate-100 placeholder:text-slate-400 dark:placeholder:text-slate-500 rounded-xl text-sm outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-500/20 transition-all"
                       placeholder="e.g. secret_project"
                       value={blacklistedTerm}
                       onChange={e => setBlacklistedTerm(e.target.value)}
                       onKeyDown={e => e.key === 'Enter' && addTerm()}
                     />
                     <button onClick={addTerm} className="px-6 bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-600 rounded-xl text-sm font-bold transition-colors">Add</button>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {workspace.blacklistedTerms.map(term => (
                      <span key={term} className="bg-red-50 text-red-600 border border-red-100 px-3 py-1.5 rounded-lg text-xs font-bold flex items-center gap-2">
                        {term}
                        <button onClick={() => removeTerm(term)} className="hover:text-red-800"><X className="w-3 h-3" /></button>
                      </span>
                    ))}
                    {workspace.blacklistedTerms.length === 0 && <span className="text-sm text-slate-400 italic">No restricted terms added.</span>}
                  </div>
                </div>

                <div className="border-t border-slate-100 pt-6 space-y-4">
                  <label className="block text-xs font-bold text-slate-400 uppercase tracking-wider mb-4">PII Blocking</label>
                  {([
                    { key: 'blockEmails', label: 'Email Addresses', description: 'Block submissions containing email addresses' },
                    { key: 'blockIban',   label: 'IBAN Numbers',    description: 'Block submissions containing IBAN bank account numbers' },
                    { key: 'blockPhone',  label: 'Telephone Numbers', description: 'Block submissions containing phone numbers' },
                  ] as const).map(({ key, label, description }) => (
                    <div key={key} className="flex items-center justify-between max-w-xl">
                      <div>
                        <p className="text-sm font-semibold text-slate-700 dark:text-slate-300">{label}</p>
                        <p className="text-xs text-slate-400 dark:text-slate-500 mt-0.5">{description}</p>
                      </div>
                      <button
                        role="switch"
                        aria-checked={workspace[key]}
                        onClick={() => updateWorkspace({ [key]: !workspace[key] })}
                        className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 focus:outline-none focus:ring-2 focus:ring-brand-500 focus:ring-offset-2 ${workspace[key] ? 'bg-brand-600' : 'bg-slate-200 dark:bg-slate-600'}`}
                      >
                        <span className={`inline-block h-5 w-5 rounded-full bg-white shadow-md transform transition-transform duration-200 ${workspace[key] ? 'translate-x-5' : 'translate-x-0'}`} />
                      </button>
                    </div>
                  ))}
                </div>
              </Card>

              {/* Self-host only — version + update notice (SQEM-118); renders nothing on Cloud */}
              <AboutSection />

              {/* SQEM-121 — self-host is a single-instance deployment: no deleting the workspace */}
              {!IS_SELF_HOSTED && can(currentUser, workspace, 'team:manage') && (
                <div className="bg-red-50 dark:bg-red-900/20 rounded-2xl border border-red-100 dark:border-red-800/50 p-8">
                  <h2 className="text-lg font-bold text-red-900 dark:text-red-300 mb-2">Danger Zone</h2>
                  <p className="text-sm text-red-600 dark:text-red-400 mb-6">Permanently delete this workspace and all associated data. This action cannot be undone.</p>
                  <button
                    onClick={() => setConfirmDialog({
                      title: `Delete workspace "${workspace.name}"?`,
                      message: 'This will permanently delete all prompts, history, results, and members. This action cannot be undone.',
                      onConfirm: async () => { await deleteWorkspace(workspace.id); navigate('/'); },
                    })}
                    className="px-4 py-2 bg-white dark:bg-slate-800 border border-red-200 dark:border-red-800/50 text-red-600 dark:text-red-400 font-bold text-sm rounded-xl hover:bg-red-600 dark:hover:bg-red-900/30 hover:text-white dark:hover:text-red-300 hover:border-red-600 dark:hover:border-red-700 transition-all shadow-sm"
                  >
                    Delete Workspace
                  </button>
                </div>
              )}
            </div>
          )}

          {/* --- Brand Tab --- */}
          {activeTab === 'brand' && can(currentUser, workspace, 'settings:general') && (
            <div className="space-y-6 animate-fade-in">
              <Card className="p-6 md:p-8">
                <div className="flex items-start justify-between mb-6 gap-4">
                  <div>
                    <h2 className="text-lg font-bold text-slate-900 dark:text-slate-100">Brand Profile</h2>
                    <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">
                      Captured during onboarding. Used to tailor AI generation and to adapt marketplace templates to your brand.
                    </p>
                  </div>
                  <button
                    onClick={handleSaveBrand}
                    disabled={!bpDirty}
                    className="shrink-0 px-5 py-3 bg-brand-600 text-white rounded-xl text-sm font-bold hover:bg-brand-700 transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
                  >
                    <Save className="w-4 h-4" /> Save
                  </button>
                </div>
                <BrandProfileForm
                  value={brandForm}
                  onChange={patch => { setBrandForm(f => ({ ...f, ...patch })); setBpDirty(true); }}
                />
              </Card>
            </div>
          )}

          {/* --- Team Tab --- */}
          {activeTab === 'team' && can(currentUser, workspace, 'settings:general') && (<>
            <Card overflow className="animate-fade-in">
              <div className="p-6 md:p-8 border-b border-slate-50 flex flex-col md:flex-row md:items-center justify-between gap-4">
                <div>
                  <h2 className="text-lg font-bold text-slate-900 dark:text-slate-100">Team Members</h2>
                  <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">
                    {memberCount} active members{(workspace.isManaged || IS_SELF_HOSTED) ? ' · Unlimited seats' : ` from ${memberLimit}`}
                  </p>
                </div>
                {can(currentUser, workspace, 'team:manage') && (isLimitReached ? (
                   <button
                     onClick={() => setActiveTab('plans')}
                     className="flex items-center gap-2 bg-amber-500 hover:bg-amber-600 text-white px-4 py-2 rounded-xl font-medium text-sm transition-all shadow-lg shadow-amber-200 dark:shadow-none w-full md:w-auto justify-center"
                   >
                     <Zap className="w-4 h-4" /> Upgrade to Invite
                   </button>
                ) : (
                   <Button
                     onClick={() => setIsInviteModalOpen(true)}
                     className="shadow-lg shadow-brand-200 w-full md:w-auto justify-center"
                   >
                     <Mail className="w-4 h-4" /> Invite Member
                   </Button>
                ))}
              </div>
              
              <div className="overflow-x-auto">
                <table className="w-full text-left text-sm min-w-[600px]">
                  <thead className="bg-slate-50 dark:bg-slate-700/50 text-slate-500 dark:text-slate-400 font-medium border-b border-slate-100 dark:border-slate-700">
                    <tr>
                      <th className="px-6 py-4 w-1/2">User</th>
                      <th className="px-6 py-4">Role</th>
                      {can(currentUser, workspace, 'team:manage') && <th className="px-6 py-4 text-right">Actions</th>}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-50 dark:divide-slate-700">
                    {workspace.members.map(member => (
                      <tr key={member.id} className="hover:bg-slate-50/50 dark:hover:bg-slate-700/50 transition-colors">
                        <td className="px-6 py-4">
                          <div className="flex items-center gap-3">
                            <img src={member.avatar} alt={member.name} className="w-10 h-10 rounded-full object-cover bg-slate-200" />
                            <div>
                              <p className="font-bold text-slate-900 dark:text-slate-100">{member.name}</p>
                              <p className="text-slate-500 dark:text-slate-400">{member.email}</p>
                            </div>
                          </div>
                        </td>
                        <td className="px-6 py-4">
                          {can(currentUser, workspace, 'team:manage') ? (
                            <select
                              className="bg-white dark:bg-slate-700 border border-slate-200 dark:border-slate-600 text-slate-700 dark:text-slate-200 text-xs font-bold uppercase tracking-wider rounded-lg py-1.5 px-3 outline-none focus:border-brand-500 cursor-pointer hover:border-slate-300 dark:hover:border-slate-500 transition-colors"
                              value={member.role}
                              onChange={(e) => updateMemberRole(member.id, e.target.value as UserRole)}
                              disabled={member.id === currentUser.id}
                            >
                              <option value="admin">Admin</option>
                              <option value="editor">Editor</option>
                              <option value="member">Member</option>
                            </select>
                          ) : (
                            <span className="text-xs font-bold uppercase tracking-wider text-slate-500 bg-slate-100 px-2.5 py-1 rounded-lg">
                              {member.role}
                            </span>
                          )}
                        </td>
                        <td className="px-6 py-4 text-right">
                          {can(currentUser, workspace, 'team:manage') && member.id !== currentUser.id && (
                            <button
                              onClick={() => setConfirmDialog({
                                title: `Remove ${member.name}?`,
                                message: `${member.name} will lose access to this workspace immediately.`,
                                onConfirm: () => removeMember(member.id),
                              })}
                              className="text-slate-400 hover:text-red-600 p-2 hover:bg-red-50 rounded-lg transition-colors"
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
                <div className="p-6 md:p-8 border-b border-slate-50">
                  <h2 className="text-lg font-bold text-slate-900 dark:text-slate-100 flex items-center gap-2">
                    <Clock className="w-5 h-5 text-amber-500" />
                    Pending Invitations ({pendingInvitations.length})
                  </h2>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-sm min-w-[600px]">
                    <thead className="bg-slate-50 dark:bg-slate-700/50 text-slate-500 dark:text-slate-400 font-medium border-b border-slate-100 dark:border-slate-700">
                      <tr>
                        <th className="px-6 py-4 w-1/2">Email</th>
                        <th className="px-6 py-4">Role</th>
                        <th className="px-6 py-4">Expires</th>
                        <th className="px-6 py-4 text-right">Actions</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-50 dark:divide-slate-700">
                      {pendingInvitations.map(inv => (
                        <tr key={inv.id} className="hover:bg-slate-50/50 dark:hover:bg-slate-700/50 transition-colors">
                          <td className="px-6 py-4">
                            <div className="flex items-center gap-3">
                              <div className="w-10 h-10 rounded-full bg-amber-50 flex items-center justify-center">
                                <Mail className="w-5 h-5 text-amber-500" />
                              </div>
                              <p className="font-bold text-slate-900 dark:text-slate-100">{inv.email}</p>
                            </div>
                          </td>
                          <td className="px-6 py-4">
                            <span className="text-xs font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400 bg-slate-100 dark:bg-slate-700 px-2.5 py-1 rounded-lg">
                              {inv.role}
                            </span>
                          </td>
                          <td className="px-6 py-4 text-slate-500 dark:text-slate-400 text-sm">
                            {new Date(inv.expiresAt).toLocaleDateString()}
                          </td>
                          <td className="px-6 py-4 text-right">
                            {can(currentUser, workspace, 'team:manage') && (
                              <div className="flex items-center justify-end gap-1">
                                <button
                                  onClick={async () => {
                                    // SQEM-112 — share the invite link directly (esp. when email delivery fails).
                                    const link = `${window.location.origin}/#/invite/${inv.token}?email=${encodeURIComponent(inv.email)}`;
                                    const ok = await copyToClipboard(link);
                                    showToast(ok ? 'Invite link copied' : 'Could not copy link', ok ? 'success' : 'error');
                                  }}
                                  className="flex items-center gap-1.5 whitespace-nowrap shrink-0 text-slate-500 hover:text-brand-600 px-2.5 py-1.5 hover:bg-brand-50 rounded-lg transition-colors text-xs font-medium"
                                  title="Copy invite link"
                                >
                                  <Copy className="w-3.5 h-3.5" />
                                  Copy link
                                </button>
                                <button
                                  onClick={async () => {
                                    setResendingIds(prev => new Set(prev).add(inv.id));
                                    await resendInvitation(inv.id);
                                    setResendingIds(prev => { const s = new Set(prev); s.delete(inv.id); return s; });
                                  }}
                                  disabled={resendingIds.has(inv.id)}
                                  className="flex items-center gap-1.5 text-slate-500 hover:text-brand-600 px-2.5 py-1.5 hover:bg-brand-50 rounded-lg transition-colors text-xs font-medium disabled:opacity-50 disabled:cursor-not-allowed"
                                  title="Resend invitation"
                                >
                                  <RotateCw className={`w-3.5 h-3.5 ${resendingIds.has(inv.id) ? 'animate-spin' : ''}`} />
                                  Resend
                                </button>
                                <button
                                  onClick={() => setConfirmDialog({
                                    title: 'Cancel invitation?',
                                    message: `The invitation for ${inv.email} will be cancelled and the link will stop working.`,
                                    onConfirm: () => cancelInvitation(inv.id),
                                  })}
                                  className="text-slate-400 hover:text-red-600 p-2 hover:bg-red-50 rounded-lg transition-colors"
                                  title="Cancel invitation"
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
                  <div className="w-16 h-16 bg-violet-100 rounded-2xl flex items-center justify-center mb-4">
                    <Shield className="w-8 h-8 text-violet-600" />
                  </div>
                  <h2 className="text-xl font-bold text-slate-900 dark:text-slate-100 mb-2">Managed Workspace</h2>
                  <p className="text-sm text-slate-500 dark:text-slate-400 max-w-sm">
                    This workspace is managed by sqemes. You have unlimited seats and full access to all features — no subscription required.
                  </p>
                  <div className="mt-6 flex gap-6 text-center">
                    <div className="bg-violet-50 dark:bg-violet-900/20 border border-violet-100 dark:border-violet-800/50 rounded-xl px-6 py-4">
                      <p className="text-2xl font-bold text-violet-700 dark:text-violet-400">∞</p>
                      <p className="text-xs text-slate-500 dark:text-slate-400 mt-1 font-medium">Team Members</p>
                    </div>
                    <div className="bg-violet-50 dark:bg-violet-900/20 border border-violet-100 dark:border-violet-800/50 rounded-xl px-6 py-4">
                      <p className="text-2xl font-bold text-violet-700 dark:text-violet-400">€0</p>
                      <p className="text-xs text-slate-500 dark:text-slate-400 mt-1 font-medium">Monthly Cost</p>
                    </div>
                  </div>
                </div>
              ) : (<>
              <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center mb-8 gap-4">
                 <div>
                    <h2 className="text-lg font-bold text-slate-900 dark:text-slate-100">Subscription Plan</h2>
                    <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">Current Plan: <span className="font-bold text-brand-600">{workspace.plan}</span></p>
                 </div>

                 {/* Only show billing cycle toggle for Solo — paid users manage billing via portal */}
                 {!hasActiveSub && (
                   <div className="flex bg-slate-100 dark:bg-slate-700 p-1 rounded-xl self-start sm:self-auto">
                      <button
                          onClick={() => setBillingCycle('monthly')}
                          className={`px-6 py-2 rounded-lg text-sm font-bold transition-all ${billingCycle === 'monthly' ? 'bg-white dark:bg-slate-800 shadow-sm text-slate-900 dark:text-slate-100' : 'text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200'}`}
                      >
                          Monthly
                      </button>
                      <button
                          onClick={() => setBillingCycle('yearly')}
                          className={`px-6 py-2 rounded-lg text-sm font-bold transition-all flex items-center gap-2 ${billingCycle === 'yearly' ? 'bg-white dark:bg-slate-800 shadow-sm text-slate-900 dark:text-slate-100' : 'text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200'}`}
                      >
                          Yearly
                          <span className="text-2xs bg-emerald-100 text-emerald-700 px-1.5 py-0.5 rounded-md uppercase tracking-wide hidden sm:inline-block">Save 20%</span>
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

                  let displayPrice = PLANS[tier].price;
                  let billingText = 'Billed monthly';

                  if (billingCycle === 'yearly') {
                    const yearlyMonthly = PLANS[tier].priceYearly;
                    displayPrice = `€${yearlyMonthly}/mo`;
                    billingText = `Billed €${yearlyMonthly * 12} yearly`;
                  }

                  const isLoading = checkoutLoadingTier === tier;

                  return (
                    <div
                      key={tier}
                      className={`relative p-6 rounded-2xl border transition-all flex flex-col ${
                        isActivePlan
                          ? 'border-brand-500 bg-brand-50 dark:bg-brand-900/20 ring-2 ring-brand-500/20 shadow-md'
                          : !canSubscribe
                            ? 'border-slate-200 dark:border-slate-700 bg-slate-50/50 dark:bg-slate-800/50 opacity-60'
                            : 'border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 hover:border-brand-300 dark:hover:border-brand-500 hover:shadow-soft-lg'
                      }`}
                    >
                      {isActivePlan && (
                        <span className="absolute top-3 right-3 text-2xs font-bold uppercase tracking-wider text-brand-700 bg-brand-100 border border-brand-200 px-2 py-0.5 rounded-full flex items-center gap-1">
                          <Check className="w-2.5 h-2.5" /> {isTrialing(workspace) ? 'Trial' : 'Active'}
                        </span>
                      )}

                      <h3 className="font-bold text-lg text-slate-900 dark:text-slate-100">{tier}</h3>
                      <p className="text-xs mt-0.5 mb-4 text-slate-500 dark:text-slate-400">{PLANS[tier].tagline}</p>

                      <div className="mb-6">
                        <p className="text-3xl font-bold text-slate-900 dark:text-slate-100">{displayPrice}</p>
                        <p className="text-xs text-slate-500 dark:text-slate-400 font-medium mt-1">{billingText}</p>
                      </div>

                      <ul className="space-y-2.5 text-sm flex-1 text-slate-600 dark:text-slate-300">
                        {PLANS[tier].features.map(feature => (
                          <li key={feature} className="flex items-center gap-2.5">
                            <Check className={`w-3.5 h-3.5 shrink-0 ${isActivePlan ? 'text-brand-500' : 'text-slate-400'}`} />
                            {feature}
                          </li>
                        ))}
                      </ul>

                      <button
                        disabled={!canSubscribe || isLoading}
                        onClick={() => canSubscribe && handleUpgrade(tier)}
                        className={`w-full mt-6 py-2.5 rounded-xl text-sm font-bold transition-colors flex items-center justify-center gap-2 ${
                          isActivePlan
                            ? 'bg-brand-600 text-white shadow-lg shadow-brand-200 dark:shadow-none cursor-default'
                            : canSubscribe
                              ? 'bg-slate-900 text-white hover:bg-slate-700'
                              : 'bg-slate-100 text-slate-400 cursor-not-allowed'
                        }`}
                      >
                        {isLoading && <Loader2 className="w-4 h-4 animate-spin" />}
                        {isActivePlan ? 'Current Plan' : canSubscribe ? (isLoading ? 'Redirecting...' : `Start ${TRIAL_DAYS}-day trial`) : 'Switch via Portal'}
                      </button>
                    </div>
                  );
                })}

                {/* SQEM-095 — Enterprise: not a Stripe plan; contact-sales card linking out. */}
                <div className="relative p-6 rounded-2xl border transition-all flex flex-col border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 hover:border-brand-300 dark:hover:border-brand-500 hover:shadow-soft-lg">
                  <h3 className="font-bold text-lg text-slate-900 dark:text-slate-100">Enterprise</h3>
                  <p className="text-xs mt-0.5 mb-4 text-slate-500 dark:text-slate-400">For organisations with custom needs</p>

                  <div className="mb-6">
                    <p className="text-3xl font-bold text-slate-900 dark:text-slate-100">Let's talk</p>
                    <p className="text-xs text-slate-500 dark:text-slate-400 font-medium mt-1">Custom pricing for your team</p>
                  </div>

                  <ul className="space-y-2.5 text-sm flex-1 text-slate-600 dark:text-slate-300">
                    {['Everything in Business', '30+ team members', 'Custom AI credit volume', 'Dedicated support & SLA', 'Custom onboarding'].map(feature => (
                      <li key={feature} className="flex items-center gap-2.5">
                        <Check className="w-3.5 h-3.5 shrink-0 text-slate-400" />
                        {feature}
                      </li>
                    ))}
                  </ul>

                  <a
                    href="https://sqemes.com/enterprise"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="w-full mt-6 py-2.5 rounded-xl text-sm font-bold transition-colors flex items-center justify-center gap-2 bg-slate-900 text-white hover:bg-slate-700"
                  >
                    Talk to us <ExternalLink className="w-4 h-4" />
                  </a>
                </div>
              </div>

              {/* Manage Subscription — shown for paid plans */}
              {hasActiveSub && !workspace.isManaged && (
                <div className="mt-6 p-5 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-2xl flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
                  <div>
                    <p className="text-sm font-bold text-slate-900 dark:text-slate-100">Manage Subscription</p>
                    <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">Change plan, update payment method, cancel, or view invoices via the Stripe billing portal.</p>
                  </div>
                  <button
                    onClick={handleManageSubscription}
                    disabled={isPortalLoading}
                    className="flex items-center gap-2 px-5 py-2.5 bg-slate-900 text-white text-sm font-bold rounded-xl hover:bg-slate-700 transition-colors whitespace-nowrap disabled:opacity-50 disabled:cursor-not-allowed shrink-0"
                  >
                    {isPortalLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <ExternalLink className="w-4 h-4" />}
                    {isPortalLoading ? 'Opening...' : 'Open Billing Portal'}
                  </button>
                </div>
              )}

              </>)}
            </Card>
          )}

          {/* --- Integrations Tab --- */}
          {activeTab === 'api' && can(currentUser, workspace, 'api-keys:manage') && (
            <div className="space-y-6 animate-fade-in">
              <Card className="p-6 md:p-8">
                <div className="flex items-center justify-between mb-6">
                  <div>
                    <h2 className="text-lg font-bold text-slate-900 dark:text-slate-100 flex items-center gap-2">
                      <Key className="w-5 h-5 text-brand-500" />
                      LLM API Configuration
                    </h2>
                    <p className="text-sm text-slate-500 mt-1">
                      Manage API keys for various providers. Keys are stored securely server-side.
                    </p>
                  </div>
                  <Button onClick={handleSaveKeys} className="px-5 py-2 shadow-lg shadow-brand-200">
                    <Save className="w-4 h-4" /> <span className="hidden sm:inline">Save Changes</span>
                  </Button>
                </div>
                
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  {PROVIDERS.map(provider => {
                    const hasExistingKey = !!workspace.apiKeys[provider.id as keyof typeof workspace.apiKeys];
                    const localValue = apiKeys[provider.id as keyof typeof apiKeys] || '';
                    return (
                    <div key={provider.id} className="relative group">
                      <label className="block text-xs font-bold text-slate-500 uppercase tracking-wider mb-2 flex items-center gap-2">
                        <ProviderIcon provider={provider.id} className="w-5 h-5" />
                        {provider.name}
                        {hasExistingKey && !localValue && (
                          <>
                            <span className="text-2xs bg-emerald-100 text-emerald-700 px-1.5 py-0.5 rounded-md font-bold">Configured</span>
                            <button
                              type="button"
                              onClick={() => setConfirmDialog({
                                title: `Remove ${provider.name} key?`,
                                message: `The saved ${provider.name} key will be deleted. You can re-enter it anytime.`,
                                onConfirm: () => handleRemoveKey(provider.id),
                              })}
                              className="ml-auto text-2xs font-bold text-slate-400 hover:text-red-600 normal-case transition-colors"
                            >
                              Remove
                            </button>
                          </>
                        )}
                      </label>
                      <div className="relative">
                         <input
                           type={provider.id === 'ollama' ? "text" : "password"}
                           value={localValue}
                           onChange={(e) => setApiKeys({...apiKeys, [provider.id]: e.target.value})}
                           placeholder={hasExistingKey ? '••••••••  (enter new key to replace)' : provider.placeholder}
                           className={`w-full p-3 border rounded-xl text-sm outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-500/20 transition-all font-mono text-slate-900 dark:text-slate-100 placeholder:text-slate-400 dark:placeholder:text-slate-500 ${hasExistingKey && !localValue ? 'border-emerald-200 dark:border-emerald-800 bg-emerald-50/30 dark:bg-emerald-900/10' : 'border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-700'}`}
                         />
                         {provider.id === 'ollama' && (
                            <div className="absolute right-3 top-1/2 -translate-y-1/2">
                               <Server className="w-4 h-4 text-slate-400" />
                            </div>
                         )}
                      </div>
                      {provider.link && (
                          <div className="mt-1.5 ml-1">
                              <a 
                                href={provider.link} 
                                target="_blank" 
                                rel="noopener noreferrer"
                                className="text-3xs text-brand-600 hover:text-brand-700 font-bold hover:underline inline-flex items-center gap-1 group/link"
                              >
                                Get API Key <ExternalLink className="w-3 h-3 transition-transform group-hover/link:-translate-y-0.5 group-hover/link:translate-x-0.5" />
                              </a>
                          </div>
                      )}
                      {provider.id === 'ollama' && (
                        <p className="text-3xs text-slate-400 mt-1.5 ml-1">
                           Enter the Base URL (e.g. http://localhost:11434)
                        </p>
                      )}
                      {provider.id === 'openrouter' && (
                        <div className="mt-3 pt-3 border-t border-slate-100 dark:border-slate-700">
                          <p className="text-2xs font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider mb-2">Custom model ids</p>
                          {workspace.openrouterModels.length > 0 && (
                            <div className="flex flex-wrap gap-1.5 mb-2">
                              {workspace.openrouterModels.map(mid => (
                                <span key={mid} className="inline-flex items-center gap-1 text-2xs font-mono px-2 py-1 bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-300 rounded-lg">
                                  {mid}
                                  <button type="button" onClick={() => updateWorkspace({ openrouterModels: workspace.openrouterModels.filter(x => x !== mid) })} className="text-slate-400 hover:text-red-500">
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
                              placeholder="vendor/model — e.g. anthropic/claude-3.7-sonnet"
                              className="flex-1 p-2 border border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-700 rounded-lg text-2xs font-mono outline-none focus:border-brand-500 text-slate-900 dark:text-slate-100 placeholder:text-slate-400"
                            />
                            <button type="button" onClick={addOrModel} className="px-3 py-2 bg-slate-900 dark:bg-slate-100 text-white dark:text-slate-900 rounded-lg text-2xs font-bold shrink-0">Add</button>
                          </div>
                          <p className="text-3xs text-slate-400 mt-1.5">
                            Adds to the model picker (needs the key above).{' '}
                            <a href="https://openrouter.ai/models" target="_blank" rel="noopener noreferrer" className="text-brand-600 hover:underline">Browse models</a>
                          </p>
                        </div>
                      )}
                    </div>
                    );
                  })}
                </div>
              </Card>

              {/* Public API Keys */}
              <Card className="p-6 md:p-8">
                <div className="flex items-center justify-between mb-6">
                  <div>
                    <h2 className="text-lg font-bold text-slate-900 dark:text-slate-100 flex items-center gap-2">
                      <Zap className="w-5 h-5 text-violet-500" />
                      Public API Keys
                    </h2>
                    <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">
                      Generate keys to access your templates via the API or MCP clients.
                    </p>
                  </div>
                  <button
                    onClick={() => { setNewKeyName(''); setNewKeyScope(DEFAULT_KEY_SCOPE); setShowGenerateKeyModal(true); }}
                    disabled={!hasMcpAccess}
                    title={!hasMcpAccess ? 'Upgrade to Team or Business to generate MCP keys' : undefined}
                    className="flex items-center gap-2 px-4 py-2 bg-violet-600 hover:bg-violet-700 text-white rounded-xl text-sm font-bold transition-all shadow-lg shadow-violet-200 dark:shadow-none disabled:opacity-50 disabled:cursor-not-allowed disabled:shadow-none"
                  >
                    <Plus className="w-4 h-4" /> Generate Key
                  </button>
                </div>

                {sqemesApiKeys.length === 0 ? (
                  <div className="text-center py-10 border-2 border-dashed border-slate-200 dark:border-slate-700 rounded-2xl">
                    <Zap className="w-8 h-8 text-slate-300 dark:text-slate-600 mx-auto mb-3" />
                    <p className="text-sm font-semibold text-slate-500 dark:text-slate-400">No API keys yet</p>
                    <p className="text-xs text-slate-400 dark:text-slate-500 mt-1">Generate a key to start using the public API.</p>
                  </div>
                ) : (
                  <div className="space-y-3">
                    {sqemesApiKeys.map(k => {
                      const scopes = k.scopes && k.scopes.length > 0 ? k.scopes : ['read', 'create', 'update', 'delete'];
                      const writeScopes = scopes.filter(s => s !== 'read');
                      // OAuth connections show the connection lifetime, not the short access-token TTL.
                      const displayExpiry = k.is_oauth ? k.connection_expires_at : k.expires_at;
                      const expired = !!displayExpiry && new Date(displayExpiry).getTime() <= Date.now();
                      return (
                      <div key={k.id} className="flex items-center justify-between gap-4 p-4 bg-slate-50 dark:bg-slate-700/50 rounded-xl border border-slate-100 dark:border-slate-700">
                        <div className="min-w-0">
                          <p className="text-sm font-bold text-slate-800 dark:text-slate-100 truncate">{k.name}</p>
                          <p className="text-xs font-mono text-slate-400 dark:text-slate-500 mt-0.5">{k.key_prefix}</p>
                          <div className="flex flex-wrap items-center gap-1.5 mt-2">
                            {k.is_oauth && (
                              <span className="text-2xs font-bold uppercase tracking-wide px-1.5 py-0.5 rounded-md bg-blue-100 dark:bg-blue-900/40 text-blue-700 dark:text-blue-300">OAuth</span>
                            )}
                            <span className="text-2xs font-bold uppercase tracking-wide px-1.5 py-0.5 rounded-md bg-slate-200 dark:bg-slate-600 text-slate-600 dark:text-slate-300">read</span>
                            {writeScopes.map(s => (
                              <span key={s} className="text-2xs font-bold uppercase tracking-wide px-1.5 py-0.5 rounded-md bg-violet-100 dark:bg-violet-900/40 text-violet-700 dark:text-violet-300">{s}</span>
                            ))}
                            {displayExpiry && (
                              <span className={`text-2xs font-bold px-1.5 py-0.5 rounded-md ${expired ? 'bg-red-100 dark:bg-red-900/40 text-red-700 dark:text-red-300' : 'bg-amber-100 dark:bg-amber-900/40 text-amber-700 dark:text-amber-300'}`}>
                                {expired ? 'Expired' : `Expires ${new Date(displayExpiry).toLocaleDateString()}`}
                              </span>
                            )}
                          </div>
                        </div>
                        <div className="text-right shrink-0 hidden sm:block">
                          <p className="text-xs text-slate-400 dark:text-slate-500">Created {new Date(k.created_at).toLocaleDateString()}</p>
                          <p className="text-xs text-slate-400 dark:text-slate-500 mt-0.5">
                            {k.last_used_at ? `Last used ${new Date(k.last_used_at).toLocaleDateString()}` : 'Never used'}
                          </p>
                        </div>
                        <div className="flex items-center gap-1 shrink-0">
                          <button
                            onClick={() => openEditKeyScope(k)}
                            className="p-2 text-slate-400 dark:text-slate-400 hover:text-violet-600 hover:bg-violet-50 dark:hover:bg-violet-900/20 rounded-lg transition-colors"
                            title="Edit connection"
                          >
                            <SlidersHorizontal className="w-4 h-4" />
                          </button>
                          <button
                            onClick={() => handleDeleteApiKey(k.id)}
                            disabled={deletingKeyId === k.id}
                            className="p-2 text-slate-400 dark:text-slate-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 rounded-lg transition-colors"
                            title="Revoke key"
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

              {/* MCP Server */}
              <McpServerCard locked={!hasMcpAccess} onUpgrade={() => setActiveTab('plans')} />

            </div>
          )}

          {/* --- Profile Tab --- */}
          {activeTab === 'profile' && (
            <div className="space-y-6 animate-fade-in max-w-2xl">
              <Card className="p-6 md:p-8">
                <h2 className="text-lg font-bold text-slate-900 dark:text-slate-100 mb-6">My Profile</h2>
                
                <div className="flex flex-col sm:flex-row items-start gap-8 mb-8 border-b border-slate-100 dark:border-slate-700 pb-8">
                   <div className="shrink-0 relative group cursor-pointer mx-auto sm:mx-0" onClick={() => fileInputRef.current?.click()}>
                     <img src={profileAvatar} alt={profileName} className="w-24 h-24 rounded-full object-cover ring-4 ring-slate-50 dark:ring-slate-700 bg-slate-200 dark:bg-slate-600" />
                     <div className="absolute inset-0 bg-slate-900/50 rounded-full flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
                        <Camera className="w-8 h-8 text-white" />
                     </div>
                     <input 
                      type="file" 
                      ref={fileInputRef} 
                      className="hidden" 
                      accept="image/*"
                      onChange={handleFileUpload}
                     />
                   </div>
                   <div className="flex-1 space-y-5 w-full">
                     <div>
                        <label className="block text-xs font-bold text-slate-400 uppercase tracking-wider mb-2">Full Name</label>
                        <input
                          className="w-full p-3 bg-white dark:bg-slate-700 border border-slate-200 dark:border-slate-600 text-slate-900 dark:text-slate-100 placeholder:text-slate-400 dark:placeholder:text-slate-500 rounded-xl text-sm outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-500/20 transition-all"
                          value={profileName}
                          onChange={e => { setProfileName(e.target.value); setProfileDirty(true); }}
                        />
                     </div>
                     <div>
                        <label className="block text-xs font-bold text-slate-400 uppercase tracking-wider mb-2">Email Address</label>
                        <input
                          className="w-full p-3 bg-white dark:bg-slate-700 border border-slate-200 dark:border-slate-600 text-slate-900 dark:text-slate-100 placeholder:text-slate-400 dark:placeholder:text-slate-500 rounded-xl text-sm outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-500/20 transition-all"
                          value={profileEmail}
                          onChange={e => { setProfileEmail(e.target.value); setProfileDirty(true); }}
                        />
                     </div>

                     <div>
                        <label className="block text-xs font-bold text-slate-400 uppercase tracking-wider mb-2">Avatar Actions</label>
                        <div className="flex gap-2">
                          <button
                            onClick={() => fileInputRef.current?.click()}
                            className="px-4 py-2 bg-slate-50 dark:bg-slate-700 hover:bg-slate-100 dark:hover:bg-slate-600 text-slate-600 dark:text-slate-300 rounded-lg text-xs font-bold flex items-center gap-2 transition-colors border border-slate-200 dark:border-slate-600 flex-1 justify-center"
                          >
                            <Upload className="w-3 h-3" /> Upload
                          </button>
                          <button
                            onClick={handleRandomizeAvatar}
                            className="px-4 py-2 bg-slate-50 dark:bg-slate-700 hover:bg-slate-100 dark:hover:bg-slate-600 text-slate-600 dark:text-slate-300 rounded-lg text-xs font-bold flex items-center gap-2 transition-colors border border-slate-200 dark:border-slate-600 flex-1 justify-center"
                          >
                            <RefreshCw className="w-3 h-3" /> Randomize
                          </button>
                        </div>
                     </div>

                      <div>
                        <label className="block text-xs font-bold text-slate-400 uppercase tracking-wider mb-2">Avatar URL (Optional)</label>
                        <input
                          className="w-full p-3 bg-white dark:bg-slate-700 border border-slate-200 dark:border-slate-600 text-slate-900 dark:text-slate-100 placeholder:text-slate-400 dark:placeholder:text-slate-500 rounded-xl text-sm outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-500/20 transition-all"
                          value={profileAvatar}
                          onChange={e => { setProfileAvatar(e.target.value); setProfileDirty(true); }}
                          placeholder="https://..."
                        />
                     </div>
                   </div>
                </div>

                <div className="space-y-5">
                   <h3 className="text-sm font-bold text-slate-900 dark:text-slate-100 flex items-center gap-2">
                     <Lock className="w-4 h-4 text-slate-400" />
                     Change Password
                   </h3>
                   <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                     <div>
                        <label className="block text-xs font-bold text-slate-400 uppercase tracking-wider mb-2">New Password</label>
                        <input 
                          type="password"
                          className="w-full p-3 bg-white dark:bg-slate-700 border border-slate-200 dark:border-slate-600 text-slate-900 dark:text-slate-100 placeholder:text-slate-400 dark:placeholder:text-slate-500 rounded-xl text-sm outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-500/20 transition-all" 
                          value={passwords.new}
                          onChange={e => setPasswords({...passwords, new: e.target.value})}
                        />
                     </div>
                     <div>
                        <label className="block text-xs font-bold text-slate-400 uppercase tracking-wider mb-2">Confirm Password</label>
                        <input 
                          type="password"
                          className="w-full p-3 bg-white dark:bg-slate-700 border border-slate-200 dark:border-slate-600 text-slate-900 dark:text-slate-100 placeholder:text-slate-400 dark:placeholder:text-slate-500 rounded-xl text-sm outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-500/20 transition-all" 
                          value={passwords.confirm}
                          onChange={e => setPasswords({...passwords, confirm: e.target.value})}
                        />
                     </div>
                   </div>
                </div>

                <div className="mt-8 pt-8 border-t border-slate-100 dark:border-slate-700 flex flex-col sm:flex-row justify-between items-center gap-4">
                  <div className="flex gap-3 w-full sm:w-auto">
                    <button
                      onClick={handleLogout}
                      className="px-4 py-2 text-slate-600 dark:text-slate-300 bg-slate-50 dark:bg-slate-700 border border-slate-200 dark:border-slate-600 rounded-xl text-sm font-bold hover:bg-slate-100 dark:hover:bg-slate-600 transition-colors flex items-center justify-center gap-2 flex-1 sm:flex-none"
                    >
                      <LogOut className="w-4 h-4" /> Sign Out
                    </button>
                    <button
                      onClick={() => setConfirmDialog({
                        title: 'Leave workspace?',
                        message: `You will lose access to "${workspace.name}". You can be re-invited later.`,
                        onConfirm: leaveWorkspace,
                      })}
                      className="px-4 py-2 text-slate-600 dark:text-slate-300 bg-slate-50 dark:bg-slate-700 border border-slate-200 dark:border-slate-600 rounded-xl text-sm font-bold hover:bg-red-50 dark:hover:bg-red-900/20 hover:text-red-600 dark:hover:text-red-400 hover:border-red-200 dark:hover:border-red-800/50 transition-colors flex items-center justify-center gap-2 flex-1 sm:flex-none"
                    >
                      <DoorOpen className="w-4 h-4" /> Leave
                    </button>
                  </div>

                  <Button
                    onClick={handleUpdateProfile}
                    className="w-full sm:w-auto px-6 py-3 shadow-lg shadow-brand-200"
                  >
                    Save Changes
                  </Button>
                </div>
              </Card>

              <div className="bg-red-50 dark:bg-red-900/20 rounded-2xl border border-red-100 dark:border-red-800/50 p-8">
                <h2 className="text-lg font-bold text-red-900 dark:text-red-300 mb-2">Danger Zone</h2>
                <p className="text-sm text-red-600 dark:text-red-400 mb-6">Permanently delete your account and remove access to all workspaces. This action cannot be undone.</p>
                <button
                  onClick={() => setConfirmDialog({
                    title: 'Delete your account?',
                    message: 'This will permanently delete your account and all your data. Any workspaces where you are the only admin will be left without an admin. This action cannot be undone.',
                    onConfirm: deleteAccount,
                  })}
                  className="px-4 py-2 bg-white dark:bg-slate-800 border border-red-200 dark:border-red-800/50 text-red-600 dark:text-red-400 font-bold text-sm rounded-xl hover:bg-red-600 dark:hover:bg-red-900/30 hover:text-white dark:hover:text-red-300 hover:border-red-600 dark:hover:border-red-700 transition-all shadow-sm"
                >
                  Delete Account
                </button>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Invite Modal */}
      <Modal open={isInviteModalOpen} onClose={() => setIsInviteModalOpen(false)} size="md" className="p-6 md:p-8">
        <h3 className="text-xl font-bold text-slate-900 dark:text-slate-100 mb-6">Invite Team Member</h3>
        <form onSubmit={handleInvite} className="space-y-5">
          <div>
            <label className="block text-xs font-bold text-slate-500 uppercase tracking-wider mb-1.5">Email Address</label>
            <input
              type="email"
              required
              className="w-full p-3 bg-white dark:bg-slate-700 border border-slate-200 dark:border-slate-600 text-slate-900 dark:text-slate-100 placeholder:text-slate-400 dark:placeholder:text-slate-500 rounded-xl text-sm outline-none focus:border-brand-500 transition-colors"
              placeholder="colleague@company.com"
              value={inviteEmail}
              onChange={e => setInviteEmail(e.target.value)}
            />
          </div>
          <div>
            <label className="block text-xs font-bold text-slate-500 uppercase tracking-wider mb-1.5">Role</label>
            <select
              className="w-full p-3 bg-white dark:bg-slate-700 border border-slate-200 dark:border-slate-600 text-slate-900 dark:text-slate-100 rounded-xl text-sm outline-none focus:border-brand-500 transition-colors appearance-none"
              value={inviteRole}
              onChange={(e) => setInviteRole(e.target.value as UserRole)}
            >
              <option value="admin">Admin (Full Access)</option>
              <option value="editor">Editor (Can Create)</option>
              <option value="member">Member (Read Only)</option>
            </select>
          </div>
          <div className="flex gap-3 mt-8">
            <button type="button" onClick={() => setIsInviteModalOpen(false)} disabled={isInviteSending} className="flex-1 px-4 py-3 text-slate-600 dark:text-slate-300 bg-slate-50 dark:bg-slate-700 rounded-xl hover:bg-slate-100 dark:hover:bg-slate-600 font-medium transition-colors disabled:opacity-60 disabled:cursor-not-allowed">Cancel</button>
            <Button type="submit" loading={isInviteSending} className="flex-1 px-4 py-3 shadow-lg shadow-brand-200">
              {!isInviteSending && 'Send Invite'}
            </Button>
          </div>
        </form>
      </Modal>

      {/* Generic Confirm Dialog */}
      {/* Generate API Key Modal */}
      <Modal open={showGenerateKeyModal} onClose={() => setShowGenerateKeyModal(false)} size="sm" className="p-6">
        <h3 className="text-lg font-bold text-slate-900 dark:text-slate-100 mb-2">Generate API Key</h3>
        <p className="text-sm text-slate-500 dark:text-slate-400 mb-5">Give this key a name so you can identify it later.</p>
        <input
          type="text"
          value={newKeyName}
          onChange={e => setNewKeyName(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && handleGenerateKey()}
          placeholder="e.g. Production, Zapier, n8n"
          className="w-full p-3 border border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-700 text-slate-900 dark:text-slate-100 rounded-xl text-sm outline-none focus:border-violet-500 focus:ring-2 focus:ring-violet-500/20 transition-all mb-5 placeholder:text-slate-400 dark:placeholder:text-slate-500"
          autoFocus
        />
        <div className="mb-5">
          <ApiKeyScopeFields value={newKeyScope} onChange={setNewKeyScope} />
        </div>
        <div className="flex gap-2">
          <button onClick={() => setShowGenerateKeyModal(false)} className="flex-1 py-2.5 text-slate-600 dark:text-slate-300 bg-slate-50 dark:bg-slate-700 rounded-xl hover:bg-slate-100 dark:hover:bg-slate-600 text-xs font-bold transition-colors">Cancel</button>
          <button
            onClick={handleGenerateKey}
            disabled={!newKeyName.trim() || isGeneratingKey}
            className="flex-1 py-2.5 bg-violet-600 hover:bg-violet-700 text-white rounded-xl text-xs font-bold transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
          >
            {isGeneratingKey ? <><Loader2 className="w-3.5 h-3.5 animate-spin" /> Generating...</> : 'Generate Key'}
          </button>
        </div>
      </Modal>

      {/* Edit Connection Permissions Modal (SQEM-064) */}
      <Modal open={!!editingKey} onClose={() => setEditingKey(null)} size="sm" className="p-6">
        <h3 className="text-lg font-bold text-slate-900 dark:text-slate-100 mb-1">Edit connection</h3>
        <p className="text-sm font-mono text-slate-500 dark:text-slate-400 mb-5 truncate">{editingKey?.key_prefix}</p>
        <label className="block text-xs font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider mb-2">Name</label>
        <input
          type="text"
          value={editKeyName}
          onChange={e => setEditKeyName(e.target.value)}
          placeholder="e.g. Production, Zapier, n8n"
          className="w-full p-3 border border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-700 text-slate-900 dark:text-slate-100 rounded-xl text-sm outline-none focus:border-violet-500 focus:ring-2 focus:ring-violet-500/20 transition-all mb-5 placeholder:text-slate-400 dark:placeholder:text-slate-500"
        />
        <ApiKeyScopeFields value={editKeyScope} onChange={setEditKeyScope} />
        <div className="flex gap-2 mt-6">
          <button onClick={() => setEditingKey(null)} className="flex-1 py-2.5 text-slate-600 dark:text-slate-300 bg-slate-50 dark:bg-slate-700 rounded-xl hover:bg-slate-100 dark:hover:bg-slate-600 text-xs font-bold transition-colors">Cancel</button>
          <button
            onClick={handleSaveKeyScope}
            disabled={isSavingScope || !editKeyName.trim()}
            className="flex-1 py-2.5 bg-violet-600 hover:bg-violet-700 text-white rounded-xl text-xs font-bold transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
          >
            {isSavingScope ? <><Loader2 className="w-3.5 h-3.5 animate-spin" /> Saving...</> : 'Save changes'}
          </button>
        </div>
      </Modal>

      {/* New Key — Show Once Modal */}
      <Modal open={!!generatedKeyValue} onClose={() => { setGeneratedKeyValue(null); setKeyCopied(false); }} size="sm" className="p-6">
        <h3 className="text-lg font-bold text-slate-900 dark:text-slate-100 mb-2">Copy your API key</h3>
        <p className="text-sm text-slate-500 dark:text-slate-400 mb-4">This key will only be shown once. Store it somewhere safe.</p>
        <div className="flex items-center gap-2 p-3 bg-slate-50 dark:bg-slate-700 border border-slate-200 dark:border-slate-600 rounded-xl mb-5">
          <code className="text-xs font-mono text-slate-700 dark:text-slate-200 flex-1 break-all">{generatedKeyValue}</code>
          <button
            onClick={() => { navigator.clipboard.writeText(generatedKeyValue || ''); setKeyCopied(true); }}
            className="shrink-0 p-1.5 text-slate-400 hover:text-brand-600 transition-colors"
            title="Copy"
          >
            {keyCopied ? <Check className="w-4 h-4 text-emerald-500" /> : <Copy className="w-4 h-4" />}
          </button>
        </div>
        <button
          onClick={() => { setGeneratedKeyValue(null); setKeyCopied(false); }}
          className="w-full py-2.5 bg-slate-900 dark:bg-slate-700 text-white rounded-xl text-xs font-bold transition-colors hover:bg-slate-800 dark:hover:bg-slate-600"
        >
          I've saved my key
        </button>
      </Modal>

      <Modal open={!!confirmDialog} onClose={() => setConfirmDialog(null)} size="sm" className="p-6">
        <h3 className="text-lg font-bold text-slate-900 dark:text-slate-100 mb-2">{confirmDialog?.title}</h3>
        <p className="text-sm text-slate-500 dark:text-slate-400 mb-6">{confirmDialog?.message}</p>
        <div className="flex gap-2">
          <button
            onClick={() => setConfirmDialog(null)}
            className="flex-1 py-2.5 text-slate-600 dark:text-slate-300 bg-slate-50 dark:bg-slate-700 rounded-xl hover:bg-slate-100 dark:hover:bg-slate-600 text-xs font-bold transition-colors"
          >
            Cancel
          </button>
          <Button
            variant="danger"
            onClick={() => { confirmDialog?.onConfirm(); setConfirmDialog(null); }}
            className="flex-1 py-2.5 text-xs shadow-lg hover:shadow-red-200"
          >
            Confirm
          </Button>
        </div>
      </Modal>
    </div>
  );
};

export default Settings;

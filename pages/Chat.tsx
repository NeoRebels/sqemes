import React, { useState, useRef, useEffect, useCallback, useMemo, memo } from 'react';
import { getLocale, m as txt } from '../lib/i18n'; // SQEM-599 — the language of server notices; SQEM-604 — `txt`, because `m` is a common callback name in this file
import { useUI, useWorkspace, useData, useChatSessions, usePrompts } from '../store';
import { can } from '../lib/permissions';
import { checkContentViolation } from '../lib/contentGuard';
import { IS_SELF_HOSTED, functionCallUrl } from '../lib/env';
import { supabase } from '../lib/supabase';
import { waitForJobResult } from '../lib/realtimeJob';
import { clientJobTimeoutMs, clientHardCapMs } from '../supabase/functions/_shared/chatTimeouts.ts';
import { AVAILABLE_MODELS } from '../constants';
import { buildEnabledModels, isFundedModel, isImageModel } from '../lib/enabledModels';
import { authoringModelId } from '../lib/authoringAI';
import { edgeError } from '../lib/edgeError';
import { Send, Square, Bot, User, Sparkles, AlertTriangle, Loader2, Copy, Check, Pencil, Paperclip, Plug, X, FileText, MessageSquarePlus, Search, MoreHorizontal, Globe, Users, Lock, Trash2, MessageSquare, Wand2, Key, Upload, Files } from 'lucide-react';
import { usePullToRefresh } from '../hooks/usePullToRefresh';
import { fetchPersona, fetchPersonas } from '../lib/api/personas';
import { clearChatHandoff, peekChatHandoff } from '../lib/chatHandoff';
import { buildPendingRef, finalizeRef, messagePlaybookFields, normalizeLoadedIds, pendingFromSent, usedPlaybooks, type PendingPlaybookRef } from '../lib/playbookRef';
import { ChatPlaybookCard, UsedPlaybookChips, LibraryChangesCard, WebSourcesCard } from '../components/ChatPlaybookCard';
import { normalizeWebSources, type WebSources } from '../supabase/functions/_shared/webSearch.ts';
import { normalizeGeneratedFiles, type GeneratedFile } from '../supabase/functions/_shared/fileOutput.ts';
import { GeneratedFilesCard, FilePreviewPanel } from '../components/ChatFileOutput';
import { normalizeLibraryChanges, type LibraryChange } from '../supabase/functions/_shared/libraryChanges.ts';
import { fetchWorkspaceFiles } from '../lib/api/files';
import { personaInstruction } from '../lib/personaChat';
import PullToRefreshIndicator from '../components/PullToRefreshIndicator';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { markdownUrlTransform } from '../lib/markdownUrlTransform';
import { composeSystemInstruction, resolveAppliedContext } from '../lib/templateContext';
import { enhancePrompt, enhanceInput } from '../supabase/functions/_shared/authoringPrompts.ts';
import { shouldSendOnEnter, hasCoarsePointer } from '../lib/chatKeys';
import { noKeyHint, PROVIDER_KEYS_TAB } from '../lib/chatKeyHint';
import { useLocation, useNavigate, useParams, Link } from 'react-router';
import { SUPPORTED_MIME_TYPES, ACCEPT_STRING, MAX_FILE_SIZE_MB, MAX_FILE_SIZE_BYTES, isImageType, fileTypeLabel } from '../lib/uploadTypes';
import {
  createChatSession, addChatMessage, fetchChatMessages, deleteChatMessages,
  fetchSharedChatSessions,
  unshareChatSession,
  fetchAppliedContext,
  updateAppliedContext,
  requestChatJobCancel,
} from '../lib/api/chatSessions';
import { stoppedContent } from '../lib/chatStop';
import Modal from '../components/ui/Modal';
import Button from '../components/ui/Button';
import { uploadWorkspaceFile, getWorkspaceFileSignedUrl } from '../lib/api/files';
import { fetchConnectors, type Connector } from '../lib/api/connectors';
import { WorkspaceFilePickerModal } from '../components/WorkspaceFilePickerModal';
import type { ChatSession, Persona, PlaybookRef, Prompt, PromptKind, WorkspaceFile } from '../types';
import { ModelSelect } from '../components/ModelSelect';
import { PersonaSelect } from '../components/PersonaSelect';
import TemplateLaunchModal, { type ContextImage } from '../components/TemplateLaunchModal';
import ChatSearchModal from '../components/ChatSearchModal';
import Avatar from '../components/ui/Avatar';
import FullScreenExit from '../components/ui/FullScreenExit';
import Checkbox from '../components/ui/Checkbox';


// ---------------------------------------------------------------------------
// Markdown renderer
// ---------------------------------------------------------------------------
const MarkdownComponents = {
  h1: ({node, ...props}: any) => <h1 className="text-xl font-bold text-slate-900 dark:text-slate-100 mb-3 pb-2 border-b border-slate-100 dark:border-slate-700" {...props} />,
  h2: ({node, ...props}: any) => <h2 className="text-lg font-bold text-slate-900 dark:text-slate-100 mt-5 mb-2" {...props} />,
  h3: ({node, ...props}: any) => <h3 className="text-base font-bold text-slate-800 dark:text-slate-200 mt-3 mb-1.5" {...props} />,
  h4: ({node, ...props}: any) => <h4 className="text-sm font-bold text-slate-800 dark:text-slate-200 mt-3 mb-1" {...props} />,
  p:  ({node, ...props}: any) => <p className="text-slate-700 dark:text-slate-300 leading-7 mb-3 last:mb-0" {...props} />,
  ul: ({node, ...props}: any) => <ul className="list-disc list-outside ml-5 mb-3 text-slate-700 dark:text-slate-300 space-y-1" {...props} />,
  ol: ({node, ...props}: any) => <ol className="list-decimal list-outside ml-5 mb-3 text-slate-700 dark:text-slate-300 space-y-1" {...props} />,
  li: ({node, ...props}: any) => <li className="pl-1" {...props} />,
  blockquote: ({node, ...props}: any) => <blockquote className="border-l-4 border-brand-200 dark:border-brand-700 pl-4 py-1 my-3 text-slate-500 dark:text-slate-400 italic bg-brand-50/30 dark:bg-brand-900/10 rounded-r-lg" {...props} />,
  code: ({node, inline, className, children, ...props}: any) => {
    const match = /language-(\w+)/.exec(className || '');
    return !inline ? (
      <div className="relative group my-4 rounded-xl overflow-hidden bg-slate-900 border border-slate-800 shadow-md">
        <div className="flex items-center justify-between px-4 py-2 bg-slate-800/50 border-b border-slate-700/50">
          <div className="flex gap-1.5">
            <div className="w-2 h-2 rounded-full bg-red-500/50" />
            <div className="w-2 h-2 rounded-full bg-amber-500/50" />
            <div className="w-2 h-2 rounded-full bg-green-500/50" />
          </div>
          <div className="flex items-center gap-3">
            <span className="text-2xs font-mono font-bold text-slate-500 uppercase tracking-wider">{match ? match[1] : 'text'}</span>
            <button onClick={() => navigator.clipboard.writeText(String(children))} className="text-2xs text-slate-400 hover:text-white transition-colors uppercase font-bold tracking-wider">{txt.chat_copy()}</button>
          </div>
        </div>
        <div className="p-4 overflow-x-auto">
          <code className={`${className} text-sm font-mono text-slate-300 leading-relaxed`} {...props}>{children}</code>
        </div>
      </div>
    ) : (
      <code className="px-1.5 py-0.5 rounded-md bg-slate-100 dark:bg-slate-700 text-brand-700 dark:text-brand-300 font-mono text-sm border border-slate-200 dark:border-slate-600" {...props}>{children}</code>
    );
  },
  table:  ({node, ...props}: any) => <div className="overflow-x-auto my-4 border border-slate-200 dark:border-slate-700 rounded-xl shadow-sm"><table className="w-full text-sm text-left" {...props} /></div>,
  thead:  ({node, ...props}: any) => <thead className="bg-slate-50 dark:bg-slate-700 text-slate-500 dark:text-slate-400 font-bold uppercase tracking-wider text-xs border-b border-slate-200 dark:border-slate-600" {...props} />,
  th:     ({node, ...props}: any) => <th className="px-4 py-3" {...props} />,
  tbody:  ({node, ...props}: any) => <tbody className="bg-white dark:bg-slate-800 divide-y divide-slate-100 dark:divide-slate-700" {...props} />,
  tr:     ({node, ...props}: any) => <tr className="hover:bg-slate-50/50 dark:hover:bg-slate-700/50 transition-colors" {...props} />,
  td:     ({node, ...props}: any) => <td className="px-4 py-3 text-slate-600 dark:text-slate-300" {...props} />,
  a:      ({node, ...props}: any) => <a className="text-brand-600 dark:text-brand-400 hover:underline font-medium" target="_blank" rel="noopener noreferrer" {...props} />,
  hr:     ({node, ...props}: any) => <hr className="my-6 border-slate-100 dark:border-slate-700" {...props} />,
};

// ---------------------------------------------------------------------------
// Types & constants
// ---------------------------------------------------------------------------

/**
 * Replace base64-encoded image markdown with blob URLs so React state never
 * holds multi-MB strings. This prevents re-render lag when typing after image
 * generation. The original base64 content is saved to the DB before this runs.
 */
function inlineImagesToBlobUrls(content: string): string {
  if (!content || !content.includes('data:image/')) return content ?? '';
  return content.replace(
    /!\[(.*?)\]\(data:(image\/\w+);base64,([A-Za-z0-9+/=]+)\)/g,
    (_match, alt, mimeType, base64) => {
      try {
        const bytes = Uint8Array.from(atob(base64), c => c.charCodeAt(0));
        const blob = new Blob([bytes], { type: mimeType });
        return `![${alt}](${URL.createObjectURL(blob)})`;
      } catch {
        return `![${alt}](data:${mimeType};base64,${base64})`;
      }
    }
  );
}

// Supabase/Cloudflare silently drops requests larger than ~582KB at the gateway
// level with no CORS headers, causing "Failed to fetch" in the browser.
// We stay well below that by trimming the oldest messages from the conversation
// history until the serialised payload fits within MAX_CHAT_PAYLOAD_CHARS.
// The most recent message (index −1, i.e. the user's new message) is always kept.
const MAX_CHAT_PAYLOAD_CHARS = 480_000;

function truncateMessagesToPayloadLimit(
  messages: { role: string; content: any }[],
  payloadTemplate: object,
): { role: string; content: any }[] {
  let trimmed = [...messages];
  while (trimmed.length > 1) {
    if (JSON.stringify({ ...payloadTemplate, messages: trimmed }).length <= MAX_CHAT_PAYLOAD_CHARS) break;
    trimmed.shift();
  }
  return trimmed;
}

interface ChatAttachment { id: string; file: File; dataUrl: string; mimeType: string; }
interface ChatMsg {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  pending?: boolean;
  attachments?: Array<{ mimeType: string; dataUrl: string }>;
  model?: string;
  userId?: string;
  userName?: string;
  userAvatar?: string;
  playbookRef?: PlaybookRef | null;   // SQEM-551 — user message started from a prompt playbook
  loadedTemplateIds?: string[];       // SQEM-551 — answer: what the model loaded for it
  libraryChanges?: LibraryChange[];   // SQEM-561 — answer: what the model changed in the library
  webSources?: WebSources | null;     // SQEM-594 — answer: what it searched for and read
  generatedFiles?: GeneratedFile[];   // SQEM-595 — answer: files it handed out (built on download)
}

// SQEM-185 — a memoized single message. Extracting this out of the Chat component means composer
// keystrokes (which re-render Chat) no longer re-render — and re-parse the markdown of — every message.
// All props are primitives or stable callbacks, so React.memo skips unchanged rows on the hot path.
interface MessageItemProps {
  msg: ChatMsg;
  currentUserId: string;
  currentUserName: string;
  userAvatar: string;
  showUserAvatar: boolean;
  onAvatarError: () => void;
  isLastAssistant: boolean;
  isLoading: boolean;
  isCopied: boolean;
  onCopy: (msgId: string, content: string) => void;
  onEdit: (msg: ChatMsg) => void;
  innerRef?: React.Ref<HTMLDivElement>;
  /** SQEM-551 — the viewer's playbooks by id (stable, memoized): chip titles and card links. */
  playbookTitles: ReadonlyMap<string, { title: string; kind: PromptKind }>;
  /** SQEM-561 — the viewer's own current title for a changed object; undefined when not theirs to see. */
  libraryTitle: (c: LibraryChange) => string | undefined;
  /** SQEM-595 — open a generated file in the preview beside the chat (stable callback). */
  onOpenFile: (f: GeneratedFile) => void;
}

const MessageItem = memo(function MessageItem({
  msg, currentUserId, currentUserName, userAvatar, showUserAvatar, onAvatarError,
  isLastAssistant, isLoading, isCopied, onCopy, onEdit, innerRef, playbookTitles, libraryTitle, onOpenFile,
}: MessageItemProps) {
  const isOtherUser = msg.role === 'user' && !!msg.userId && msg.userId !== currentUserId;
  return (
    <div ref={innerRef} className={`flex gap-3 ${msg.role === 'user' && !isOtherUser ? 'justify-end' : 'justify-start'}${isLastAssistant ? ' scroll-mt-5' : ''}`}>
      {msg.role === 'assistant' && (
        <div className="w-8 h-8 rounded-control bg-accent-strong flex items-center justify-center shrink-0 mt-1">
          <Bot className="w-4 h-4 text-white" />
        </div>
      )}
      {/* SQEM-205 — Avatar falls back to initials when the picture is missing *or* fails to load.
          The old markup only covered "missing", so a blocked external image rendered broken. */}
      {isOtherUser && (
        <Avatar src={msg.userAvatar} name={msg.userName || 'User'} className="w-8 h-8 mt-1" rounded="rounded-lg" />
      )}
      <div className={`max-w-[85%] ${msg.role === 'user' && !isOtherUser ? 'order-first' : ''}`}>
        {isOtherUser && (
          <p className="text-xs font-medium text-slate-500 dark:text-slate-400 mb-1 ml-1">{msg.userName || 'Collaborator'}</p>
        )}
        {msg.role === 'user' ? (
          <div>
            {msg.playbookRef ? (
              // SQEM-551 — the card, with the text it produced collapsed inside it.
              <div className={`flex ${isOtherUser ? 'justify-start' : 'justify-end'}`}>
                <ChatPlaybookCard playbookRef={msg.playbookRef} content={msg.content} linkable={playbookTitles.has(msg.playbookRef.id)}>
                  {msg.attachments && msg.attachments.length > 0 && (
                    <div className="flex flex-wrap gap-2 mt-2">
                      {msg.attachments.map((att, i) =>
                        isImageType(att.mimeType)
                          ? <img key={i} src={att.dataUrl} alt={txt.chat_attachment_alt()} className="max-w-[200px] max-h-[150px] rounded-lg object-cover border border-line" />
                          : <span key={i} className="flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 bg-surface-sunken text-xs font-medium text-ink-muted"><FileText className="w-4 h-4" />{fileTypeLabel(att.mimeType)}</span>
                      )}
                    </div>
                  )}
                </ChatPlaybookCard>
              </div>
            ) : (
            <div className={`px-4 py-3 rounded-2xl shadow-sm ${isOtherUser ? 'bg-slate-200 dark:bg-slate-600 text-slate-800 dark:text-slate-100 rounded-tl-md' : 'bg-accent-strong text-white rounded-tr-md'}`}>
              {msg.attachments && msg.attachments.length > 0 && (
                <div className="flex flex-wrap gap-2 mb-2">
                  {msg.attachments.map((att, i) =>
                    isImageType(att.mimeType) ? (
                      <img key={i} src={att.dataUrl} alt={txt.chat_attachment_alt()} className="max-w-[200px] max-h-[150px] rounded-lg object-cover border border-white/20" />
                    ) : (
                      <div key={i} className="flex items-center gap-1.5 bg-white/10 rounded-lg px-2.5 py-1.5">
                        <FileText className="w-4 h-4 text-white/70" />
                        <span className="text-xs text-white/80 font-medium">{fileTypeLabel(att.mimeType)}</span>
                      </div>
                    )
                  )}
                </div>
              )}
              <p className="text-sm leading-relaxed whitespace-pre-wrap">{msg.content}</p>
            </div>
            )}
            <div className={`mt-2 flex gap-2 ${isOtherUser ? 'ml-1' : 'mr-1 justify-end'}`}>
              <button onClick={() => onCopy(msg.id, msg.content)} className="inline-flex items-center gap-1 text-xs font-medium text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 transition-colors">
                {isCopied ? <><Check className="w-3.5 h-3.5" /> {txt.chat_copied()}</> : <><Copy className="w-3.5 h-3.5" /> {txt.chat_copy()}</>}
              </button>
              {!isLoading && !isOtherUser && (
                <button onClick={() => onEdit(msg)} className="inline-flex items-center gap-1 text-xs font-medium text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 transition-colors">
                  <Pencil className="w-3.5 h-3.5" /> {txt.chat_edit()}
                </button>
              )}
            </div>
          </div>
        ) : (
          <div>
            <div className="bg-surface-raised px-5 py-4 rounded-card rounded-tl-md shadow-rest border border-line">
              {msg.pending ? (
                <div className="flex items-center gap-2 text-slate-400 dark:text-slate-500">
                  <Loader2 className="w-4 h-4 animate-spin" />
                  <span className="text-sm">{txt.chat_thinking()}</span>
                </div>
              ) : (
                <div className="prose max-w-none text-sm">
                  {/* SQEM-019 sanitizes model-supplied URLs (XSS defense); SQEM-196 narrows
                      that to let generated images through — see lib/markdownUrlTransform.ts. */}
                  <ReactMarkdown components={MarkdownComponents} remarkPlugins={[remarkGfm]} urlTransform={markdownUrlTransform}>{msg.content}</ReactMarkdown>
                </div>
              )}
              {msg.model && !msg.pending && <p className="text-2xs text-slate-400 dark:text-slate-500 mt-2 font-mono">{msg.model}</p>}
            </div>
            {!msg.pending && <UsedPlaybookChips used={usedPlaybooks(msg.loadedTemplateIds, playbookTitles)} />}
            {!msg.pending && <LibraryChangesCard changes={msg.libraryChanges} currentTitle={libraryTitle} />}
            {!msg.pending && <GeneratedFilesCard files={msg.generatedFiles} onOpen={onOpenFile} />}
            {!msg.pending && <WebSourcesCard sources={msg.webSources} />}
            {!msg.pending && (
              <button onClick={() => onCopy(msg.id, msg.content)} className="mt-2 ml-1 inline-flex items-center gap-1 text-xs font-medium text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 transition-colors">
                {isCopied ? <><Check className="w-3.5 h-3.5" /> {txt.chat_copied()}</> : <><Copy className="w-3.5 h-3.5" /> {txt.chat_copy()}</>}
              </button>
            )}
          </div>
        )}
      </div>
      {msg.role === 'user' && !isOtherUser && (
        <div className="w-8 h-8 rounded-lg bg-slate-100 dark:bg-slate-700 flex items-center justify-center shrink-0 mt-1">
          {showUserAvatar
            ? <img src={userAvatar} alt={currentUserName || 'User'} className="w-full h-full rounded-lg object-cover" onError={onAvatarError} />
            : <User className="w-4 h-4 text-slate-500" />}
        </div>
      )}
    </div>
  );
});

const formatRelativeTime = (iso: string) => {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return txt.chat_time_just_now();
  if (mins < 60) return txt.chat_time_minutes({ count: mins });
  const hours = Math.floor(mins / 60);
  if (hours < 24) return txt.chat_time_hours({ count: hours });
  const days = Math.floor(hours / 24);
  if (days < 7) return txt.chat_time_days({ count: days });
  return new Date(iso).toLocaleDateString(getLocale()); // SQEM-604 — the app's language, not the browser's
};

// Platform-aware hint for the search shortcut (SQEM-173) — cosmetic only.
const searchShortcutHint =
  typeof navigator !== 'undefined' && /Mac|iPhone|iPad|iPod/i.test(navigator.userAgent) ? '⌘K' : txt.chat_ctrl_k();

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------
const Chat = () => {
  const { workspace, currentUser } = useWorkspace();
  // SQEM-536 — the no-key state differs for whoever may add a provider key and for everybody else.
  const keyHint = noKeyHint(can(currentUser, workspace, 'api-keys:manage'));
  const { workspaceFiles, addWorkspaceFile, setWorkspaceFiles } = useData();
  // SQEM-371 — needed to turn the ids stored on a session back into templates on load.
  const { prompts } = usePrompts();
  // SQEM-551 — the viewer's own playbooks by id: chip titles and card links come from here, so a
  // shared chat never shows a playbook the viewer cannot open. Memoized — MessageItem is memo'd.
  const playbookTitles = useMemo(
    () => new Map(prompts.map(p => [p.id, { title: p.title, kind: p.kind }] as const)),
    [prompts],
  );
  // SQEM-551 — set on "Insert" from a prompt playbook, read once at send. A ref, not state: nothing
  // renders from it. Emptying the composer drops it (effect below).
  const pendingPlaybookRef = useRef<PendingPlaybookRef | null>(null);
  const { chatSessions, addChatSession, updateChatSession: storeUpdateSession,
    deleteChatSession: storeDeleteSession } = useChatSessions();
  const { showToast } = useUI();

  const location  = useLocation();
  const navigate  = useNavigate();
  const openProviderKeys = () => navigate('/settings', { state: { initialTab: PROVIDER_KEYS_TAB } });
  const { sessionId: routeSessionId } = useParams<{ sessionId?: string }>();

  // ── Conversation state ───────────────────────────────────────────────────
  const [messages, setMessages]               = useState<ChatMsg[]>([]);
  const [selectedModel, setSelectedModel]     = useState('');
  /**
   * SQEM-389 — the persona applied to this session: the role. Its composed text (role + routing
   * table, what `get_persona` serves) is what `activeSystemInstruction` holds.
   * SQEM-390 — the assistant that used to share this slot is gone with its kind; a persona is the
   * only role now, and every former assistant is a skill in `activeSkills`.
   */
  const [activePersona, setActivePersona] = useState<Persona | null>(null);
  const [activeSystemInstruction, setActiveSystemInstruction] = useState<string>('');
  /**
   * SQEM-371 — skills applied to this session, in application order, with the context each
   * contributes. Kept apart from the role because they are different things: the role LEADS, skills
   * STACK on top of it. Flattening both into one string would lose the order that
   * `composeSystemInstruction` depends on.
   */
  const [activeSkills, setActiveSkills] = useState<{ template: Prompt; context: string }[]>([]);
  const [isLoading, setIsLoading]             = useState(false);
  const [error, setError]                     = useState<string | null>(null);
  const [errorCode, setErrorCode]             = useState<string | null>(null);
  // SQEM-550 (a) — text handed over from the Start page's composer (lib/chatHandoff.ts). Read once;
  // the input starts with it, and it is sent automatically as soon as the chat is ready (below).
  const [handoff]                              = useState(() => peekChatHandoff());
  const [input, setInput]                     = useState(() => handoff?.draft ?? '');
  const [avatarLoadError, setAvatarLoadError] = useState(false);
  const [copiedMessageId, setCopiedMessageId] = useState<string | null>(null);
  const [attachments, setAttachments]         = useState<ChatAttachment[]>([]);
  const [isEnhancing, setIsEnhancing]         = useState(false);
  const [dragActive, setDragActive]           = useState(false);
  const [sessionId, setSessionId]             = useState<string | null>(null);
  const [attachMenuOpen, setAttachMenuOpen]   = useState(false);
  // SQEM-149 — the workspace's connectors. ⭐ SQEM-436 removed the per-session SELECTION: a connector
  // is set up in order to be there, and confirming it again before every conversation was a step that
  // bought nothing. What is left is the list and a status indicator.
  const [connectors, setConnectors]           = useState<Connector[]>([]);
  // SQEM-594 — web search for the NEXT message only: off by default, and off
  // again the moment a message is sent. Search costs time and money, so it is a choice per question.
  const [webNext, setWebNext]                 = useState(false);
  // SQEM-595 — the generated file shown beside the chat (desktop) or full screen (phone); null = closed.
  const [previewFile, setPreviewFile]         = useState<GeneratedFile | null>(null);
  const [saveToWorkspace, setSaveToWorkspace] = useState(false);
  const [workspacePickerOpen, setWorkspacePickerOpen] = useState(false);

  // ── Session list / sidebar state ─────────────────────────────────────────
  const [sidebarTab, setSidebarTab]           = useState<'mine' | 'shared'>('mine');
  const [sharedSessions, setSharedSessions]   = useState<ChatSession[]>([]);
  const [sharedLoading, setSharedLoading]     = useState(false);
  const [openMenuId, setOpenMenuId]           = useState<string | null>(null);
  const [renamingId, setRenamingId]           = useState<string | null>(null);
  const [renameValue, setRenameValue]         = useState('');
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);

  // ── Template launch modal ────────────────────────────────────────────────
  const [templateModalOpen, setTemplateModalOpen]       = useState(false);
  const [templateModalInitId, setTemplateModalInitId]   = useState<string | null>(null);

  // ── Mobile tab ───────────────────────────────────────────────────────────
  const [mobileTab, setMobileTab] = useState<'sessions' | 'chat'>('chat');

  // SQEM-360 — decides whether `Enter` sends or breaks the line (see `lib/chatKeys.ts`). Watched
  // rather than read once, because a tablet gains and loses its keyboard while the tab stays open.
  const [coarsePointer, setCoarsePointer] = useState(hasCoarsePointer);
  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return;
    const mq = window.matchMedia('(pointer: coarse)');
    const onChange = () => setCoarsePointer(mq.matches);
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);

  // ── Chat search (SQEM-103) ───────────────────────────────────────────────
  const [searchOpen, setSearchOpen] = useState(false);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); setSearchOpen(true); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // ── Refs ─────────────────────────────────────────────────────────────────
  const messagesEndRef       = useRef<HTMLDivElement>(null);
  const lastAssistantRef     = useRef<HTMLDivElement>(null);
  const messagesScrollRef    = useRef<HTMLDivElement>(null);
  // SQEM-385 — the message list is the chat's scroll container; pull down at its top to reload.
  const pull = usePullToRefresh(messagesScrollRef);
  const textareaRef         = useRef<HTMLTextAreaElement>(null);
  const fileInputRef        = useRef<HTMLInputElement>(null);
  const attachMenuRef       = useRef<HTMLDivElement>(null);
  const sessionLoadedRef    = useRef<string | null>(null);
  // SQEM-115 — ids of messages truncated by an edit, pruned from the DB on the next send.
  const supersededIdsRef    = useRef<string[]>([]);
  const menuRef             = useRef<HTMLDivElement>(null);
  const renameInputRef      = useRef<HTMLInputElement>(null);
  const abortControllerRef  = useRef<AbortController | null>(null);
  // SQEM-583 — the answer running now (for Stop) and the text it has written so far (kept on Stop).
  const runningJobRef = useRef<{ jobId: string; stopped: boolean } | null>(null);
  const streamedTextRef = useRef('');
  const membersRef          = useRef(workspace.members);
  useEffect(() => { membersRef.current = workspace.members; }, [workspace.members]);

  const userAvatar    = (currentUser.avatar || '').trim();
  const showUserAvatar = userAvatar.length > 0 && !avatarLoadError;
  const launchTemplateId  = (location.state as { launchTemplateId?: string } | null)?.launchTemplateId;
  const launchPersonaId   = (location.state as { launchPersonaId?: string } | null)?.launchPersonaId;
  // SQEM-550 (a) — Start's "Playbook" button and "/" land here with the picker open.
  const openTemplatePicker = (location.state as { openTemplatePicker?: boolean } | null)?.openTemplatePicker;

  // SQEM-185 — memoized so a keystroke in the composer doesn't rebuild the model list or re-sort sessions.
  const enabledModels = useMemo(
    () => buildEnabledModels(workspace.apiKeys, workspace.openrouterModels, workspace.fundedAvailable),
    [workspace.apiKeys, workspace.openrouterModels, workspace.fundedAvailable],
  );

  // SQEM-577 — the workspace's default model (Settings → General → Default AI model) is where a chat
  // starts; the first usable model only when there is none or it cannot be used here.
  const defaultModelId = useMemo(() => {
    const preferred = authoringModelId(workspace);
    return preferred && enabledModels.some(m => m.id === preferred) ? preferred : (enabledModels[0]?.id ?? '');
  }, [workspace, enabledModels]);

  const mySessions = useMemo(
    () => [...chatSessions]
      .filter(s => s.userId === currentUser.id)
      .sort((a, b) => new Date(b.lastActiveAt).getTime() - new Date(a.lastActiveAt).getTime()),
    [chatSessions, currentUser.id],
  );

  // ── Effects ──────────────────────────────────────────────────────────────

  useEffect(() => {
    if (!selectedModel && defaultModelId) setSelectedModel(defaultModelId);
  }, [defaultModelId, selectedModel]);

  useEffect(() => { setAvatarLoadError(false); }, [userAvatar]);

  // SQEM-208 — the Escape handler moved into FullScreenExit; the list of "something more local is
  // open" states stays here, where those states live, and is passed down as `escapeReady`.

  useEffect(() => {
    if (openTemplatePicker) setTemplateModalOpen(true);
  }, [openTemplatePicker]);

  // Open template modal when navigated here with a launchTemplateId
  useEffect(() => {
    if (!launchTemplateId) return;
    setTemplateModalInitId(launchTemplateId);
    setTemplateModalOpen(true);
  }, [launchTemplateId]);

  /**
   * SQEM-389 — apply a persona to this chat: it becomes the role, shows as a pill, and is written
   * to the session if one exists — a chat not yet created carries it through `createChatSession`,
   * like the skills.
   */
  const applyPersona = useCallback((persona: Persona) => {
    setActivePersona(persona);
    setActiveSystemInstruction(personaInstruction(persona, prompts));
    if (sessionId) void updateAppliedContext(sessionId, { personaId: persona.id }).catch(() => {});
  }, [prompts, sessionId]);

  // Dismissed the same way a skill is: state, then the row. Shared by the pill and the picker.
  const removePersona = useCallback(() => {
    setActivePersona(null);
    setActiveSystemInstruction('');
    if (sessionId) void updateAppliedContext(sessionId, { personaId: null }).catch(() => {});
  }, [sessionId]);

  /**
   * SQEM-390 (PR C) — the personas the picker offers. Loaded once per workspace and refreshed each
   * time the picker opens: a persona created in another tab should be there without a reload, and
   * the list is small. ⚠️ Not in the store on purpose — nothing else on this page needs it, and the
   * Personas page loads its own (see the note at the top of `pages/Personas.tsx`).
   */
  const [personas, setPersonas] = useState<Persona[]>([]);
  const loadPersonas = useCallback(() => {
    if (!workspace.id) return;
    fetchPersonas(workspace.id).then(setPersonas).catch(() => { /* the picker simply stays as it was */ });
  }, [workspace.id]);
  useEffect(() => { loadPersonas(); }, [loadPersonas]);

  // SQEM-561 — the card under an answer shows the viewer's own CURRENT title, read from the lists
  // they can see: playbooks (store, realtime), personas (above), files (store). Nothing found means
  // the viewer cannot open it, or it is gone — `changeLabel` decides what to show then.
  const libraryTitle = useCallback((c: LibraryChange): string | undefined => {
    if (c.kind === 'persona') return personas.find(p => p.id === c.id)?.title;
    if (c.kind === 'file') return workspaceFiles.find(f => f.id === c.id)?.name;
    return playbookTitles.get(c.id)?.title;
  }, [personas, workspaceFiles, playbookTitles]);

  // Navigated here from a persona card: load it with its routes and apply it.
  useEffect(() => {
    if (!launchPersonaId) return;
    let cancelled = false;
    fetchPersona(launchPersonaId)
      .then(persona => {
        if (cancelled || !persona) return;
        applyPersona(persona);
        showToast(txt.chat_using_persona({ title: persona.title }), 'success');
      })
      .catch(() => { /* a persona that cannot be read is simply not applied */ });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once per launch id, not on every prompts refresh
  }, [launchPersonaId]);

  /**
   * SQEM-550 (a) — send what the Start page handed over, exactly once.
   * ⛔ Once: `handoffSentRef` survives StrictMode's double effect run, the slot is cleared as soon as
   * the text is in the input, and Back/reload find nothing to send (it never was router state).
   * ⚠️ Waits for a model (no key → the text simply stays in the composer next to the usual hint,
   * SQEM-536) and, if a persona was chosen, for that persona to be applied first.
   */
  const handoffSentRef = useRef(false);
  const [handoffPersonaReady, setHandoffPersonaReady] = useState(() => !handoff?.personaId);
  useEffect(() => {
    if (!handoff) return;
    clearChatHandoff();
    if (!handoff.personaId) return;
    let cancelled = false;
    fetchPersona(handoff.personaId)
      .then(persona => { if (cancelled) return; if (persona) applyPersona(persona); setHandoffPersonaReady(true); })
      .catch(() => { if (!cancelled) setHandoffPersonaReady(true); });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once per handoff
  }, [handoff]);

  // Load session from route param
  useEffect(() => {
    if (!routeSessionId) return;
    if (sessionLoadedRef.current === routeSessionId) return;
    sessionLoadedRef.current = routeSessionId;

    (async () => {
      try {
        const stored = await fetchChatMessages(routeSessionId);
        supersededIdsRef.current = []; // SQEM-115 — a switch discards any unsent edit truncation
        setPreviewFile(null); // SQEM-595 — a file belongs to the chat it was made in
        setMessages(stored.map(m => ({
          id: m.id, role: m.role, content: inlineImagesToBlobUrls(m.content), model: m.model,
          userId: m.userId, userName: m.userName, userAvatar: m.userAvatar,
          playbookRef: m.playbookRef, loadedTemplateIds: m.loadedTemplateIds, // SQEM-551
          libraryChanges: m.libraryChanges, // SQEM-561
          webSources: m.webSources, // SQEM-594
          generatedFiles: m.generatedFiles, // SQEM-595
        })));
        setSessionId(routeSessionId);
        setMobileTab('chat');

        // SQEM-371 — restore what is applied to THIS session, and clear what belonged to the last.
        //
        // ⛔ Both halves were real defects when that ticket found them. The applied role was
        // written on create and never read, so a reload silently dropped it. And nothing cleared
        // the state on a switch, so context applied in session A kept governing session B — with
        // the header confirming it as if intended.
        //
        // ⚠️ Set unconditionally, including to empty. An early return on "nothing applied" would
        // leave the previous session's context in place, which is exactly the leak.
        try {
          const applied = await fetchAppliedContext(routeSessionId);
          // ⚠️ Ids that no longer resolve are dropped rather than reported: a template can vanish
          // by deletion OR by access control, and from here the two are indistinguishable. The
          // session keeps working with what is left.
          const skills = applied.appliedSkillIds
            .map(id => prompts.find(p => p.id === id && p.kind === 'skill'))
            .filter((p): p is Prompt => !!p);

          // SQEM-389 — the persona on the row is the role. Unresolvable (deleted, or invisible
          // through access control) → dropped, like a vanished skill.
          const persona = applied.personaId ? await fetchPersona(applied.personaId).catch(() => null) : null;

          const skillCtxs = await Promise.all(skills.map(sk => resolveAppliedContext(sk, workspaceFiles)));

          setActivePersona(persona);
          setActiveSystemInstruction(persona ? personaInstruction(persona, prompts) : '');
          setActiveSkills(skills.map((template, i) => ({ template, context: skillCtxs[i].text })));
        } catch {
          // A failed restore must not cost the conversation. Clear rather than keep the previous
          // session's context — wrong context is worse than none, and this is the leak's direction.
          setActivePersona(null);
          setActiveSystemInstruction('');
          setActiveSkills([]);
        }
      } catch {
        // SQEM-287 — a dead end otherwise: the conversation list is right there, and starting a
        // new chat loses nothing, but neither is obvious while staring at a failure.
        showToast('Could not load this conversation. Pick another from the list, or start a new one.', 'error');
      }
    })();
  }, [routeSessionId, showToast]);

  // Fetch shared sessions on-demand when tab selected
  useEffect(() => {
    if (sidebarTab !== 'shared' || !workspace.id) return;
    setSharedLoading(true);
    fetchSharedChatSessions(workspace.id, currentUser.id)
      .then(setSharedSessions)
      .catch(() => showToast(txt.chat_shared_load_failed(), 'error'))
      .finally(() => setSharedLoading(false));
  }, [sidebarTab, workspace.id, currentUser.id, showToast]);

  // 5a. Realtime subscription for messages from other collaborators
  useEffect(() => {
    if (!sessionId) return;
    const sub = supabase
      .channel(`chat_messages:${sessionId}`)
      .on('postgres_changes', { event: 'INSERT', schema: 'public',
          table: 'chat_messages', filter: `session_id=eq.${sessionId}` },
        (payload) => {
          const row = payload.new as any;
          if (row.user_id === currentUser.id) return; // skip own messages
          if (!row.content) return; // skip if payload was truncated (e.g. oversized image)
          setMessages(prev => {
            if (prev.some(m => m.id === row.id)) return prev;
            const sender = membersRef.current.find(m => m.id === row.user_id);
            return [...prev, {
              id: row.id, role: row.role, content: inlineImagesToBlobUrls(row.content),
              model: row.model || undefined,
              userId: row.user_id, userName: sender?.name, userAvatar: sender?.avatar,
              ...messagePlaybookFields(row), // SQEM-551 — same mapping as the history load
            }];
          });
        })
      .subscribe();
    return () => { supabase.removeChannel(sub); };
  }, [sessionId, currentUser.id]);

  // 5b. Sync model when collaborator changes it via Realtime on chat_sessions
  useEffect(() => {
    const active = chatSessions.find(s => s.id === sessionId);
    if (active && active.model && active.model !== selectedModel) {
      const isValid = enabledModels.some(m => m.id === active.model);
      setSelectedModel(isValid ? active.model : defaultModelId);
    }
  }, [chatSessions, sessionId, enabledModels, defaultModelId]);

  useEffect(() => {
    const container = messagesScrollRef.current;
    if (!container) return;
    const lastMsg = messages[messages.length - 1];
    if (lastMsg?.role === 'assistant' && lastAssistantRef.current) {
      // Scroll so the start of the assistant reply is ~20px below the top of the container.
      const offset = lastAssistantRef.current.offsetTop - container.offsetTop - 20;
      container.scrollTo({ top: offset, behavior: 'smooth' });
    } else {
      container.scrollTo({ top: container.scrollHeight, behavior: 'smooth' });
    }
  }, [messages]);

  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
      textareaRef.current.style.height = Math.min(textareaRef.current.scrollHeight, 200) + 'px';
    }
  }, [input]);

  // Close context menu on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setOpenMenuId(null);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  useEffect(() => {
    if (renamingId) renameInputRef.current?.focus();
  }, [renamingId]);

  // ── Conversation handlers ─────────────────────────────────────────────────

  // SQEM-583 — Stop: the server is asked to abort (that is what ends the cost), then the client stops
  // waiting. What was written so far is kept by the send handler's AbortError branch.
  const handleStop = () => {
    const job = runningJobRef.current;
    if (!job || job.stopped) return;
    job.stopped = true;
    requestChatJobCancel(job.jobId).catch(() => { /* a finished job needs no stop */ });
    abortControllerRef.current?.abort();
  };

  const handleNewChat = () => {
    // SQEM-583 — leaving a running answer stops it on the server too; before, it ran on unseen.
    if (runningJobRef.current) requestChatJobCancel(runningJobRef.current.jobId).catch(() => {});
    abortControllerRef.current?.abort();
    abortControllerRef.current = null;
    setIsLoading(false);
    setMessages([]);
    supersededIdsRef.current = []; // SQEM-115 — drop any unsent edit truncation
    setError(null);
    setErrorCode(null);
    setInput('');
    setAttachments([]);
    setActivePersona(null); // SQEM-389
    setActiveSystemInstruction('');
    setActiveSkills([]);
    setSessionId(null);
    sessionLoadedRef.current = null;
    navigate('/chat', { replace: true });
    setMobileTab('chat');
  };

  // SQEM-185 — stable so the memoized MessageItem doesn't re-render on unrelated Chat re-renders (typing).
  const handleCopyMessage = useCallback(async (msgId: string, content: string) => {
    try {
      await navigator.clipboard.writeText(content);
      setCopiedMessageId(msgId);
      setTimeout(() => setCopiedMessageId(prev => prev === msgId ? null : prev), 1500);
    } catch { showToast(txt.chat_copy_failed(), 'error'); }
  }, [showToast]);

  const processFile = (file: File) => {
    if (!SUPPORTED_MIME_TYPES.has(file.type)) {
      showToast(txt.chat_unsupported_file(), 'error'); return;
    }
    if (file.size > MAX_FILE_SIZE_BYTES) {
      showToast(txt.chat_file_too_big({ size: MAX_FILE_SIZE_MB }), 'error'); return;
    }
    const reader = new FileReader();
    reader.onloadend = () => setAttachments(prev => [...prev, { id: crypto.randomUUID(), file, dataUrl: reader.result as string, mimeType: file.type }]);
    reader.readAsDataURL(file);
  };

  // Persist an uploaded file to the workspace library (when "Save to workspace" is on).
  const saveFileToWorkspace = async (file: File) => {
    if (!SUPPORTED_MIME_TYPES.has(file.type) || file.size > MAX_FILE_SIZE_BYTES) return;
    try {
      const wf = await uploadWorkspaceFile(workspace.id, file);
      addWorkspaceFile(wf);
    } catch {
      showToast(txt.chat_save_to_workspace_failed({ name: file.name }), 'error');
    }
  };

  const handleFileSelect   = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (files) {
      const arr = Array.from(files);
      arr.forEach(processFile);
      if (saveToWorkspace) arr.forEach(saveFileToWorkspace);
    }
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  // Attach existing workspace files to the message (fetch via signed URL → base64).
  const attachWorkspaceFiles = async (selected: WorkspaceFile[]) => {
    for (const f of selected) {
      if (f.sizeBytes > MAX_FILE_SIZE_BYTES) { showToast(txt.chat_attach_too_large({ name: f.name }), 'error'); continue; }
      try {
        const url = await getWorkspaceFileSignedUrl(f.storagePath);
        const res = await fetch(url);
        const blob = await res.blob();
        const dataUrl: string = await new Promise((resolve, reject) => {
          const reader = new FileReader();
          reader.onloadend = () => resolve(reader.result as string);
          reader.onerror = reject;
          reader.readAsDataURL(blob);
        });
        setAttachments(prev => [...prev, { id: crypto.randomUUID(), file: new File([], f.name, { type: f.mimeType }), dataUrl, mimeType: f.mimeType }]);
      } catch {
        showToast(txt.chat_attach_failed({ name: f.name }), 'error');
      }
    }
  };
  const handleDragOver     = (e: React.DragEvent) => { e.preventDefault(); e.stopPropagation(); setDragActive(true); };
  const handleDragLeave    = (e: React.DragEvent) => { e.preventDefault(); e.stopPropagation(); setDragActive(false); };
  const handleDrop         = (e: React.DragEvent) => { e.preventDefault(); e.stopPropagation(); setDragActive(false); const files = e.dataTransfer.files; if (files) Array.from(files).forEach(processFile); };
  const removeAttachment   = (id: string) => setAttachments(prev => prev.filter(a => a.id !== id));

  useEffect(() => {
    if (!attachMenuOpen) return;
    const handler = (e: MouseEvent) => {
      if (attachMenuRef.current && !attachMenuRef.current.contains(e.target as Node)) setAttachMenuOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [attachMenuOpen]);

  // SQEM-149 — load the workspace's connectors.
  useEffect(() => { fetchConnectors(workspace.id).then(setConnectors).catch(() => {}); }, [workspace.id]);

  /**
   * SQEM-436 — whether the MODEL currently chosen can reach connectors.
   *
   * ⚠️ The selected model, not "does a Claude key exist anywhere". The old menu was shown on the
   * latter, which answered a different question: a workspace with a Claude key could be chatting on
   * Gemini and still be offered connectors that would never be sent.
   *
   * Connector ids are withheld when the answer is no; `chat-message` would ignore them anyway. (They
   * used to raise the client timeout too — since SQEM-582 every Cloud turn gets the long pair.)
   */
  // SQEM-584 — every TEXT model: Claude and OpenAI run connectors themselves, all others through
  // sqemes' own MCP client. Only image models cannot use them.
  const connectorsSupported = useMemo(() => {
    const m = AVAILABLE_MODELS.find(x => x.id === selectedModel) ?? enabledModels.find(x => x.id === selectedModel);
    return !!m && !isImageModel(m.id);
  }, [selectedModel, enabledModels]);
  const activeConnectorIds = useMemo(
    () => (connectorsSupported ? connectors.map(c => c.id) : []),
    [connectorsSupported, connectors],
  );
  // SQEM-594 — web search needs a text model (same rule as connectors) and a search key: sqemes' own
  // on Cloud, or the workspace's (Linkup or Brave). Self-host without one: the button says where to add it.
  const webKeyAvailable = !!workspace.webSearchHosted || !!workspace.apiKeys.search_linkup || !!workspace.apiKeys.search_brave;
  const webAvailable = connectorsSupported && webKeyAvailable;

  // SQEM-185 — useCallback so the memoized MessageItem stays memoized between keystrokes. Depends on
  // `messages` (unchanged while typing), so it's stable on the hot path but current when messages change.
  const handleEditMessage = useCallback((msg: ChatMsg) => {
    const idx = messages.findIndex(m => m.id === msg.id);
    if (idx >= 0) {
      // SQEM-115 — remember the truncated tail so it's pruned from the DB on the next send
      // (otherwise fetchChatMessages resurrects the edited/removed messages on reload).
      supersededIdsRef.current = [...new Set([...supersededIdsRef.current, ...messages.slice(idx).map(m => m.id)])];
      setMessages(messages.slice(0, idx));
    }
    setInput(msg.content);
    pendingPlaybookRef.current = pendingFromSent(msg.playbookRef, msg.content); // SQEM-551 — the card comes back with it
    if (msg.attachments?.length) {
      setAttachments(msg.attachments.map(a => ({ id: crypto.randomUUID(), file: new File([], 'restored'), dataUrl: a.dataUrl, mimeType: a.mimeType })));
    } else {
      setAttachments([]);
    }
    textareaRef.current?.focus();
  }, [messages]);

  // SQEM-185 — stable avatar-error handler + the last-assistant index computed once (was an O(n²)
  // `messages.map(...).lastIndexOf('assistant')` inside the render map).
  const handleAvatarError = useCallback(() => setAvatarLoadError(true), []);
  const lastAssistantIndex = useMemo(() => {
    for (let i = messages.length - 1; i >= 0; i--) if (messages[i].role === 'assistant') return i;
    return -1;
  }, [messages]);

  const handleEnhanceInput = async () => {
    const trimmed = input.trim();
    if (!trimmed) return;
    setIsEnhancing(true);
    try {
      // Always use a text-capable model — never route enhance through an image
      // generation model (it would generate an image instead of refining text).
      const IMAGE_MODEL_PATTERNS = ['image', 'dall-e', 'aurora'];
      const textModel = enabledModels.find(
        m => !IMAGE_MODEL_PATTERNS.some(p => m.id.toLowerCase().includes(p))
      );
      if (!textModel) {
        showToast(txt.chat_enhance_no_model(), 'error');
        return;
      }

      const { data: { session } } = await supabase.auth.getSession();
      if (!session) throw new Error(txt.chat_not_authenticated());
      const jobId = crypto.randomUUID();
      const resultPromise = waitForJobResult(jobId);
      const funded = isFundedModel(textModel.id);
      const res = await fetch(functionCallUrl('execute-step'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${session.access_token}` },
        body: JSON.stringify({
          workspaceId: workspace.id,
          modelId: funded ? undefined : textModel.id,
          funded,
          // SQEM-390 — the composer enhances a PROMPT, from the shared module; the extension keeps
          // a byte-identical copy of this one variant (its documented twin).
          systemInstruction: enhancePrompt('prompt'),
          promptContent: enhanceInput('prompt', trimmed),
          jobId,
        }),
      });
      if (!res.ok) { const err = await res.json().catch(() => ({ error: res.statusText })); throw new Error(err.error || txt.chat_error_status({ status: res.status })); }
      const data = await res.json();
      if (data?.error) throw new Error(data.error);
      const enhancedResult = data?.result ?? await resultPromise;
      if (enhancedResult) setInput(enhancedResult);
    } catch (err: any) {
      showToast(err.message || txt.chat_enhance_failed(), 'error');
    } finally {
      setIsEnhancing(false);
    }
  };

  // SQEM-101 — after the first exchange of a new chat, generate a concise topic title
  // (3–6 words) with the cheapest available text model and replace the truncated
  // first-message title. Fire-and-forget: any failure silently keeps the truncation title.
  const generateChatTitle = async (firstUserMsg: string, firstAssistantReply: string, targetSessionId: string) => {
    try {
      const IMAGE_MODEL_PATTERNS = ['image', 'dall-e', 'aurora'];
      const textModels = enabledModels.filter(m => !IMAGE_MODEL_PATTERNS.some(p => m.id.toLowerCase().includes(p)));
      if (textModels.length === 0) return;
      // Cheapest by spec cost (falls back to the first text model if specs are unavailable).
      const model = [...textModels].sort((a: any, b: any) => (a.specs?.cost ?? 99) - (b.specs?.cost ?? 99))[0];
      const funded = isFundedModel(model.id);

      const { data: { session } } = await supabase.auth.getSession();
      if (!session) return;

      const jobId = crypto.randomUUID();
      const resultPromise = waitForJobResult(jobId);
      const res = await fetch(functionCallUrl('execute-step'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${session.access_token}` },
        body: JSON.stringify({
          workspaceId: workspace.id,
          modelId: funded ? undefined : model.id,
          funded,
          systemInstruction: 'You write an extremely short title for a chat conversation. Reply with ONLY the title: 3 to 6 words, in the same language as the conversation, no surrounding quotes, no trailing punctuation, no markdown.',
          promptContent: `Conversation:\nUser: ${firstUserMsg.slice(0, 1000)}\nAssistant: ${firstAssistantReply.slice(0, 800)}\n\nTitle:`,
          jobId,
        }),
      });
      if (!res.ok) return;
      const data = await res.json();
      if (data?.error) return;
      const raw = (data?.result ?? await resultPromise) as string;
      if (!raw) return;
      const title = raw.trim().split('\n')[0].replace(/^["'`*#\s]+|["'`*.\s]+$/g, '').slice(0, 70).trim();
      if (title) storeUpdateSession(targetSessionId, { title }).catch(() => {});
    } catch { /* keep the truncated first-message title */ }
  };

  // SQEM-551 — an emptied composer is a new message, not an edit of the inserted playbook.
  useEffect(() => {
    if (!input.trim()) pendingPlaybookRef.current = null;
  }, [input]);

  // SQEM-550 (a) — see `handoffSentRef` above.
  useEffect(() => {
    if (!handoff || handoffSentRef.current || !handoffPersonaReady || !selectedModel || isLoading) return;
    if (input.trim() !== handoff.draft) return; // the person started editing — leave it to them
    handoffSentRef.current = true;
    void handleSend();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- handleSend is recreated every render
  }, [handoff, handoffPersonaReady, selectedModel, isLoading, input]);

  const handleSend = async () => {
    const trimmed = input.trim();
    if (!trimmed || isLoading || !selectedModel) return;

    // SQEM-170 — Content Governance is a Cloud-only feature
    if (!IS_SELF_HOSTED) {
      const violation = checkContentViolation(trimmed, workspace);
      if (violation) { showToast(violation, 'error'); return; }
    }

    abortControllerRef.current?.abort();
    const controller = new AbortController();
    abortControllerRef.current = controller;

    const currentAttachments = attachments.map(a => ({ mimeType: a.mimeType, dataUrl: a.dataUrl }));
    const playbookRef = finalizeRef(pendingPlaybookRef.current, trimmed); // SQEM-551
    pendingPlaybookRef.current = null;
    const userMsg: ChatMsg = { id: crypto.randomUUID(), role: 'user', content: trimmed, attachments: currentAttachments.length > 0 ? currentAttachments : undefined, playbookRef };

    setMessages(prev => [...prev, userMsg]);
    setInput('');
    setAttachments([]);
    // SQEM-594 — read once for this message, then switched off for the next one.
    const webThis = webNext && webAvailable;
    setWebNext(false);
    setError(null);
    setErrorCode(null);
    setIsLoading(true);
    if (textareaRef.current) textareaRef.current.style.height = 'auto';

    const isNewSession = !sessionId;
    let activeSessionId: string | null = sessionId;
    let started: { jobId: string; assistantMsgId: string } | null = null; // SQEM-583

    try {
      if (!activeSessionId) {
        const title = trimmed.slice(0, 60).trim() + (trimmed.length > 60 ? '…' : '');
        const newSession = await createChatSession(
          workspace.id, currentUser.id, title, selectedModel,
          // SQEM-371 — a skill applied BEFORE the first message has no session to be written
          // to yet; it rides along here. Without this it would survive until the first reload
          // and then quietly disappear — the exact failure this ticket exists to remove.
          activeSkills.map(sk => sk.template.id),
          activePersona?.id, // SQEM-389 — same reason as the skills: applied before the row existed
        );
        activeSessionId = newSession.id;
        sessionLoadedRef.current = activeSessionId; // prevent fetch from overwriting optimistic messages
        setSessionId(activeSessionId);
        addChatSession(newSession);
        navigate(`/chat/${activeSessionId}`, { replace: true });
      }

      storeUpdateSession(activeSessionId, { isGenerating: true }).catch(() => {});

      const userContentForStorage = currentAttachments.length > 0
        ? `${trimmed}\n${currentAttachments.map(a => `[Attachment: ${a.mimeType}]`).join('\n')}`.trim()
        : trimmed;

      // SQEM-115 — prune messages truncated by an edit before persisting the new exchange. Private
      // chats only: a shared session's tail can contain collaborators' messages (and the delete RLS
      // blocks those regardless). Clear the ref either way so it never leaks across sessions.
      if (supersededIdsRef.current.length) {
        if (chatSessions.find(cs => cs.id === activeSessionId)?.visibility === 'private') {
          deleteChatMessages(supersededIdsRef.current).catch(() => {});
        }
        supersededIdsRef.current = [];
      }

      // Persist the user message with its local id (SQEM-115) so local == DB ids for pruning.
      addChatMessage(activeSessionId, 'user', userContentForStorage, undefined, currentUser.id, userMsg.id, { playbookRef }).catch(() => {});

      const allMessages = [...messages, userMsg].map(m => {
        if (m.attachments?.length) {
          const content: any[] = m.attachments.map(a => ({ inlineData: { mimeType: a.mimeType, data: a.dataUrl.split(',')[1] } }));
          if (m.content) content.push({ text: m.content });
          return { role: m.role, content };
        }
        return { role: m.role, content: m.content };
      });

      const { data: { session } } = await supabase.auth.getSession();
      if (!session) throw new Error(txt.chat_not_authenticated());

      const modelInfo = AVAILABLE_MODELS.find(m => m.id === selectedModel) ?? enabledModels.find(m => m.id === selectedModel);
      const assistantMsgId = crypto.randomUUID();
      const jobId = crypto.randomUUID();
      started = { jobId, assistantMsgId };
      runningJobRef.current = { jobId, stopped: false };
      streamedTextRef.current = '';
      // Funded (keyless) → send `funded` and omit modelId; the server picks the funded model.
      const funded = isFundedModel(selectedModel);
      // SQEM-370 — the zone is the only part of the time context the client knows; the server
      // formats the moment in it, per request. Read at send time, not at session start: someone who
      // travels, or whose machine changes zone, should not keep the old one for the session's life.
      const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
      const chatPayloadBase = { workspaceId: workspace.id, modelId: funded ? undefined : selectedModel, funded, systemInstruction: composeSystemInstruction(activeSystemInstruction || null, activeSkills.map(s => s.context)), timeZone };
      const messagesToSend = truncateMessagesToPayloadLimit(allMessages, chatPayloadBase);

      // Show thinking bubble immediately — before the fetch even completes
      setMessages(prev => [...prev, { id: assistantMsgId, role: 'assistant', content: '', pending: true, model: modelInfo?.name || selectedModel }]);

      // Subscribe to Realtime before sending the request
      //
      // SQEM-372 — the third argument paints the answer as it is written. ⚠️ Each delta carries the
      // WHOLE text so far, so this REPLACES the content instead of appending: a dropped broadcast
      // then repairs itself on the next one rather than leaving a hole.
      //
      // `pending` is cleared on the first delta — the thinking bubble has done its job the moment
      // there is text to show, and leaving it would render a spinner above the reply it announced.
      //
      // SQEM-381 — with connectors the server MAY allow the provider 300 s instead of 120 (every
      // remote tool call runs inside that one request), and the client has to outlast it or the
      // server's honest 504 arrives at nobody. Same module as the server, so the two cannot drift —
      // including the `EDGE_PLAN_IS_PAID` gate, which keeps both at the default pair on a free plan.
      let loadedTemplateIds: string[] = [];
      let libraryChanges: LibraryChange[] = []; // SQEM-561
      let webSources: WebSources | null = null; // SQEM-594
      let generatedFiles: GeneratedFile[] = []; // SQEM-595
      const resultPromise = waitForJobResult(jobId, controller.signal, (textSoFar) => {
        streamedTextRef.current = textSoFar;
        setMessages(prev => prev.map(m => (
          m.id === assistantMsgId ? { ...m, content: textSoFar, pending: false } : m
        )));
      }, clientJobTimeoutMs({ selfHosted: IS_SELF_HOSTED }),
      // SQEM-551 — what the model loaded for this answer ("Used" chips).
      (meta) => {
        loadedTemplateIds = normalizeLoadedIds(meta.loadedTemplateIds);
        libraryChanges = normalizeLibraryChanges(meta.libraryChanges);
        webSources = normalizeWebSources(meta.webSources);
        generatedFiles = normalizeGeneratedFiles(meta.generatedFiles);
      }, clientHardCapMs({ selfHosted: IS_SELF_HOSTED })); // SQEM-582 — deltas may extend up to this

      const res = await fetch(functionCallUrl('chat-message'), {
        method: 'POST',
        signal: controller.signal,
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${session.access_token}` },
        body: JSON.stringify({ ...chatPayloadBase, messages: messagesToSend, jobId, connectorIds: activeConnectorIds, ...(webThis ? { webSearch: true } : {}), locale: getLocale() }),
      });

      if (!res.ok) throw await edgeError(res);

      const resData = await res.json();
      if (resData?.error) throw new Error(resData.error);

      let rawResult: string;

      if (resData?.result !== undefined) {
        // Image generation models return { result } directly (fast path, no jobId)
        rawResult = resData.result || txt.chat_no_content();
        setMessages(prev => prev.map(m => m.id === assistantMsgId ? { ...m, content: inlineImagesToBlobUrls(rawResult), pending: false } : m));
      } else {
        // Text model — wait for Realtime broadcast
        rawResult = await resultPromise;
        setMessages(prev => prev.map(m => m.id === assistantMsgId ? { ...m, content: inlineImagesToBlobUrls(rawResult), pending: false, loadedTemplateIds, libraryChanges, webSources, generatedFiles } : m));
        // SQEM-561 — playbooks arrive through the store's realtime channel; personas and files do not,
        // so the lists the card and the pickers read from are fetched again when either changed.
        if (libraryChanges.some(c => c.kind === 'persona')) {
          loadPersonas();
        }
        if (libraryChanges.some(c => c.kind === 'file')) {
          fetchWorkspaceFiles(workspace.id).then(setWorkspaceFiles).catch(() => { /* reloaded with the next page load */ });
        }
      }

      // Save original base64 content to DB (use same ID so realtime can deduplicate)
      if (activeSessionId) addChatMessage(activeSessionId, 'assistant', rawResult, selectedModel, undefined, assistantMsgId, { loadedTemplateIds, libraryChanges, webSources, generatedFiles }).catch(() => {});

      // First exchange of a new chat → upgrade the truncated title to an AI topic title.
      if (isNewSession && activeSessionId) generateChatTitle(trimmed, rawResult, activeSessionId);
    } catch (err: any) {
      const job = runningJobRef.current;
      if (err.name === 'AbortError' && started && job?.jobId === started.jobId && job.stopped) {
        // SQEM-583 — stopped on purpose: keep what was written, say that it ends here, and store it.
        const content = stoppedContent(streamedTextRef.current);
        const { assistantMsgId } = started;
        setMessages(prev => prev.map(m => (m.id === assistantMsgId ? { ...m, content, pending: false } : m)));
        if (activeSessionId) addChatMessage(activeSessionId, 'assistant', content, selectedModel, undefined, assistantMsgId).catch(() => {});
      } else if (err.name !== 'AbortError') { setError(err.message); setErrorCode(err.code ?? null); }
    } finally {
      if (started && runningJobRef.current?.jobId === started.jobId) runningJobRef.current = null;
      setIsLoading(false);
      if (activeSessionId) storeUpdateSession(activeSessionId, { isGenerating: false }).catch(() => {});
    }
  };

  const addContextImages = (images: ContextImage[]) => {
    setAttachments(prev => [
      ...prev,
      ...images.map(img => ({
        id: crypto.randomUUID(),
        file: new File([], img.name, { type: img.mimeType }),
        dataUrl: img.dataUrl,
        mimeType: img.mimeType,
      })),
    ]);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    // SQEM-360 — `Enter` sends only where `Shift+Enter` exists to make a line break. On a touch
    // keyboard it does not, so Return stays Return and the send button beside the field sends.
    if (shouldSendOnEnter(e, coarsePointer)) { e.preventDefault(); handleSend(); }
    if (e.key === '/' && !input.trim()) {
      e.preventDefault();
      setTemplateModalInitId(null);
      setTemplateModalOpen(true);
    }
  };

  // ── Session sidebar handlers ──────────────────────────────────────────────

  const handleSelectSession = (session: ChatSession) => {
    navigate(`/chat/${session.id}`);
    setMobileTab('chat');
  };

  const handleStartRename = (session: ChatSession) => {
    setRenamingId(session.id);
    setRenameValue(session.title);
    setOpenMenuId(null);
  };

  const handleRenameSubmit = async (id: string) => {
    const trimmed = renameValue.trim();
    if (trimmed) await storeUpdateSession(id, { title: trimmed });
    setRenamingId(null);
  };

  const handleToggleVisibility = async (session: ChatSession) => {
    const next = session.visibility === 'private' ? 'workspace' : 'private';
    await storeUpdateSession(session.id, { visibility: next });
    setOpenMenuId(null);
    showToast(next === 'workspace' ? txt.chat_shared_with_workspace() : txt.chat_set_private(), 'success');
  };

  /**
   * SQEM-357 — a workspace admin withdraws somebody else's shared chat.
   *
   * ⛔ Deliberately NOT part of the owner context menu. That menu offers rename, share and delete —
   * every one of which would be wrong for a person who does not own the conversation. An admin gets
   * exactly one action, and it is the only one that is anybody else's business.
   *
   * ⚠️ The chat is not lost: the author still sees it, and the existing expiry trigger gives it 30
   * days before it goes. Withdrawing sharing is reversible by its owner for a month.
   */
  const handleWithdrawSharing = async (session: ChatSession) => {
    try {
      await unshareChatSession(session.id);
      setSharedSessions(prev => prev.filter(s => s.id !== session.id));
      showToast(txt.chat_withdrawn(), 'success');
    } catch (err: any) {
      showToast(err?.message || txt.chat_withdraw_failed(), 'error');
    }
  };

  const handleDeleteConfirm = async (id: string) => {
    await storeDeleteSession(id);
    setDeleteConfirmId(null);
    if (sessionId === id) handleNewChat();
  };

  // ── Derived ───────────────────────────────────────────────────────────────

  const modelInfo = AVAILABLE_MODELS.find(m => m.id === selectedModel) ?? enabledModels.find(m => m.id === selectedModel);
  const activeSession = chatSessions.find(s => s.id === sessionId);
  const otherIsGenerating = !!activeSession?.isGenerating && !isLoading;

  // ── Session list item ─────────────────────────────────────────────────────

  const renderSession = (session: ChatSession) => {
    const isActive    = session.id === sessionId;
    const isOwner     = session.isOwner;
    const showOwner   = sidebarTab === 'shared';
    const ownerLabel  = isOwner ? 'You' : (session.ownerName || 'Teammate');

    return (
      // SQEM-538 — the row is not a click target itself: the title is a real button whose ::after
      // covers the row (the TemplateCard pattern), so the row works by keyboard and has a name. The
      // row's own controls sit above that layer with `relative z-10`.
      <div
        key={session.id}
        className={`group relative flex items-start gap-2.5 px-3 py-2.5 rounded-xl cursor-pointer transition-all ${
          isActive ? 'bg-brand-50 dark:bg-brand-900/20 border border-brand-100 dark:border-brand-800' : 'hover:bg-slate-50 dark:hover:bg-slate-700 border border-transparent'
        }`}
      >
        <div className={`w-7 h-7 rounded-lg flex items-center justify-center shrink-0 mt-0.5 overflow-hidden ${isActive ? 'bg-brand-100 dark:bg-brand-800' : 'bg-slate-100 dark:bg-slate-600'}`}>
          {showOwner && session.ownerAvatar ? (
            <Avatar src={session.ownerAvatar} name={ownerLabel} className="w-full h-full" rounded="rounded-lg" />
          ) : showOwner ? (
            <span className={`text-xs font-bold ${isActive ? 'text-brand-600 dark:text-brand-300' : 'text-slate-500 dark:text-slate-400'}`}>
              {ownerLabel.charAt(0).toUpperCase()}
            </span>
          ) : (
            <MessageSquare className={`w-3.5 h-3.5 ${isActive ? 'text-brand-600 dark:text-brand-400' : 'text-slate-400 dark:text-slate-500'}`} />
          )}
        </div>

        <div className="flex-1 min-w-0">
          {renamingId === session.id ? (
            <input
              ref={renameInputRef}
              value={renameValue}
              onChange={e => setRenameValue(e.target.value)}
              onBlur={() => handleRenameSubmit(session.id)}
              onKeyDown={e => { if (e.key === 'Enter') handleRenameSubmit(session.id); if (e.key === 'Escape') setRenamingId(null); }}
              onClick={e => e.stopPropagation()}
              className="w-full text-xs font-medium text-slate-900 dark:text-slate-100 bg-white dark:bg-slate-700 border border-brand-400 rounded-md px-1.5 py-0.5 outline-none"
            />
          ) : (
            <button
              type="button"
              onClick={() => handleSelectSession(session)}
              aria-current={isActive ? 'page' : undefined}
              className={`block w-full text-left text-xs font-medium truncate leading-snug after:absolute after:inset-0 after:content-[''] after:rounded-xl ${isActive ? 'text-brand-900 dark:text-brand-300' : 'text-slate-700 dark:text-slate-200'}`}
            >
              {session.title}
            </button>
          )}
          <div className="flex items-center gap-1 mt-0.5">
            <p className="text-2xs text-slate-400 dark:text-slate-500 shrink-0">{formatRelativeTime(session.lastActiveAt)}</p>
            {showOwner && (
              <p className="text-2xs text-slate-400 truncate">· {ownerLabel}</p>
            )}
          </div>
        </div>

        {/* Visibility icon */}
        {/* SQEM-594 — shared chats are marked with Users: the globe now means web search. */}
        {isOwner && session.visibility === 'workspace' && (
          <Users className="w-3 h-3 text-brand-400 shrink-0 mt-1" aria-label={txt.chat_shared_with_team()} />
        )}

        {/* SQEM-357 — the one action an admin has on somebody else's shared chat. A dead artefact
            otherwise: its author has left the workspace, only they could withdraw it, and a shared
            session never expires. */}
        {!isOwner && session.visibility === 'workspace' && can(currentUser, workspace, 'team:manage') && (
          <button
            onClick={e => { e.stopPropagation(); handleWithdrawSharing(session); }}
            title={txt.chat_withdraw_title()}
            className="relative z-10 p-1.5 shrink-0 text-slate-300 dark:text-slate-600 hover:text-slate-600 dark:hover:text-slate-300 rounded-md transition-all reveal-on-hover"
          >
            <Lock className="w-3.5 h-3.5" />
          </button>
        )}

        {/* Context menu (owner only) */}
        {isOwner && (
          <div className="relative z-10 shrink-0" ref={openMenuId === session.id ? menuRef : null}>
            <button
              onClick={e => { e.stopPropagation(); setOpenMenuId(openMenuId === session.id ? null : session.id); }}
              className="p-1.5 text-slate-300 dark:text-slate-600 hover:text-slate-600 dark:hover:text-slate-300 rounded-md transition-all reveal-on-hover"
            >
              <MoreHorizontal className="w-3.5 h-3.5" />
            </button>

            {openMenuId === session.id && (
              <div
                className="absolute right-0 top-6 w-44 bg-white dark:bg-slate-800 rounded-xl shadow-xl border border-slate-100 dark:border-slate-700 py-1 z-50 animate-scale-up origin-top-right"
                onClick={e => e.stopPropagation()}
              >
                <button onClick={() => handleStartRename(session)} className="w-full flex items-center gap-2.5 px-3 py-2 text-xs text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700 transition-colors">
                  <Pencil className="w-3.5 h-3.5" /> {txt.chat_rename()}
                </button>
                <button onClick={() => handleToggleVisibility(session)} className="w-full flex items-center gap-2.5 px-3 py-2 text-xs text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700 transition-colors">
                  {session.visibility === 'workspace' ? <><Lock className="w-3.5 h-3.5" /> {txt.chat_make_private()}</> : <><Users className="w-3.5 h-3.5" /> {txt.chat_share_team()}</>}
                </button>
                <div className="border-t border-slate-100 dark:border-slate-700 mt-1 pt-1">
                  <button onClick={() => { setDeleteConfirmId(session.id); setOpenMenuId(null); }} className="w-full flex items-center gap-2.5 px-3 py-2 text-xs text-red-500 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors">
                    <Trash2 className="w-3.5 h-3.5" /> {txt.chat_delete()}
                  </button>
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    );
  };

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="flex flex-col h-dvh bg-slate-50 dark:bg-slate-900 overflow-hidden">

      {/* ── Mobile tab switcher ── */}
      <div className="md:hidden flex border-b border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 z-20 shrink-0">
        <button
          onClick={() => setMobileTab('sessions')}
          className={`flex-1 py-3 text-sm font-medium flex items-center justify-center gap-2 ${mobileTab === 'sessions' ? 'text-brand-600 border-b-2 border-brand-600' : 'text-slate-500 dark:text-slate-400'}`}
        >
          <MessageSquare className="w-4 h-4" /> {txt.chat_tab_chats()}
        </button>
        <button
          onClick={() => setMobileTab('chat')}
          className={`flex-1 py-3 text-sm font-medium flex items-center justify-center gap-2 ${mobileTab === 'chat' ? 'text-brand-600 border-b-2 border-brand-600' : 'text-slate-500 dark:text-slate-400'}`}
        >
          <Bot className="w-4 h-4" /> {txt.chat_tab_conversation()}
        </button>
      </div>

      <div className="flex-1 min-h-0 flex flex-col md:flex-row overflow-hidden">

        {/* ════════════════════════════════════════════════════════════════
            LEFT PANEL — session list
        ════════════════════════════════════════════════════════════════ */}
        <div className={`w-full md:w-[300px] bg-surface-sunken dark:bg-surface-raised border-r border-line flex-col h-full shrink-0 ${mobileTab === 'sessions' ? 'flex' : 'hidden md:flex'}`}>

          {/* Panel header */}
          <div className="p-4 border-b border-line shrink-0">
            {/* SQEM-206/208 — Chat is a full-screen mode, and this is the door out of it. The
                behaviour now lives in FullScreenExit, shared with the editor and the marketplace
                detail page; `escapeReady` is what keeps Escape from firing while something more
                local should consume it. */}
            <div className="flex items-center gap-2 mb-4">
              <img src="/logo-favicon-V2.png" alt="sqemes" className="w-8 h-8 rounded-lg shrink-0" />
              <FullScreenExit
                label={txt.chat_back_to_start()}
                onExit={() => navigate('/')}
                escapeEnabled
                escapeReady={
                  !templateModalOpen && !searchOpen && !attachMenuOpen &&
                  !workspacePickerOpen && !renamingId && !openMenuId && !deleteConfirmId
                }
                className="flex-1"
              />
            </div>
            <button
              onClick={handleNewChat}
              className="w-full flex items-center justify-center gap-2 px-4 py-2.5 bg-accent-strong text-white rounded-control text-sm font-semibold hover:opacity-90 transition-opacity"
            >
              <MessageSquarePlus className="w-4 h-4" /> {txt.chat_new_chat()}
            </button>
            {/* Search (SQEM-173) — labeled entry under New Chat; ⌘K/Ctrl+K also opens it */}
            <button
              onClick={() => setSearchOpen(true)}
              title={txt.chat_search_title()}
              className="w-full mt-2 flex items-center gap-2 px-4 py-2 text-sm font-medium text-slate-600 dark:text-slate-300 bg-slate-50 dark:bg-slate-700/50 border border-slate-200 dark:border-slate-600 rounded-xl hover:bg-slate-100 dark:hover:bg-slate-700 transition-colors"
            >
              <Search className="w-4 h-4 shrink-0 text-slate-400 dark:text-slate-500" />
              <span>{txt.chat_search()}</span>
              <kbd className="ml-auto hidden sm:inline-flex items-center text-2xs font-sans font-semibold text-slate-400 dark:text-slate-500 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-600 rounded px-1.5 py-0.5">
                {searchShortcutHint}
              </kbd>
            </button>
          </div>

          {/* My Chats / Shared toggle */}
          <div className="px-4 pt-3 pb-2 shrink-0">
            <div className="flex gap-1 bg-slate-100 dark:bg-slate-700 rounded-xl p-1">
              <button
                onClick={() => setSidebarTab('mine')}
                className={`flex-1 py-1.5 rounded-lg text-xs font-medium transition-all ${sidebarTab === 'mine' ? 'bg-white dark:bg-slate-600 text-slate-900 dark:text-slate-100 shadow-sm' : 'text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200'}`}
              >
                {txt.chat_my_chats()}
                {mySessions.length > 0 && <span className="ml-1 text-slate-400 dark:text-slate-500">{mySessions.length}</span>}
              </button>
              <button
                onClick={() => setSidebarTab('shared')}
                className={`flex-1 py-1.5 rounded-lg text-xs font-medium transition-all ${sidebarTab === 'shared' ? 'bg-white dark:bg-slate-600 text-slate-900 dark:text-slate-100 shadow-sm' : 'text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200'}`}
              >
                {txt.chat_shared()}
                {sharedSessions.length > 0 && <span className="ml-1 text-slate-400 dark:text-slate-500">{sharedSessions.length}</span>}
              </button>
            </div>
          </div>

          {/* Session list */}
          <div className="flex-1 overflow-y-auto px-2 pb-4 space-y-0.5">
            {sidebarTab === 'mine' && (
              mySessions.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-10 px-4 text-center">
                  <div className="w-10 h-10 bg-slate-50 dark:bg-slate-700 rounded-full flex items-center justify-center mb-3">
                    <MessageSquare className="w-5 h-5 text-slate-300 dark:text-slate-500" />
                  </div>
                  <p className="text-xs font-semibold text-slate-500 dark:text-slate-400 mb-0.5">{txt.chat_no_chats()}</p>
                  <p className="text-xs text-slate-400 dark:text-slate-500">{txt.chat_no_chats_hint()}</p>
                </div>
              ) : (
                mySessions.map(s => renderSession(s))
              )
            )}

            {sidebarTab === 'shared' && (
              sharedLoading ? (
                <div className="flex items-center justify-center py-10">
                  <Loader2 className="w-5 h-5 text-slate-300 animate-spin" />
                </div>
              ) : sharedSessions.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-10 px-4 text-center">
                  <div className="w-10 h-10 bg-slate-50 dark:bg-slate-700 rounded-full flex items-center justify-center mb-3">
                    <Users className="w-5 h-5 text-slate-300 dark:text-slate-500" />
                  </div>
                  <p className="text-xs font-semibold text-slate-500 dark:text-slate-400 mb-0.5">{txt.chat_no_shared()}</p>
                  <p className="text-xs text-slate-400 dark:text-slate-500">{txt.chat_no_shared_hint()}</p>
                </div>
              ) : (
                sharedSessions.map(s => renderSession(s))
              )
            )}
          </div>
          <p className="text-center text-2xs text-slate-400 dark:text-slate-500 px-4 pb-3 shrink-0">{txt.chat_private_expiry()}</p>
        </div>

        {/* ════════════════════════════════════════════════════════════════
            RIGHT PANEL — conversation
        ════════════════════════════════════════════════════════════════ */}
        <div className={`flex-1 flex-col min-h-0 h-full overflow-hidden bg-surface ${mobileTab === 'chat' ? 'flex' : 'hidden md:flex'}`}>

          {/* Top bar */}
          <div className="border-b border-line bg-surface-raised px-4 py-3 flex items-center gap-2 shrink-0 flex-wrap">
            {/* Model selector */}
            <ModelSelect
              models={enabledModels}
              value={selectedModel}
              onChange={id => {
                setSelectedModel(id);
                if (sessionId) storeUpdateSession(sessionId, { model: id });
              }}
              emptyLabel={txt.chat_no_model()}
              // SQEM-536 — only someone who can add a key gets the button; a member's tab has no key card.
              emptyActionLabel={keyHint.actionLabel ?? undefined}
              emptyActionIcon={<Key className="w-3.5 h-3.5" />}
              onEmptyAction={keyHint.actionLabel ? openProviderKeys : undefined}
              /**
               * SQEM-446 — mark the models your connectors actually reach.
               *
               * ⚠️ Only when the workspace HAS connectors. Otherwise green would advertise a
               * capability nobody set up, and it would contradict the composer's icon, which appears
               * under the same condition. (The other reading — a pure capability hint, always shown —
               * is one line away if that turns out to be the more useful one.)
               */
            />

            {/* SQEM-390 (PR C) — the role, chosen where the model is chosen. A persona applied
                from its card (SQEM-389) shows here too; choosing "No persona" is the pill's remove. */}
            <PersonaSelect
              personas={personas}
              value={activePersona?.id ?? null}
              onOpen={loadPersonas}
              onChange={persona => {
                if (!persona) { removePersona(); return; }
                applyPersona(persona);
                showToast(txt.chat_using_persona({ title: persona.title }), 'success');
              }}
              emptyLabel={txt.start_no_persona()}
              emptyActionLabel={can(currentUser, workspace, 'prompts:edit') ? txt.chat_create_persona() : undefined}
              onEmptyAction={can(currentUser, workspace, 'prompts:edit') ? () => navigate('/personas') : undefined}
            />

            {/*
              SQEM-371 — the applied-context strip. It shows a SET, because more than one thing can
              be applied: at most one persona (the role) plus any number of skills (they stack on
              it). The container was already built for a row — `overflow-x-auto` was there while
              only ever one pill was rendered. (SQEM-390: the assistant pill went with the kind.)
            */}
            {(() => {
              if (!activeSkills.length && !activePersona) return null;

              const fileCount = activeSkills.reduce((n, sk) => n + (sk.template.contextFileIds?.length ?? 0), 0);

              // SQEM-389 — the persona pill: the role, first in the strip; `removePersona` is the
              // component-level one the picker shares.
              const removeApplied = (template: Prompt) => {
                setActiveSkills(prev => {
                  const next = prev.filter(sk => sk.template.id !== template.id);
                  // ⚠️ Removing has to reach the session too. Clearing only the client state would
                  // put the skill back on the next reload — the same write-only hole this ticket fixes.
                  if (sessionId) void updateAppliedContext(sessionId, { appliedSkillIds: next.map(sk => sk.template.id) }).catch(() => {});
                  return next;
                });
              };

              return (
                <>
                  <div className="w-px h-5 bg-slate-200 dark:bg-slate-600 shrink-0" />
                  <span className="text-xs text-slate-400 dark:text-slate-500 shrink-0 font-medium">{txt.chat_using()}</span>
                  <div className="flex items-center gap-1.5 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden min-w-0 flex-1">
                    {activePersona && (
                      <div className="shrink-0 flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-full text-accent bg-accent-soft">
                        <Bot className="w-3.5 h-3.5" />
                        <span className="opacity-60 font-medium">{txt.chat_persona()}</span>
                        <span className="opacity-30">·</span>
                        <span className="font-semibold">{activePersona.title}</span>
                        <button onClick={removePersona} className="ml-0.5 transition-opacity opacity-70 hover:opacity-100" title={txt.chat_remove()}>
                          <X className="w-3 h-3" />
                        </button>
                      </div>
                    )}
                    {activeSkills.map(({ template }) => (
                        <div key={template.id} className="shrink-0 flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-full text-skill bg-skill-soft">
                          <Wand2 className="w-3.5 h-3.5" />
                          <span className="opacity-60 font-medium">{txt.chat_skill()}</span>
                          <span className="opacity-30">·</span>
                          <span className="font-semibold">{template.title}</span>
                          <button
                            onClick={() => removeApplied(template)}
                            className="ml-0.5 transition-opacity opacity-70 hover:opacity-100"
                            title={txt.chat_remove()}
                          >
                            <X className="w-3 h-3" />
                          </button>
                        </div>
                    ))}
                    {fileCount > 0 && (
                      <div className="shrink-0 flex items-center gap-1 text-xs text-slate-600 dark:text-slate-300 bg-slate-100 dark:bg-slate-700 px-2 py-1 rounded-full">
                        <FileText className="w-3 h-3" />
                        <span className="font-medium">{txt.chat_file_count({ count: fileCount })}</span>
                      </div>
                    )}
                  </div>
                </>
              );
            })()}

          </div>

          {/* Messages area */}
          <div ref={messagesScrollRef} className="flex-1 min-h-0 overflow-y-auto overflow-x-hidden overscroll-y-contain">
            <PullToRefreshIndicator {...pull} />
            {messages.length === 0 ? (
              <div className="h-full flex flex-col items-center justify-center text-center p-6">
                <div className="w-14 h-14 rounded-card bg-accent-soft flex items-center justify-center mb-4">
                  <Sparkles className="w-7 h-7 text-accent" />
                </div>
                <h2 className="font-display text-2xl font-semibold tracking-tight text-ink-strong mb-2">{txt.chat_start_conversation()}</h2>
                <p className="text-slate-500 dark:text-slate-400 text-sm max-w-sm">
                  {enabledModels.length > 0
                    ? (activePersona
                        ? txt.chat_start_hint_persona({ model: modelInfo?.name || txt.chat_model_fallback(), persona: activePersona.title })
                        : txt.chat_start_hint({ model: modelInfo?.name || txt.chat_model_fallback() }))
                    : keyHint.text}
                </p>
                {enabledModels.length === 0 && keyHint.actionLabel && (
                  <Button onClick={openProviderKeys} className="mt-4">
                    <Key className="w-4 h-4" /> {keyHint.actionLabel}
                  </Button>
                )}
              </div>
            ) : (
              <div className="max-w-3xl mx-auto px-4 py-6 space-y-6">
                {messages.map((msg, index) => (
                  <MessageItem
                    key={msg.id}
                    msg={msg}
                    innerRef={index === lastAssistantIndex ? lastAssistantRef : undefined}
                    isLastAssistant={index === lastAssistantIndex}
                    currentUserId={currentUser.id}
                    currentUserName={currentUser.name}
                    userAvatar={userAvatar}
                    showUserAvatar={showUserAvatar}
                    onAvatarError={handleAvatarError}
                    isLoading={isLoading}
                    isCopied={copiedMessageId === msg.id}
                    onCopy={handleCopyMessage}
                    onEdit={handleEditMessage}
                    playbookTitles={playbookTitles}
                    onOpenFile={setPreviewFile}
                    libraryTitle={libraryTitle}
                  />
                ))}

                <div ref={messagesEndRef} />
              </div>
            )}
          </div>

          {/* Error */}
          {error && errorCode === 'out_of_credits' ? (
            <div className="px-4 py-2 shrink-0">
              <div className="max-w-3xl mx-auto p-3 bg-amber-50 dark:bg-amber-900/20 border border-amber-100 dark:border-amber-800 rounded-xl text-sm text-amber-700 dark:text-amber-400 flex items-center gap-2">
                <AlertTriangle className="w-4 h-4 shrink-0" />
                <span className="flex-1">{error}</span>
                <Link to="/settings" state={{ initialTab: 'plans' }} className="shrink-0 font-bold underline hover:no-underline">{txt.chat_upgrade_or_key()}</Link>
              </div>
            </div>
          ) : error && (
            <div className="px-4 py-2 shrink-0">
              {/* SQEM-465 — this message wraps, and that is the whole point of the ticket.
                  It used to be `truncate`, so a provider's reason ended after one line with an
                  ellipsis. A customer's screenshot of `Claude API error (400): {"type":"error",…
                  "message":"mcp_servers: M…` is what exposed it: the half we needed was the half
                  that was cut. `lib/aiErrors.ts` argues at length that the provider's own sentence
                  must survive — this is the same rule, enforced in CSS rather than in code.
                  ⚠️ `items-start` because the text is now multi-line and the icon belongs beside
                  the first line, not floating in the middle. `break-words` because a provider
                  error is often JSON with no spaces to break at. */}
              <div className="max-w-3xl mx-auto p-3 bg-red-50 dark:bg-red-900/20 border border-red-100 dark:border-red-800 rounded-xl text-sm text-red-600 dark:text-red-400 flex items-start gap-2">
                <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
                <span className="flex-1 break-words">{error}</span>
              </div>
            </div>
          )}

          {/* Input area */}
          <div className="shrink-0">
            {otherIsGenerating && (
              <div className="px-4 py-2 bg-amber-50 dark:bg-amber-900/20 border-t border-amber-100 dark:border-amber-800 flex items-center gap-2 text-xs text-amber-700 dark:text-amber-400">
                <Loader2 className="w-3 h-3 animate-spin" />
                {txt.chat_someone_waiting()}
              </div>
            )}
            {/* SQEM-550 (e) — redesign C: the composer is a raised card on the page, not a bar. */}
            <div className="px-4 pt-2 pb-4">
              <div className="max-w-3xl mx-auto rounded-3xl border border-line bg-surface-raised shadow-raised p-3 md:p-4">
                {attachments.length > 0 && (
                  <div className="flex flex-wrap gap-2 mb-2">
                    {attachments.map(att => (
                      <div key={att.id} className="relative group">
                        {isImageType(att.mimeType) ? (
                          <img src={att.dataUrl} alt={txt.chat_attachment_alt()} className="w-16 h-16 rounded-lg object-cover border border-slate-200" />
                        ) : (
                          <div className="w-16 h-16 rounded-lg bg-red-50 border border-red-200 flex flex-col items-center justify-center">
                            <FileText className="w-6 h-6 text-red-500" />
                            <span className="text-2xs font-bold text-red-500 mt-0.5">{fileTypeLabel(att.mimeType)}</span>
                          </div>
                        )}
                        <button onClick={() => removeAttachment(att.id)} className="hit-24 absolute -top-1.5 -right-1.5 w-5 h-5 bg-red-500 text-white rounded-full flex items-center justify-center reveal-on-hover transition-opacity shadow-sm">
                          <X className="w-3 h-3" />
                        </button>
                      </div>
                    ))}
                  </div>
                )}
                <div
                  className={`flex flex-col gap-2 md:flex-row md:items-center md:gap-3 ${dragActive ? 'ring-2 ring-brand-500 ring-offset-2 rounded-xl' : ''}`}
                  onDragOver={handleDragOver}
                  onDragLeave={handleDragLeave}
                  onDrop={handleDrop}
                >
                  <input ref={fileInputRef} type="file" accept={ACCEPT_STRING} multiple onChange={handleFileSelect} className="hidden" />
                  {/* SQEM-401 — two rows on a phone, one on a desktop. Below `md` the input row comes first
                      (`order-1`) and these tools sit centred underneath; from `md` up the wrapper is the row it
                      always was, tools first. The two menus anchor to the button's centre on a phone — `left-0`
                      under a centred toolbar overflows a 375 px screen to the right. Owner's request, 2026-09-13. */}
                  <div className="flex items-center justify-center gap-2 order-2 md:order-1 md:justify-start md:gap-3">
                    <div ref={attachMenuRef} className="relative shrink-0">
                      <button
                        onClick={() => setAttachMenuOpen(o => !o)}
                        disabled={isLoading || enabledModels.length === 0}
                        className="p-3 text-slate-400 dark:text-slate-500 hover:text-slate-600 dark:hover:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700 rounded-xl transition-all disabled:opacity-40 disabled:cursor-not-allowed"
                        title={txt.chat_attach_file()}
                      >
                        <Paperclip className="w-4 h-4" />
                      </button>
                      {attachMenuOpen && (
                        <div className="absolute bottom-full left-1/2 -translate-x-1/2 md:left-0 md:translate-x-0 mb-2 w-64 bg-white dark:bg-slate-800 border border-slate-100 dark:border-slate-700 rounded-xl shadow-xl z-30 p-1.5 animate-scale-up">
                          <button
                            onClick={() => { setAttachMenuOpen(false); setWorkspacePickerOpen(true); }}
                            className="w-full text-left px-3 py-2 flex items-center gap-2.5 rounded-lg hover:bg-slate-50 dark:hover:bg-slate-700 transition-colors"
                          >
                            <Files className="w-4 h-4 text-slate-400 shrink-0" />
                            <span className="text-sm text-slate-700 dark:text-slate-200">{txt.chat_choose_workspace()}</span>
                          </button>
                          <button
                            onClick={() => { setAttachMenuOpen(false); fileInputRef.current?.click(); }}
                            className="w-full text-left px-3 py-2 flex items-center gap-2.5 rounded-lg hover:bg-slate-50 dark:hover:bg-slate-700 transition-colors"
                          >
                            <Upload className="w-4 h-4 text-slate-400 shrink-0" />
                            <span className="text-sm text-slate-700 dark:text-slate-200">{txt.chat_upload_device()}</span>
                          </button>
                          <label className="flex items-center gap-2 px-3 py-2 mt-1 border-t border-slate-100 dark:border-slate-700 cursor-pointer">
                            <Checkbox
                              checked={saveToWorkspace}
                              onChange={() => setSaveToWorkspace(!saveToWorkspace)}
                              align="center"
                            />
                            <span className="text-xs text-slate-600 dark:text-slate-400">{txt.chat_save_uploads()}</span>
                          </label>
                        </div>
                      )}
                    </div>
                    <button
                      onClick={() => { setTemplateModalInitId(null); setTemplateModalOpen(true); }}
                      disabled={enabledModels.length === 0}
                      title={txt.chat_use_playbook()}
                      className="p-3 text-slate-400 dark:text-slate-500 hover:text-brand-600 dark:hover:text-brand-400 hover:bg-brand-50 dark:hover:bg-brand-900/20 rounded-xl transition-all disabled:opacity-40 disabled:cursor-not-allowed shrink-0"
                    >
                      <FileText className="w-4 h-4" />
                    </button>
                    {/* SQEM-436 — a STATUS, not a menu. The connectors are always sent; this says
                        whether the chosen model can use them. Shown whenever the workspace has any.
                        SQEM-584 — every text model can; only an image model shows "inactive". */}
                    {connectors.length > 0 && (
                      <div className="relative shrink-0 group">
                        <div
                          role="status"
                          aria-label={connectorsSupported
                            ? txt.chat_connectors_active()
                            : txt.chat_connectors_inactive_label()}
                          className={`p-3 rounded-control transition-all ${connectorsSupported
                            ? 'text-success bg-success-soft'
                            : 'text-danger bg-danger-soft'}`}
                        >
                          <Plug className="w-4 h-4" />
                        </div>
                        <div
                          role="tooltip"
                          className="pointer-events-none absolute bottom-full left-1/2 -translate-x-1/2 mb-2 w-max max-w-[15rem] px-3 py-2 bg-surface-raised border border-line rounded-control shadow-xl z-30 opacity-0 group-hover:opacity-100 transition-opacity"
                        >
                          {connectorsSupported ? (
                            <p className="text-2xs font-bold text-success">{txt.chat_connectors_active()}</p>
                          ) : (
                            <>
                              <p className="text-2xs font-bold text-danger">{txt.chat_connectors_inactive()}</p>
                              <p className="text-2xs text-ink-muted mt-0.5">{txt.chat_connectors_image_models()}</p>
                            </>
                          )}
                        </div>
                      </div>
                    )}
                  </div>
                  <div className="flex items-center gap-3 order-1 md:order-2 flex-1 min-w-0">
                    <div className="flex-1 relative">
                      <textarea
                        ref={textareaRef}
                        value={input}
                        onChange={e => setInput(e.target.value)}
                        onKeyDown={handleKeyDown}
                        aria-label={txt.chat_message_label()}
                        placeholder={dragActive ? txt.chat_drop_here() : txt.chat_type_message()}
                        rows={1}
                        disabled={isLoading || enabledModels.length === 0}
                        className="w-full resize-none bg-transparent px-2 py-2.5 text-sm md:text-base text-ink-strong outline-none transition-all disabled:opacity-50 placeholder:text-ink-subtle"
                      />
                    </div>
                    {/* SQEM-594 — web search for the next message only; pressed state is the whole UI. */}
                    <button
                      type="button"
                      onClick={() => setWebNext(v => !v)}
                      disabled={!webAvailable || isLoading}
                      aria-pressed={webNext && webAvailable}
                      aria-label={txt.chat_web_label()}
                      title={!webKeyAvailable
                        ? txt.chat_web_needs_key()
                        : !connectorsSupported
                          ? txt.chat_web_image_models()
                          : webNext ? txt.chat_web_on() : txt.chat_web_label()}
                      className={`p-3 rounded-xl transition-all shrink-0 disabled:opacity-40 disabled:cursor-not-allowed ${webNext && webAvailable ? 'bg-accent-soft text-accent' : 'text-ink-subtle hover:text-ink hover:bg-surface-sunken'}`}
                    >
                      <Globe className="w-4 h-4" />
                    </button>
                    <button
                      onClick={handleEnhanceInput}
                      disabled={isEnhancing || isLoading || !input.trim() || enabledModels.length === 0}
                      title={txt.chat_enhance()}
                      className="p-3 text-brand-500 hover:text-brand-700 hover:bg-brand-50 rounded-xl transition-all disabled:opacity-40 disabled:cursor-not-allowed shrink-0"
                    >
                      {isEnhancing ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />}
                    </button>
                    {/* SQEM-583 — while an answer runs, Send becomes Stop (as in ChatGPT and Claude). */}
                    {isLoading ? (
                      <button onClick={handleStop} aria-label={txt.chat_stop_label()} title={txt.chat_stop()} className="p-3 bg-ink-strong text-surface-raised rounded-control hover:opacity-90 transition-all shadow-sm dark:shadow-none shrink-0">
                        <Square className="w-4 h-4" fill="currentColor" />
                      </button>
                    ) : (
                      <button onClick={handleSend} aria-label={txt.chat_send_label()} disabled={!input.trim() || enabledModels.length === 0} className="p-3 bg-accent-strong text-white rounded-control hover:opacity-90 transition-all disabled:opacity-40 disabled:cursor-not-allowed shadow-sm hover:shadow-md dark:shadow-none dark:hover:shadow-none shrink-0">
                        <Send className="w-4 h-4" />
                      </button>
                    )}
                  </div>
                </div>
              </div>
              {/* SQEM-265 — EU AI Act Art. 50(1): the person has to be told they are interacting with
                  an AI system, and Art. 50(5) wants that "clear and distinguishable … at the latest at
                  the time of the first interaction". This used to be the tail of the keyboard-hint line
                  ("AI can make mistakes") in 9px — true, but a quality caveat buried among shortcuts is
                  neither the statement the Article asks for nor distinguishable from the rest.
                  Own line, own icon, one size up, and **standing rather than dismissible**: a duty is not
                  discharged by something the reader can click away before the first message.
                  Which surface makes us a provider under Art. 50, and why, is classified in
                  `pm/DOCUMENTATION.md` → Regulatory in the source repository. */}
              <p className="flex items-center justify-center gap-1.5 text-2xs text-slate-500 dark:text-slate-400 mt-2">
                <Bot className="w-3 h-3 shrink-0" aria-hidden="true" />
                {txt.chat_ai_disclosure()}
              </p>
              <p className="text-center text-2xs text-slate-400 dark:text-slate-500 mt-1">{txt.chat_key_hints()}</p>
            </div>
          </div>
        </div>

        {/* SQEM-595 — a generated file beside the chat (md+), full screen on a phone. */}
        {previewFile && (
          <FilePreviewPanel file={previewFile} onClose={() => setPreviewFile(null)} markdownComponents={MarkdownComponents} workspaceStyle={workspace.documentStyle} files={workspaceFiles} />
        )}
      </div>

      {/* ── Delete confirm modal ── */}
      <Modal open={!!deleteConfirmId} onClose={() => setDeleteConfirmId(null)} size="sm" className="p-6">
        <h3 className="text-lg font-bold text-slate-900 dark:text-slate-100 mb-2">{txt.chat_delete_title()}</h3>
        <p className="text-sm text-slate-500 dark:text-slate-400 mb-6">{txt.chat_delete_body()}</p>
        <div className="flex gap-2">
          <button onClick={() => setDeleteConfirmId(null)} className="flex-1 py-2.5 text-slate-600 dark:text-slate-300 bg-slate-50 dark:bg-slate-700 rounded-xl hover:bg-slate-100 dark:hover:bg-slate-600 text-sm font-medium transition-colors">{txt.chat_cancel()}</button>
          <Button variant="danger" onClick={() => handleDeleteConfirm(deleteConfirmId!)} className="flex-1 py-2.5 text-sm shadow-lg hover:shadow-red-200">{txt.chat_delete()}</Button>
        </div>
      </Modal>

      {/* ── Template launch modal ── */}
      <TemplateLaunchModal
        isOpen={templateModalOpen}
        onClose={() => setTemplateModalOpen(false)}
        initialTemplateId={templateModalInitId}
        onInsert={(text, template, images, inputs) => {
          // SQEM-551 — remembered for the card; attached at send (with `edited` if the text changed).
          pendingPlaybookRef.current = buildPendingRef(template, template.variables ?? [], inputs, text);
          setInput(text);
          if (images.length) addContextImages(images);
          textareaRef.current?.focus();
        }}
        onSkillSelect={(template, context, images) => {
          // ⛔ Applied, not inserted. A skill is a knowledge block, not a task — pasting it into
          // the composer made the header's "Using:" chip a claim the mechanism did not honour.
          // SQEM-371 — persisted so a reload keeps it. Only when a session exists: a chat that has
          // not been created yet carries its skills through `createChatSession`.
          setActiveSkills(prev => {
            if (prev.some(s => s.template.id === template.id)) return prev; // applying twice is a no-op
            const next = [...prev, { template, context }];
            if (sessionId) void updateAppliedContext(sessionId, { appliedSkillIds: next.map(s => s.template.id) }).catch(() => {});
            return next;
          });
          if (images.length) addContextImages(images);
          showToast(txt.chat_using_playbook({ title: template.title }), 'success');
        }}
      />

      {workspacePickerOpen && (
        <WorkspaceFilePickerModal
          files={workspaceFiles}
          onClose={() => setWorkspacePickerOpen(false)}
          onAttach={attachWorkspaceFiles}
        />
      )}

      <ChatSearchModal
        open={searchOpen}
        onClose={() => setSearchOpen(false)}
        workspaceId={workspace.id}
        onSelect={(id) => { setSearchOpen(false); setMobileTab('chat'); navigate(`/chat/${id}`); }}
      />

    </div>
  );
};

export default Chat;

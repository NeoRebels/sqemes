import React, { useState, useRef, useEffect, useCallback } from 'react';
import { useWorkspace, useData } from '../store';
import { supabase } from '../lib/supabase';
import { waitForJobResult } from '../lib/realtimeJob';
import { getWorkspaceFileSignedUrl } from '../lib/api/files';
import { isImageType } from '../lib/uploadTypes';
import { buildEnabledModels, isFundedModel } from '../lib/enabledModels';
import { edgeError } from '../lib/edgeError';
import { Link } from 'react-router-dom';
import { ModelSelect } from './ModelSelect';
import { Send, Loader2, Bot, User, Sparkles, Image, RotateCcw } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import type { PromptKind, Variable } from '../types';

interface TemplateSnapshot {
  kind: PromptKind;
  title: string;
  content: string;
  systemInstruction?: string;
  variables: Variable[];
  contextFileIds?: string[];
}

interface Props {
  template: TemplateSnapshot;
  resetKey: number;
  onReset: () => void;
}

interface ImageAttachment { mimeType: string; data: string; name: string; }

interface ChatMsg {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  pending?: boolean;
  images?: ImageAttachment[];
}

const MAX_PAYLOAD_CHARS = 480_000;

function truncateMessages(messages: { role: string; content: any }[], base: object) {
  let trimmed = [...messages];
  while (trimmed.length > 1 && JSON.stringify({ ...base, messages: trimmed }).length > MAX_PAYLOAD_CHARS) {
    trimmed.shift();
  }
  return trimmed;
}

async function fetchFileAsBase64(storagePath: string): Promise<string | null> {
  try {
    const signedUrl = await getWorkspaceFileSignedUrl(storagePath);
    const res = await fetch(signedUrl);
    const blob = await res.blob();
    return await new Promise<string>(resolve => {
      const reader = new FileReader();
      reader.onloadend = () => resolve((reader.result as string).split(',')[1]);
      reader.readAsDataURL(blob);
    });
  } catch {
    return null;
  }
}

async function fetchFileAsText(storagePath: string): Promise<string | null> {
  try {
    const signedUrl = await getWorkspaceFileSignedUrl(storagePath);
    const res = await fetch(signedUrl);
    return await res.text();
  } catch {
    return null;
  }
}

export default function EditorTestPanel({ template, resetKey, onReset }: Props) {
  const { workspace } = useWorkspace();
  const { workspaceFiles } = useData();

  const enabledModels = buildEnabledModels(workspace?.apiKeys ?? {}, workspace?.openrouterModels, workspace?.fundedAvailable);

  const [selectedModel, setSelectedModel] = useState(enabledModels[0]?.id ?? '');
  const [messages, setMessages] = useState<ChatMsg[]>([]);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [errorCode, setErrorCode] = useState<string | null>(null);
  const [varInputs, setVarInputs] = useState<Record<string, string>>({});
  const [testStarted, setTestStarted] = useState(false);

  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    abortRef.current?.abort();
    setMessages([]);
    setInput('');
    setError(null);
    setErrorCode(null);
    setTestStarted(false);
    const initial: Record<string, string> = {};
    template.variables.forEach(v => { initial[v.name] = v.defaultValue ?? ''; });
    setVarInputs(initial);
  }, [resetKey]);

  useEffect(() => {
    if (testStarted) return;
    const initial: Record<string, string> = {};
    template.variables.forEach(v => { initial[v.name] = v.defaultValue ?? ''; });
    setVarInputs(initial);
  }, [template.variables, testStarted]);

  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [messages]);

  const resolveContextFiles = useCallback(async (): Promise<{ textBlocks: string[]; images: ImageAttachment[] }> => {
    const ids = template.contextFileIds ?? [];
    if (!ids.length) return { textBlocks: [], images: [] };

    const files = workspaceFiles.filter(f => ids.includes(f.id));
    const textBlocks: string[] = [];
    const images: ImageAttachment[] = [];

    await Promise.all(files.map(async f => {
      if (isImageType(f.mimeType) || f.mimeType === 'application/pdf') {
        const data = await fetchFileAsBase64(f.storagePath);
        if (data) images.push({ mimeType: f.mimeType, data, name: f.name });
      } else {
        const text = await fetchFileAsText(f.storagePath);
        if (text?.trim()) textBlocks.push(`[Context: ${f.name}]\n${text.trim()}`);
      }
    }));

    return { textBlocks, images };
  }, [template.contextFileIds, workspaceFiles]);

  const sendMessage = useCallback(async (
    userText: string,
    allMessages: ChatMsg[],
    images: ImageAttachment[] = [],
  ) => {
    if (!selectedModel || !workspace) return;

    const { data: { session } } = await supabase.auth.getSession();
    if (!session) return;

    const msgId = crypto.randomUUID();
    const jobId = crypto.randomUUID();

    const userMsg: ChatMsg = { id: crypto.randomUUID(), role: 'user', content: userText, images: images.length ? images : undefined };
    const withUser = [...allMessages, userMsg];
    setMessages([...withUser, { id: msgId, role: 'assistant', content: '', pending: true }]);
    setIsLoading(true);
    setError(null);
    setErrorCode(null);

    const controller = new AbortController();
    abortRef.current = controller;

    const systemInstruction = template.kind === 'assistant' ? (template.systemInstruction || undefined) : undefined;
    // Funded (keyless) → send `funded` and omit modelId; the server picks the funded model.
    const funded = isFundedModel(selectedModel);
    const payloadBase = { workspaceId: workspace.id, modelId: funded ? undefined : selectedModel, funded, systemInstruction, temperature: 0.7 };

    // Build messages for API — images go as inlineData in the last user message
    const apiMessages = withUser.map((m, i) => {
      const isLast = i === withUser.length - 1;
      if (isLast && images.length) {
        const content: any[] = images.map(img => ({ inlineData: { mimeType: img.mimeType, data: img.data } }));
        if (m.content) content.push({ text: m.content });
        return { role: m.role, content };
      }
      return { role: m.role, content: m.content };
    });

    const messagesToSend = truncateMessages(apiMessages, payloadBase);

    try {
      const resultPromise = waitForJobResult(jobId, controller.signal);
      const res = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/chat-message`, {
        method: 'POST',
        signal: controller.signal,
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${session.access_token}` },
        body: JSON.stringify({ ...payloadBase, messages: messagesToSend, jobId }),
      });

      if (!res.ok) throw await edgeError(res);
      const resData = await res.json();
      if (resData?.error) throw new Error(resData.error);

      const rawResult: string = resData?.result !== undefined ? (resData.result || '') : await resultPromise;
      setMessages(prev => prev.map(m => m.id === msgId ? { ...m, content: rawResult, pending: false } : m));
    } catch (err: any) {
      if (err.name !== 'AbortError') {
        setError(err.message);
        setErrorCode(err.code ?? null);
        setMessages(prev => prev.filter(m => m.id !== msgId));
      }
    } finally {
      setIsLoading(false);
    }
  }, [selectedModel, workspace, template]);

  const handleStartTest = async () => {
    // Assistants carry their instructions (incl. content) in systemInstruction, so don't
    // resend content as the first user message — just open the chat and send any context.
    let content = template.kind === 'assistant' ? '' : (template.content ?? '');
    template.variables.forEach(v => {
      content = content.replace(new RegExp(`{{${v.name}}}`, 'g'), varInputs[v.name] ?? '');
    });

    const { textBlocks, images } = await resolveContextFiles();
    const parts = [...textBlocks, content.trim()].filter(Boolean);
    const firstMsg = parts.join('\n\n');
    if (!firstMsg && !images.length && template.kind !== 'assistant') return;

    setTestStarted(true);
    if (firstMsg || images.length) sendMessage(firstMsg, [], images);
  };

  const handleSend = () => {
    const text = input.trim();
    if (!text || isLoading) return;
    setInput('');
    sendMessage(text, messages.filter(m => !m.pending));
  };

  const hasVariables = template.variables.length > 0;
  const showVarForm = !testStarted && hasVariables;
  const showStartPrompt = !testStarted && !hasVariables;

  return (
    <div className="flex flex-col h-full bg-slate-50 dark:bg-slate-900 border-l border-slate-200 dark:border-slate-700">
      {/* Header */}
      <div className="flex items-center gap-2 px-4 py-2.5 border-b border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 shrink-0">
        <span className="text-xs font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider shrink-0">Test</span>
        <div className="flex-1" />
        <ModelSelect models={enabledModels} value={selectedModel} onChange={setSelectedModel} />
        <button
          onClick={onReset}
          className="p-1.5 text-slate-400 dark:text-slate-500 hover:text-slate-600 dark:hover:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700 rounded-lg transition-colors shrink-0"
          title="Clear test"
        >
          <RotateCcw className="w-3.5 h-3.5" />
        </button>
      </div>

      {/* Variable prefill form */}
      {showVarForm && (
        <div className="p-4 border-b border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 shrink-0 space-y-3">
          <p className="text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider">Fill variables</p>
          {template.variables.map(v => (
            <div key={v.id}>
              <label className="block text-xs font-medium text-slate-600 dark:text-slate-300 mb-1">{v.label || v.name}</label>
              {v.type === 'select' && v.options?.length ? (
                <select
                  value={varInputs[v.name] ?? ''}
                  onChange={e => setVarInputs(prev => ({ ...prev, [v.name]: e.target.value }))}
                  className="w-full px-3 py-2 border border-slate-200 dark:border-slate-600 rounded-lg text-sm bg-white dark:bg-slate-700 text-slate-800 dark:text-slate-200 outline-none focus:border-brand-500"
                >
                  <option value="">Select…</option>
                  {v.options.map(o => <option key={o} value={o}>{o}</option>)}
                </select>
              ) : (
                <textarea
                  value={varInputs[v.name] ?? ''}
                  onChange={e => setVarInputs(prev => ({ ...prev, [v.name]: e.target.value }))}
                  rows={v.type === 'textarea' ? 3 : 1}
                  className="w-full px-3 py-2 border border-slate-200 dark:border-slate-600 rounded-lg text-sm bg-white dark:bg-slate-700 text-slate-800 dark:text-slate-200 outline-none focus:border-brand-500 resize-none"
                  placeholder={v.defaultValue || `Enter ${v.label || v.name}…`}
                />
              )}
            </div>
          ))}
          <button
            onClick={handleStartTest}
            disabled={!selectedModel || isLoading}
            className="w-full flex items-center justify-center gap-2 px-4 py-2 bg-brand-600 hover:bg-brand-700 disabled:opacity-40 text-white text-sm font-medium rounded-lg transition-colors"
          >
            <Sparkles className="w-3.5 h-3.5" /> Start test
          </button>
        </div>
      )}

      {/* Start button for no-variable templates */}
      {showStartPrompt && (
        <div className="p-4 border-b border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 shrink-0">
          <button
            onClick={handleStartTest}
            disabled={!selectedModel || isLoading || (!template.content.trim() && !(template.contextFileIds?.length))}
            className="w-full flex items-center justify-center gap-2 px-4 py-2 bg-brand-600 hover:bg-brand-700 disabled:opacity-40 text-white text-sm font-medium rounded-lg transition-colors"
          >
            <Sparkles className="w-3.5 h-3.5" /> Start test
          </button>
        </div>
      )}

      {/* Messages */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto p-4 space-y-4 min-h-0">
        {messages.length === 0 && testStarted && (
          <div className="flex items-center justify-center h-full">
            <Loader2 className="w-5 h-5 animate-spin text-slate-300" />
          </div>
        )}
        {messages.map(msg => (
          <div key={msg.id} className={`flex gap-2.5 ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
            {msg.role === 'assistant' && (
              <div className="w-7 h-7 rounded-lg bg-brand-50 dark:bg-brand-900/20 flex items-center justify-center shrink-0 mt-0.5">
                <Bot className="w-3.5 h-3.5 text-brand-500" />
              </div>
            )}
            <div className={`max-w-[85%] rounded-2xl px-3.5 py-2.5 text-sm ${msg.role === 'user' ? 'bg-brand-600 text-white rounded-tr-sm' : 'bg-white dark:bg-slate-800 text-slate-800 dark:text-slate-200 border border-slate-100 dark:border-slate-700 rounded-tl-sm'}`}>
              {msg.pending ? (
                <Loader2 className="w-4 h-4 animate-spin opacity-50" />
              ) : msg.role === 'assistant' ? (
                <div className="prose prose-sm dark:prose-invert max-w-none prose-p:my-1 prose-headings:my-2">
                  <ReactMarkdown remarkPlugins={[remarkGfm]}>{msg.content}</ReactMarkdown>
                </div>
              ) : (
                <div>
                  {msg.images?.map((img, i) => (
                    <div key={i} className="flex items-center gap-1.5 mb-1.5 text-white/70 text-xs">
                      <Image className="w-3.5 h-3.5" />
                      <span>{img.name}</span>
                    </div>
                  ))}
                  {msg.content && <p className="whitespace-pre-wrap">{msg.content}</p>}
                </div>
              )}
            </div>
            {msg.role === 'user' && (
              <div className="w-7 h-7 rounded-lg bg-slate-100 dark:bg-slate-700 flex items-center justify-center shrink-0 mt-0.5">
                <User className="w-3.5 h-3.5 text-slate-500" />
              </div>
            )}
          </div>
        ))}
        {error && errorCode === 'out_of_credits' ? (
          <p className="text-xs text-amber-600 dark:text-amber-400 text-center">
            {error}{' '}
            <Link to="/settings" state={{ initialTab: 'plans' }} className="font-bold underline hover:no-underline">Upgrade or add a key</Link>
          </p>
        ) : error && <p className="text-xs text-red-500 text-center">{error}</p>}
      </div>

      {/* Input */}
      {testStarted && (
        <div className="border-t border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 p-3 shrink-0 flex items-end gap-2">
          <textarea
            ref={inputRef}
            value={input}
            onChange={e => { setInput(e.target.value); e.target.style.height = 'auto'; e.target.style.height = `${Math.min(e.target.scrollHeight, 120)}px`; }}
            onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend(); } }}
            placeholder="Continue the conversation…"
            rows={1}
            className="flex-1 resize-none text-sm bg-slate-50 dark:bg-slate-700 border border-slate-200 dark:border-slate-600 rounded-xl px-3 py-2 text-slate-800 dark:text-slate-200 placeholder-slate-400 outline-none focus:border-brand-500 focus:ring-1 focus:ring-brand-500/20 transition-all"
          />
          <button
            onClick={handleSend}
            disabled={isLoading || !input.trim()}
            className="p-2.5 bg-brand-600 text-white rounded-xl hover:bg-brand-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors shrink-0"
          >
            <Send className="w-4 h-4" />
          </button>
        </div>
      )}
    </div>
  );
}

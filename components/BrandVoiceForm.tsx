import React, { useState } from 'react';
import { Plus, X, ChevronDown, ChevronUp, Code2 } from 'lucide-react';
import type { AssistantBrandConfig, BrandVoiceExample, ToneLevel } from '../types';
import { compileAssistantInstruction, TONE_LABELS } from '../lib/compileBrandVoice';

const TONE_OPTIONS: { value: ToneLevel; label: string }[] = [
  { value: 1, label: 'Very Formal' },
  { value: 2, label: 'Formal' },
  { value: 3, label: 'Balanced' },
  { value: 4, label: 'Casual' },
  { value: 5, label: 'Very Casual' },
];


function ExamplesEditor({
  examples,
  onAdd,
  onChange,
  onRemove,
  disabled,
}: {
  examples: BrandVoiceExample[];
  onAdd: () => void;
  onChange: (id: string, field: 'input' | 'output', value: string) => void;
  onRemove: (id: string) => void;
  disabled?: boolean;
}) {
  return (
    <div className="space-y-3">
      {examples.map((ex, i) => (
        <div key={ex.id} className="bg-white dark:bg-slate-700 border border-slate-200 dark:border-slate-600 rounded-xl p-3">
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs font-bold text-slate-400 uppercase tracking-wider">Example {i + 1}</span>
            {!disabled && (
              <button type="button" onClick={() => onRemove(ex.id)} className="text-slate-300 dark:text-slate-500 hover:text-red-500 transition-colors">
                <X className="w-3.5 h-3.5" />
              </button>
            )}
          </div>
          <div className="space-y-2">
            <div>
              <label className="text-xs text-slate-400 mb-1 block">User message</label>
              <textarea
                value={ex.input}
                onChange={e => onChange(ex.id, 'input', e.target.value)}
                placeholder="What the user sends..."
                readOnly={disabled}
                rows={2}
                className="w-full text-sm px-3 py-2 border border-slate-200 dark:border-slate-600 bg-slate-50 dark:bg-slate-800 text-slate-700 dark:text-slate-200 rounded-lg outline-none focus:border-brand-500 transition-colors placeholder:text-slate-400 resize-none"
              />
            </div>
            <div>
              <label className="text-xs text-slate-400 mb-1 block">Expected output</label>
              <textarea
                value={ex.output}
                onChange={e => onChange(ex.id, 'output', e.target.value)}
                placeholder="How the assistant should respond..."
                readOnly={disabled}
                rows={2}
                className="w-full text-sm px-3 py-2 border border-slate-200 dark:border-slate-600 bg-slate-50 dark:bg-slate-800 text-slate-700 dark:text-slate-200 rounded-lg outline-none focus:border-brand-500 transition-colors placeholder:text-slate-400 resize-none"
              />
            </div>
          </div>
        </div>
      ))}
      {!disabled && (
        <button
          type="button"
          onClick={onAdd}
          className="w-full py-2.5 border-2 border-dashed border-slate-200 dark:border-slate-600 rounded-xl text-xs font-medium text-slate-400 hover:text-brand-600 hover:border-brand-300 dark:hover:border-brand-600 transition-colors flex items-center justify-center gap-1.5"
        >
          <Plus className="w-3.5 h-3.5" /> Add Example
        </button>
      )}
    </div>
  );
}

interface Props {
  config: AssistantBrandConfig;
  onChange: (config: AssistantBrandConfig) => void;
  onSwitchToAdvanced: () => void;
  disabled?: boolean;
  content?: string;
  onContentChange?: (content: string) => void;
}

export function BrandVoiceForm({ config, onChange, onSwitchToAdvanced, disabled, content, onContentChange }: Props) {
  const [showPreview, setShowPreview] = useState(false);

  const update = (patch: Partial<AssistantBrandConfig>) => onChange({ ...config, ...patch });

  const compiled = compileAssistantInstruction(config, content);

  return (
    <div className="px-6 py-4 space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between">
        <label className="text-xs font-bold text-slate-400 dark:text-slate-500 uppercase tracking-wider">Assistant Setup</label>
        {!disabled && (
          <button
            type="button"
            onClick={onSwitchToAdvanced}
            className="text-xs text-slate-400 hover:text-slate-600 dark:hover:text-slate-300 flex items-center gap-1 transition-colors"
          >
            <Code2 className="w-3 h-3" /> Advanced
          </button>
        )}
      </div>

      {/* Role */}
      <div>
        <label className="block text-xs font-semibold text-slate-500 dark:text-slate-400 mb-2">Role</label>
        <textarea
          value={config.brandContext}
          onChange={e => update({ brandContext: e.target.value })}
          placeholder="Who is this assistant and what do they do? e.g. 'You are a senior customer success manager for Acme — a B2B SaaS for logistics teams. You help enterprise customers troubleshoot integrations and get the most out of the platform.'"
          readOnly={disabled}
          rows={3}
          className="w-full p-3 text-sm text-slate-800 dark:text-slate-200 bg-white dark:bg-slate-700 border border-slate-200 dark:border-slate-600 rounded-xl resize-none outline-none focus:ring-2 focus:ring-brand-500/20 focus:border-brand-500 transition-all placeholder-slate-300 dark:placeholder-slate-600"
        />
      </div>

      {/* Tone */}
      <div>
        <label className="block text-xs font-semibold text-slate-500 dark:text-slate-400 mb-2">
          Tone — <span className="font-normal text-slate-400">{TONE_LABELS[config.tone]}</span>
        </label>
        <div className="grid grid-cols-5 gap-1 bg-slate-100 dark:bg-slate-700 p-1 rounded-xl">
          {TONE_OPTIONS.map(opt => (
            <button
              key={opt.value}
              type="button"
              disabled={disabled}
              onClick={() => update({ tone: opt.value })}
              className={`py-2 rounded-lg text-xs font-medium transition-all ${
                config.tone === opt.value
                  ? 'bg-white dark:bg-slate-600 text-slate-900 dark:text-slate-100 shadow-sm'
                  : 'text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-300'
              }`}
            >
              {opt.label}
            </button>
          ))}
        </div>
      </div>

      {/* Content */}
      <div>
        <label className="block text-xs font-semibold text-slate-500 dark:text-slate-400 mb-2">Content</label>
        <textarea
          value={content ?? ''}
          onChange={e => onContentChange?.(e.target.value)}
          placeholder="Additional instructions, context, or knowledge for this assistant..."
          readOnly={disabled}
          rows={4}
          className="w-full p-3 text-sm font-mono text-slate-800 dark:text-slate-200 bg-white dark:bg-slate-700 border border-slate-200 dark:border-slate-600 rounded-xl resize-none outline-none focus:ring-2 focus:ring-brand-500/20 focus:border-brand-500 transition-all placeholder-slate-300 dark:placeholder-slate-600"
        />
      </div>

      {/* Few-shot examples */}
      <div>
        <label className="block text-xs font-semibold text-slate-500 dark:text-slate-400 mb-2">Few-shot examples</label>
        <ExamplesEditor
          examples={config.examples}
          onAdd={() => update({ examples: [...config.examples, { id: crypto.randomUUID(), input: '', output: '' }] })}
          onChange={(id, field, value) => update({ examples: config.examples.map(e => e.id === id ? { ...e, [field]: value } : e) })}
          onRemove={id => update({ examples: config.examples.filter(e => e.id !== id) })}
          disabled={disabled}
        />
      </div>

      {/* Compiled preview */}
      <div className="border border-slate-200 dark:border-slate-700 rounded-xl overflow-hidden">
        <button
          type="button"
          onClick={() => setShowPreview(p => !p)}
          className="w-full flex items-center justify-between px-4 py-3 bg-slate-50 dark:bg-slate-800/60 text-xs font-bold text-slate-400 uppercase tracking-wider hover:bg-slate-100 dark:hover:bg-slate-700 transition-colors"
        >
          Preview compiled instruction
          {showPreview ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
        </button>
        {showPreview && (
          <pre className="px-4 py-3 text-xs font-mono text-slate-600 dark:text-slate-300 bg-white dark:bg-slate-900 whitespace-pre-wrap leading-relaxed">
            {compiled || <span className="text-slate-400 italic">Fill in the fields above to preview…</span>}
          </pre>
        )}
      </div>
    </div>
  );
}

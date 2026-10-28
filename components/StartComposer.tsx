import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router';
import { ArrowUp, BookMarked, Bot, Check } from 'lucide-react';
import PickerDropdown from './ui/PickerDropdown';
import { fetchPersonas } from '../lib/api/personas';
import { handOffToChat } from '../lib/chatHandoff';
import type { Persona } from '../types';
import { m } from '../lib/i18n';

/**
 * SQEM-550 (a) — the composer on the Start page (redesign C): describe the task, optionally pick the
 * persona, send — and the chat opens with the message already on its way.
 *
 * The text travels through `lib/chatHandoff.ts`, not router state (see there: Back and reload must not
 * send it twice). A playbook is not picked here: "/" or the Playbook button opens Chat's own picker,
 * which already handles fields, files and skills — a second picker on this page would be a copy that
 * drifts.
 */
export default function StartComposer({ workspaceId }: { workspaceId: string }) {
  const navigate = useNavigate();
  const [text, setText] = useState('');
  const [personas, setPersonas] = useState<Persona[]>([]);
  const [persona, setPersona] = useState<Persona | null>(null);
  const [search, setSearch] = useState('');

  useEffect(() => {
    if (!workspaceId) return;
    let cancelled = false;
    fetchPersonas(workspaceId).then(p => { if (!cancelled) setPersonas(p); }).catch(() => { /* no picker entries, nothing else breaks */ });
    return () => { cancelled = true; };
  }, [workspaceId]);

  const send = () => {
    const t = text.trim();
    if (!t) return;
    handOffToChat(t, persona?.id);
    navigate('/chat');
  };
  const openPlaybooks = () => navigate('/chat', { state: { openTemplatePicker: true } });

  const shown = personas.filter(p => p.title.toLowerCase().includes(search.trim().toLowerCase()));

  return (
    <div className="w-full max-w-3xl rounded-3xl border border-line bg-surface-raised shadow-raised p-4 md:p-5">
      <label htmlFor="start-composer" className="sr-only">{m.start_composer_label()}</label>
      <textarea
        id="start-composer"
        value={text}
        rows={2}
        onChange={e => {
          // "/" as the very first keystroke means "start from a playbook", as in Chat.
          if (e.target.value === '/') { openPlaybooks(); return; }
          setText(e.target.value);
        }}
        onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); send(); } }}
        placeholder={m.start_composer_placeholder()}
        className="w-full resize-none bg-transparent text-base md:text-lg text-ink-strong placeholder:text-ink-subtle focus:outline-none"
      />
      <div className="mt-3 flex items-center justify-between gap-3">
        <div className="flex items-center gap-2 min-w-0 flex-wrap">
          <PickerDropdown
            wide
            triggerIcon={<Bot className="w-4 h-4" />}
            triggerLabel={persona ? persona.title : m.start_no_persona()}
            search={search}
            onSearchChange={setSearch}
            searchPlaceholder="Search personas…"
          >
            {close => (
              <>
                <button
                  type="button"
                  onClick={() => { setPersona(null); close(); }}
                  className="w-full flex items-center gap-2 px-3 py-2 text-sm text-left text-ink hover:bg-surface-sunken rounded-control"
                >
                  {persona === null ? <Check className="w-4 h-4 text-accent" /> : <span className="w-4" />} {m.start_no_persona()}
                </button>
                {shown.map(p => (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => { setPersona(p); close(); }}
                    className="w-full flex items-center gap-2 px-3 py-2 text-sm text-left text-ink hover:bg-surface-sunken rounded-control"
                  >
                    {persona?.id === p.id ? <Check className="w-4 h-4 text-accent" /> : <span className="w-4" />}
                    <span className="truncate">{p.title}</span>
                  </button>
                ))}
              </>
            )}
          </PickerDropdown>
          <button
            type="button"
            onClick={openPlaybooks}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full border border-line text-sm font-medium text-ink-muted hover:text-ink-strong hover:bg-surface-sunken transition-colors"
          >
            <BookMarked className="w-4 h-4" /> {m.start_playbook_button()}
          </button>
        </div>
        <button
          type="button"
          onClick={send}
          disabled={!text.trim()}
          aria-label={m.start_send()}
          className="shrink-0 w-10 h-10 rounded-control bg-accent-strong text-white flex items-center justify-center hover:opacity-90 disabled:opacity-40 disabled:cursor-not-allowed transition-opacity"
        >
          <ArrowUp className="w-5 h-5" />
        </button>
      </div>
    </div>
  );
}

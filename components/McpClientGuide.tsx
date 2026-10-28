import React, { useState } from 'react';
import { Check, Code2, Copy, ExternalLink, Plug } from 'lucide-react';
import SegmentedTabs from './ui/SegmentedTabs';
import { copyToClipboard } from '../lib/clipboard';
import { MCP_CLIENTS, type McpClientGuide as Client, type McpClientId } from '../lib/mcpClients';
import { ProviderIcon } from './ProviderIcon';
import { m } from '../lib/i18n';
import { mcpClientText } from '../lib/labels';

/**
 * SQEM-554 (c) — each tab carries the client's logo. Single-colour logos invert in dark mode. VS Code
 * and "Other" get a neutral icon instead of a logo from a source nobody checked (assets/ICONS-LICENSE.md).
 */
function clientIcon(c: Client) {
  if (c.logo) return <ProviderIcon provider={c.logo.icon} alt="" className={`w-4 h-4${c.logo.mono ? ' dark:invert' : ''}`} />;
  return c.id === 'vscode' ? <Code2 aria-hidden className="w-4 h-4" /> : <Plug aria-hidden className="w-4 h-4" />;
}

/**
 * SQEM-533 — one tab per MCP client, with exactly the steps and the file or command that client wants.
 * The content lives in `lib/mcpClients.ts`; this only renders it, so the Settings card and the setup
 * wizard cannot drift apart. `url` is the endpoint the page already shows (Cloud or the self-host's own).
 */
export default function McpClientGuide({ url, compact = false }: { url: string; compact?: boolean }) {
  const [active, setActive] = useState<McpClientId>('claude');
  const [copied, setCopied] = useState(false);
  const client = MCP_CLIENTS.find(c => c.id === active) ?? MCP_CLIENTS[0];
  const snippet = client.snippet?.(url);

  return (
    <div>
      {/* SQEM-568 — on a phone one row that scrolls sideways, like the Files page's tabs;
          from sm up it wraps as before, where all six fit. */}
      <div className="overflow-x-auto -mx-1 px-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden sm:overflow-visible">
        <SegmentedTabs
          tabs={MCP_CLIENTS.map(c => ({ value: c.id, label: mcpClientText(c.label), icon: clientIcon(c) }))}
          value={active}
          onChange={(v) => { setActive(v); setCopied(false); }}
          className="w-max sm:w-auto sm:flex-wrap [&>button]:whitespace-nowrap"
        />
      </div>
      <div className="mt-3 space-y-3">
        <ol className="list-decimal pl-5 space-y-1 text-xs text-ink leading-relaxed">
          {client.steps.map((step) => <li key={step}>{mcpClientText(step)}</li>)}
        </ol>
        {snippet && (
          <div>
            <p className="text-2xs font-bold text-ink-subtle uppercase tracking-wider mb-1">{mcpClientText(snippet.label)}</p>
            <div className="relative bg-slate-900 dark:bg-slate-950 rounded-xl p-4 overflow-hidden">
              <pre className="text-xs font-mono text-slate-300 overflow-x-auto whitespace-pre pr-8">{snippet.code}</pre>
              <button
                type="button"
                onClick={async () => { await copyToClipboard(snippet.code); setCopied(true); setTimeout(() => setCopied(false), 2000); }}
                className="absolute top-3 right-3 p-1.5 text-slate-500 hover:text-slate-200 transition-colors"
                title={m.mcp_copy()}
                aria-label={m.mcpg_copy_label({ label: mcpClientText(snippet.label) })}
              >
                {copied ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
              </button>
            </div>
          </div>
        )}
        {client.note && !compact && (
          <p className="text-xs text-ink-muted leading-relaxed">{mcpClientText(client.note)}</p>
        )}
        <p className="text-2xs text-ink-subtle">
          {client.auth === 'oauth' ? m.mcpg_oauth() : m.mcpg_key()}{' '}
          {m.mcpg_differs()}{' '}
          <a href={client.docsUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-0.5 font-semibold text-accent hover:underline">
            {m.mcpg_docs({ client: mcpClientText(client.label) })} <ExternalLink className="w-3 h-3" />
          </a>
        </p>
      </div>
    </div>
  );
}

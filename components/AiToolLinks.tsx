import { ProviderIcon } from './ProviderIcon';
import { AI_TOOLS } from '../lib/aiTools';

/**
 * SQEM-557 — quick links from Start to the AI tools a team already works in.
 * Each opens the vendor's chat in a new tab; the sentence underneath says why that is useful here:
 * the playbooks follow through the extension or MCP. Plain references with the vendors' own logos —
 * no ranking, no recommendation (see assets/ICONS-LICENSE.md). No visible external-link glyph: with it
 * the eight chips wrap onto two lines; the new tab is announced to screen readers instead,
 * through the same `aria-label` that carries the full name where the chip shows a short one.
 */
export default function AiToolLinks() {
  return (
    <nav aria-labelledby="start-ai-tools" className="w-full max-w-4xl">
      <h2 id="start-ai-tools" className="sr-only">Open an AI tool</h2>
      <ul className="flex flex-wrap justify-center gap-1.5">
        {AI_TOOLS.map(tool => (
          <li key={tool.id}>
            <a
              href={tool.url}
              target="_blank"
              rel="noopener noreferrer"
              aria-label={`${tool.name} (opens in a new tab)`}
              className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-full border border-line bg-surface-raised text-sm font-medium text-ink hover:border-line-strong hover:text-ink-strong transition-colors"
            >
              <ProviderIcon provider={tool.icon} alt="" className={`w-4 h-4${tool.mono ? ' dark:invert' : ''}`} />
              {tool.short ?? tool.name}
            </a>
          </li>
        ))}
      </ul>
      <p className="mt-3 text-xs text-ink-subtle">Your playbooks come along through the sqemes extension or MCP.</p>
    </nav>
  );
}

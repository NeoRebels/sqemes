/**
 * SQEM-649 — Claude's `pause_turn`.
 *
 * With connectors (`mcp_servers`) Anthropic runs the remote tool calls in its own server-side loop. When
 * that loop reaches its iteration limit the response ends with `stop_reason: "pause_turn"` — not an
 * answer, a pause. To go on, the assistant turn is sent back EXACTLY as it came (server tool blocks
 * included, no extra "continue" message) and Anthropic resumes where it stopped. Until SQEM-649 a
 * paused turn was returned as if it were the finished answer: cut off, without a word.
 *
 * ⚠️ Whether the MCP connector reaches that limit in practice is not measured (the docs name it for
 * server tools in general). The handling costs nothing when it never fires.
 *
 * ⛔ The streaming readers (`claudeDelta`, `createClaudeToolAccumulator`) deliberately keep only text
 * and our own `tool_use` blocks — they cannot rebuild the turn. This collector keeps EVERY block as it
 * arrived, so a paused turn can be sent back verbatim. It is read only when the turn paused.
 */

/** At most this many resumes per invocation — a model that pauses forever must still end. */
export const MAX_PAUSE_RESUMES = 5;

export function isPauseTurn(stopReason: string | null | undefined): boolean {
  return stopReason === 'pause_turn';
}

export interface ClaudeBlockCollector {
  onChunk(chunk: unknown): void;
  /** The content blocks of the turn, in order, with streamed JSON inputs parsed. */
  blocks(): unknown[];
}

export function createClaudeBlockCollector(): ClaudeBlockCollector {
  const blocks: Record<string, any>[] = [];
  const json: Record<number, string> = {};

  return {
    onChunk(chunk: unknown) {
      const c = chunk as any;
      if (!c || typeof c !== 'object' || typeof c.index !== 'number') return;
      if (c.type === 'content_block_start' && c.content_block) {
        blocks[c.index] = structuredClone(c.content_block);
        return;
      }
      const block = blocks[c.index];
      if (!block) return;
      if (c.type === 'content_block_delta' && c.delta) {
        const d = c.delta;
        if (d.type === 'text_delta') block.text = (block.text ?? '') + (d.text ?? '');
        else if (d.type === 'input_json_delta') json[c.index] = (json[c.index] ?? '') + (d.partial_json ?? '');
        else if (d.type === 'citations_delta' && d.citation) (block.citations ??= []).push(d.citation);
        else if (d.type === 'thinking_delta') block.thinking = (block.thinking ?? '') + (d.thinking ?? '');
        else if (d.type === 'signature_delta') block.signature = d.signature;
        return;
      }
      if (c.type === 'content_block_stop' && json[c.index] !== undefined) {
        try { block.input = JSON.parse(json[c.index] || '{}'); } catch { /* left as it started */ }
        delete json[c.index];
      }
    },
    blocks: () => blocks.filter(Boolean),
  };
}

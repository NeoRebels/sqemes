// SQEM-169 — heuristic prompt-injection / content scan for marketplace submissions. Deterministic
// pattern matching over a listing's text (template body + system instruction + description + embedded
// skill content). Advisory: it surfaces a risk badge + reasons to admins in the review queue; it does
// not relax the manual approval gate. An LLM second-opinion + server-enforced re-scan are a later
// hardening (3c). Kept dependency-free so it can also run in the extension/self-host later.

export type ScanRisk = 'low' | 'medium' | 'high';
export type ScanResult = { risk: ScanRisk; reasons: string[] };

type Rule = { weight: number; label: string; re: RegExp };

// weight 3 = strong injection signal · 2 = suspicious · 1 = weak/context.
const RULES: Rule[] = [
  { weight: 3, label: 'Instruction override ("ignore/disregard previous instructions")', re: /\b(ignore|disregard|forget)\b[^.\n]{0,40}\b(previous|prior|above|all|earlier)\b[^.\n]{0,20}\b(instruction|instructions|prompt|rules?|context)\b/i },
  { weight: 3, label: 'Attempts to reveal the system prompt / secrets', re: /\b(reveal|show|print|repeat|expose|leak)\b[^.\n]{0,30}\b(system prompt|system instruction|your instructions|api[\s_-]?key|secret|token|password|credentials?)\b/i },
  { weight: 3, label: 'Data-exfiltration directive ("send … to/via …")', re: /\b(send|forward|post|upload|exfiltrat\w*|leak|email)\b[^.\n]{0,40}\b(to|via|at)\b[^.\n]{0,40}(https?:\/\/|@|\bwebhook\b|\bendpoint\b)/i },
  { weight: 3, label: 'Jailbreak / role-override ("you are now …", "DAN", "do anything now")', re: /\b(you are now|act as (?:a |an )?(?:different|new|unrestricted)|do anything now|\bDAN\b|jailbreak|developer mode)\b/i },
  { weight: 2, label: 'Overrides safety / refuses restrictions', re: /\b(bypass|override|ignore)\b[^.\n]{0,30}\b(safety|guardrails?|filters?|restrictions?|policy|policies)\b/i },
  { weight: 2, label: 'Tool/connector misuse instruction', re: /\b(use|call|invoke)\b[^.\n]{0,30}\b(connector|tool|gmail|shopify|mcp)\b[^.\n]{0,40}\b(to )?(send|delete|transfer|export|read all|forward)\b/i },
  { weight: 2, label: 'Obfuscated content (long base64/hex blob)', re: /(?:[A-Za-z0-9+/]{240,}={0,2})|(?:[0-9a-fA-F]{240,})/ },
  { weight: 1, label: 'Mentions secrets/keys', re: /\b(api[\s_-]?key|access token|secret key|password)\b/i },
  { weight: 1, label: 'Contains an external URL', re: /\bhttps?:\/\/[^\s)]+/i },
];

/** Scan combined listing text. `parts` are concatenated; empty/undefined parts are ignored. */
export function scanForInjection(...parts: (string | null | undefined)[]): ScanResult {
  const text = parts.filter(Boolean).join('\n\n');
  if (!text.trim()) return { risk: 'low', reasons: [] };

  let weight = 0;
  const reasons: string[] = [];
  for (const rule of RULES) {
    if (rule.re.test(text)) { weight += rule.weight; reasons.push(rule.label); }
  }

  // Any weight-3 hit ⇒ high. A couple of weaker signals ⇒ medium.
  const hasStrong = RULES.some(r => r.weight === 3 && r.re.test(text));
  const risk: ScanRisk = hasStrong || weight >= 5 ? 'high' : weight >= 2 ? 'medium' : 'low';
  return { risk, reasons };
}

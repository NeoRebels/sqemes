// SQEM-310 — turning a provider's error into something a person can act on.
//
// The chain that produces these: `execute-step` throws `` `Gemini API error (503): ${body}` ``,
// `runAuthoringAI` rethrows it unchanged, and the caller shows `err.message`. What the person sees
// is a JSON blob with `"status": "UNAVAILABLE"` in it.
//
// ⛔ **The fix is emphatically not to hide the provider's reason.** That was the *other* failure, and
// it cost hours: SQEM-273 spent an afternoon on a connector because the message said "Connection
// failed" and swallowed what the provider had actually said. Here the provider's sentence —
// *"Please try again later"* — is the single most useful thing in the message.
//
// What is missing is everything around it: who is at fault, whether 503 means broken or busy, and
// what the person can do next. This adds that and keeps the original verbatim.
//
// ⚠️ **Deliberately not here: silently retrying on another model.** Tempting, and wrong — somebody
// chose that model, and quietly answering from a different one changes the result without telling
// them.

/**
 * What a status code means for the person, not for the protocol.
 *
 * ⛔ **Every `nextStep` here must name something the product actually offers.** The first draft said
 * *"pick a different model in Settings"* for a busy provider — and there is no such setting: authoring
 * flows (Enhance, Generate, the wizards, Adapt) take `firstTextModelId()`, the **first** model in
 * `AVAILABLE_MODELS` order for which a provider key exists. Nobody chooses it. The owner caught it by
 * asking whether that option existed at all.
 *
 * **An instruction to do something impossible is worse than no instruction**: it sends a person
 * hunting through Settings for a control that was never built, and they end up doubting the product
 * rather than the message. So each line below is the *most* that can honestly be offered.
 */
function meaning(status: number): { headline: string; nextStep: string } | null {
  if (status === 429 || status === 503) {
    // ⛔ **No next step here, and the emptiness is the fix (SQEM-320).** It used to add "this usually
    // clears in a moment — try again shortly", which said, in our words, exactly what the provider
    // had already said in theirs. The headline said it a third time. **Three statements of one fact
    // read as boilerplate and bury the one sentence that carries information** — the provider's.
    //
    // Where a real alternative exists, the caller supplies it (`alternativesAvailable` below);
    // repeating "wait" is not an alternative.
    return { headline: 'is busy right now', nextStep: '' };
  }
  if (status === 401 || status === 403) {
    // The one case with a real control behind it: provider keys do live in Settings.
    return {
      headline: 'refused the key',
      nextStep: 'Check the API key for this provider in Settings — it may be wrong, revoked, or out of quota.',
    };
  }
  if (status === 404) {
    // The model was picked from the key, not by the person — so the lever is the key, not a model list.
    return {
      headline: 'does not know this model',
      nextStep: 'It has probably been retired. Sqemes picks the model from your provider keys, so removing that provider’s key in Settings will make it use another.',
    };
  }
  if (status >= 500) {
    return { headline: 'had a problem', nextStep: 'Not something you can fix — try again shortly.' };
  }
  return null;
}

/**
 * `Gemini API error (503): {json}` → provider, status and the provider's own sentence.
 *
 * Returns `null` when the message is not one of these, so callers can fall through to their own
 * wording rather than dressing up an unrelated error as a provider outage.
 */
function parse(message: string): { provider: string; status: number; detail: string } | null {
  const m = message.match(/^(.*?)\s*API error \((\d{3})\):\s*([\s\S]*)$/);
  if (!m) return null;
  const [, rawProvider, rawStatus, body] = m;
  const provider = rawProvider.trim() || 'The AI provider';
  // The body is usually JSON with the readable sentence nested somewhere. Reach for it, and fall
  // back to the raw body — a long line is still better than dropping what they told us.
  let detail = body.trim();
  try {
    const parsed = JSON.parse(body);
    const found = parsed?.error?.message ?? parsed?.message ?? parsed?.error?.[0]?.message;
    if (typeof found === 'string' && found.trim()) detail = found.trim();
  } catch { /* not JSON — keep the raw body */ }
  return { provider, status: Number(rawStatus), detail };
}

/**
 * A sentence for a human, with the provider's own words kept inside it.
 *
 * Falls back to the original message unchanged when this is not a provider error — a caller should
 * never end up showing less than it would have without this function.
 */
export function describeAIError(
  err: unknown,
  fallback: string,
  /**
   * SQEM-320 — whether this workspace has another authoring model to switch to.
   *
   * ⛔ **The caller decides, this function words it, and that split is deliberate.** Answering it
   * here would mean reaching into the workspace and its provider keys from a pure, testable
   * function. The caller already holds both.
   *
   * ⚠️ **And the flag must be honest, not optimistic.** SQEM-310 removed "pick a different model in
   * Settings" because no such setting existed; SQEM-311 built it. Pointing a workspace with one
   * provider key — or one on funded credits — at that section would be the same defect relocated:
   * a section that offers nothing. The test that forbids the old phrase still stands.
   */
  opts?: { alternativesAvailable?: boolean },
): string {
  const raw = err instanceof Error ? err.message : typeof err === 'string' ? err : '';
  if (!raw) return fallback;

  const parsed = parse(raw);
  if (!parsed) return raw;

  const sense = meaning(parsed.status);
  const who = parsed.provider === 'The AI provider' ? parsed.provider : parsed.provider;
  const head = sense ? `${who} ${sense.headline}.` : `${who} returned an error (${parsed.status}).`;
  // The provider's sentence, verbatim and marked as theirs — so nobody wonders whose wording it is.
  const quoted = parsed.detail ? ` They said: “${parsed.detail}”` : '';
  const next = sense?.nextStep ? ` ${sense.nextStep}` : '';
  // Only for the transient cases, and only when there is genuinely something else to run on.
  const transient = parsed.status === 429 || parsed.status === 503;
  const alternative = transient && opts?.alternativesAvailable
    ? ' You can switch the model under Settings → General → AI for authoring.'
    : '';
  return `${head}${quoted}${next}${alternative}`;
}

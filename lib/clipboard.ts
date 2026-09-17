// SQEM-414 — copying to the clipboard, in one place.
//
// It lived inside `pages/Settings.tsx` until the setup wizard needed the same thing for the MCP
// endpoint. ⚠️ The fallback is not decoration: `navigator.clipboard` rejects outside a secure context
// and in a few embedded browsers, and a copy button that silently does nothing is worse than none —
// the caller gets `false` and can say so.

export async function copyToClipboard(text: string): Promise<boolean> {
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
}

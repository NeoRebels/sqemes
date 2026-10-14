import React, { useEffect, useRef } from 'react';
import { TURNSTILE_SCRIPT } from '../lib/captcha';

/**
 * SQEM-501 — Cloudflare Turnstile, loaded without an npm package (one script from one host).
 *
 * `appearance: 'interaction-only'` keeps it invisible unless Cloudflare wants a click. A token is
 * single-use, so the parent changes `resetKey` after every auth attempt and the widget issues a new
 * one. `onToken(null)` means "no valid token right now" (expired or failed).
 */
interface TurnstileApi {
  render(el: HTMLElement, opts: Record<string, unknown>): string;
  reset(id: string): void;
  remove(id: string): void;
}
declare global {
  interface Window { turnstile?: TurnstileApi }
}

let scriptPromise: Promise<void> | null = null;
function loadScript(): Promise<void> {
  if (window.turnstile) return Promise.resolve();
  scriptPromise ??= new Promise<void>((resolve, reject) => {
    const s = document.createElement('script');
    s.src = TURNSTILE_SCRIPT;
    s.async = true;
    s.onload = () => resolve();
    s.onerror = () => { scriptPromise = null; reject(new Error('Turnstile failed to load')); };
    document.head.appendChild(s);
  });
  return scriptPromise;
}

export default function TurnstileWidget({ siteKey, onToken, resetKey }: {
  siteKey: string;
  onToken: (token: string | null) => void;
  resetKey: number;
}) {
  const box = useRef<HTMLDivElement>(null);
  const widgetId = useRef<string | null>(null);
  const tokenCb = useRef(onToken);
  useEffect(() => { tokenCb.current = onToken; }, [onToken]);

  useEffect(() => {
    let cancelled = false;
    loadScript().then(() => {
      if (cancelled || !box.current || !window.turnstile) return;
      widgetId.current = window.turnstile.render(box.current, {
        sitekey: siteKey,
        appearance: 'interaction-only',
        callback: (t: string) => tokenCb.current(t),
        'expired-callback': () => tokenCb.current(null),
        'error-callback': () => tokenCb.current(null),
      });
    }).catch(() => tokenCb.current(null));
    return () => {
      cancelled = true;
      if (widgetId.current && window.turnstile) window.turnstile.remove(widgetId.current);
      widgetId.current = null;
    };
  }, [siteKey]);

  useEffect(() => {
    if (resetKey === 0 || !widgetId.current || !window.turnstile) return;
    tokenCb.current(null);
    window.turnstile.reset(widgetId.current);
  }, [resetKey]);

  return <div ref={box} className="flex justify-center" />;
}

import { useEffect, useState } from 'react';
import { EXTENSION_ID } from '../lib/links';

// SQEM-079 — best-effort detection of the installed Sqemes browser extension.
// The extension answers an `externally_connectable` ping ({ type: 'sqemes:ping' })
// with { installed: true, version }. Web pages can't enumerate extensions, so this
// handshake is the only reliable signal.
//
// Defaults to NOT installed and only flips to true on a confirmed reply — so a
// blocked/failed check, a different browser/profile, or a non-Chromium browser
// never wrongly hides the "Install Extension" link.
export function useExtensionInstalled(): boolean {
  const [installed, setInstalled] = useState(false);

  useEffect(() => {
    const runtime = (window as any).chrome?.runtime;
    if (!runtime?.sendMessage) return;
    try {
      runtime.sendMessage(EXTENSION_ID, { type: 'sqemes:ping' }, (resp: { installed?: boolean } | undefined) => {
        // Reading lastError marks it handled (suppresses the console warning) and
        // tells us the extension isn't there / didn't respond.
        if ((window as any).chrome?.runtime?.lastError) return;
        if (resp?.installed) setInstalled(true);
      });
    } catch {
      /* messaging unavailable — treat as not installed */
    }
  }, []);

  return installed;
}

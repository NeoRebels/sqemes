import React, { useEffect, useState } from 'react';
import { Info, ArrowUpCircle, CheckCircle2, ExternalLink } from 'lucide-react';
import Card from './ui/Card';
import { IS_SELF_HOSTED } from '../lib/env';
import { CURRENT_VERSION, UPDATE_DOCS_URL, checkForUpdate, type UpdateStatus } from '../lib/version';

// SQEM-118 — self-host "About" panel: shows the running Sqemes version and, when a newer
// release is available, a link to the update docs. Renders nothing on Cloud.
export function AboutSection() {
  const [status, setStatus] = useState<UpdateStatus | null>(null);

  useEffect(() => {
    if (!IS_SELF_HOSTED) return;
    const ctrl = new AbortController();
    checkForUpdate(ctrl.signal).then(setStatus);
    return () => ctrl.abort();
  }, []);

  if (!IS_SELF_HOSTED) return null;

  const updateAvailable = !!(status?.updateAvailable && status.latest);

  return (
    <Card className="p-6 md:p-8">
      <h2 className="text-lg font-bold text-slate-900 dark:text-slate-100 flex items-center gap-2 mb-6">
        <Info className="w-5 h-5 text-brand-500" /> About
      </h2>

      <div className="flex items-center justify-between gap-4">
        <div>
          <div className="text-sm font-bold text-slate-900 dark:text-slate-100">Sqemes</div>
          <div className="text-xs text-slate-500 dark:text-slate-400">Self-hosted</div>
        </div>
        <div className="text-sm font-mono text-slate-700 dark:text-slate-200">v{CURRENT_VERSION}</div>
      </div>

      {updateAvailable ? (
        <div className="mt-5 rounded-xl border border-amber-200 dark:border-amber-800/50 bg-amber-50 dark:bg-amber-900/20 p-4">
          <div className="flex items-start gap-3">
            <ArrowUpCircle className="w-5 h-5 text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" />
            <div className="min-w-0">
              <div className="text-sm font-bold text-amber-900 dark:text-amber-200">
                Version {status!.latest} is available
              </div>
              <p className="text-xs text-amber-700 dark:text-amber-300/90 mt-0.5">
                You're running v{CURRENT_VERSION}.
              </p>
              <a
                href={UPDATE_DOCS_URL}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 mt-2 text-sm font-bold text-amber-700 dark:text-amber-300 hover:text-amber-900 dark:hover:text-amber-100 transition-colors"
              >
                How to update <ExternalLink className="w-3.5 h-3.5" />
              </a>
            </div>
          </div>
        </div>
      ) : status ? (
        <div className="mt-4 flex items-center gap-2 text-xs text-emerald-600 dark:text-emerald-400">
          <CheckCircle2 className="w-4 h-4" /> You're on the latest version.
        </div>
      ) : null}
    </Card>
  );
}

export default AboutSection;

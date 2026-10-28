import React from 'react';
import { Info, ArrowUpCircle, CheckCircle2, ExternalLink } from 'lucide-react';
import Card from './ui/Card';
import { IS_SELF_HOSTED } from '../lib/env';
import { CURRENT_VERSION, UPDATE_DOCS_URL } from '../lib/version';
import { useUpdateStatus } from '../hooks/useUpdateStatus';
import { m } from '../lib/i18n';

// SQEM-118 — self-host "About" panel: shows the running Sqemes version and, when a newer
// release is available, a link to the update docs. Renders nothing on Cloud.
// SQEM-123 — shares the update check with the sidebar footer via useUpdateStatus(); the
// `id="about"` anchor is the scroll target when the footer indicator links here.
export function AboutSection() {
  const status = useUpdateStatus();

  if (!IS_SELF_HOSTED) return null;

  const updateAvailable = !!(status?.updateAvailable && status.latest);

  return (
    <Card id="about" className="p-6 md:p-8 scroll-mt-6">
      <h2 className="font-display text-xl font-semibold text-ink-strong flex items-center gap-2 mb-6">
        <Info className="w-5 h-5 text-accent" /> {m.ab_title()}
      </h2>

      <div className="flex items-center justify-between gap-4">
        <div>
          <div className="text-sm font-bold text-ink-strong">sqemes</div>
          <div className="text-xs text-ink-muted">{m.ab_self_hosted()}</div>
        </div>
        <div className="text-sm font-mono text-ink">v{CURRENT_VERSION}</div>
      </div>

      {updateAvailable ? (
        <div className="mt-5 rounded-xl border border-warning/40 bg-warning-soft p-4">
          <div className="flex items-start gap-3">
            <ArrowUpCircle className="w-5 h-5 text-warning shrink-0 mt-0.5" />
            <div className="min-w-0">
              <div className="text-sm font-bold text-ink-strong">
                {m.ab_update({ version: status!.latest })}
              </div>
              <p className="text-xs text-ink mt-0.5">
                {m.ab_running({ version: CURRENT_VERSION })}
              </p>
              <a
                href={UPDATE_DOCS_URL}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 mt-2 text-sm font-bold text-ink-strong hover:underline transition-colors"
              >
                {m.ab_how()} <ExternalLink className="w-3.5 h-3.5" />
              </a>
            </div>
          </div>
        </div>
      ) : status ? (
        <div className="mt-4 flex items-center gap-2 text-xs text-success">
          <CheckCircle2 className="w-4 h-4" /> {m.ab_latest()}
        </div>
      ) : null}
    </Card>
  );
}

export default AboutSection;

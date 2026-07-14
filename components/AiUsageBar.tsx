import { creditsUsagePercent, creditsTooltip } from '../lib/credits';

interface AiUsageBarProps {
  used: number;
  limit: number;
  /** Sqemes-funded AI available (Cloud). When false the indicator is hidden entirely. */
  fundedAvailable?: boolean;
  /** Workspace has a BYOK text key → funded credits aren't consumed (own key is used). */
  hasByokText: boolean;
}

// SQEM-082 — "AI credits" indicator on the Dashboard plan card. Styled to match the
// "Seats" bar exactly (same brand colours, same track/fill) so the two read as a pair.
// BYOK-aware: a workspace using its own key never burns credits; self-host has no
// funded path; and an unprovisioned allowance (limit 0) is hidden rather than shown.
const AiUsageBar = ({ used, limit, fundedAvailable, hasByokText }: AiUsageBarProps) => {
  if (!fundedAvailable) return null;
  if (!hasByokText && limit === 0) return null;

  const showBar = !hasByokText && limit > 0;
  const rightLabel = hasByokText
    ? 'Using your own key'
    : `${used.toLocaleString('en-US')} / ${limit.toLocaleString('en-US')}`;

  return (
    <div title={hasByokText ? 'Your own API key is used — AI credits are not consumed' : creditsTooltip(used, limit)}>
      <div className="flex justify-between text-xs mb-1.5 text-brand-100">
        <span className="font-medium">AI credits</span>
        <span className="font-bold">{rightLabel}</span>
      </div>
      {showBar && (
        <div className="h-1.5 w-full bg-brand-950/40 rounded-full overflow-hidden">
          <div
            className="h-full rounded-full transition-all duration-500 bg-white"
            style={{ width: `${creditsUsagePercent(used, limit)}%` }}
          />
        </div>
      )}
    </div>
  );
};

export default AiUsageBar;

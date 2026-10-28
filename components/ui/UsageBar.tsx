/**
 * SQEM-555 — one usage line with a bar: seats, storage, anything with a used value and a limit.
 *
 * `limit === null` means unlimited (a managed workspace): the line says so and draws no bar, because a
 * bar without an end is a guess dressed up as a measurement. Over 90 % the bar turns red — the same
 * threshold the seats bar used before it became this component.
 *
 * Two tones: `onBrand` for the dark plan card (white on purple), `surface` for ordinary cards.
 */
import { m, getLocale } from '../../lib/i18n';

export function formatStorage(bytes: number): string {
  // SQEM-607 — the decimal separator follows the app language.
  if (bytes >= 1024 ** 3) return `${(bytes / 1024 ** 3).toLocaleString(getLocale(), { maximumFractionDigits: bytes >= 10 * 1024 ** 3 ? 0 : 1, minimumFractionDigits: bytes >= 10 * 1024 ** 3 ? 0 : 1 })} GB`;
  if (bytes >= 1024 ** 2) return `${Math.round(bytes / 1024 ** 2)} MB`;
  if (bytes > 0) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return '0 MB';
}

export function usagePercent(used: number, limit: number | null): number | null {
  if (limit === null) return null;
  if (limit <= 0) return 100;
  return Math.min(100, Math.max(0, (used / limit) * 100));
}

export default function UsageBar({
  label,
  used,
  limit,
  format = (n: number) => String(n),
  tone = 'surface',
}: {
  label: string;
  used: number;
  limit: number | null;
  format?: (n: number) => string;
  tone?: 'onBrand' | 'surface';
}) {
  const pct = usagePercent(used, limit);
  const onBrand = tone === 'onBrand';
  const value = limit === null ? m.usage_unlimited({ used: format(used) }) : `${format(used)} / ${format(limit)}`;
  return (
    <div>
      <div className={`flex justify-between text-xs mb-1.5 ${onBrand ? 'text-brand-100' : 'text-ink-muted'}`}>
        <span className="font-medium">{label}</span>
        <span className={`font-bold ${onBrand ? '' : 'text-ink-strong'}`}>{value}</span>
      </div>
      {pct !== null && (
        <div
          role="progressbar"
          aria-label={label}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={Math.round(pct)}
          className={`h-1.5 w-full rounded-full overflow-hidden ${onBrand ? 'bg-brand-950/40' : 'bg-surface-sunken'}`}
        >
          <div
            className={`h-full rounded-full transition-all duration-500 ${pct > 90 ? (onBrand ? 'bg-red-400' : 'bg-danger') : onBrand ? 'bg-white' : 'bg-accent'}`}
            style={{ width: `${pct}%` }}
          />
        </div>
      )}
    </div>
  );
}

// SQEM-691 — Settings → Profile "Devices": where this person is signed in, and a way to end any other
// session. Before, the profile could only sign out the device in front of you; a session left open on
// a borrowed laptop stayed open.
// ⚠️ Ending a session stops its refresh token at once, but the access token that device already holds
// stays valid until it expires (one hour). The card says so instead of promising an instant logout.
import { useCallback, useEffect, useState } from 'react';
import { Laptop, Smartphone, Tablet, MonitorSmartphone, Loader2, LogOut } from 'lucide-react';
import Card from './ui/Card';
import Button from './ui/Button';
import ConfirmModal from './ui/ConfirmModal';
import SettingsCardHeader from './ui/SettingsCardHeader';
import { fetchMySessions, revokeMySession, signOutOtherSessions, type MySession } from '../lib/api/sessions';
import { parseUserAgent, formatPlace } from '../lib/userAgent';
import { m, getLocale } from '../lib/i18n';

const KIND_ICON = { desktop: Laptop, mobile: Smartphone, tablet: Tablet } as const;

function deviceLabel(ua: string | null): string {
  const { browser, os } = parseUserAgent(ua);
  if (browser && os) return m.stp_devices_browser_on_os({ browser, os });
  return browser ?? os ?? m.stp_devices_unknown_device();
}

export default function DevicesCard({ showToast }: { showToast: (msg: string, type?: 'success' | 'error' | 'info') => void }) {
  const [sessions, setSessions] = useState<MySession[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [pending, setPending] = useState<MySession | 'others' | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      setSessions(await fetchMySessions());
      setFailed(false);
    } catch {
      setFailed(true);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const when = (iso: string) =>
    new Date(iso).toLocaleString(getLocale(), { dateStyle: 'short', timeStyle: 'short' });

  const confirm = async () => {
    if (!pending) return;
    setBusy(true);
    try {
      if (pending === 'others') await signOutOtherSessions();
      else await revokeMySession(pending.id);
      showToast(pending === 'others' ? m.stp_devices_others_done() : m.stp_devices_one_done(), 'success');
      await load();
    } catch {
      showToast(m.stp_devices_failed(), 'error');
    } finally {
      setBusy(false);
      setPending(null);
    }
  };

  const others = (sessions ?? []).filter(s => !s.isCurrent);

  return (
    <Card id="devices" className="p-6 md:p-8">
      <SettingsCardHeader
        icon={<MonitorSmartphone />}
        title={m.stp_devices_title()}
        description={m.stp_devices_description()}
        actions={others.length > 0 && (
          <Button variant="secondary" size="sm" onClick={() => setPending('others')}>
            {m.stp_devices_sign_out_others()}
          </Button>
        )}
      />

      {failed && <p className="text-sm text-danger">{m.stp_devices_load_failed()}</p>}
      {!failed && sessions === null && <Loader2 className="w-5 h-5 animate-spin text-ink-muted" aria-label={m.stp_devices_loading()} />}

      {sessions && sessions.length > 0 && (
        <div role="table" aria-label={m.stp_devices_title()} className="text-sm">
          <div role="row" className="hidden md:grid grid-cols-[minmax(0,1.5fr)_minmax(0,1.2fr)_minmax(0,1fr)_minmax(0,1fr)_auto] gap-4 pb-2 border-b border-line text-xs font-semibold uppercase tracking-wide text-ink-muted">
            <span role="columnheader">{m.stp_devices_col_device()}</span>
            <span role="columnheader">{m.stp_devices_col_location()}</span>
            <span role="columnheader">{m.stp_devices_col_signed_in()}</span>
            <span role="columnheader">{m.stp_devices_col_last_active()}</span>
            <span role="columnheader"><span className="sr-only">{m.stp_devices_col_action()}</span></span>
          </div>
          {sessions.map(s => {
            const Icon = KIND_ICON[parseUserAgent(s.userAgent).kind];
            const place = formatPlace(s.city, s.country) ?? m.stp_devices_unknown_location();
            return (
              <div role="row" key={s.id} className="grid grid-cols-1 md:grid-cols-[minmax(0,1.5fr)_minmax(0,1.2fr)_minmax(0,1fr)_minmax(0,1fr)_auto] gap-1 md:gap-4 py-4 border-b border-line last:border-b-0 md:items-center">
                {/* The badge sits under the name: beside it, it squeezed the device name to a few letters in the profile column. */}
                <span role="cell" className="flex items-start gap-2 font-medium text-ink-strong min-w-0">
                  <Icon className="w-4 h-4 mt-0.5 shrink-0 text-ink-muted" aria-hidden />
                  <span className="min-w-0">
                    <span className="block truncate">{deviceLabel(s.userAgent)}</span>
                    {s.isCurrent && (
                      <span className="inline-block mt-1 rounded-full bg-accent-soft text-accent text-xs font-semibold px-2 py-0.5">{m.stp_devices_this_device()}</span>
                    )}
                  </span>
                </span>
                <span role="cell" className="text-ink min-w-0">
                  <span className="md:hidden text-ink-muted">{m.stp_devices_col_location()}: </span>
                  {place}
                  {s.ip && <span className="block text-xs text-ink-muted font-mono truncate">{s.ip}</span>}
                </span>
                <span role="cell" className="text-ink">
                  <span className="md:hidden text-ink-muted">{m.stp_devices_col_signed_in()}: </span>
                  {when(s.createdAt)}
                </span>
                <span role="cell" className="text-ink">
                  <span className="md:hidden text-ink-muted">{m.stp_devices_col_last_active()}: </span>
                  {s.isCurrent ? m.stp_devices_now() : when(s.lastActiveAt)}
                </span>
                <span role="cell" className="md:text-right pt-2 md:pt-0">
                  {!s.isCurrent && (
                    <button
                      type="button"
                      onClick={() => setPending(s)}
                      aria-label={m.stp_devices_sign_out_one_label({ device: deviceLabel(s.userAgent) })}
                      className="inline-flex items-center gap-1.5 text-sm font-semibold text-ink hover:text-danger transition-colors"
                    >
                      <LogOut className="w-4 h-4" aria-hidden /> {m.stp_devices_sign_out_one()}
                    </button>
                  )}
                </span>
              </div>
            );
          })}
        </div>
      )}

      <p className="mt-4 text-xs text-ink-muted">{m.stp_devices_hint()}</p>

      <ConfirmModal
        open={pending !== null}
        title={pending === 'others' ? m.stp_devices_others_title() : m.stp_devices_one_title()}
        confirmLabel={m.stp_devices_sign_out_one()}
        busy={busy}
        onConfirm={() => void confirm()}
        onClose={() => !busy && setPending(null)}
      >
        {pending === 'others'
          ? m.stp_devices_others_body({ count: String(others.length) })
          : pending && m.stp_devices_one_body({ device: deviceLabel(pending.userAgent) })}
      </ConfirmModal>
    </Card>
  );
}

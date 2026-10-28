import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router';
import { Lock, Eye, EyeOff, CheckCircle, AlertTriangle } from 'lucide-react';
import { useAuth } from '../hooks/useAuth';
import { supabase } from '../lib/supabase';
import ScrollScreen from '../components/ScrollScreen';
import { Input } from '../components/ui/Input';
import { m } from '../lib/i18n';
import { authErrorText } from '../lib/authErrors';

type Phase = 'verifying' | 'ready' | 'link_error';

const ResetPassword = () => {
  const navigate = useNavigate();
  const { updatePassword } = useAuth();
  const [phase, setPhase] = useState<Phase>('verifying');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  // SQEM-091 — redeem the recovery link. Email scanners/prefetchers burn a GoTrue
  // /verify link before the user clicks it, so the reset email now points at this page
  // with the token in the fragment (`#/reset-password?token_hash=…&type=recovery`). The
  // token is only consumed here, when the user's browser calls verifyOtp — a scanner's
  // GET just loads static HTML and can't redeem it.
  useEffect(() => {
    let active = true;
    (async () => {
      const hash = window.location.hash;
      const qIndex = hash.indexOf('?');
      const params = new URLSearchParams(qIndex >= 0 ? hash.slice(qIndex + 1) : '');
      const tokenHash = params.get('token_hash');
      const type = params.get('type') || 'recovery';

      if (tokenHash) {
        const { error: verifyError } = await supabase.auth.verifyOtp({
          token_hash: tokenHash,
          type: type as 'recovery',
        });
        if (!active) return;
        if (verifyError) {
          setPhase('link_error');
          return;
        }
        // Strip the token from the URL so it isn't left in history.
        window.history.replaceState(null, '', `${window.location.pathname}#/reset-password`);
        setPhase('ready');
        return;
      }

      // No token_hash in the URL — fall back to an already-established recovery session
      // (e.g. a legacy PASSWORD_RECOVERY redirect). If there's no session, the link is bad.
      const { data: { session } } = await supabase.auth.getSession();
      if (!active) return;
      setPhase(session ? 'ready' : 'link_error');
    })();
    return () => { active = false; };
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (password.length < 8) {
      setError(m.reset_too_short());
      return;
    }
    if (password !== confirm) {
      setError(m.reset_mismatch());
      return;
    }

    setLoading(true);
    try {
      const { error } = await updatePassword(password);
      if (error) throw error;
      setSuccess(true);
      // SQEM-140 — the verifyOtp recovery session leaves the workspace fetch empty (→ the
      // "create your first workspace" screen). Sign out and send them to sign-in so they
      // re-auth with the new password on a clean full session that loads workspaces correctly.
      setTimeout(async () => {
        await supabase.auth.signOut();
        navigate('/', { replace: true });
      }, 2000);
    } catch (err: any) {
      setError(err?.code || err?.message ? authErrorText(err) : m.reset_failed());
    } finally {
      setLoading(false);
    }
  };

  if (phase === 'verifying') {
    return (
      <ScrollScreen className="bg-surface">
        <div className="text-center">
          <img src="/logo-favicon-V2.png" alt="sqemes" className="w-10 h-10 rounded-xl shadow-soft mx-auto mb-4 animate-pulse" />
          <p className="text-ink-subtle text-sm font-medium">{m.reset_verifying()}</p>
        </div>
      </ScrollScreen>
    );
  }

  if (phase === 'link_error') {
    return (
      <ScrollScreen className="bg-surface">
        <div className="w-full max-w-md bg-surface-raised rounded-2xl shadow-soft border border-line p-8 text-center">
          <AlertTriangle className="w-12 h-12 text-warning mx-auto mb-4" />
          <h2 className="font-display text-xl font-semibold text-ink-strong mb-2">{m.reset_link_invalid_title()}</h2>
          <p className="text-ink-muted text-sm mb-6">{m.reset_link_invalid_body()}</p>
          <button
            onClick={() => { window.location.hash = '#/'; }}
            className="w-full py-3 bg-accent-strong text-white rounded-xl font-bold text-sm shadow-lg hover:opacity-90 transition-all"
          >
            {m.auth_back_to_sign_in()}
          </button>
        </div>
      </ScrollScreen>
    );
  }

  if (success) {
    return (
      <ScrollScreen className="bg-surface">
        <div className="w-full max-w-md bg-surface-raised rounded-2xl shadow-soft border border-line p-8 text-center">
          <CheckCircle className="w-12 h-12 text-success mx-auto mb-4" />
          <h2 className="font-display text-xl font-semibold text-ink-strong mb-2">{m.reset_updated_title()}</h2>
          <p className="text-ink-muted text-sm">{m.reset_redirecting()}</p>
        </div>
      </ScrollScreen>
    );
  }

  return (
    <ScrollScreen className="bg-surface">
      <div className="w-full max-w-md">
        <div className="text-center mb-8">
          <img src="/logo-favicon-V2.png" alt="sqemes" className="w-12 h-12 rounded-xl shadow-soft mx-auto mb-4" />
          <h1 className="font-display text-2xl font-semibold text-ink-strong">{m.reset_title()}</h1>
          <p className="text-ink-muted mt-1 text-sm">{m.reset_subtitle()}</p>
        </div>

        <div className="bg-surface-raised rounded-2xl shadow-soft border border-line p-8">
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label htmlFor="reset-password-new-password" className="block text-xs font-bold text-ink-muted uppercase tracking-wider mb-1.5">
                {m.reset_new_password()}
              </label>
              <div className="relative">
                <div className="absolute left-3.5 top-1/2 -translate-y-1/2 text-ink-subtle">
                  <Lock className="w-4 h-4" />
                </div>
                <Input id="reset-password-new-password" autoComplete="new-password"
                  type={showPassword ? 'text' : 'password'}
                  className="pl-10 pr-10"
                  value={password}
                  onChange={e => setPassword(e.target.value)}
                  placeholder={m.reset_new_password_placeholder()}
                  required
                  autoFocus
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(v => !v)}
                  aria-label={showPassword ? m.auth_hide_password() : m.auth_show_password()}
                  className="absolute right-3.5 top-1/2 -translate-y-1/2 text-ink-subtle hover:text-ink transition-colors"
                >
                  {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
            </div>

            <div>
              <label htmlFor="reset-password-confirm-password" className="block text-xs font-bold text-ink-muted uppercase tracking-wider mb-1.5">
                {m.reset_confirm_password()}
              </label>
              <div className="relative">
                <div className="absolute left-3.5 top-1/2 -translate-y-1/2 text-ink-subtle">
                  <Lock className="w-4 h-4" />
                </div>
                <Input id="reset-password-confirm-password" autoComplete="new-password"
                  type={showPassword ? 'text' : 'password'}
                  className="pl-10 pr-10"
                  value={confirm}
                  onChange={e => setConfirm(e.target.value)}
                  placeholder={m.reset_confirm_placeholder()}
                  required
                />
              </div>
            </div>

            {error && (
              <p className="text-xs text-danger font-medium">{error}</p>
            )}

            <button
              type="submit"
              disabled={loading}
              className="w-full py-3 bg-accent-strong text-white rounded-xl font-bold text-sm shadow-lg hover:opacity-90 transition-all disabled:opacity-60 disabled:cursor-not-allowed mt-2"
            >
              {loading ? m.reset_updating() : m.reset_submit()}
            </button>
          </form>
        </div>
      </div>
    </ScrollScreen>
  );
};

export default ResetPassword;

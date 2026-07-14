import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Lock, Eye, EyeOff, CheckCircle, AlertTriangle } from 'lucide-react';
import { useAuth } from '../hooks/useAuth';
import { supabase } from '../lib/supabase';
import ScrollScreen from '../components/ScrollScreen';

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
      setError('Password must be at least 8 characters.');
      return;
    }
    if (password !== confirm) {
      setError('Passwords do not match.');
      return;
    }

    setLoading(true);
    try {
      const { error } = await updatePassword(password);
      if (error) throw error;
      setSuccess(true);
      setTimeout(() => navigate('/', { replace: true }), 2000);
    } catch (err: any) {
      setError(err.message || 'Failed to update password.');
    } finally {
      setLoading(false);
    }
  };

  if (phase === 'verifying') {
    return (
      <ScrollScreen className="bg-slate-50 dark:bg-slate-900">
        <div className="text-center">
          <img src="/logo-favicon-V2.png" alt="sqemes" className="w-10 h-10 rounded-xl shadow-soft mx-auto mb-4 animate-pulse" />
          <p className="text-slate-400 dark:text-slate-500 text-sm font-medium">Verifying your reset link…</p>
        </div>
      </ScrollScreen>
    );
  }

  if (phase === 'link_error') {
    return (
      <ScrollScreen className="bg-slate-50 dark:bg-slate-900">
        <div className="w-full max-w-md bg-white dark:bg-slate-800 rounded-2xl shadow-soft border border-slate-100 dark:border-slate-700 p-8 text-center">
          <AlertTriangle className="w-12 h-12 text-amber-500 mx-auto mb-4" />
          <h2 className="text-xl font-bold text-slate-900 dark:text-slate-100 mb-2">Reset link invalid or expired</h2>
          <p className="text-slate-500 dark:text-slate-400 text-sm mb-6">This password reset link is no longer valid. Request a new one and use it right away.</p>
          <button
            onClick={() => { window.location.hash = '#/'; }}
            className="w-full py-3 bg-brand-600 text-white rounded-xl font-bold text-sm shadow-lg shadow-brand-200 dark:shadow-none hover:bg-brand-700 transition-all"
          >
            Back to sign in
          </button>
        </div>
      </ScrollScreen>
    );
  }

  if (success) {
    return (
      <ScrollScreen className="bg-slate-50 dark:bg-slate-900">
        <div className="w-full max-w-md bg-white dark:bg-slate-800 rounded-2xl shadow-soft border border-slate-100 dark:border-slate-700 p-8 text-center">
          <CheckCircle className="w-12 h-12 text-emerald-500 mx-auto mb-4" />
          <h2 className="text-xl font-bold text-slate-900 dark:text-slate-100 mb-2">Password Updated</h2>
          <p className="text-slate-500 dark:text-slate-400 text-sm">Redirecting you to the dashboard...</p>
        </div>
      </ScrollScreen>
    );
  }

  return (
    <ScrollScreen className="bg-slate-50 dark:bg-slate-900">
      <div className="w-full max-w-md">
        <div className="text-center mb-8">
          <img src="/logo-favicon-V2.png" alt="sqemes" className="w-12 h-12 rounded-xl shadow-soft mx-auto mb-4" />
          <h1 className="text-2xl font-bold text-slate-900 dark:text-slate-100">Set new password</h1>
          <p className="text-slate-500 dark:text-slate-400 mt-1 text-sm">Choose a strong password for your account.</p>
        </div>

        <div className="bg-white dark:bg-slate-800 rounded-2xl shadow-soft border border-slate-100 dark:border-slate-700 p-8">
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="block text-xs font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider mb-1.5">
                New Password
              </label>
              <div className="relative">
                <div className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400">
                  <Lock className="w-4 h-4" />
                </div>
                <input
                  type={showPassword ? 'text' : 'password'}
                  className="w-full pl-10 pr-10 py-3 bg-slate-50 dark:bg-slate-700 border border-slate-200 dark:border-slate-600 rounded-xl text-sm text-slate-900 dark:text-slate-100 placeholder-slate-400 dark:placeholder-slate-500 outline-none focus:border-brand-500 focus:bg-white dark:focus:bg-slate-700 transition-colors"
                  value={password}
                  onChange={e => setPassword(e.target.value)}
                  placeholder="At least 8 characters"
                  required
                  autoFocus
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(v => !v)}
                  className="absolute right-3.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 dark:hover:text-slate-300 transition-colors"
                >
                  {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
            </div>

            <div>
              <label className="block text-xs font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider mb-1.5">
                Confirm Password
              </label>
              <div className="relative">
                <div className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400">
                  <Lock className="w-4 h-4" />
                </div>
                <input
                  type={showPassword ? 'text' : 'password'}
                  className="w-full pl-10 pr-10 py-3 bg-slate-50 dark:bg-slate-700 border border-slate-200 dark:border-slate-600 rounded-xl text-sm text-slate-900 dark:text-slate-100 placeholder-slate-400 dark:placeholder-slate-500 outline-none focus:border-brand-500 focus:bg-white dark:focus:bg-slate-700 transition-colors"
                  value={confirm}
                  onChange={e => setConfirm(e.target.value)}
                  placeholder="Repeat your password"
                  required
                />
              </div>
            </div>

            {error && (
              <p className="text-xs text-red-600 font-medium">{error}</p>
            )}

            <button
              type="submit"
              disabled={loading}
              className="w-full py-3 bg-brand-600 text-white rounded-xl font-bold text-sm shadow-lg shadow-brand-200 dark:shadow-none hover:bg-brand-700 transition-all disabled:opacity-60 disabled:cursor-not-allowed mt-2"
            >
              {loading ? 'Updating...' : 'Update Password'}
            </button>
          </form>
        </div>
      </div>
    </ScrollScreen>
  );
};

export default ResetPassword;

import React, { useState } from 'react';
import { useAuth } from '../hooks/useAuth';
import { Mail, Lock, User, ArrowRight, Eye, EyeOff } from 'lucide-react';
import loginImage from '../assets/Login-Screen-V2.jpg';
import Button from '../components/ui/Button';
import Card from '../components/ui/Card';
import { Input } from '../components/ui/Input';
import { IS_SELF_HOSTED } from '../lib/env';
import TurnstileWidget from '../components/TurnstileWidget';
import { TURNSTILE_SITE_KEY, captchaEnabled } from '../lib/captcha';
import { m } from '../lib/i18n';
import { authErrorText, isEmailNotConfirmed } from '../lib/authErrors';

// SQEM-258 — `initialMode` lets a caller open the register form directly. Someone who pressed
// "Start free trial" on a public listing has said what they want; showing them a sign-in form asks
// them to answer a question they already answered.
const Auth = ({ inviteEmail, initialMode }: { inviteEmail?: string; initialMode?: 'login' | 'register' }) => {
  const { signIn, signUp, signInWithOAuth, resetPassword, resendConfirmation } = useAuth();
  const [mode, setMode] = useState<'login' | 'register' | 'forgot'>(initialMode ?? (inviteEmail ? 'register' : 'login'));
  const [email, setEmail] = useState(inviteEmail || '');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  // SQEM-277 — shown only once we know a confirmation is genuinely outstanding, never on spec.
  const [canResend, setCanResend] = useState(false);
  const [resending, setResending] = useState(false);
  // SQEM-501 — the login captcha. Without a site key it is off and none of this has an effect. A token
  // is single-use, so every attempt (whatever its outcome) bumps `captchaReset` for a fresh one.
  const captchaOn = captchaEnabled(TURNSTILE_SITE_KEY);
  const [captchaToken, setCaptchaToken] = useState<string | null>(null);
  const [captchaReset, setCaptchaReset] = useState(0);
  const token = captchaToken ?? undefined;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setMessage(null);
    setCanResend(false);
    setLoading(true);

    try {
      if (mode === 'login') {
        const { error } = await signIn(email, password, token);
        if (error) {
          // SQEM-277 — "Email not confirmed" is the one sign-in failure with a next step, so it
          // gets one. SQEM-603 — every other one goes through authErrorText (ours for a known code,
          // the provider's message otherwise).
          if (isEmailNotConfirmed(error)) {
            setCanResend(true);
            throw new Error(m.auth_error_email_not_confirmed());
          }
          throw error;
        }
      } else if (mode === 'forgot') {
        const { error } = await resetPassword(email, token);
        if (error) throw error;
        setMessage(m.auth_reset_sent());
      } else {
        if (!name.trim()) {
          throw new Error(m.auth_name_required());
        }
        const { data, error } = await signUp(email, password, name, token);
        if (error) throw error;

        // SQEM-277 — ask the response instead of assuming the answer.
        //
        // `data.session` is null exactly when Supabase is holding the account until the address is
        // confirmed, and populated when it is not. The old code announced a confirmation step
        // unconditionally, so whichever way the project was configured, half the time it told the
        // person something untrue — and it was untrue in the direction that matters, promising a
        // check that was not happening.
        //
        // Deriving it means this survives the setting being changed in the dashboard, which is
        // where it lives and where no deploy can see it.
        if (data.session) {
          setMessage(null);
          return; // signed in already — the auth listener takes it from here
        }

        // SQEM-458 — …and `session === null` has TWO causes, which is what SQEM-277 could not see.
        //
        // Signing up with an address that already has an account returns no error and no session
        // either: Supabase obfuscates the case deliberately, so the form cannot be used to test
        // which addresses are registered. Measured against staging on 2026-09-21 — the two
        // responses are identical but for one field:
        //
        //   existing address → identities: []            new address → identities: [{ provider: 'email' }]
        //
        // ⛔ Everything else is fabricated to match: a random `id`, `created_at` = now, and a
        // `confirmation_sent_at` for a mail that was never sent. So the old copy told the one
        // person who already had an account to go and open a link that does not exist, and offered
        // to send it again.
        //
        // ⚠️ We do not read `identities` to tell them apart (considered and rejected, owner,
        // 2026-09-21): it is not a guaranteed part of their API, it would fail silently rather than
        // break, and using it re-opens exactly the account-enumeration their obfuscation closes.
        // The wording below is true under both causes instead, and names a next step under both.
        setMessage(m.auth_signup_check_inbox());
        setMode('login');

        // ⚠️ Deliberately no `setCanResend(true)` here — and that RESTORES what SQEM-277 intended
        // ("shown only once we know a confirmation is genuinely outstanding, never on spec"). It is
        // not lost: `setMode('login')` puts them on the sign-in form, and a sign-in attempt on an
        // unconfirmed account answers "Email not confirmed", which offers the resend above — at the
        // one moment we actually know there is something to resend.
      }
    } catch (err: any) {
      setError(authErrorText(err));
    } finally {
      setLoading(false);
      if (captchaOn) setCaptchaReset(n => n + 1);
    }
  };

  // SQEM-277 — Supabase gives the same answer whether or not a signup is pending for this address,
  // so the confirmation here says what we did, not what it found. Claiming more would leak whether
  // an address is registered, which is the thing their API deliberately refuses to reveal.
  const handleResend = async () => {
    if (!email) return;
    setError(null);
    setMessage(null);
    setResending(true);
    const { error } = await resendConfirmation(email, token);
    setResending(false);
    if (captchaOn) setCaptchaReset(n => n + 1);
    if (error) {
      setError(authErrorText(error));
      return;
    }
    setMessage(m.auth_resend_sent());
  };

  const handleOAuth = async (provider: 'google' | 'github') => {
    setError(null);
    const { error } = await signInWithOAuth(provider);
    if (error) setError(authErrorText(error));
  };

  return (
    <div className="h-dvh overflow-hidden flex">
      {/* Right — Image panel (hidden on mobile) */}
      <div className="hidden md:flex flex-1 relative overflow-hidden bg-auth-highlight">
        <img
          src={loginImage}
          alt=""
          className="absolute inset-0 w-full h-full object-cover"
        />
      </div>

      {/* Right — Form (own scroll container so tall forms / zoom don't clip) */}
      <div className="flex-1 bg-surface overflow-y-auto">
        <div className="min-h-full flex items-center justify-center p-6 md:p-12">
        <div className="w-full max-w-md">
          {/* Logo */}
          <div className="mb-8 text-center">
            <div className="inline-flex items-center gap-2 mb-4">
              <img src="/logo-favicon-V2.png" alt="sqemes" className="w-10 h-10 rounded-xl shadow-soft" />
              <span className="text-2xl font-bold text-ink-strong">sqemes</span>
            </div>
            {/* SQEM-544 — the page's one h1: what this screen is for. Same look as the line it replaced. */}
            <h1 className="text-ink-muted text-sm font-normal">
              {mode === 'login' ? m.auth_heading_login() : mode === 'register' ? m.auth_heading_register() : m.auth_heading_forgot()}
            </h1>
          </div>

          {/* Card */}
          <Card className="p-8">
            {/* OAuth Buttons — hidden on self-host (no OAuth providers configured there) */}
            {!IS_SELF_HOSTED && mode !== 'forgot' && <div className="space-y-3 mb-6">
              <button
                onClick={() => handleOAuth('google')}
                className="w-full flex items-center justify-center gap-3 px-4 py-3 bg-surface-raised border border-line-strong rounded-xl text-sm font-medium text-ink hover:bg-surface-sunken hover:border-ink-subtle transition-all"
              >
                <svg className="w-5 h-5" viewBox="0 0 24 24">
                  <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z" fill="#4285F4"/>
                  <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
                  <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05"/>
                  <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/>
                </svg>
                {m.auth_continue_google()}
              </button>
              <button
                onClick={() => handleOAuth('github')}
                className="w-full flex items-center justify-center gap-3 px-4 py-3 bg-surface-raised border border-line-strong rounded-xl text-sm font-medium text-ink hover:bg-surface-sunken hover:border-ink-subtle transition-all"
              >
                <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24">
                  <path fillRule="evenodd" d="M12 2C6.477 2 2 6.484 2 12.017c0 4.425 2.865 8.18 6.839 9.504.5.092.682-.217.682-.483 0-.237-.008-.868-.013-1.703-2.782.605-3.369-1.343-3.369-1.343-.454-1.158-1.11-1.466-1.11-1.466-.908-.62.069-.608.069-.608 1.003.07 1.531 1.032 1.531 1.032.892 1.53 2.341 1.088 2.91.832.092-.647.35-1.088.636-1.338-2.22-.253-4.555-1.113-4.555-4.951 0-1.093.39-1.988 1.029-2.688-.103-.253-.446-1.272.098-2.65 0 0 .84-.27 2.75 1.026A9.564 9.564 0 0 1 12 6.844a9.59 9.59 0 0 1 2.504.337c1.909-1.296 2.747-1.027 2.747-1.027.546 1.379.202 2.398.1 2.651.64.7 1.028 1.595 1.028 2.688 0 3.848-2.339 4.695-4.566 4.943.359.309.678.92.678 1.855 0 1.338-.012 2.419-.012 2.747 0 .268.18.58.688.482A10.02 10.02 0 0 0 22 12.017C22 6.484 17.522 2 12 2z" clipRule="evenodd"/>
                </svg>
                {m.auth_continue_github()}
              </button>
            </div>}

            {/* Divider — hidden on self-host along with the OAuth buttons */}
            {!IS_SELF_HOSTED && mode !== 'forgot' && <div className="relative my-6">
              <div className="absolute inset-0 flex items-center">
                <div className="w-full border-t border-line-strong"></div>
              </div>
              <div className="relative flex justify-center text-xs">
                <span className="bg-surface-raised px-4 text-ink-subtle font-medium">{m.auth_or_email()}</span>
              </div>
            </div>}

            {/* Form */}
            <form onSubmit={handleSubmit} className="space-y-4">
              {mode === 'register' && (
                <div>
                  <label htmlFor="auth-full-name" className="block text-xs font-bold text-ink-subtle uppercase tracking-wider mb-2">{m.auth_full_name()}</label>
                  <div className="relative">
                    <User className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-ink-subtle" />
                    <Input id="auth-full-name" autoComplete="name"
                      type="text"
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                      placeholder={m.auth_full_name_placeholder()}
                      className="pl-10"
                    />
                  </div>
                </div>
              )}

              <div>
                <label htmlFor="auth-email" className="block text-xs font-bold text-ink-subtle uppercase tracking-wider mb-2">{m.auth_email()}</label>
                <div className="relative">
                  <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-ink-subtle" />
                  <Input id="auth-email" autoComplete="email"
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder={m.auth_email_placeholder()}
                    required
                    className="pl-10"
                  />
                </div>
              </div>

              {mode !== 'forgot' && (
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <label htmlFor="auth-password" className="block text-xs font-bold text-ink-subtle uppercase tracking-wider">{m.auth_password()}</label>
                    {mode === 'login' && (
                      <button
                        type="button"
                        onClick={() => { setMode('forgot'); setError(null); setMessage(null); }}
                        className="text-xs text-accent hover:opacity-80 font-medium"
                      >
                        {m.auth_forgot_password()}
                      </button>
                    )}
                  </div>
                  <div className="relative">
                    <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-ink-subtle" />
                    <Input
                      id="auth-password"
                      // SQEM-538 — tells a password manager whether to fill a saved password or offer a new one.
                      autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
                      type={showPassword ? 'text' : 'password'}
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      placeholder={m.auth_password_placeholder()}
                      required
                      minLength={8}
                      className="pl-10 pr-12"
                    />
                    <button
                      type="button"
                      onClick={() => setShowPassword(!showPassword)}
                      aria-label={showPassword ? m.auth_hide_password() : m.auth_show_password()}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-ink-subtle hover:text-ink"
                    >
                      {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                    </button>
                  </div>
                </div>
              )}

              {error && (
                <div className="p-3 bg-danger-soft border border-danger/30 rounded-xl text-sm text-danger">
                  {error}
                </div>
              )}

              {message && (
                <div className="p-3 bg-success-soft border border-success/30 rounded-xl text-sm text-success">
                  {message}
                </div>
              )}

              {/* SQEM-277 — the way out when the confirmation mail never arrives. Without it an
                  account that cannot receive that one mail is simply lost, with nothing on screen
                  to try. Shown only once a confirmation is known to be outstanding. */}
              {canResend && (
                <button
                  type="button"
                  onClick={handleResend}
                  disabled={resending || !email || (captchaOn && !captchaToken)}
                  className="w-full text-center text-sm text-accent hover:underline disabled:opacity-50 disabled:no-underline"
                >
                  {resending ? m.auth_sending() : m.auth_resend()}
                </button>
              )}

              {captchaOn && (
                <TurnstileWidget siteKey={TURNSTILE_SITE_KEY} onToken={setCaptchaToken} resetKey={captchaReset} />
              )}

              <Button
                type="submit"
                loading={loading}
                disabled={captchaOn && !captchaToken}
                className="w-full py-3 shadow-lg"
              >
                {loading ? m.auth_please_wait() : mode === 'login' ? m.auth_sign_in() : mode === 'forgot' ? m.auth_send_reset() : m.auth_create_account()}
                {!loading && <ArrowRight className="w-4 h-4" />}
              </Button>
            </form>

            <div className="mt-6 text-center text-sm text-ink-muted">
              {mode === 'login' ? (
                <>
                  {m.auth_no_account()}{' '}
                  <button onClick={() => { setMode('register'); setError(null); setMessage(null); }} className="text-accent font-bold hover:opacity-80">
                    {m.auth_sign_up()}
                  </button>
                </>
              ) : mode === 'forgot' ? (
                <button onClick={() => { setMode('login'); setError(null); setMessage(null); }} className="text-accent font-bold hover:opacity-80">
                  {m.auth_back_to_sign_in()}
                </button>
              ) : (
                <>
                  {m.auth_have_account()}{' '}
                  <button onClick={() => { setMode('login'); setError(null); setMessage(null); }} className="text-accent font-bold hover:opacity-80">
                    {m.auth_sign_in()}
                  </button>
                </>
              )}
            </div>
          </Card>
        </div>
        </div>
      </div>

    </div>
  );
};

export default Auth;

import { useState, useEffect, useCallback } from 'react';
import { supabase } from '../lib/supabase';
import { clearMonitoringUser } from '../lib/monitoring';
import type { Session, User } from '@supabase/supabase-js';

const INVITE_KEYS = ['pendingInviteToken', 'pendingInviteTokenAt', 'pendingInviteEmail'] as const;

function clearInviteStorage() {
  INVITE_KEYS.forEach(k => localStorage.removeItem(k));
}

export function useAuth() {
  const [session, setSession] = useState<Session | null>(null);
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session);
      setUser(session?.user ?? null);
      setLoading(false);
    });

    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      (_event, session) => {
        setSession(session);
        setUser(session?.user ?? null);
        setLoading(false);
        // SQEM-091 — when supabase-js establishes the recovery session from the URL it
        // fires PASSWORD_RECOVERY; route to the reset page (the route bypasses the
        // loading/workspace guards in App.tsx so the form renders from the recovery
        // session). This is the fix that shipped with SQEM-038 and later regressed away.
        if (_event === 'PASSWORD_RECOVERY' && !window.location.hash.startsWith('#/reset-password')) {
          window.location.hash = '/reset-password';
        }
      }
    );

    return () => subscription.unsubscribe();
  }, []);

  const signUp = useCallback(async (email: string, password: string, name: string) => {
    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        data: { name },
        emailRedirectTo: window.location.origin,
      },
    });
    return { data, error };
  }, []);

  // SQEM-277 — resend the signup confirmation.
  //
  // This exists because confirmation is *on*: an account is unusable until the mail arrives, so a
  // mail that lands in spam or gets lost is a dead end with no way out. Password reset has had a
  // way to retry since it shipped; signup had none, because nothing depended on that mail.
  //
  // Supabase answers identically whether or not the address has a pending signup — that is
  // deliberate on their side (it stops the form being used to test which addresses are
  // registered), and the caller must not try to be more informative than the API is.
  const resendConfirmation = useCallback(async (email: string) => {
    const { error } = await supabase.auth.resend({
      type: 'signup',
      email,
      options: { emailRedirectTo: window.location.origin },
    });
    return { error };
  }, []);

  const signIn = useCallback(async (email: string, password: string) => {
    const { data, error } = await supabase.auth.signInWithPassword({
      email,
      password,
    });
    return { data, error };
  }, []);

  const signInWithOAuth = useCallback(async (provider: 'google' | 'github') => {
    // Preserve pending invite token across OAuth redirect using localStorage
    // (sessionStorage is cleared by the OAuth redirect)
    const hash = window.location.hash;
    const inviteMatch = hash.match(/#\/invite\/([^?]+)(?:\?email=([^&]+))?/);
    if (inviteMatch) {
      localStorage.setItem('pendingInviteToken', inviteMatch[1]);
      localStorage.setItem('pendingInviteTokenAt', String(Date.now()));
      if (inviteMatch[2]) {
        localStorage.setItem('pendingInviteEmail', decodeURIComponent(inviteMatch[2]));
      }
    }

    const { data, error } = await supabase.auth.signInWithOAuth({
      provider,
      options: {
        redirectTo: window.location.origin,
      },
    });
    return { data, error };
  }, []);

  const signOut = useCallback(async () => {
    clearInviteStorage();
    clearMonitoringUser();
    const { error } = await supabase.auth.signOut();
    return { error };
  }, []);

  const resetPassword = useCallback(async (email: string) => {
    // SQEM-091 — redirect to the BARE origin (no `/#/reset-password`). GoTrue puts the
    // recovery token in the fragment; the bare origin lands it at `#access_token=…&type=recovery`
    // where supabase-js parses it cleanly and establishes the recovery session. The
    // PASSWORD_RECOVERY handler above then routes to the reset page.
    const { data, error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: window.location.origin,
    });
    return { data, error };
  }, []);

  const updatePassword = useCallback(async (newPassword: string) => {
    const { data, error } = await supabase.auth.updateUser({ password: newPassword });
    return { data, error };
  }, []);

  return {
    session,
    user,
    loading,
    signUp,
    resendConfirmation,
    signIn,
    signInWithOAuth,
    signOut,
    resetPassword,
    updatePassword,
  };
}

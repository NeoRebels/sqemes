import { useEffect, useRef, useState } from 'react';
import { useParams, useNavigate } from 'react-router';
import { acceptInvitation } from '../lib/api/invitations';
import { useAuth } from '../hooks/useAuth';
import { CheckCircle, AlertTriangle, Loader2 } from 'lucide-react';
import ScrollScreen from '../components/ScrollScreen';
import { m } from '../lib/i18n';

const InviteAccept = () => {
  const { token } = useParams<{ token: string }>();
  const navigate = useNavigate();
  const { session, loading } = useAuth();
  const [status, setStatus] = useState<'loading' | 'success' | 'error'>('loading');
  const [errorMessage, setErrorMessage] = useState('');
  // SQEM-120 — accept exactly once. After signup, onAuthStateChange fires multiple times,
  // each producing a new `session` object → this effect re-runs; without a latch the second
  // acceptInvitation() call hits the RPC's "already accepted" guard and flips success to error.
  const acceptedRef = useRef(false);

  useEffect(() => {
    if (!token) {
      setStatus('error');
      setErrorMessage(m.invite_invalid_link());
      return;
    }

    // Wait for auth to resolve before deciding — useAuth() starts with session=null
    // even when the user is already logged in, which would incorrectly trigger the
    // !session branch below before the real session is known.
    if (loading) return;

    if (!session) {
      // Confirmed not logged in — save token in localStorage so it survives OAuth redirects
      localStorage.setItem('pendingInviteToken', token);
      localStorage.setItem('pendingInviteTokenAt', String(Date.now()));
      navigate('/', { replace: true });
      return;
    }

    // Logged in — accept the invitation, but only once per mount (see acceptedRef above).
    if (acceptedRef.current) return;
    acceptedRef.current = true;

    const finishSuccess = () => {
      localStorage.removeItem('pendingInviteToken');
      localStorage.removeItem('pendingInviteEmail');
      localStorage.removeItem('pendingInviteTokenAt');
      setStatus('success');
      // Redirect to home after a short delay so user sees the success message
      setTimeout(() => {
        // Force full reload to re-init store with new workspace
        window.location.href = window.location.origin + window.location.pathname + '#/';
        window.location.reload();
      }, 1500);
    };

    const accept = async () => {
      try {
        await acceptInvitation(token);
        finishSuccess();
      } catch (err: any) {
        const msg: string = err?.message || '';
        // Idempotent: the invitation is email-bound, so "already accepted" means THIS user
        // already joined (e.g. a duplicate call or a re-clicked link) — treat as success.
        // Genuine expired / revoked / wrong-email / not-found still surface as errors.
        if (/already been accepted/i.test(msg)) {
          finishSuccess();
          return;
        }
        setStatus('error');
        setErrorMessage(msg || m.invite_failed());
      }
    };

    accept();
  }, [token, session, loading, navigate]);

  return (
    <ScrollScreen className="bg-surface">
      <div className="w-full max-w-md bg-surface-raised rounded-2xl shadow-soft border border-line p-8 text-center">
        {status === 'loading' && (
          <>
            <Loader2 className="w-12 h-12 text-accent animate-spin mx-auto mb-4" />
            <h1 className="font-display text-xl font-semibold text-ink-strong mb-2">{m.invite_accepting_title()}</h1>
            <p className="text-ink-muted text-sm">{m.invite_accepting_body()}</p>
          </>
        )}

        {status === 'success' && (
          <>
            <CheckCircle className="w-12 h-12 text-success mx-auto mb-4" />
            <h1 className="font-display text-xl font-semibold text-ink-strong mb-2">{m.invite_accepted_title()}</h1>
            <p className="text-ink-muted text-sm">{m.invite_redirecting()}</p>
          </>
        )}

        {status === 'error' && (
          <>
            <AlertTriangle className="w-12 h-12 text-danger mx-auto mb-4" />
            <h1 className="font-display text-xl font-semibold text-ink-strong mb-2">{m.invite_error_title()}</h1>
            <p className="text-ink-muted text-sm mb-4">{errorMessage}</p>
            <button
              onClick={() => navigate('/', { replace: true })}
              className="px-6 py-3 bg-accent-strong text-white rounded-xl font-bold text-sm hover:opacity-90 transition-all"
            >
              {m.invite_go_to_start()}
            </button>
          </>
        )}
      </div>
    </ScrollScreen>
  );
};

export default InviteAccept;

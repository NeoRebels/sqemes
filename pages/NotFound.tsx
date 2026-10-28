import React from 'react';
import { useNavigate } from 'react-router';
import { Home, AlertCircle } from 'lucide-react';
import { m } from '../lib/i18n';

const NotFound = () => {
  const navigate = useNavigate();

  return (
    <div className="min-h-full bg-surface flex items-center justify-center p-8">
      <div className="bg-surface-raised rounded-2xl border border-line shadow-soft p-10 max-w-md w-full text-center">
        <div className="w-14 h-14 bg-surface-sunken rounded-2xl flex items-center justify-center mx-auto mb-6">
          <AlertCircle className="w-7 h-7 text-ink-subtle" />
        </div>
        <h1 className="font-display text-3xl font-semibold text-ink-strong mb-2">404</h1>
        <h2 className="text-lg font-semibold text-ink mb-3">{m.nf_title()}</h2>
        <p className="text-sm text-ink-muted mb-8">
          {m.nf_body()}
        </p>
        <button
          onClick={() => navigate('/')}
          className="inline-flex items-center gap-2 px-6 py-2.5 bg-accent-strong text-white rounded-xl text-sm font-bold hover:opacity-90 transition-all shadow-lg"
        >
          <Home className="w-4 h-4" />
          {m.nf_home()}
        </button>
      </div>
    </div>
  );
};

export default NotFound;

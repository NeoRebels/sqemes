import React, { Component, ReactNode } from 'react';
import { AlertTriangle, RefreshCw } from 'lucide-react';
import { logError } from '../lib/monitoring';
import { isStaleBuildError } from '../lib/staleBuild';

interface Props {
  children: ReactNode;
  fallback?: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    // SQEM-301 — a chunk missing after a deploy is the expected course of events, not a defect.
    // Reporting it would put an entry in Sentry after every single release, and a list that fills
    // up with the expected is a list everybody learns to skip.
    if (isStaleBuildError(error)) return;
    logError(error, { context: 'ErrorBoundary', componentStack: info.componentStack });
  }

  render() {
    if (this.state.hasError) {
      if (this.props.fallback) return this.props.fallback;

      // SQEM-301 — the deploy case gets its own screen: brand colour, no warning triangle, and no
      // technical message, because here it explains nothing. The heading is the whole content.
      //
      // ⛔ No automatic reload. Were the new build unreachable too, an automatic one would loop and
      // the person could not read why. The button costs a click and stays their decision.
      //
      // ⛔ And nothing is promised that is not true — no "your work is safe". A reload discards
      // unsaved input, and somebody who reads that line and trusts it loses their work with our
      // assurance behind it.
      if (isStaleBuildError(this.state.error)) {
        return (
          <div className="min-h-full bg-slate-50 dark:bg-slate-900 flex items-center justify-center p-8">
            <div className="bg-white dark:bg-slate-800 rounded-2xl border border-slate-100 dark:border-slate-700 shadow-soft p-8 max-w-md w-full text-center">
              <div className="w-12 h-12 bg-brand-50 dark:bg-brand-900/30 rounded-xl flex items-center justify-center mx-auto mb-4">
                <RefreshCw className="w-6 h-6 text-brand-600 dark:text-brand-400" />
              </div>
              <h2 className="text-xl font-bold text-slate-900 dark:text-slate-100 mb-2">We&apos;ve updated Sqemes</h2>
              <p className="text-sm text-slate-500 dark:text-slate-400 mb-6">
                Reload to use the latest version.
              </p>
              <button
                onClick={() => window.location.reload()}
                className="px-6 py-2.5 bg-brand-600 text-white rounded-xl text-sm font-bold hover:bg-brand-700 transition-all shadow-lg shadow-brand-200 dark:shadow-none"
              >
                Reload
              </button>
            </div>
          </div>
        );
      }

      return (
        <div className="min-h-full bg-slate-50 flex items-center justify-center p-8">
          <div className="bg-white rounded-2xl border border-slate-100 shadow-soft p-8 max-w-md w-full text-center">
            <div className="w-12 h-12 bg-red-50 rounded-xl flex items-center justify-center mx-auto mb-4">
              <AlertTriangle className="w-6 h-6 text-red-500" />
            </div>
            <h2 className="text-xl font-bold text-slate-900 mb-2">Something went wrong</h2>
            <p className="text-sm text-slate-500 mb-6 font-mono break-all">
              {this.state.error?.message || 'An unexpected error occurred.'}
            </p>
            <button
              onClick={() => window.location.reload()}
              className="px-6 py-2.5 bg-brand-600 text-white rounded-xl text-sm font-bold hover:bg-brand-700 transition-all shadow-lg shadow-brand-200 dark:shadow-none"
            >
              Reload page
            </button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}

export default ErrorBoundary;

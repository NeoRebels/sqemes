import { createContext, useContext, useState, useCallback, useEffect, useRef } from 'react';

export interface UIState {
  // SQEM-013 — `showToast` (the trigger, used by ~12 components) stays here; the toast *display*
  // state moved to ToastContext so a toast showing/hiding no longer re-renders every useUI consumer.
  showToast: (message: string, type: 'success' | 'error' | 'info') => void;
  isLoading: boolean;
  isBackgroundFetching: boolean;
  noWorkspace: boolean;
  theme: 'light' | 'dark';
  setTheme: (t: 'light' | 'dark') => void;
  toggleTheme: () => void;
}

// SQEM-013 — toast display state, consumed only by the toast renderer in App.tsx. Kept separate
// from UIContext so the frequent show/hide/pause/resume churn doesn't re-render unrelated consumers.
export interface ToastState {
  toast: { message: string; type: 'success' | 'error' | 'info' } | null;
  hideToast: () => void;
  pauseToast: () => void;
  resumeToast: () => void;
}

function getInitialTheme(): 'light' | 'dark' {
  const stored = localStorage.getItem('theme');
  if (stored === 'dark' || stored === 'light') return stored;
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

export const UIContext = createContext<UIState | undefined>(undefined);
export const ToastContext = createContext<ToastState | undefined>(undefined);

export function useUIState() {
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' | 'info' } | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isBackgroundFetching, setIsBackgroundFetching] = useState(false);
  const [noWorkspace, setNoWorkspace] = useState(false);
  const [theme, setThemeState] = useState<'light' | 'dark'>(getInitialTheme);

  const setTheme = useCallback((t: 'light' | 'dark') => {
    setThemeState(t);
    localStorage.setItem('theme', t);
    document.documentElement.classList.toggle('dark', t === 'dark');
  }, []);

  const toggleTheme = useCallback(() => {
    setThemeState(prev => {
      const next = prev === 'dark' ? 'light' : 'dark';
      localStorage.setItem('theme', next);
      document.documentElement.classList.toggle('dark', next === 'dark');
      return next;
    });
  }, []);

  const toastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const toastExpiresAtRef = useRef<number>(0);

  useEffect(() => {
    return () => {
      if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    };
  }, []);

  const showToast = useCallback((message: string, type: 'success' | 'error' | 'info') => {
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    setToast({ message, type });
    const duration = type === 'error' ? 8000 : type === 'info' ? 5000 : 3000;
    toastExpiresAtRef.current = Date.now() + duration;
    toastTimerRef.current = setTimeout(() => setToast(null), duration);
  }, []);

  const hideToast = useCallback(() => {
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    setToast(null);
  }, []);

  const pauseToast = useCallback(() => {
    if (toastTimerRef.current) {
      clearTimeout(toastTimerRef.current);
      toastTimerRef.current = null;
    }
  }, []);

  const resumeToast = useCallback(() => {
    const remaining = toastExpiresAtRef.current - Date.now();
    if (remaining > 0) {
      toastTimerRef.current = setTimeout(() => setToast(null), remaining);
    } else {
      setToast(null);
    }
  }, []);

  return {
    toast, setToast,
    isLoading, setIsLoading,
    isBackgroundFetching, setIsBackgroundFetching,
    noWorkspace, setNoWorkspace,
    showToast, hideToast, pauseToast, resumeToast,
    theme, setTheme, toggleTheme,
  };
}

export function useUI(): UIState {
  const ctx = useContext(UIContext);
  if (!ctx) throw new Error('useUI must be used within AppProvider');
  return ctx;
}

export function useToast(): ToastState {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error('useToast must be used within AppProvider');
  return ctx;
}

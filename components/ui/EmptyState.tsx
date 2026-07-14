import React from 'react';

// SQEM-069 — canonical empty / no-results state shared across list pages.
// Dashed rounded card with an icon circle, heading, subtext and optional action.
// `iconWrapClassName` tones the icon circle: brand for "create your first …",
// neutral (default) for "nothing matches your filter".

export default function EmptyState({
  icon,
  iconWrapClassName = 'bg-slate-50 dark:bg-slate-700',
  title,
  description,
  action,
}: {
  icon: React.ReactNode;
  iconWrapClassName?: string;
  title: string;
  description: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="text-center py-20 bg-white dark:bg-slate-800 rounded-3xl border border-slate-100 dark:border-slate-700 border-dashed">
      <div className={`w-16 h-16 ${iconWrapClassName} rounded-full flex items-center justify-center mx-auto mb-4`}>
        {icon}
      </div>
      <h3 className="text-slate-900 dark:text-slate-100 font-bold text-lg">{title}</h3>
      <p className={`text-slate-400 dark:text-slate-500 text-sm mt-1 ${action ? 'mb-5' : ''}`}>{description}</p>
      {action}
    </div>
  );
}

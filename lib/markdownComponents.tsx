import React from 'react';

const MarkdownComponents = {
  h1: ({node, ...props}: any) => <h1 className="text-2xl font-bold text-slate-900 dark:text-slate-100 mb-4 pb-2 border-b border-slate-100 dark:border-slate-700" {...props} />,
  h2: ({node, ...props}: any) => <h2 className="text-xl font-bold text-slate-900 dark:text-slate-100 mt-6 mb-3" {...props} />,
  h3: ({node, ...props}: any) => <h3 className="text-lg font-bold text-slate-800 dark:text-slate-200 mt-4 mb-2" {...props} />,
  h4: ({node, ...props}: any) => <h4 className="text-base font-bold text-slate-800 dark:text-slate-200 mt-3 mb-1.5" {...props} />,
  p: ({node, ...props}: any) => <p className="text-slate-600 dark:text-slate-300 leading-7 mb-4" {...props} />,
  ul: ({node, ...props}: any) => <ul className="list-disc list-outside ml-5 mb-4 text-slate-600 dark:text-slate-300 space-y-1" {...props} />,
  ol: ({node, ...props}: any) => <ol className="list-decimal list-outside ml-5 mb-4 text-slate-600 dark:text-slate-300 space-y-1" {...props} />,
  li: ({node, ...props}: any) => <li className="pl-1" {...props} />,
  blockquote: ({node, ...props}: any) => <blockquote className="border-l-4 border-brand-200 dark:border-brand-700 pl-4 py-1 my-4 text-slate-500 dark:text-slate-400 italic bg-brand-50/30 dark:bg-brand-900/10 rounded-r-lg" {...props} />,
  code: ({node, inline, className, children, ...props}: any) => {
    const match = /language-(\w+)/.exec(className || '')
    return !inline ? (
      <div className="relative group my-6 rounded-xl overflow-hidden bg-slate-900 border border-slate-800 shadow-lg">
         <div className="flex items-center justify-between px-4 py-2 bg-slate-800/50 border-b border-slate-700/50">
            <div className="flex gap-1.5">
              <div className="w-2.5 h-2.5 rounded-full bg-red-500/50"></div>
              <div className="w-2.5 h-2.5 rounded-full bg-amber-500/50"></div>
              <div className="w-2.5 h-2.5 rounded-full bg-green-500/50"></div>
            </div>
            <div className="flex items-center gap-3">
                <span className="text-2xs font-mono font-bold text-slate-500 uppercase tracking-wider">{match ? match[1] : 'text'}</span>
                <button
                  onClick={() => navigator.clipboard.writeText(String(children))}
                  className="text-2xs text-slate-400 hover:text-white transition-colors uppercase font-bold tracking-wider"
                >
                  Copy
                </button>
            </div>
         </div>
         <div className="p-4 overflow-x-auto">
           <code className={`${className} text-sm font-mono text-slate-300 leading-relaxed`} {...props}>
             {children}
           </code>
         </div>
      </div>
    ) : (
      <code className="px-1.5 py-0.5 rounded-md bg-slate-100 dark:bg-slate-700 text-brand-700 dark:text-brand-300 font-mono text-sm border border-slate-200 dark:border-slate-600" {...props}>
        {children}
      </code>
    )
  },
  table: ({node, ...props}: any) => <div className="overflow-x-auto my-6 border border-slate-200 dark:border-slate-700 rounded-xl shadow-sm"><table className="w-full text-sm text-left" {...props} /></div>,
  thead: ({node, ...props}: any) => <thead className="bg-slate-50 dark:bg-slate-700 text-slate-500 dark:text-slate-400 font-bold uppercase tracking-wider text-xs border-b border-slate-200 dark:border-slate-600" {...props} />,
  th: ({node, ...props}: any) => <th className="px-6 py-4" {...props} />,
  tbody: ({node, ...props}: any) => <tbody className="bg-white dark:bg-slate-800 divide-y divide-slate-100 dark:divide-slate-700" {...props} />,
  tr: ({node, ...props}: any) => <tr className="hover:bg-slate-50/50 dark:hover:bg-slate-700/50 transition-colors" {...props} />,
  td: ({node, ...props}: any) => <td className="px-6 py-4 text-slate-600 dark:text-slate-300" {...props} />,
  a: ({node, ...props}: any) => {
    const isVideoLink = String(props.children).includes('View Video');
    if (isVideoLink && props.href) {
        return (
           <div className="my-6">
              <div className="relative rounded-xl overflow-hidden shadow-lg bg-slate-900 border border-slate-800">
                 <video
                   controls
                   className="w-full max-h-[600px] aspect-video"
                   src={props.href}
                   playsInline
                 >
                   <a href={props.href} target="_blank" rel="noopener noreferrer">Download Video</a>
                 </video>
              </div>
              <div className="mt-2 text-right">
                 <a href={props.href} target="_blank" rel="noopener noreferrer" className="text-xs font-bold text-brand-600 hover:text-brand-800 flex items-center justify-end gap-1">
                    Download Video
                 </a>
              </div>
           </div>
        );
    }
    return <a className="text-brand-600 dark:text-brand-400 hover:underline font-medium hover:text-brand-800 dark:hover:text-brand-300 transition-colors" target="_blank" rel="noopener noreferrer" {...props} />;
  },
  img: ({node, ...props}: any) => (
    <div className="my-6 rounded-xl overflow-hidden shadow-md border border-slate-100 dark:border-slate-700 bg-slate-50 dark:bg-slate-800">
      <img
        {...props}
        className="w-full h-auto max-h-[600px] object-contain mx-auto"
        loading="lazy"
        onError={(e: React.SyntheticEvent<HTMLImageElement>) => {
          const target = e.currentTarget;
          target.style.display = 'none';
          const placeholder = document.createElement('div');
          placeholder.className = 'flex flex-col items-center justify-center py-12 text-slate-400 text-sm';
          placeholder.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" fill="none" viewBox="0 0 24 24" stroke="currentColor" class="mb-2 opacity-40"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M2.25 15.75l5.159-5.159a2.25 2.25 0 013.182 0l5.159 5.159m-1.5-1.5l1.409-1.409a2.25 2.25 0 013.182 0l2.909 2.909M3 3l18 18M9.75 9.75a.75.75 0 11-1.5 0 .75.75 0 011.5 0z"/></svg><span>Image expired and is no longer available</span>';
          target.parentElement?.appendChild(placeholder);
        }}
      />
    </div>
  ),
  hr: ({node, ...props}: any) => <hr className="my-8 border-slate-100 dark:border-slate-700" {...props} />,
};

export default MarkdownComponents;

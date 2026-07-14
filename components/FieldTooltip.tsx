import React, { useState } from 'react';
import { HelpCircle } from 'lucide-react';

interface FieldTooltipProps {
  text: string;
  position?: 'top' | 'bottom';
}

const FieldTooltip = ({ text, position = 'top' }: FieldTooltipProps) => {
  const [visible, setVisible] = useState(false);

  const bubbleClass = position === 'bottom'
    ? 'absolute top-full left-1/2 -translate-x-1/2 mt-2'
    : 'absolute bottom-full left-1/2 -translate-x-1/2 mb-2';

  const arrowClass = position === 'bottom'
    ? 'absolute bottom-full left-1/2 -translate-x-1/2 border-4 border-transparent border-b-slate-900'
    : 'absolute top-full left-1/2 -translate-x-1/2 border-4 border-transparent border-t-slate-900';

  return (
    <span className="relative inline-flex items-center">
      <button
        type="button"
        onMouseEnter={() => setVisible(true)}
        onMouseLeave={() => setVisible(false)}
        onFocus={() => setVisible(true)}
        onBlur={() => setVisible(false)}
        className="text-slate-300 hover:text-slate-500 transition-colors focus:outline-none"
        aria-label="More information"
      >
        <HelpCircle className="w-3.5 h-3.5" />
      </button>
      {visible && (
        <span className={`${bubbleClass} w-56 bg-slate-900 text-white text-xs rounded-xl px-3 py-2 leading-relaxed shadow-xl z-50 pointer-events-none`}>
          {text}
          <span className={arrowClass} />
        </span>
      )}
    </span>
  );
};

export default FieldTooltip;

import React from 'react';

interface CardProps extends React.HTMLAttributes<HTMLDivElement> {
  hover?: boolean;
  overflow?: boolean;
}

const Card = React.forwardRef<HTMLDivElement, CardProps>(
  ({ hover, overflow, className = '', children, ...props }, ref) => {
    return (
      <div
        ref={ref}
        className={[
          'bg-surface-raised rounded-2xl shadow-soft border border-line',
          hover ? 'hover:shadow-soft-lg transition-shadow duration-300 cursor-pointer' : '',
          overflow ? 'overflow-hidden' : '',
          className,
        ].filter(Boolean).join(' ')}
        {...props}
      >
        {children}
      </div>
    );
  }
);

Card.displayName = 'Card';

export default Card;

import { useState } from 'react';

export function Tooltip({ content, children }) {
  const [visible, setVisible] = useState(false);

  if (!content) return children;

  return (
    <div
      className="relative inline-flex"
      onMouseEnter={() => setVisible(true)}
      onMouseLeave={() => setVisible(false)}
    >
      {children}
      {visible && (
        <div className="absolute bottom-full left-0 mb-1.5 pointer-events-none z-50">
          {content}
        </div>
      )}
    </div>
  );
}

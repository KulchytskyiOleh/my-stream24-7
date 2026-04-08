export function Tooltip({ content, children }) {
  return (
    <div className="relative group/tt inline-flex">
      {children}
      <div className="absolute bottom-full left-0 mb-1.5 opacity-0 group-hover/tt:opacity-100
                      pointer-events-none z-50 transition-opacity duration-150">
        {content}
      </div>
    </div>
  );
}

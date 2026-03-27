import { useEffect } from 'react';
import { X } from 'lucide-react';
import { cn } from '@/lib/utils';

export function Dialog({ open, onClose, children }) {
  useEffect(() => {
    const handler = (e) => { if (e.key === 'Escape') onClose(); };
    if (open) document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />
      <div className="relative z-10 w-full max-w-md mx-4">{children}</div>
    </div>
  );
}

export function DialogContent({ className, children }) {
  return (
    <div className={cn('bg-card border border-border rounded-lg shadow-xl p-6', className)}>
      {children}
    </div>
  );
}

export function DialogHeader({ children }) {
  return <div className="mb-4">{children}</div>;
}

export function DialogTitle({ children }) {
  return <h2 className="text-lg font-semibold text-foreground">{children}</h2>;
}

export function DialogClose({ onClose }) {
  return (
    <button
      onClick={onClose}
      className="absolute top-4 right-4 text-muted-foreground hover:text-foreground"
    >
      <X size={18} />
    </button>
  );
}

import { cn } from '@/lib/utils';

const variants = {
  online: 'bg-green-500/20 text-green-400 border border-green-500/30',
  offline: 'bg-muted text-muted-foreground border border-border',
  error: 'bg-red-500/20 text-red-400 border border-red-500/30',
};

export function Badge({ status }) {
  return (
    <span className={cn('inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-xs font-medium', variants[status?.toLowerCase()] ?? variants.offline)}>
      <span className={cn('w-1.5 h-1.5 rounded-full', {
        'bg-green-400 animate-pulse': status === 'ONLINE',
        'bg-muted-foreground': status === 'OFFLINE',
        'bg-red-400': status === 'ERROR',
      })} />
      {status ?? 'OFFLINE'}
    </span>
  );
}

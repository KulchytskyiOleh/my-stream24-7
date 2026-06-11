import { useState, useEffect, useCallback } from 'react';
import { Radio, LogOut, Sun, Moon, Server } from 'lucide-react';
import { useAuth } from '@/hooks/useAuth.jsx';
import { useTheme } from '@/hooks/useTheme.js';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogClose } from '@/components/ui/dialog';
import { getSystemStats } from '@/lib/api';

function formatBytes(bytes) {
  if (bytes >= 1073741824) return (bytes / 1073741824).toFixed(1) + ' GB';
  return (bytes / 1048576).toFixed(0) + ' MB';
}

function StatRow({ label, value, sub }) {
  return (
    <div className="flex justify-between items-baseline py-1.5 border-b border-border last:border-0">
      <span className="text-sm text-muted-foreground">{label}</span>
      <div className="text-right">
        <span className="text-sm font-medium tabular-nums">{value}</span>
        {sub && <span className="text-xs text-muted-foreground ml-1.5">{sub}</span>}
      </div>
    </div>
  );
}

function ServerStatsModal({ open, onClose }) {
  const [stats, setStats] = useState(null);
  const [error, setError] = useState(false);

  const load = useCallback(async () => {
    try {
      const data = await getSystemStats();
      setStats(data);
      setError(false);
    } catch {
      setError(true);
    }
  }, []);

  useEffect(() => {
    if (!open) return;
    setStats(null);
    setError(false);
    load();
    const interval = setInterval(load, 5000);
    return () => clearInterval(interval);
  }, [open, load]);

  return (
    <Dialog open={open} onClose={onClose}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>Server Stats</DialogTitle>
        </DialogHeader>
        <DialogClose onClose={onClose} />

        {error ? (
          <p className="text-sm text-destructive text-center py-4">Failed to load stats</p>
        ) : !stats ? (
          <p className="text-sm text-muted-foreground text-center py-4">Loading...</p>
        ) : (
          <div>
            {(() => {
              const cpuPct = Math.min(100, Math.round((stats.cpu.load1 / stats.cpu.cores) * 100));
              const ramPct = Math.round((stats.ram.used / stats.ram.total) * 100);
              const diskPct = stats.disk ? Math.round((stats.disk.used / stats.disk.total) * 100) : null;
              return <>
                <StatRow
                  label="CPU"
                  value={`${cpuPct}%`}
                  sub={`load ${stats.cpu.load1.toFixed(2)} · ${stats.cpu.cores} cores`}
                />
                <StatRow
                  label="RAM"
                  value={`${ramPct}%`}
                  sub={`${formatBytes(stats.ram.used)} / ${formatBytes(stats.ram.total)}`}
                />
                {stats.disk && (
                  <StatRow
                    label="Disk"
                    value={`${diskPct}%`}
                    sub={`${formatBytes(stats.disk.used)} / ${formatBytes(stats.disk.total)}`}
                  />
                )}
              </>;
            })()}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

export default function Layout({ children }) {
  const { user, logout } = useAuth();
  const { theme, toggle } = useTheme();
  const [statsOpen, setStatsOpen] = useState(false);

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b border-border bg-card/50 backdrop-blur-sm sticky top-0 z-40">
        <div className="max-w-7xl mx-auto px-4 h-14 flex items-center justify-between">
          <div className="flex items-center gap-2 font-semibold text-foreground">
            <Radio size={20} className="text-primary" />
            <span>Stream247</span>
          </div>

          {user && (
            <div className="flex items-center gap-3">
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                {user.avatar && (
                  <img src={user.avatar} alt="" className="w-7 h-7 rounded-full" />
                )}
                <span className="hidden sm:block">{user.name}</span>
              </div>
              <Button variant="ghost" size="icon" onClick={() => setStatsOpen(true)} title="Server stats">
                <Server size={16} />
              </Button>
              <Button variant="ghost" size="icon" onClick={toggle} title="Toggle theme">
                {theme === 'dark' ? <Sun size={16} /> : <Moon size={16} />}
              </Button>
              <Button variant="ghost" size="icon" onClick={logout} title="Logout">
                <LogOut size={16} />
              </Button>
            </div>
          )}
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 py-8">
        {children}
      </main>

      <ServerStatsModal open={statsOpen} onClose={() => setStatsOpen(false)} />
    </div>
  );
}

import { Radio, LogOut } from 'lucide-react';
import { useAuth } from '@/hooks/useAuth';
import { Button } from '@/components/ui/button';

export default function Layout({ children }) {
  const { user, logout } = useAuth();

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
    </div>
  );
}

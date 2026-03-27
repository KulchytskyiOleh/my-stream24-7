import { useState } from 'react';
import { Play, Square, Pencil, Trash2, ChevronDown, ChevronUp, Radio } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import PlaylistEditor from './PlaylistEditor';
import { startStream, stopStream, deleteStream } from '@/lib/api';

export default function StreamSlot({ stream, videos, onRefresh }) {
  const [expanded, setExpanded] = useState(false);
  const [loading, setLoading] = useState(false);

  const handleToggle = async () => {
    setLoading(true);
    try {
      if (stream.status === 'ONLINE') {
        await stopStream(stream.id);
      } else {
        await startStream(stream.id);
      }
      onRefresh();
    } catch (err) {
      alert(err.response?.data?.error || err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleDelete = async () => {
    if (!confirm(`Delete stream "${stream.name}"?`)) return;
    await deleteStream(stream.id);
    onRefresh();
  };

  return (
    <div className="bg-card border border-border rounded-lg overflow-hidden">
      <div className="p-4">
        <div className="flex items-start justify-between gap-4">
          <div className="flex items-center gap-3 min-w-0">
            <Radio size={18} className={stream.status === 'ONLINE' ? 'text-green-400' : 'text-muted-foreground'} />
            <div className="min-w-0">
              <h3 className="font-medium truncate">{stream.name}</h3>
              {stream.currentVideo && stream.status === 'ONLINE' && (
                <p className="text-xs text-muted-foreground truncate mt-0.5">
                  Now playing: {stream.currentVideo.originalName}
                </p>
              )}
            </div>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            <Badge status={stream.status} />

            <Button
              size="sm"
              variant={stream.status === 'ONLINE' ? 'destructive' : 'default'}
              onClick={handleToggle}
              disabled={loading}
              className="gap-1.5"
            >
              {stream.status === 'ONLINE' ? (
                <><Square size={12} /> Stop</>
              ) : (
                <><Play size={12} /> Start</>
              )}
            </Button>

            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8 text-muted-foreground"
              onClick={() => setExpanded(e => !e)}
              title="Edit playlist"
            >
              {expanded ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
            </Button>

            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8 text-muted-foreground hover:text-destructive"
              onClick={handleDelete}
              title="Delete stream"
            >
              <Trash2 size={14} />
            </Button>
          </div>
        </div>
      </div>

      {expanded && (
        <div className="border-t border-border p-4">
          <PlaylistEditor stream={stream} videos={videos} onUpdate={onRefresh} />
        </div>
      )}
    </div>
  );
}

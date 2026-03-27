import { useState, useEffect, useCallback } from 'react';
import { Plus } from 'lucide-react';
import Layout from '@/components/Layout';
import VideoLibrary from '@/components/VideoLibrary';
import StreamSlot from '@/components/StreamSlot';
import NewStreamDialog from '@/components/NewStreamDialog';
import { Button } from '@/components/ui/button';
import { getStreams, getVideos } from '@/lib/api';

export default function Dashboard() {
  const [streams, setStreams] = useState([]);
  const [videos, setVideos] = useState([]);
  const [newStreamOpen, setNewStreamOpen] = useState(false);

  const refreshStreams = useCallback(async () => {
    const data = await getStreams();
    setStreams(data);
  }, []);

  const refreshVideos = useCallback(async () => {
    const data = await getVideos();
    setVideos(data);
  }, []);

  useEffect(() => {
    refreshStreams();
    refreshVideos();
  }, []);

  // Poll stream status every 5s to show live updates
  useEffect(() => {
    const interval = setInterval(refreshStreams, 5000);
    return () => clearInterval(interval);
  }, [refreshStreams]);

  return (
    <Layout>
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        {/* Streams section */}
        <div className="lg:col-span-2 space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-semibold">Streams</h2>
            <Button onClick={() => setNewStreamOpen(true)} size="sm" className="gap-1.5">
              <Plus size={14} />
              New Stream
            </Button>
          </div>

          {streams.length === 0 ? (
            <div className="text-center py-16 border border-dashed border-border rounded-lg">
              <p className="text-muted-foreground text-sm">No streams yet</p>
              <Button
                variant="outline"
                className="mt-3"
                onClick={() => setNewStreamOpen(true)}
              >
                Create your first stream
              </Button>
            </div>
          ) : (
            <div className="space-y-3">
              {streams.map(stream => (
                <StreamSlot
                  key={stream.id}
                  stream={stream}
                  videos={videos}
                  onRefresh={() => { refreshStreams(); refreshVideos(); }}
                />
              ))}
            </div>
          )}
        </div>

        {/* Video library section */}
        <div>
          <h2 className="text-lg font-semibold mb-4">Video Library</h2>
          <VideoLibrary videos={videos} onRefresh={refreshVideos} />
        </div>
      </div>

      <NewStreamDialog
        open={newStreamOpen}
        onClose={() => setNewStreamOpen(false)}
        onCreated={refreshStreams}
      />
    </Layout>
  );
}

import { useState, useEffect, useCallback } from 'react';
import { Plus } from 'lucide-react';
import Layout from '@/components/Layout';
import VideoLibrary from '@/components/VideoLibrary';
import AudioLibrary from '@/components/AudioLibrary';
import StreamSlot from '@/components/StreamSlot';
import NewStreamDialog from '@/components/NewStreamDialog';
import { Button } from '@/components/ui/button';
import { getStreams, getVideos, getAudios } from '@/lib/api';

export default function Dashboard() {
  const [streams, setStreams] = useState([]);
  const [videos, setVideos] = useState([]);
  const [audios, setAudios] = useState([]);
  const [newStreamOpen, setNewStreamOpen] = useState(false);
  const [libraryTab, setLibraryTab] = useState('video');

  const refreshStreams = useCallback(async () => {
    const data = await getStreams();
    setStreams(data);
  }, []);

  const refreshVideos = useCallback(async () => {
    const data = await getVideos();
    setVideos(data);
  }, []);

  const refreshAudios = useCallback(async () => {
    const data = await getAudios();
    setAudios(data);
  }, []);

  useEffect(() => {
    refreshStreams();
    refreshVideos();
    refreshAudios();
  }, []);

  // Poll stream status every 5s
  useEffect(() => {
    const interval = setInterval(refreshStreams, 5000);
    return () => clearInterval(interval);
  }, [refreshStreams]);

  // Poll videos every 5s when any are processing/transcoding
  useEffect(() => {
    const hasActive = videos.some(v => ['PROCESSING', 'TRANSCODING'].includes(v.status));
    if (!hasActive) return;
    const interval = setInterval(refreshVideos, 5000);
    return () => clearInterval(interval);
  }, [videos, refreshVideos]);

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
                  audios={audios}
                  onRefresh={() => { refreshStreams(); refreshVideos(); refreshAudios(); }}
                />
              ))}
            </div>
          )}
        </div>

        {/* Library section */}
        <div>
          <div className="flex items-center gap-3 mb-4">
            <button
              onClick={() => setLibraryTab('video')}
              className={`text-lg font-semibold transition-colors ${libraryTab === 'video' ? '' : 'text-muted-foreground hover:text-foreground'}`}
            >
              Video Library
            </button>
            <span className="text-muted-foreground">/</span>
            <button
              onClick={() => setLibraryTab('audio')}
              className={`text-lg font-semibold transition-colors ${libraryTab === 'audio' ? '' : 'text-muted-foreground hover:text-foreground'}`}
            >
              Audio Library
            </button>
          </div>
          {libraryTab === 'video'
            ? <VideoLibrary videos={videos} streams={streams} onRefresh={refreshVideos} />
            : <AudioLibrary audios={audios} onRefresh={refreshAudios} />
          }
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

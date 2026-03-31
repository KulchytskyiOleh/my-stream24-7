import { useState } from 'react';
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
} from '@dnd-kit/core';
import {
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
  arrayMove,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { GripVertical, Plus, X, Shuffle, Music, Video } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { formatDuration } from '@/lib/utils';
import { updatePlaylist, updateStream, updateLoopAudio } from '@/lib/api';

function SortableItem({ item, onRemove, label }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: item.id,
  });

  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={`flex items-center gap-2 p-2 rounded-md bg-muted/50 border border-transparent ${
        isDragging ? 'opacity-50 border-primary' : 'hover:border-border'
      }`}
    >
      <button {...attributes} {...listeners} className="text-muted-foreground cursor-grab active:cursor-grabbing">
        <GripVertical size={14} />
      </button>
      <span className="flex-1 text-sm truncate">{label}</span>
      <span className="text-xs text-muted-foreground shrink-0">
        {formatDuration(item.duration ?? item.video?.duration ?? item.audio?.duration)}
      </span>
      <Button variant="ghost" size="icon" className="h-6 w-6 text-muted-foreground hover:text-destructive" onClick={() => onRemove(item.id)}>
        <X size={12} />
      </Button>
    </div>
  );
}

function ModeTab({ active, onClick, children }) {
  return (
    <button
      onClick={onClick}
      className={`flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-md transition-colors ${
        active
          ? 'bg-primary text-primary-foreground'
          : 'text-muted-foreground hover:text-foreground hover:bg-muted'
      }`}
    >
      {children}
    </button>
  );
}

// ─── Playlist mode ────────────────────────────────────────────────────────────

function PlaylistMode({ stream, videos, onUpdate }) {
  const [items, setItems] = useState(stream.playlistItems ?? []);
  const [saving, setSaving] = useState(false);

  const sensors = useSensors(
    useSensor(PointerSensor),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  );

  const handleDragEnd = (event) => {
    const { active, over } = event;
    if (active.id !== over?.id) {
      const oldIdx = items.findIndex(i => i.id === active.id);
      const newIdx = items.findIndex(i => i.id === over.id);
      setItems(arrayMove(items, oldIdx, newIdx));
    }
  };

  const addVideo = (video) => {
    if (items.some(i => i.video.id === video.id)) return;
    setItems(prev => [...prev, {
      id: `temp-${video.id}`,
      video,
      streamId: stream.id,
      videoId: video.id,
      position: prev.length,
    }]);
  };

  const removeItem = (itemId) => setItems(prev => prev.filter(i => i.id !== itemId));

  const save = async () => {
    setSaving(true);
    try {
      await updatePlaylist(stream.id, items.map(i => i.video.id));
      onUpdate();
    } finally {
      setSaving(false);
    }
  };

  const toggleShuffle = async () => {
    await updateStream(stream.id, { shuffle: !stream.shuffle });
    onUpdate();
  };

  const inPlaylist = new Set(items.map(i => i.video.id));
  const availableVideos = videos.filter(v => !inPlaylist.has(v.id) && (v.status === 'READY' || v.status === 'NEEDS_TRANSCODE'));

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
      <div>
        <h3 className="text-sm font-medium text-muted-foreground mb-3">Video Library</h3>
        {availableVideos.length === 0 ? (
          <p className="text-sm text-muted-foreground">All videos added to playlist</p>
        ) : (
          <div className="space-y-1 max-h-96 overflow-y-auto">
            {availableVideos.map(video => (
              <div key={video.id} className="flex items-center gap-2 p-2 rounded-md hover:bg-muted/50 group">
                <span className="flex-1 text-sm truncate">{video.originalName}</span>
                <span className="text-xs text-muted-foreground">{formatDuration(video.duration)}</span>
                <Button variant="ghost" size="icon" className="h-6 w-6 opacity-0 group-hover:opacity-100" onClick={() => addVideo(video)}>
                  <Plus size={12} />
                </Button>
              </div>
            ))}
          </div>
        )}
      </div>

      <div>
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-medium text-muted-foreground">Playlist ({items.length})</h3>
          <button
            onClick={toggleShuffle}
            className={`flex items-center gap-1.5 text-xs px-2 py-1 rounded transition-colors ${
              stream.shuffle ? 'text-primary bg-primary/10' : 'text-muted-foreground hover:text-foreground'
            }`}
          >
            <Shuffle size={12} />
            Shuffle
          </button>
        </div>

        {items.length === 0 ? (
          <p className="text-sm text-muted-foreground">No videos in playlist. Add from the library.</p>
        ) : (
          <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
            <SortableContext items={items.map(i => i.id)} strategy={verticalListSortingStrategy}>
              <div className="space-y-1 max-h-96 overflow-y-auto">
                {items.map(item => (
                  <SortableItem key={item.id} item={item} label={item.video.originalName} onRemove={removeItem} />
                ))}
              </div>
            </SortableContext>
          </DndContext>
        )}

        <Button className="mt-4 w-full" onClick={save} disabled={saving}>
          {saving ? 'Saving...' : 'Save Playlist'}
        </Button>
      </div>
    </div>
  );
}

// ─── Loop mode ────────────────────────────────────────────────────────────────

function LoopMode({ stream, videos, audios, onUpdate }) {
  const [selectedVideoId, setSelectedVideoId] = useState(stream.loopVideoId ?? '');
  const [audioItems, setAudioItems] = useState(stream.loopAudioItems ?? []);
  const [saving, setSaving] = useState(false);

  const sensors = useSensors(
    useSensor(PointerSensor),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  );

  const handleDragEnd = (event) => {
    const { active, over } = event;
    if (active.id !== over?.id) {
      const oldIdx = audioItems.findIndex(i => i.id === active.id);
      const newIdx = audioItems.findIndex(i => i.id === over.id);
      setAudioItems(arrayMove(audioItems, oldIdx, newIdx));
    }
  };

  const addAudio = (audio) => {
    if (audioItems.some(i => i.audio.id === audio.id)) return;
    setAudioItems(prev => [...prev, {
      id: `temp-${audio.id}`,
      audio,
      streamId: stream.id,
      audioId: audio.id,
      position: prev.length,
    }]);
  };

  const removeAudioItem = (itemId) => setAudioItems(prev => prev.filter(i => i.id !== itemId));

  const save = async () => {
    setSaving(true);
    try {
      const updates = [];
      if (selectedVideoId !== stream.loopVideoId) {
        updates.push(updateStream(stream.id, { loopVideoId: selectedVideoId || null }));
      }
      updates.push(updateLoopAudio(stream.id, audioItems.map(i => i.audio.id)));
      await Promise.all(updates);
      onUpdate();
    } catch (err) {
      alert(err.response?.data?.error || err.message);
    } finally {
      setSaving(false);
    }
  };

  const readyVideos = videos.filter(v => v.status === 'READY' || v.status === 'NEEDS_TRANSCODE');
  const inAudioList = new Set(audioItems.map(i => i.audio.id));
  const availableAudios = audios.filter(a => !inAudioList.has(a.id));

  return (
    <div className="space-y-6">
      {/* Video selector */}
      <div>
        <h3 className="text-sm font-medium text-muted-foreground mb-2 flex items-center gap-1.5">
          <Video size={13} /> Loop Video
        </h3>
        <select
          value={selectedVideoId}
          onChange={e => setSelectedVideoId(e.target.value)}
          className="w-full text-sm bg-background border border-border rounded-md px-3 py-2 focus:outline-none focus:ring-1 focus:ring-ring"
        >
          <option value="">— Select a video —</option>
          {readyVideos.map(v => (
            <option key={v.id} value={v.id}>{v.originalName}</option>
          ))}
        </select>
      </div>

      {/* Audio playlist */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* Left: audio library */}
        <div>
          <h3 className="text-sm font-medium text-muted-foreground flex items-center gap-1.5 mb-2">
            <Music size={13} /> Audio Library
          </h3>

          {availableAudios.length === 0 ? (
            <p className="text-sm text-muted-foreground">All audio files added to playlist</p>
          ) : (
            <div className="space-y-1 max-h-64 overflow-y-auto">
              {availableAudios.map(audio => (
                <div key={audio.id} className="flex items-center gap-2 p-2 rounded-md hover:bg-muted/50 group">
                  <span className="flex-1 text-sm truncate">{audio.originalName}</span>
                  <span className="text-xs text-muted-foreground">{formatDuration(audio.duration)}</span>
                  <Button
                    variant="ghost" size="icon"
                    className="h-6 w-6 opacity-0 group-hover:opacity-100"
                    onClick={() => addAudio(audio)}
                  >
                    <Plus size={12} />
                  </Button>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Right: audio playlist */}
        <div>
          <h3 className="text-sm font-medium text-muted-foreground mb-2">
            Audio Playlist ({audioItems.length})
          </h3>

          {audioItems.length === 0 ? (
            <p className="text-sm text-muted-foreground">No audio files. Add from the library.</p>
          ) : (
            <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
              <SortableContext items={audioItems.map(i => i.id)} strategy={verticalListSortingStrategy}>
                <div className="space-y-1 max-h-64 overflow-y-auto">
                  {audioItems.map(item => (
                    <SortableItem key={item.id} item={item} label={item.audio.originalName} onRemove={removeAudioItem} />
                  ))}
                </div>
              </SortableContext>
            </DndContext>
          )}
        </div>
      </div>

      <Button className="w-full" onClick={save} disabled={saving}>
        {saving ? 'Saving...' : 'Save Loop Settings'}
      </Button>
    </div>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

export default function PlaylistEditor({ stream, videos, audios = [], onUpdate }) {
  const [mode, setMode] = useState(stream.mode ?? 'PLAYLIST');
  const [switchingMode, setSwitchingMode] = useState(false);

  const handleModeSwitch = async (newMode) => {
    if (newMode === mode) return;
    setSwitchingMode(true);
    try {
      await updateStream(stream.id, { mode: newMode });
      setMode(newMode);
      onUpdate();
    } catch (err) {
      alert(err.response?.data?.error || err.message);
    } finally {
      setSwitchingMode(false);
    }
  };

  return (
    <div className="space-y-4">
      {/* Mode toggle */}
      <div className="flex items-center gap-2">
        <ModeTab active={mode === 'PLAYLIST'} onClick={() => handleModeSwitch('PLAYLIST')}>
          <Video size={13} /> Playlist
        </ModeTab>
        <ModeTab active={mode === 'LOOP'} onClick={() => handleModeSwitch('LOOP')}>
          <Music size={13} /> Loop + Audio
        </ModeTab>
      </div>

      {mode === 'PLAYLIST' ? (
        <PlaylistMode stream={stream} videos={videos} onUpdate={onUpdate} />
      ) : (
        <LoopMode stream={stream} videos={videos} audios={audios} onUpdate={onUpdate} />
      )}
    </div>
  );
}

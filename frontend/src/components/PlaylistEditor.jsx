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
import { GripVertical, Plus, X, Shuffle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { formatDuration } from '@/lib/utils';
import { updatePlaylist, updateStream } from '@/lib/api';

function SortableItem({ item, onRemove }) {
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
      <span className="flex-1 text-sm truncate">{item.video.originalName}</span>
      <span className="text-xs text-muted-foreground shrink-0">
        {formatDuration(item.video.duration)}
      </span>
      <Button variant="ghost" size="icon" className="h-6 w-6 text-muted-foreground hover:text-destructive" onClick={() => onRemove(item.id)}>
        <X size={12} />
      </Button>
    </div>
  );
}

export default function PlaylistEditor({ stream, videos, onUpdate }) {
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
    const newItem = {
      id: `temp-${video.id}`,
      video,
      streamId: stream.id,
      videoId: video.id,
      position: items.length,
    };
    setItems(prev => [...prev, newItem]);
  };

  const removeItem = (itemId) => {
    setItems(prev => prev.filter(i => i.id !== itemId));
  };

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
  const availableVideos = videos.filter(v => !inPlaylist.has(v.id) && v.status === 'READY');

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
      {/* Left: video library */}
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

      {/* Right: playlist */}
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
                  <SortableItem key={item.id} item={item} onRemove={removeItem} />
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

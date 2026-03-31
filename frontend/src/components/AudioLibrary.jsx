import { useCallback, useState } from 'react';
import { useDropzone } from 'react-dropzone';
import { Upload, Trash2, Music, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { formatBytes, formatDuration } from '@/lib/utils';
import { uploadAudio, deleteAudio } from '@/lib/api';

export default function AudioLibrary({ audios, onRefresh }) {
  const [uploading, setUploading] = useState([]);

  const startUpload = async (file) => {
    const id = `${Date.now()}-${Math.random()}`;
    setUploading(prev => [...prev, { id, name: file.name, progress: 0 }]);
    try {
      await uploadAudio(file, (progress) => {
        setUploading(prev => prev.map(u => u.id === id ? { ...u, progress } : u));
      });
      onRefresh();
    } catch (err) {
      alert(err.response?.data?.error || err.message);
    } finally {
      setUploading(prev => prev.filter(u => u.id !== id));
    }
  };

  const onDrop = useCallback((acceptedFiles) => {
    acceptedFiles.forEach(startUpload);
  }, []);

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: { 'audio/*': ['.mp3', '.aac', '.ogg', '.wav', '.flac'] },
    multiple: true,
  });

  const handleDelete = async (id) => {
    if (!confirm('Delete this audio file?')) return;
    await deleteAudio(id);
    onRefresh();
  };

  return (
    <div className="space-y-4">
      <div
        {...getRootProps()}
        className={`border-2 border-dashed rounded-lg p-8 text-center cursor-pointer transition-colors ${
          isDragActive ? 'border-primary bg-primary/5' : 'border-border hover:border-primary/50'
        }`}
      >
        <input {...getInputProps()} />
        <Upload size={24} className="mx-auto mb-2 text-muted-foreground" />
        <p className="text-sm text-muted-foreground">
          {isDragActive ? 'Drop files here...' : 'Drag & drop audio or click to browse'}
        </p>
        <p className="text-xs text-muted-foreground/60 mt-1">MP3, AAC, OGG, WAV, FLAC</p>
      </div>

      {uploading.map(u => (
        <div key={u.id} className="flex items-center gap-3 p-3 bg-muted rounded-md">
          <Loader2 size={16} className="animate-spin text-primary shrink-0" />
          <div className="flex-1 min-w-0">
            <p className="text-sm truncate">{u.name}</p>
            <div className="mt-1 h-1 bg-border rounded-full overflow-hidden">
              <div className="h-full bg-primary transition-all duration-300" style={{ width: `${u.progress}%` }} />
            </div>
          </div>
          <span className="text-xs text-muted-foreground shrink-0">{u.progress}%</span>
        </div>
      ))}

      {audios.length === 0 && uploading.length === 0 && (
        <p className="text-center text-muted-foreground text-sm py-4">No audio files yet</p>
      )}

      <div className="space-y-1">
        {audios.map(audio => (
          <div key={audio.id} className="flex items-center gap-3 p-3 rounded-md hover:bg-muted/50 group">
            <Music size={16} className="text-muted-foreground shrink-0" />
            <div className="flex-1 min-w-0">
              <p className="text-sm truncate">{audio.originalName}</p>
              <p className="text-xs text-muted-foreground">
                {formatBytes(audio.size)} · {formatDuration(audio.duration)}{audio.bitrate ? ` · ${Math.round(audio.bitrate / 1000)} kbps` : ''}
              </p>
            </div>
            <Button
              variant="ghost"
              size="icon"
              className="opacity-0 group-hover:opacity-100 h-7 w-7 text-muted-foreground hover:text-destructive shrink-0"
              onClick={() => handleDelete(audio.id)}
            >
              <Trash2 size={14} />
            </Button>
          </div>
        ))}
      </div>
    </div>
  );
}

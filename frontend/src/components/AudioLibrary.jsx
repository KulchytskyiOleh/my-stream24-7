import { useCallback, useEffect, useState } from 'react';
import { useDropzone } from 'react-dropzone';
import { Upload, Trash2, Music, Loader2, AlertTriangle, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { formatBytes, formatDuration } from '@/lib/utils';
import { uploadAudio, deleteAudio, transcodeAudio, getAudioProgress } from '@/lib/api';

export default function AudioLibrary({ audios, onRefresh }) {
  const [uploading, setUploading] = useState([]);
  const [transcodingPct, setTranscodingPct] = useState({});

  // Poll progress for audios being processed
  useEffect(() => {
    const processing = audios.filter(a => a.status === 'PROCESSING' || a.status === 'PROCESSING_IN_PROGRESS');
    if (processing.length === 0) return;

    const interval = setInterval(async () => {
      for (const audio of processing) {
        if (audio.status === 'PROCESSING_IN_PROGRESS') {
          const { progress } = await getAudioProgress(audio.id).catch(() => ({ progress: null }));
          if (progress !== null) setTranscodingPct(prev => ({ ...prev, [audio.id]: progress }));
        }
      }
      onRefresh();
    }, 3000);

    return () => clearInterval(interval);
  }, [audios]);

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
    const duplicates = [];
    const toUpload = acceptedFiles.filter(file => {
      const isDup = audios.some(a => a.originalName === file.name && Number(a.size) === file.size);
      if (isDup) duplicates.push(file.name);
      return !isDup;
    });
    if (duplicates.length) {
      alert(`Already uploaded:\n${duplicates.join('\n')}`);
    }
    toUpload.forEach(startUpload);
  }, [audios]);

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

  const handleFix = async (id) => {
    await transcodeAudio(id).catch(() => {});
    onRefresh();
  };

  const renderStatus = (audio) => {
    const pct = transcodingPct[audio.id];

    if (audio.status === 'PROCESSING') {
      return (
        <div className="flex items-center gap-2 text-muted-foreground">
          <Loader2 size={14} className="animate-spin shrink-0" />
          <span className="text-xs">Checking...</span>
        </div>
      );
    }

    if (audio.status === 'PROCESSING_IN_PROGRESS') {
      return (
        <div className="flex items-center gap-2 min-w-0 flex-1">
          <Loader2 size={14} className="animate-spin text-primary shrink-0" />
          <div className="flex-1 min-w-0">
            <div className="h-1 bg-border rounded-full overflow-hidden">
              <div className="h-full bg-primary transition-all duration-300" style={{ width: `${pct ?? 0}%` }} />
            </div>
          </div>
          <span className="text-xs text-muted-foreground shrink-0">{pct ?? 0}%</span>
        </div>
      );
    }

    if (audio.status === 'NEEDS_PROCESSING') {
      return (
        <div className="flex items-center gap-2 shrink-0">
          <AlertTriangle size={14} className="text-yellow-500 shrink-0" />
          <span className="text-xs text-yellow-500 hidden sm:inline">Not optimal for YouTube</span>
          <Button
            variant="outline"
            size="sm"
            className="h-7 text-xs text-yellow-500 border-yellow-500/30 hover:bg-yellow-500/10 shrink-0"
            onClick={() => handleFix(audio.id)}
          >
            Fix for YouTube
          </Button>
        </div>
      );
    }

    if (audio.status === 'ERROR') {
      return <span className="text-xs text-destructive shrink-0">Processing failed</span>;
    }

    if (audio.status === 'READY') {
      return (
        <Button
          variant="outline"
          size="sm"
          className="opacity-0 group-hover:opacity-100 h-7 text-xs shrink-0"
          onClick={() => handleFix(audio.id)}
        >
          <RefreshCw size={12} />
          Transcode
        </Button>
      );
    }

    return null;
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
            {renderStatus(audio)}
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

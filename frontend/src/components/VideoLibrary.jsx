import { useCallback, useState } from 'react';
import { useDropzone } from 'react-dropzone';
import { Upload, Trash2, Film, Loader2, X } from 'lucide-react';
import * as tus from 'tus-js-client';
import { Button } from '@/components/ui/button';
import { formatBytes, formatDuration } from '@/lib/utils';
import { deleteVideo } from '@/lib/api';

export default function VideoLibrary({ videos, onRefresh }) {
  const [uploading, setUploading] = useState([]);

  const startUpload = (file) => {
    const id = `${Date.now()}-${Math.random()}`;

    setUploading(prev => [...prev, { id, name: file.name, progress: 0, upload: null }]);

    const upload = new tus.Upload(file, {
      endpoint: '/api/videos/upload',
      retryDelays: [0, 3000, 5000, 10000],
      chunkSize: 10 * 1024 * 1024, // 10MB chunks
      metadata: {
        filename: encodeURIComponent(file.name),
        filetype: file.type,
      },
      withCredentials: true,
      onProgress: (bytesUploaded, bytesTotal) => {
        const progress = Math.round((bytesUploaded / bytesTotal) * 100);
        setUploading(prev => prev.map(u => u.id === id ? { ...u, progress } : u));
      },
      onSuccess: () => {
        setUploading(prev => prev.filter(u => u.id !== id));
        onRefresh();
      },
      onError: (err) => {
        console.error('Upload error:', err);
        setUploading(prev => prev.filter(u => u.id !== id));
      },
    });

    upload.start();
    setUploading(prev => prev.map(u => u.id === id ? { ...u, upload } : u));
  };

  const cancelUpload = (id) => {
    setUploading(prev => {
      const item = prev.find(u => u.id === id);
      item?.upload?.abort();
      return prev.filter(u => u.id !== id);
    });
  };

  const onDrop = useCallback((acceptedFiles) => {
    acceptedFiles.forEach(startUpload);
  }, [onRefresh]);

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: { 'video/*': ['.mp4', '.mkv', '.mov', '.avi', '.webm', '.flv'] },
    multiple: true,
  });

  const handleDelete = async (id) => {
    if (!confirm('Delete this video?')) return;
    await deleteVideo(id);
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
          {isDragActive ? 'Drop files here...' : 'Drag & drop videos or click to browse'}
        </p>
        <p className="text-xs text-muted-foreground/60 mt-1">MP4, MKV, MOV, AVI, WebM, FLV · Large files supported</p>
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
          <Button
            variant="ghost"
            size="icon"
            className="h-6 w-6 text-muted-foreground hover:text-destructive shrink-0"
            onClick={() => cancelUpload(u.id)}
          >
            <X size={12} />
          </Button>
        </div>
      ))}

      {videos.length === 0 && uploading.length === 0 && (
        <p className="text-center text-muted-foreground text-sm py-4">No videos yet</p>
      )}

      <div className="space-y-1">
        {videos.map(video => (
          <div key={video.id} className="flex items-center gap-3 p-3 rounded-md hover:bg-muted/50 group">
            {video.status === 'PROCESSING'
              ? <Loader2 size={16} className="text-muted-foreground shrink-0 animate-spin" />
              : <Film size={16} className="text-muted-foreground shrink-0" />
            }
            <div className="flex-1 min-w-0">
              <p className="text-sm truncate">{video.originalName}</p>
              <p className="text-xs text-muted-foreground">
                {video.status === 'PROCESSING'
                  ? 'Processing...'
                  : video.status === 'ERROR'
                  ? 'Processing failed'
                  : `${formatBytes(video.size)} · ${formatDuration(video.duration)}`
                }
              </p>
            </div>
            <Button
              variant="ghost"
              size="icon"
              className="opacity-0 group-hover:opacity-100 h-7 w-7 text-muted-foreground hover:text-destructive"
              onClick={() => handleDelete(video.id)}
            >
              <Trash2 size={14} />
            </Button>
          </div>
        ))}
      </div>
    </div>
  );
}

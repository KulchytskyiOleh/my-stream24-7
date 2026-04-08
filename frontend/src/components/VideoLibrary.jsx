import { useCallback, useState, useEffect, useRef } from 'react';
import { useDropzone } from 'react-dropzone';
import { Upload, Trash2, Film, Loader2, X, AlertTriangle, RefreshCw, Info } from 'lucide-react';
import * as tus from 'tus-js-client';
import { Button } from '@/components/ui/button';
import { Tooltip } from '@/components/ui/tooltip';
import { formatBytes, formatDuration } from '@/lib/utils';
import { deleteVideo, transcodeVideo } from '@/lib/api';
import api from '@/lib/api';

function formatBitrate(bps) {
  if (!bps) return null;
  return `${Math.round(bps / 1_000_000)} Mbps`;
}

// Returns { min, recommended, max } in Mbps — based on YouTube H.264 bitrate table
function getTranscodeOptions(width, fps) {
  const w = width ?? 1920;
  const is60 = fps > 40;
  if (w >= 3840) return is60 ? { min: 10, recommended: 35, max: 40 } : { min: 8, recommended: 30, max: 35 };
  if (w >= 2560) return is60 ? { min: 6,  recommended: 24, max: 30 } : { min: 5, recommended: 15, max: 25 };
  if (w >= 1920) return is60 ? { min: 4,  recommended: 12, max: 15 } : { min: 3, recommended: 10, max: 12 };
  if (w >= 1280) return is60 ? { min: 2,  recommended: 7,  max: 10 } : { min: 1, recommended: 5,  max: 7  };
  return { min: 1, recommended: 3, max: 5 };
}

function VideoMetaTooltip({ video }) {
  const hasInfo = video.width || video.duration || video.bitrate || video.audioCodec || video.fps != null;
  if (!hasInfo) return null;

  return (
    <div className="bg-background border border-border rounded-md shadow-md p-2.5 text-xs space-y-1 min-w-[140px]">
      {video.width && video.height && (
        <div className="flex justify-between gap-3">
          <span className="text-muted-foreground">Resolution</span>
          <span className="font-medium">{video.width}×{video.height}</span>
        </div>
      )}
      {video.fps != null && (
        <div className="flex justify-between gap-3">
          <span className="text-muted-foreground">FPS</span>
          <span className="font-medium">{video.fps > 40 ? '60 fps' : '30 fps'}</span>
        </div>
      )}
      {video.duration != null && (
        <div className="flex justify-between gap-3">
          <span className="text-muted-foreground">Duration</span>
          <span className="font-medium">{formatDuration(video.duration)}</span>
        </div>
      )}
      {video.size != null && (
        <div className="flex justify-between gap-3">
          <span className="text-muted-foreground">Size</span>
          <span className="font-medium">{formatBytes(video.size)}</span>
        </div>
      )}
      {video.bitrate && (
        <div className="flex justify-between gap-3">
          <span className="text-muted-foreground">Bitrate</span>
          <span className="font-medium">{formatBitrate(video.bitrate)}</span>
        </div>
      )}
      {video.audioCodec && (
        <div className="flex justify-between gap-3">
          <span className="text-muted-foreground">Audio</span>
          <span className="font-medium uppercase">{video.audioCodec}</span>
        </div>
      )}
    </div>
  );
}

function TranscodePicker({ video, onConfirm, onCancel }) {
  const opts = getTranscodeOptions(video.width, video.fps);
  const hasCustomRange = opts.max - opts.min > 2; // need at least 1 step between min and max
  const [mode, setMode] = useState('recommended'); // 'min' | 'recommended' | 'max' | 'custom'
  const [customMbps, setCustomMbps] = useState(opts.min + 1);
  const ref = useRef(null);

  useEffect(() => {
    function onKey(e) { if (e.key === 'Escape') onCancel(); }
    function onClick(e) { if (ref.current && !ref.current.contains(e.target)) onCancel(); }
    document.addEventListener('keydown', onKey);
    document.addEventListener('mousedown', onClick);
    return () => { document.removeEventListener('keydown', onKey); document.removeEventListener('mousedown', onClick); };
  }, [onCancel]);

  const selectedMbps = mode === 'min' ? opts.min
    : mode === 'max' ? opts.max
    : mode === 'custom' ? customMbps
    : opts.recommended;

  const presets = [
    { key: 'min',         label: 'Min',         value: opts.min },
    { key: 'recommended', label: 'Recommended',  value: opts.recommended, star: true },
    { key: 'max',         label: 'Max',          value: opts.max },
  ];

  return (
    <div ref={ref} className="mt-1 mb-1 p-3 bg-muted/80 border border-border rounded-md space-y-2.5">
      <p className="text-xs text-muted-foreground font-medium">Select target bitrate</p>
      <div className="flex flex-wrap gap-1.5">
        {presets.map(p => (
          <button
            key={p.key}
            onClick={() => setMode(p.key)}
            className={`px-2.5 py-1 rounded text-xs border transition-colors ${
              mode === p.key
                ? 'bg-primary text-primary-foreground border-primary'
                : 'bg-background border-border hover:border-primary/50 text-foreground'
            }`}
          >
            {p.label} {p.value} Mbps{p.star && mode !== p.key ? ' ★' : ''}
          </button>
        ))}
        {hasCustomRange && (
          <button
            onClick={() => setMode('custom')}
            className={`px-2.5 py-1 rounded text-xs border transition-colors ${
              mode === 'custom'
                ? 'bg-primary text-primary-foreground border-primary'
                : 'bg-background border-border hover:border-primary/50 text-foreground'
            }`}
          >
            Custom{mode === 'custom' ? ` ${customMbps} Mbps` : ''}
          </button>
        )}
      </div>
      {mode === 'custom' && hasCustomRange && (
        <div className="space-y-1">
          <div className="flex justify-between text-xs text-muted-foreground">
            <span>{opts.min + 1} Mbps</span>
            <span className="font-medium text-foreground">{customMbps} Mbps</span>
            <span>{opts.max - 1} Mbps</span>
          </div>
          <input
            type="range"
            min={opts.min + 1}
            max={opts.max - 1}
            step={1}
            value={customMbps}
            onChange={e => setCustomMbps(Number(e.target.value))}
            className="w-full accent-primary"
          />
        </div>
      )}
      <div className="flex gap-2 pt-0.5">
        <Button size="sm" className="h-7 text-xs" onClick={() => onConfirm(selectedMbps * 1000)}>
          Transcode
        </Button>
        <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </div>
  );
}

export default function VideoLibrary({ videos, streams = [], onRefresh }) {
  const [uploading, setUploading] = useState([]);
  const [transcodingPct, setTranscodingPct] = useState({});
  const [transcodePicker, setTranscodePicker] = useState(null); // videoId or null

  const activeVideoIds = new Set(
    streams.filter(s => s.isRunning && s.currentVideo).map(s => s.currentVideo.id)
  );

  useEffect(() => {
    const processing = videos.filter(v => v.status === 'PROCESSING');
    if (processing.length === 0) return;

    const interval = setInterval(async () => {
      const updates = await Promise.all(
        processing.map(v => api.get(`/videos/${v.id}/progress`).then(r => [v.id, r.data.progress]))
      );
      setTranscodingPct(Object.fromEntries(updates));
      onRefresh();
    }, 3000);

    return () => clearInterval(interval);
  }, [videos]);

  const startUpload = (file) => {
    const id = `${Date.now()}-${Math.random()}`;

    setUploading(prev => [...prev, { id, name: file.name, progress: 0, upload: null }]);

    const upload = new tus.Upload(file, {
      endpoint: '/api/videos/upload',
      retryDelays: [0, 3000, 5000, 10000],
      chunkSize: 10 * 1024 * 1024,
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
    const duplicates = [];
    const toUpload = acceptedFiles.filter(file => {
      const isDup = videos.some(v => v.originalName === file.name && Number(v.size) === file.size);
      if (isDup) duplicates.push(file.name);
      return !isDup;
    });
    if (duplicates.length) {
      alert(`Already uploaded:\n${duplicates.join('\n')}`);
    }
    toUpload.forEach(startUpload);
  }, [videos, onRefresh]);

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

  const openPicker = (video) => {
    setTranscodePicker(video.id);
  };

  const handleTranscode = async (videoId, targetBitrate) => {
    setTranscodePicker(null);
    transcodeVideo(videoId, targetBitrate).catch(() => {}).finally(onRefresh);
  };

  const showTooltip = (status) => ['READY', 'NEEDS_TRANSCODE', 'ERROR'].includes(status);

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
          <div key={video.id}>
            <div className="flex items-center gap-3 p-3 rounded-md hover:bg-muted/50 group">
              {video.status === 'PROCESSING' || video.status === 'TRANSCODING'
                ? <Loader2 size={16} className="text-muted-foreground shrink-0 animate-spin" />
                : video.status === 'NEEDS_TRANSCODE'
                ? <AlertTriangle size={16} className="text-yellow-500 shrink-0" />
                : <Film size={16} className="text-muted-foreground shrink-0" />
              }
              <div className="flex-1 min-w-0">
                <p className="text-sm truncate">{video.originalName}</p>
                {video.status === 'PROCESSING' ? (
                  <p className="text-xs text-muted-foreground">Checking...</p>
                ) : video.status === 'TRANSCODING' ? (
                  <div className="mt-1">
                    <div className="flex justify-between text-xs text-muted-foreground mb-0.5">
                      <span>Transcoding...</span>
                      <span>{transcodingPct[video.id] ?? 0}%</span>
                    </div>
                    <div className="h-1 bg-border rounded-full overflow-hidden">
                      <div className="h-full bg-primary transition-all duration-500"
                        style={{ width: `${transcodingPct[video.id] ?? 0}%` }} />
                    </div>
                  </div>
                ) : video.status === 'NEEDS_TRANSCODE' ? (
                  <p className="text-xs text-yellow-500">Keyframe interval too large for YouTube</p>
                ) : video.status === 'ERROR' ? (
                  <p className="text-xs text-destructive">Processing failed</p>
                ) : null}
              </div>
              {showTooltip(video.status) && (
                <Tooltip content={<VideoMetaTooltip video={video} />}>
                  <Info size={14} className="text-muted-foreground/50 hover:text-muted-foreground shrink-0 cursor-default transition-colors" />
                </Tooltip>
              )}
              {video.status === 'NEEDS_TRANSCODE' && (
                <Button
                  variant="outline"
                  size="sm"
                  className="h-7 text-xs text-yellow-500 border-yellow-500/30 hover:bg-yellow-500/10 shrink-0"
                  onClick={() => openPicker(video)}
                >
                  Fix for YouTube
                </Button>
              )}
              {video.status === 'READY' && !activeVideoIds.has(video.id) && (!video.bitrate || video.bitrate > 8_000_000) && (
                <Button
                  variant="outline"
                  size="sm"
                  className="opacity-0 group-hover:opacity-100 h-7 text-xs shrink-0"
                  onClick={() => openPicker(video)}
                >
                  <RefreshCw size={12} />
                  Transcode
                </Button>
              )}
              <Button
                variant="ghost"
                size="icon"
                className="opacity-0 group-hover:opacity-100 h-7 w-7 text-muted-foreground hover:text-destructive shrink-0"
                onClick={() => handleDelete(video.id)}
              >
                <Trash2 size={14} />
              </Button>
            </div>
            {transcodePicker === video.id && (
              <TranscodePicker
                video={video}
                onConfirm={(bitrate) => handleTranscode(video.id, bitrate)}
                onCancel={() => setTranscodePicker(null)}
              />
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

import { useState, useRef } from 'react';
import { createPortal } from 'react-dom';
import { Play, Square, Pencil, Trash2, ChevronDown, ChevronUp, Radio, RotateCcw, Check, X, Clock, AlertCircle, History, Eye, EyeOff } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import PlaylistEditor from './PlaylistEditor';
import { startStream, stopStream, restartStream, deleteStream, updateStream, getStreamHistory, getStreamKey } from '@/lib/api';

function ErrorTooltip({ message }) {
  const [visible, setVisible] = useState(false);
  const [pos, setPos] = useState({ top: 0, left: 0 });
  const ref = useRef(null);

  const handleMouseEnter = () => {
    const rect = ref.current.getBoundingClientRect();
    setPos({ top: rect.top + window.scrollY - 8, left: rect.left + rect.width / 2 });
    setVisible(true);
  };

  return (
    <div ref={ref} className="flex items-center" onMouseEnter={handleMouseEnter} onMouseLeave={() => setVisible(false)}>
      <AlertCircle size={15} className="text-red-400 cursor-help" />
      {visible && createPortal(
        <div
          className="fixed z-[9999] w-64 rounded-md bg-card border border-border shadow-xl px-3 py-2 text-xs text-foreground -translate-x-1/2 -translate-y-full"
          style={{ top: pos.top, left: pos.left }}
        >
          {message}
        </div>,
        document.body
      )}
    </div>
  );
}

function toDatetimeLocal(isoString) {
  if (!isoString) return '';
  const d = new Date(isoString);
  const pad = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function formatRelative(isoString) {
  if (!isoString) return '';
  const diff = new Date(isoString) - Date.now();
  const abs = Math.abs(diff);
  const mins = Math.floor(abs / 60000);
  const hours = Math.floor(mins / 60);
  const days = Math.floor(hours / 24);
  const suffix = diff < 0 ? 'ago' : 'from now';
  if (days > 0) return `${days}d ${hours % 24}h ${suffix}`;
  if (hours > 0) return `${hours}h ${mins % 60}m ${suffix}`;
  return `${mins}m ${suffix}`;
}

const inputCls = 'h-8 text-sm bg-muted border border-border rounded-md px-2 text-foreground focus:outline-none focus:ring-1 focus:ring-ring transition-colors cursor-pointer disabled:opacity-40';
const HOURS = Array.from({ length: 24 }, (_, i) => String(i).padStart(2, '0'));
const MINUTES_5 = Array.from({ length: 12 }, (_, i) => String(i * 5).padStart(2, '0'));
const MINUTES_1 = Array.from({ length: 60 }, (_, i) => String(i).padStart(2, '0'));

function DateTimeRow({ value, onChange, label = 'Start at' }) {
  const [fineMin, setFineMin] = useState(false);
  const date = value.split('T')[0] || '';
  const time = value.split('T')[1] || '00:00';
  const hh = time.slice(0, 2);
  const mm = time.slice(3, 5);

  const update = (newDate, newHH, newMM) => {
    if (!newDate) { onChange(''); return; }
    onChange(`${newDate}T${newHH}:${newMM}`);
  };

  const minutes = fineMin ? MINUTES_1 : MINUTES_5;

  return (
    <div className="flex items-center gap-2 flex-wrap">
      <span className="text-sm w-20 shrink-0">{label}</span>
      <input
        type="date"
        value={date}
        onChange={e => update(e.target.value, hh, mm)}
        className={`${inputCls} accent-primary`}
      />
      <select value={hh} onChange={e => update(date, e.target.value, mm)} className={inputCls} disabled={!date}>
        {HOURS.map(h => <option key={h}>{h}</option>)}
      </select>
      <span className="font-medium text-foreground">:</span>
      <select value={mm} onChange={e => update(date, hh, e.target.value)} className={inputCls} disabled={!date}>
        {minutes.map(m => <option key={m}>{m}</option>)}
      </select>
      <button
        type="button"
        onClick={() => setFineMin(f => !f)}
        className={`text-xs px-1.5 py-0.5 rounded border transition-colors ${fineMin ? 'border-primary text-primary bg-primary/10' : 'border-border text-muted-foreground hover:text-foreground'}`}
        title={fineMin ? 'Switch to 5-min steps' : 'Switch to 1-min steps'}
      >
        {fineMin ? '1m' : '5m'}
      </button>
      {value && (
        <span className="text-xs text-muted-foreground bg-muted rounded px-1.5 py-0.5">
          {formatRelative(new Date(value).toISOString())}
        </span>
      )}
      {value && (
        <Button size="icon" variant="ghost" className="h-6 w-6 text-muted-foreground" onClick={() => onChange('')}>
          <X size={12} />
        </Button>
      )}
    </div>
  );
}

function friendlyError(msg) {
  if (!msg) return 'Unknown error';
  const m = msg.toLowerCase();
  if (m.includes('connection refused') || m.includes('failed to connect') || m.includes('rtmp')) return 'Could not connect to YouTube. Check your stream key.';
  if (m.includes('conversion failed')) return 'Stream stopped unexpectedly. Possible causes: wrong stream key, network issue, or video too large for your connection.';
  if (m.includes('invalid data') || m.includes('moov atom')) return 'Video file is corrupted or in unsupported format.';
  if (m.includes('no such file')) return 'Video file not found on server.';
  return msg;
}


function formatUptime(ms) {
  const s = Math.floor(ms / 1000);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

export default function StreamSlot({ stream, videos, audios, onRefresh }) {
  const [expanded, setExpanded] = useState(false);
  const [loading, setLoading] = useState(false);
  const [restarting, setRestarting] = useState(false);
  const [editingKey, setEditingKey] = useState(false);
  const [newKey, setNewKey] = useState('');
  const [savingKey, setSavingKey] = useState(false);
  const [currentKey, setCurrentKey] = useState('');
  const [keyVisible, setKeyVisible] = useState(false);
  const [scheduleOpen, setScheduleOpen] = useState(false);
  const [schedStart, setSchedStart] = useState(toDatetimeLocal(stream.scheduleStart));
  const [schedStop, setSchedStop] = useState(toDatetimeLocal(stream.scheduleStop));
  const [savingSchedule, setSavingSchedule] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [history, setHistory] = useState(null);
  const [historyLoading, setHistoryLoading] = useState(false);

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

  const handleRestart = async () => {
    setRestarting(true);
    try {
      await restartStream(stream.id);
      onRefresh();
    } catch (err) {
      alert(err.response?.data?.error || err.message);
    } finally {
      setRestarting(false);
    }
  };

  const handleEditKey = async () => {
    setNewKey('');
    setKeyVisible(false);
    setEditingKey(true);
    try {
      const key = await getStreamKey(stream.id);
      setCurrentKey(key);
      setNewKey(key);
    } catch {
      setCurrentKey('');
    }
  };

  const handleSaveKey = async () => {
    if (!newKey.trim()) return;
    setSavingKey(true);
    try {
      await updateStream(stream.id, { streamKey: newKey.trim() });
      setEditingKey(false);
      onRefresh();
    } catch (err) {
      alert(err.response?.data?.error || err.message);
    } finally {
      setSavingKey(false);
    }
  };

  const handleSaveSchedule = async () => {
    const now = Date.now();
    if (schedStart && new Date(schedStart) <= now) {
      alert('Start time must be in the future');
      return;
    }
    if (schedStop && new Date(schedStop) <= now) {
      alert('Stop time must be in the future');
      return;
    }
    if (schedStart && schedStop && new Date(schedStop) <= new Date(schedStart)) {
      alert('Stop time must be after start time');
      return;
    }
    setSavingSchedule(true);
    try {
      await updateStream(stream.id, {
        scheduleStart: schedStart ? new Date(schedStart).toISOString() : null,
        scheduleStop: schedStop ? new Date(schedStop).toISOString() : null,
      });
      onRefresh();
      setScheduleOpen(false);
    } catch (err) {
      alert(err.response?.data?.error || err.message);
    } finally {
      setSavingSchedule(false);
    }
  };

  const handleToggleHistory = async () => {
    if (!historyOpen && history === null) {
      setHistoryLoading(true);
      try {
        const data = await getStreamHistory(stream.id);
        setHistory(data);
      } catch (err) {
        setHistory([]);
      } finally {
        setHistoryLoading(false);
      }
    }
    setHistoryOpen(o => !o);
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
                  {stream.mode === 'LOOP' ? 'Looping:' : 'Now playing:'} {stream.currentVideo.originalName}
                </p>
              )}
              {stream.status === 'ONLINE' && (stream.bitrate || stream.startedAt) && (
                <p className="text-xs text-muted-foreground mt-0.5">
                  {stream.bitrate ? `${(stream.bitrate / 1000).toFixed(1)} Mbps` : ''}
                  {stream.bitrate && stream.startedAt ? ' · ' : ''}
                  {stream.startedAt ? formatUptime(Date.now() - stream.startedAt) : ''}
                </p>
              )}
            </div>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            {editingKey && (
              <div className="flex items-center gap-1">
                <div className="relative">
                  <Input
                    type={keyVisible ? 'text' : 'password'}
                    placeholder="Stream key"
                    value={newKey}
                    onChange={e => setNewKey(e.target.value)}
                    onKeyDown={e => { if (e.key === 'Enter') handleSaveKey(); if (e.key === 'Escape') setEditingKey(false); }}
                    className="h-8 w-56 text-xs pr-8"
                    autoFocus
                  />
                  <button
                    type="button"
                    className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                    onClick={() => setKeyVisible(v => !v)}
                    tabIndex={-1}
                  >
                    {keyVisible ? <EyeOff size={13} /> : <Eye size={13} />}
                  </button>
                </div>
                <Button size="icon" variant="ghost" className="h-8 w-8 text-green-500" onClick={handleSaveKey} disabled={savingKey}>
                  <Check size={14} />
                </Button>
                <Button size="icon" variant="ghost" className="h-8 w-8 text-muted-foreground" onClick={() => setEditingKey(false)}>
                  <X size={14} />
                </Button>
              </div>
            )}

            <Badge status={stream.status} />

            {stream.status === 'ERROR' && stream.errorMessage && (
              <ErrorTooltip message={friendlyError(stream.errorMessage)} />
            )}

            {stream.status === 'ONLINE' && (
              <Button
                size="sm"
                variant="outline"
                onClick={handleRestart}
                disabled={restarting}
                className="gap-1.5"
                title="Restart stream"
              >
                <RotateCcw size={12} className={restarting ? 'animate-spin' : ''} />
                {restarting ? 'Restarting...' : 'Restart'}
              </Button>
            )}

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
              className={`h-8 w-8 ${scheduleOpen || stream.scheduleStart || stream.scheduleStop ? 'text-blue-400' : 'text-muted-foreground'}`}
              onClick={() => setScheduleOpen(o => !o)}
              title="Schedule stream"
            >
              <Clock size={14} />
            </Button>

            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8 text-muted-foreground"
              onClick={handleEditKey}
              title="Edit stream key"
            >
              <Pencil size={14} />
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

      {scheduleOpen && (
        <div className="border-t border-border p-4 bg-muted/30">
          <p className="text-xs font-semibold text-foreground mb-3 uppercase tracking-wider flex items-center gap-1.5">
            <Clock size={12} className="text-muted-foreground" /> Schedule
          </p>
          <div className="space-y-2">
            <DateTimeRow value={schedStart} onChange={setSchedStart} />
            <DateTimeRow value={schedStop} onChange={setSchedStop} label="Stop at" />
          </div>
          <div className="flex gap-2 mt-3">
            <Button size="sm" onClick={handleSaveSchedule} disabled={savingSchedule}>
              {savingSchedule ? 'Saving…' : 'Save schedule'}
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setScheduleOpen(false)}>Cancel</Button>
          </div>
        </div>
      )}

      {expanded && (
        <div className="border-t border-border p-4">
          <PlaylistEditor stream={stream} videos={videos} audios={audios} onUpdate={onRefresh} />
        </div>
      )}

      <div className="border-t border-border">
        <button
          className="w-full flex items-center justify-between px-4 py-2.5 text-sm text-muted-foreground hover:text-foreground hover:bg-muted/30 transition-colors"
          onClick={handleToggleHistory}
        >
          <span className="flex items-center gap-2">
            <History size={14} />
            Stream History
          </span>
          {historyOpen ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
        </button>

        {historyOpen && (
          <div className="px-4 pb-4">
            {historyLoading && (
              <p className="text-xs text-muted-foreground py-2">Loading…</p>
            )}
            {!historyLoading && history?.length === 0 && (
              <p className="text-xs text-muted-foreground py-2">No sessions yet.</p>
            )}
            {!historyLoading && history?.length > 0 && (
              <div className="space-y-1">
                {history.map(s => (
                  <div key={s.id} className="flex items-center justify-between text-xs py-1.5 border-b border-border/50 last:border-0">
                    <div className="flex items-center gap-2 min-w-0">
                      <span className={`shrink-0 w-1.5 h-1.5 rounded-full ${s.reason === 'ERROR' ? 'bg-red-400' : 'bg-green-400'}`} />
                      <span className="text-foreground">{new Date(s.startedAt).toLocaleString()}</span>
                      {s.stoppedAt && (
                        <span className="text-muted-foreground">
                          → {new Date(s.stoppedAt).toLocaleString()}
                        </span>
                      )}
                      {!s.stoppedAt && (
                        <span className="text-green-400">running</span>
                      )}
                    </div>
                    {s.reason && (
                      <span className={`shrink-0 ml-2 px-1.5 py-0.5 rounded text-[10px] font-medium ${s.reason === 'ERROR' ? 'bg-red-500/15 text-red-400' : 'bg-muted text-muted-foreground'}`}>
                        {s.reason}
                      </span>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

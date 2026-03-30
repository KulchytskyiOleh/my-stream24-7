import { spawn } from 'child_process';
import fs from 'fs/promises';
import { PrismaClient } from '@prisma/client';
import { decrypt } from './encryption.js';

const prisma = new PrismaClient();

// Map of streamId -> { process, currentIndex, playlist, stopped, mode, concatPath? }
const activeStreams = new Map();

export async function startStream(streamId) {
  if (activeStreams.has(streamId)) {
    throw new Error('Stream already running');
  }

  const stream = await prisma.stream.findUnique({
    where: { id: streamId },
    include: {
      playlistItems: {
        include: { video: true },
        orderBy: { position: 'asc' },
      },
      loopVideo: true,
      loopAudioItems: {
        include: { audio: true },
        orderBy: { position: 'asc' },
      },
    },
  });

  if (!stream) throw new Error('Stream not found');

  if (stream.mode === 'LOOP') {
    return _startLoopStream(streamId, stream);
  }
  return _startPlaylistStream(streamId, stream);
}

async function _startPlaylistStream(streamId, stream) {
  if (stream.playlistItems.length === 0) throw new Error('Playlist is empty');

  const streamKey = decrypt(stream.streamKeyEnc);
  const playlist = stream.shuffle
    ? shuffleArray([...stream.playlistItems])
    : [...stream.playlistItems];

  await prisma.stream.update({
    where: { id: streamId },
    data: { status: 'ONLINE' },
  });

  const state = { process: null, currentIndex: 0, playlist, streamKey, stopped: false, mode: 'PLAYLIST' };
  activeStreams.set(streamId, state);

  await playNext(streamId);
}

async function _startLoopStream(streamId, stream) {
  if (!stream.loopVideo) throw new Error('Loop video not set');
  if (stream.loopAudioItems.length === 0) throw new Error('No audio files in loop playlist');

  const streamKey = decrypt(stream.streamKeyEnc);
  const rtmpUrl = `rtmp://a.rtmp.youtube.com/live2/${streamKey}`;

  // Write concat file for audio playlist
  const concatPath = `/tmp/stream-${streamId}-audio.txt`;
  const concatContent = stream.loopAudioItems
    .map(item => `file '${item.audio.path}'`)
    .join('\n');
  await fs.writeFile(concatPath, concatContent);

  await prisma.stream.update({
    where: { id: streamId },
    data: { status: 'ONLINE', currentVideoId: stream.loopVideoId },
  });

  const args = [
    '-stream_loop', '-1',
    '-re',
    '-i', stream.loopVideo.path,
    '-stream_loop', '-1',
    '-f', 'concat',
    '-safe', '0',
    '-i', concatPath,
    '-map', '0:v',
    '-map', '1:a',
    '-c:v', 'copy',
    '-c:a', 'aac',
    '-b:a', '128k',
    '-f', 'flv',
    rtmpUrl,
  ];

  const proc = spawn('ffmpeg', args, { stdio: ['ignore', 'pipe', 'pipe'] });
  const state = { process: proc, stopped: false, mode: 'LOOP', concatPath };
  activeStreams.set(streamId, state);

  proc.stderr.on('data', () => {});

  proc.on('close', async () => {
    if (state.stopped) return;
    await stopStream(streamId, 'ERROR');
  });

  proc.on('error', async (err) => {
    console.error(`FFmpeg error for stream ${streamId}:`, err);
    if (!state.stopped) {
      await stopStream(streamId, 'ERROR');
    }
  });
}

async function playNext(streamId) {
  const state = activeStreams.get(streamId);
  if (!state || state.stopped) return;

  if (state.currentIndex >= state.playlist.length) {
    // End of playlist — reshuffle if needed and restart
    if (state.playlist.length === 0) {
      await stopStream(streamId, 'ERROR');
      return;
    }
    state.currentIndex = 0;
    const stream = await prisma.stream.findUnique({ where: { id: streamId } });
    if (stream?.shuffle) {
      state.playlist = shuffleArray([...state.playlist]);
    }
  }

  const item = state.playlist[state.currentIndex];
  const videoPath = item.video.path;
  const rtmpUrl = `rtmp://a.rtmp.youtube.com/live2/${state.streamKey}`;

  await prisma.stream.update({
    where: { id: streamId },
    data: { currentVideoId: item.video.id },
  });

  const args = [
    '-re',
    '-i', videoPath,
    '-c:v', 'copy',
    '-c:a', 'aac',
    '-f', 'flv',
    rtmpUrl,
  ];

  const proc = spawn('ffmpeg', args, { stdio: ['ignore', 'pipe', 'pipe'] });
  state.process = proc;

  proc.stderr.on('data', () => {});

  proc.on('close', async () => {
    if (state.stopped) return;
    state.currentIndex++;
    await playNext(streamId);
  });

  proc.on('error', async (err) => {
    console.error(`FFmpeg error for stream ${streamId}:`, err);
    if (!state.stopped) {
      await stopStream(streamId, 'ERROR');
    }
  });
}

export async function stopStream(streamId, status = 'OFFLINE') {
  const state = activeStreams.get(streamId);
  if (!state) return;

  state.stopped = true;
  if (state.process && !state.process.killed) {
    state.process.kill('SIGTERM');
  }

  // Clean up concat file for loop streams
  if (state.concatPath) {
    fs.unlink(state.concatPath).catch(() => {});
  }

  activeStreams.delete(streamId);

  await prisma.stream.update({
    where: { id: streamId },
    data: { status, currentVideoId: null },
  });
}

export async function restartStream(streamId) {
  const state = activeStreams.get(streamId);
  if (!state) throw new Error('Stream not running');

  const stream = await prisma.stream.findUnique({ where: { id: streamId } });
  if (!stream) throw new Error('Stream not found');

  const mode = stream.mode;
  await stopStream(streamId);

  // Brief pause — YouTube keeps stream alive during short gaps
  await new Promise(resolve => setTimeout(resolve, 800));

  await startStream(streamId);
}

export function isStreamRunning(streamId) {
  return activeStreams.has(streamId);
}

// Update playlist without interrupting current video
export async function updateStreamPlaylist(streamId) {
  const state = activeStreams.get(streamId);
  if (!state || state.mode !== 'PLAYLIST') return;

  const stream = await prisma.stream.findUnique({
    where: { id: streamId },
    include: {
      playlistItems: {
        include: { video: true },
        orderBy: { position: 'asc' },
      },
    },
  });
  if (!stream) return;

  const currentVideoId = state.playlist[state.currentIndex]?.video?.id;
  const newPlaylist = stream.shuffle
    ? shuffleArray([...stream.playlistItems])
    : [...stream.playlistItems];

  // Keep currentIndex pointing to the same video if it still exists
  const newIndex = newPlaylist.findIndex(i => i.video.id === currentVideoId);
  state.playlist = newPlaylist;
  state.currentIndex = newIndex >= 0 ? newIndex : 0;
}

export async function stopAllUserStreams(userId) {
  const streams = await prisma.stream.findMany({
    where: { userId, status: 'ONLINE' },
  });
  for (const s of streams) {
    await stopStream(s.id);
  }
}

function shuffleArray(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

import { spawn } from 'child_process';
import { PrismaClient } from '@prisma/client';
import { decrypt } from './encryption.js';

const prisma = new PrismaClient();

// Map of streamId -> { process, currentIndex, playlist }
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
    },
  });

  if (!stream) throw new Error('Stream not found');
  if (stream.playlistItems.length === 0) throw new Error('Playlist is empty');

  const streamKey = decrypt(stream.streamKeyEnc);
  const playlist = stream.shuffle
    ? shuffleArray([...stream.playlistItems])
    : [...stream.playlistItems];

  await prisma.stream.update({
    where: { id: streamId },
    data: { status: 'ONLINE' },
  });

  const state = { process: null, currentIndex: 0, playlist, streamKey, stopped: false };
  activeStreams.set(streamId, state);

  await playNext(streamId);
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

  proc.stderr.on('data', (data) => {
    // FFmpeg logs progress to stderr — ignore for now
  });

  proc.on('close', async (code) => {
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
  activeStreams.delete(streamId);

  await prisma.stream.update({
    where: { id: streamId },
    data: { status, currentVideoId: null },
  });
}

export function isStreamRunning(streamId) {
  return activeStreams.has(streamId);
}

// Update playlist without interrupting current video
export async function updateStreamPlaylist(streamId) {
  const state = activeStreams.get(streamId);
  if (!state) return; // stream not running — nothing to do

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

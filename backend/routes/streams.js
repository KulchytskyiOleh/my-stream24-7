import { Router } from 'express';
import { PrismaClient } from '@prisma/client';
import { requireAuth } from '../middleware/auth.js';
import { encrypt, decrypt } from '../services/encryption.js';
import { startStream, stopStream, restartStream, isStreamRunning, updateStreamPlaylist, getStreamStats } from '../services/ffmpeg.js';

const prisma = new PrismaClient();
const router = Router();

const streamInclude = {
  currentVideo: { select: { id: true, originalName: true } },
  loopVideo: { select: { id: true, originalName: true, duration: true, status: true } },
  playlistItems: {
    include: { video: { select: { id: true, originalName: true, duration: true } } },
    orderBy: { position: 'asc' },
  },
  loopAudioItems: {
    include: { audio: { select: { id: true, originalName: true, duration: true } } },
    orderBy: { position: 'asc' },
  },
};

// List user's streams
router.get('/', requireAuth, async (req, res) => {
  const streams = await prisma.stream.findMany({
    where: { userId: req.user.id },
    include: streamInclude,
    orderBy: { createdAt: 'desc' },
  });

  res.json(streams.map(s => ({ ...maskStreamKey(s), ...getStreamStats(s.id) })));
});

// Get single stream
router.get('/:id', requireAuth, async (req, res) => {
  const stream = await prisma.stream.findFirst({
    where: { id: req.params.id, userId: req.user.id },
    include: streamInclude,
  });
  if (!stream) return res.status(404).json({ error: 'Stream not found' });
  res.json(maskStreamKey(stream));
});

// Create stream
router.post('/', requireAuth, async (req, res) => {
  const { name, streamKey } = req.body;
  if (!name?.trim() || !streamKey?.trim()) {
    return res.status(400).json({ error: 'Name and stream key are required' });
  }

  const stream = await prisma.stream.create({
    data: {
      userId: req.user.id,
      name: name.trim(),
      streamKeyEnc: encrypt(streamKey.trim()),
    },
  });

  res.status(201).json(maskStreamKey(stream));
});

// Update stream (name, stream key, shuffle)
router.patch('/:id', requireAuth, async (req, res) => {
  const stream = await prisma.stream.findFirst({
    where: { id: req.params.id, userId: req.user.id },
  });
  if (!stream) return res.status(404).json({ error: 'Stream not found' });

  const data = {};
  if (req.body.name !== undefined) data.name = req.body.name.trim();
  if (req.body.streamKey !== undefined) data.streamKeyEnc = encrypt(req.body.streamKey.trim());
  if (req.body.shuffle !== undefined) data.shuffle = Boolean(req.body.shuffle);
  if (req.body.mode !== undefined && ['PLAYLIST', 'LOOP'].includes(req.body.mode)) {
    data.mode = req.body.mode;
  }
  if (req.body.scheduleStart !== undefined) {
    data.scheduleStart = req.body.scheduleStart ? new Date(req.body.scheduleStart) : null;
  }
  if (req.body.scheduleStop !== undefined) {
    data.scheduleStop = req.body.scheduleStop ? new Date(req.body.scheduleStop) : null;
  }
  if (req.body.loopVideoId !== undefined) {
    if (req.body.loopVideoId === null) {
      data.loopVideoId = null;
    } else {
      const video = await prisma.video.findFirst({
        where: { id: req.body.loopVideoId, userId: req.user.id },
      });
      if (!video) return res.status(400).json({ error: 'Video not found' });
      data.loopVideoId = video.id;
    }
  }

  const updated = await prisma.stream.update({ where: { id: stream.id }, data });
  res.json(maskStreamKey(updated));
});

// Delete stream
router.delete('/:id', requireAuth, async (req, res) => {
  const stream = await prisma.stream.findFirst({
    where: { id: req.params.id, userId: req.user.id },
  });
  if (!stream) return res.status(404).json({ error: 'Stream not found' });

  if (isStreamRunning(stream.id)) {
    await stopStream(stream.id);
  }

  await prisma.stream.delete({ where: { id: stream.id } });
  res.json({ ok: true });
});

// Start stream
router.post('/:id/start', requireAuth, async (req, res) => {
  const stream = await prisma.stream.findFirst({
    where: { id: req.params.id, userId: req.user.id },
  });
  if (!stream) return res.status(404).json({ error: 'Stream not found' });

  try {
    await startStream(stream.id);
    res.json({ ok: true, status: 'ONLINE' });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// Stop stream
router.post('/:id/stop', requireAuth, async (req, res) => {
  const stream = await prisma.stream.findFirst({
    where: { id: req.params.id, userId: req.user.id },
  });
  if (!stream) return res.status(404).json({ error: 'Stream not found' });

  await stopStream(stream.id);
  res.json({ ok: true, status: 'OFFLINE' });
});

// Restart stream (stop + immediate start, no YouTube signal drop)
router.post('/:id/restart', requireAuth, async (req, res) => {
  const stream = await prisma.stream.findFirst({
    where: { id: req.params.id, userId: req.user.id },
  });
  if (!stream) return res.status(404).json({ error: 'Stream not found' });

  try {
    await restartStream(stream.id);
    res.json({ ok: true, status: 'ONLINE' });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// Update playlist
router.put('/:id/playlist', requireAuth, async (req, res) => {
  const stream = await prisma.stream.findFirst({
    where: { id: req.params.id, userId: req.user.id },
  });
  if (!stream) return res.status(404).json({ error: 'Stream not found' });

  const { videoIds } = req.body; // ordered array of video IDs
  if (!Array.isArray(videoIds)) {
    return res.status(400).json({ error: 'videoIds must be an array' });
  }

  // Verify all videos belong to this user
  const videos = await prisma.video.findMany({
    where: { id: { in: videoIds }, userId: req.user.id },
  });
  if (videos.length !== videoIds.length) {
    return res.status(400).json({ error: 'Some videos not found' });
  }

  // Replace playlist atomically
  await prisma.$transaction([
    prisma.playlistItem.deleteMany({ where: { streamId: stream.id } }),
    prisma.playlistItem.createMany({
      data: videoIds.map((videoId, position) => ({
        streamId: stream.id,
        videoId,
        position,
      })),
    }),
  ]);

  // Update in-memory playlist if stream is running (no interruption)
  await updateStreamPlaylist(stream.id);

  res.json({ ok: true });
});

// Update loop audio playlist
router.put('/:id/loop-audio', requireAuth, async (req, res) => {
  const stream = await prisma.stream.findFirst({
    where: { id: req.params.id, userId: req.user.id },
  });
  if (!stream) return res.status(404).json({ error: 'Stream not found' });

  const { audioIds } = req.body;
  if (!Array.isArray(audioIds)) {
    return res.status(400).json({ error: 'audioIds must be an array' });
  }

  // Verify all audios belong to this user
  const audios = await prisma.audio.findMany({
    where: { id: { in: audioIds }, userId: req.user.id },
  });
  if (audios.length !== audioIds.length) {
    return res.status(400).json({ error: 'Some audio files not found' });
  }

  await prisma.$transaction([
    prisma.loopAudioItem.deleteMany({ where: { streamId: stream.id } }),
    prisma.loopAudioItem.createMany({
      data: audioIds.map((audioId, position) => ({
        streamId: stream.id,
        audioId,
        position,
      })),
    }),
  ]);

  res.json({ ok: true });
});

function maskStreamKey(stream) {
  const { streamKeyEnc, ...rest } = stream;
  return rest;
}

export default router;

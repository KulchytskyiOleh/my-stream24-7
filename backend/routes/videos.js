import { Router } from 'express';
import path from 'path';
import fs from 'fs/promises';
import { PrismaClient } from '@prisma/client';
import rateLimit from 'express-rate-limit';
import { requireAuth } from '../middleware/auth.js';
import { fileURLToPath } from 'url';
import { spawn } from 'child_process';
import { Server as TusServer } from '@tus/server';
import { FileStore } from '@tus/file-store';
import { processVideo, transcodeVideo, transcodingProgress } from '../services/transcoder.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const prisma = new PrismaClient();
const router = Router();

const uploadDir = path.resolve(process.env.UPLOAD_DIR || './uploads');

const uploadLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  message: { error: 'Too many uploads, try again later' },
});

function getVideoInfo(filePath) {
  return new Promise((resolve) => {
    const proc = spawn('ffprobe', [
      '-v', 'quiet',
      '-print_format', 'json',
      '-show_format',
      '-show_streams',
      '-select_streams', 'v:0',
      filePath,
    ]);
    let output = '';
    proc.stdout.on('data', (d) => (output += d));
    proc.on('close', () => {
      try {
        const data = JSON.parse(output);
        const duration = parseFloat(data.format?.duration) || null;
        const bitrate = parseInt(data.streams?.[0]?.bit_rate) || parseInt(data.format?.bit_rate) || null;
        resolve({ duration, bitrate });
      } catch {
        resolve({ duration: null, bitrate: null });
      }
    });
    proc.on('error', () => resolve({ duration: null, bitrate: null }));
  });
}

const tusServer = new TusServer({
  path: '/api/videos/upload',
  datastore: new FileStore({ directory: uploadDir }),
  onUploadFinish: async (req, res, upload) => {
    try {
      const userId = req.user?.id;
      const originalName = decodeURIComponent(upload.metadata?.filename || 'video');
      const filePath = path.join(uploadDir, upload.id);
      const size = upload.size;
      const { duration, bitrate } = await getVideoInfo(filePath);

      const video = await prisma.video.create({
        data: {
          userId,
          filename: upload.id,
          originalName,
          size: BigInt(size),
          duration,
          bitrate,
          path: filePath,
          status: 'PROCESSING',
        },
      });

      // Transcode in background (fix keyframe interval for YouTube)
      processVideo(video.id).catch(err => console.error('processVideo error:', err));
    } catch (err) {
      console.error('tus onUploadFinish error:', err);
    }
    return res;
  },
});

// Rate limit only POST (new upload creation), not PATCH (chunk uploads)
router.post('/upload', requireAuth, uploadLimiter, (req, res) => tusServer.handle(req, res));
router.all('/upload*', requireAuth, (req, res) => tusServer.handle(req, res));

router.post('/:id/transcode', requireAuth, async (req, res) => {
  const video = await prisma.video.findFirst({
    where: { id: req.params.id, userId: req.user.id },
  });
  if (!video) return res.status(404).json({ error: 'Video not found' });
  if (!['NEEDS_TRANSCODE', 'ERROR'].includes(video.status)) {
    return res.status(400).json({ error: 'Video does not need transcoding' });
  }
  transcodeVideo(video.id).catch(err => console.error('transcodeVideo error:', err));
  res.json({ ok: true });
});

router.get('/:id/progress', requireAuth, async (req, res) => {
  const progress = transcodingProgress.get(req.params.id) ?? null;
  res.json({ progress });
});

router.get('/', requireAuth, async (req, res) => {
  const videos = await prisma.video.findMany({
    where: { userId: req.user.id },
    orderBy: { createdAt: 'desc' },
    select: { id: true, originalName: true, size: true, duration: true, bitrate: true, status: true, createdAt: true },
  });
  res.json(videos.map(v => ({ ...v, size: Number(v.size) })));
});

router.delete('/:id', requireAuth, async (req, res) => {
  const video = await prisma.video.findFirst({
    where: { id: req.params.id, userId: req.user.id },
  });
  if (!video) return res.status(404).json({ error: 'Video not found' });

  await prisma.video.delete({ where: { id: video.id } });

  try {
    await fs.unlink(video.path);
    await fs.unlink(video.path + '.json').catch(() => {});
  } catch {
    // File may already be gone
  }

  res.json({ ok: true });
});

export default router;

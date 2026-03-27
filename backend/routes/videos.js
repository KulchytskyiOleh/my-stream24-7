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

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const prisma = new PrismaClient();
const router = Router();

const uploadDir = path.resolve(process.env.UPLOAD_DIR || './uploads');

const uploadLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  message: { error: 'Too many uploads, try again later' },
});

function getVideoDuration(filePath) {
  return new Promise((resolve) => {
    const proc = spawn('ffprobe', [
      '-v', 'quiet',
      '-print_format', 'json',
      '-show_format',
      filePath,
    ]);
    let output = '';
    proc.stdout.on('data', (d) => (output += d));
    proc.on('close', () => {
      try {
        const data = JSON.parse(output);
        resolve(parseFloat(data.format?.duration) || null);
      } catch {
        resolve(null);
      }
    });
    proc.on('error', () => resolve(null));
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
      const duration = await getVideoDuration(filePath);

      await prisma.video.create({
        data: {
          userId,
          filename: upload.id,
          originalName,
          size,
          duration,
          path: filePath,
        },
      });
    } catch (err) {
      console.error('tus onUploadFinish error:', err);
    }
    return res;
  },
});

router.all('/upload*', requireAuth, uploadLimiter, (req, res) => {
  return tusServer.handle(req, res);
});

router.get('/', requireAuth, async (req, res) => {
  const videos = await prisma.video.findMany({
    where: { userId: req.user.id },
    orderBy: { createdAt: 'desc' },
    select: { id: true, originalName: true, size: true, duration: true, createdAt: true },
  });
  res.json(videos);
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

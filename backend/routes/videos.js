import { Router } from 'express';
import multer from 'multer';
import path from 'path';
import fs from 'fs/promises';
import { PrismaClient } from '@prisma/client';
import rateLimit from 'express-rate-limit';
import { requireAuth } from '../middleware/auth.js';
import { fileURLToPath } from 'url';
import { spawn } from 'child_process';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const prisma = new PrismaClient();
const router = Router();

const uploadDir = path.resolve(process.env.UPLOAD_DIR || './uploads');

const storage = multer.diskStorage({
  destination: async (req, file, cb) => {
    const userDir = path.join(uploadDir, req.user.id);
    await fs.mkdir(userDir, { recursive: true });
    cb(null, userDir);
  },
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname);
    cb(null, `${Date.now()}-${Math.random().toString(36).slice(2)}${ext}`);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: (parseInt(process.env.MAX_FILE_SIZE_MB) || 2048) * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const allowed = ['.mp4', '.mkv', '.mov', '.avi', '.webm', '.flv'];
    if (allowed.includes(path.extname(file.originalname).toLowerCase())) {
      cb(null, true);
    } else {
      cb(new Error('Invalid file type. Allowed: mp4, mkv, mov, avi, webm, flv'));
    }
  },
});

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

router.get('/', requireAuth, async (req, res) => {
  const videos = await prisma.video.findMany({
    where: { userId: req.user.id },
    orderBy: { createdAt: 'desc' },
    select: { id: true, originalName: true, size: true, duration: true, createdAt: true },
  });
  res.json(videos);
});

router.post('/', requireAuth, uploadLimiter, upload.single('video'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file uploaded' });

  const duration = await getVideoDuration(req.file.path);

  const video = await prisma.video.create({
    data: {
      userId: req.user.id,
      filename: req.file.filename,
      originalName: req.file.originalname,
      size: req.file.size,
      duration,
      path: req.file.path,
    },
  });

  res.status(201).json({
    id: video.id,
    originalName: video.originalName,
    size: video.size,
    duration: video.duration,
    createdAt: video.createdAt,
  });
});

router.delete('/:id', requireAuth, async (req, res) => {
  const video = await prisma.video.findFirst({
    where: { id: req.params.id, userId: req.user.id },
  });
  if (!video) return res.status(404).json({ error: 'Video not found' });

  await prisma.video.delete({ where: { id: video.id } });

  try {
    await fs.unlink(video.path);
  } catch {
    // File may already be gone — not critical
  }

  res.json({ ok: true });
});

export default router;

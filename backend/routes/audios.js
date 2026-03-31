import { Router } from 'express';
import path from 'path';
import fs from 'fs/promises';
import multer from 'multer';
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
  destination: uploadDir,
  filename: (req, file, cb) => {
    const unique = `audio-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    cb(null, unique);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: 200 * 1024 * 1024 }, // 200 MB
  fileFilter: (req, file, cb) => {
    const allowed = /audio\/(mpeg|mp3|aac|ogg|wav|flac)/i;
    if (allowed.test(file.mimetype) || file.originalname.match(/\.(mp3|aac|ogg|wav|flac)$/i)) {
      cb(null, true);
    } else {
      cb(new Error('Only audio files are allowed'));
    }
  },
});

const uploadLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 30,
  message: { error: 'Too many uploads, try again later' },
});

function getAudioMeta(filePath) {
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
        const duration = parseFloat(data.format?.duration) || null;
        const bitrate = parseInt(data.format?.bit_rate) || null;
        resolve({ duration, bitrate });
      } catch {
        resolve({ duration: null, bitrate: null });
      }
    });
    proc.on('error', () => resolve({ duration: null, bitrate: null }));
  });
}

// Upload MP3/audio file
router.post('/', requireAuth, uploadLimiter, upload.single('audio'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No audio file provided' });

  const filePath = path.join(uploadDir, req.file.filename);

  const existing = await prisma.audio.findFirst({
    where: { userId: req.user.id, originalName: req.file.originalname, size: BigInt(req.file.size) },
  });
  if (existing) {
    await fs.unlink(filePath).catch(() => {});
    return res.status(409).json({ error: 'This file is already uploaded' });
  }

  const { duration, bitrate } = await getAudioMeta(filePath);

  const audio = await prisma.audio.create({
    data: {
      userId: req.user.id,
      filename: req.file.filename,
      originalName: req.file.originalname,
      size: BigInt(req.file.size),
      duration,
      bitrate,
      path: filePath,
    },
  });

  res.status(201).json({ ...audio, size: Number(audio.size) });
});

// List user's audio files
router.get('/', requireAuth, async (req, res) => {
  const audios = await prisma.audio.findMany({
    where: { userId: req.user.id },
    orderBy: { createdAt: 'desc' },
    select: { id: true, originalName: true, size: true, duration: true, bitrate: true, createdAt: true },
  });
  res.json(audios.map(a => ({ ...a, size: Number(a.size) })));
});

// Delete audio file
router.delete('/:id', requireAuth, async (req, res) => {
  const audio = await prisma.audio.findFirst({
    where: { id: req.params.id, userId: req.user.id },
  });
  if (!audio) return res.status(404).json({ error: 'Audio not found' });

  await prisma.audio.delete({ where: { id: audio.id } });

  try {
    await fs.unlink(audio.path);
  } catch {
    // File may already be gone
  }

  res.json({ ok: true });
});

export default router;

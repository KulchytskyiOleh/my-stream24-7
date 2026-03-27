import { spawn } from 'child_process';
import { PrismaClient } from '@prisma/client';
import path from 'path';
import fs from 'fs/promises';

const prisma = new PrismaClient();

// videoId → progress (0-100)
export const transcodingProgress = new Map();

export async function processVideo(videoId) {
  const video = await prisma.video.findUnique({ where: { id: videoId } });
  if (!video) return;

  const inputPath = video.path;
  const outputPath = inputPath + '.transcoded.mp4';

  transcodingProgress.set(videoId, 0);

  try {
    await transcode(inputPath, outputPath, video.duration, videoId);

    // Replace original with transcoded
    await fs.unlink(inputPath);
    await fs.rename(outputPath, inputPath);

    // Get final duration
    const duration = await getVideoDuration(inputPath);

    transcodingProgress.set(videoId, 100);
    await prisma.video.update({
      where: { id: videoId },
      data: { status: 'READY', duration },
    });
    transcodingProgress.delete(videoId);
  } catch (err) {
    console.error(`Transcoding failed for video ${videoId}:`, err.message);
    await fs.unlink(outputPath).catch(() => {});
    await prisma.video.update({
      where: { id: videoId },
      data: { status: 'ERROR' },
    });
    transcodingProgress.delete(videoId);
  }
}

function transcode(inputPath, outputPath, totalDuration, videoId) {
  return new Promise((resolve, reject) => {
    const args = [
      '-i', inputPath,
      '-c:v', 'libx264',
      '-preset', 'veryfast',
      '-g', '48',
      '-keyint_min', '48',
      '-sc_threshold', '0',
      '-c:a', 'aac',
      '-b:a', '128k',
      '-f', 'mp4',
      '-y',
      outputPath,
    ];

    const proc = spawn('ffmpeg', args, { stdio: ['ignore', 'ignore', 'pipe'] });

    proc.stderr.on('data', (data) => {
      if (!totalDuration) return;
      const match = data.toString().match(/time=(\d+):(\d+):(\d+\.\d+)/);
      if (match) {
        const current = parseInt(match[1]) * 3600 + parseInt(match[2]) * 60 + parseFloat(match[3]);
        const pct = Math.min(99, Math.round((current / totalDuration) * 100));
        transcodingProgress.set(videoId, pct);
      }
    });

    proc.on('close', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`FFmpeg exited with code ${code}`));
    });

    proc.on('error', reject);
  });
}

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
        resolve(parseFloat(JSON.parse(output).format?.duration) || null);
      } catch {
        resolve(null);
      }
    });
    proc.on('error', () => resolve(null));
  });
}

import { spawn } from 'child_process';
import { PrismaClient } from '@prisma/client';
import fs from 'fs/promises';

const prisma = new PrismaClient();

// videoId → progress (0-100)
export const transcodingProgress = new Map();

// After upload: check keyframe interval, set READY or NEEDS_TRANSCODE
export async function processVideo(videoId) {
  const video = await prisma.video.findUnique({ where: { id: videoId } });
  if (!video) return;

  try {
    const needsTranscode = await checkNeedsTranscode(video.path);
    await prisma.video.update({
      where: { id: videoId },
      data: { status: needsTranscode ? 'NEEDS_TRANSCODE' : 'READY' },
    });
  } catch (err) {
    console.error(`processVideo check failed for ${videoId}:`, err.message);
    await prisma.video.update({ where: { id: videoId }, data: { status: 'NEEDS_TRANSCODE' } });
  }
}

// User-triggered transcode
export async function transcodeVideo(videoId) {
  const video = await prisma.video.findUnique({ where: { id: videoId } });
  if (!video) return;

  const inputPath = video.path;
  const outputPath = inputPath + '.transcoded.mp4';

  transcodingProgress.set(videoId, 0);
  await prisma.video.update({ where: { id: videoId }, data: { status: 'TRANSCODING' } });

  try {
    await transcode(inputPath, outputPath, video.duration, videoId);

    await fs.unlink(inputPath);
    await fs.rename(outputPath, inputPath);

    const duration = await getVideoDuration(inputPath);

    transcodingProgress.set(videoId, 100);
    await prisma.video.update({ where: { id: videoId }, data: { status: 'READY', duration } });
    transcodingProgress.delete(videoId);
  } catch (err) {
    console.error(`Transcoding failed for video ${videoId}:`, err.message);
    await fs.unlink(outputPath).catch(() => {});
    await prisma.video.update({ where: { id: videoId }, data: { status: 'ERROR' } });
    transcodingProgress.delete(videoId);
  }
}

function checkNeedsTranscode(filePath) {
  return new Promise((resolve) => {
    const proc = spawn('ffprobe', [
      '-v', 'quiet',
      '-select_streams', 'v:0',
      '-show_frames',
      '-show_entries', 'frame=pict_type,pkt_pts_time',
      '-of', 'json',
      '-read_intervals', '%+30',
      filePath,
    ]);
    let output = '';
    proc.stdout.on('data', (d) => (output += d));
    proc.on('close', () => {
      try {
        const frames = JSON.parse(output).frames || [];
        const keyframes = frames
          .filter(f => f.pict_type === 'I')
          .map(f => parseFloat(f.pkt_pts_time));
        if (keyframes.length < 2) return resolve(true);
        let maxInterval = 0;
        for (let i = 1; i < keyframes.length; i++) {
          maxInterval = Math.max(maxInterval, keyframes[i] - keyframes[i - 1]);
        }
        resolve(maxInterval > 4);
      } catch {
        resolve(true);
      }
    });
    proc.on('error', () => resolve(true));
  });
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

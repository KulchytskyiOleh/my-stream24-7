import { spawn } from 'child_process';
import { PrismaClient } from '@prisma/client';
import fs from 'fs/promises';

const prisma = new PrismaClient();

// videoId → progress (0-100)
export const transcodingProgress = new Map();

// audioId → progress (0-100)
export const audioTranscodingProgress = new Map();

// After upload: check keyframe interval, set READY or NEEDS_TRANSCODE
export async function processVideo(videoId) {
  const video = await prisma.video.findUnique({ where: { id: videoId } });
  if (!video) return;

  try {
    const highBitrate = video.bitrate && video.bitrate > 8_000_000;
    const badKeyframes = await checkNeedsTranscode(video.path);
    const needsTranscode = highBitrate || badKeyframes;
    const audioCodec = await getAudioCodec(video.path);
    await prisma.video.update({
      where: { id: videoId },
      data: { status: needsTranscode ? 'NEEDS_TRANSCODE' : 'READY', audioCodec },
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
    const newBitrate = await getVideoBitrate(inputPath);
    const { width, height } = await getVideoDimensions(inputPath);

    transcodingProgress.set(videoId, 100);
    await prisma.video.update({
      where: { id: videoId },
      data: { status: 'READY', duration, audioCodec: 'aac', ...(newBitrate && { bitrate: newBitrate }), ...(width && { width }), ...(height && { height }) },
    });
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
      '-read_intervals', '%+120', // check first 2 minutes
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
        resolve(maxInterval > 3.5); // stricter threshold
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
      '-b:v', '6M',
      '-maxrate', '6M',
      '-bufsize', '12M',
      '-g', '48',
      '-keyint_min', '48',
      '-sc_threshold', '0',
      '-c:a', 'aac',
      '-b:a', '256k',
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

function getVideoBitrate(filePath) {
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
        resolve(parseInt(JSON.parse(output).format?.bit_rate) || null);
      } catch {
        resolve(null);
      }
    });
    proc.on('error', () => resolve(null));
  });
}

function getVideoDimensions(filePath) {
  return new Promise((resolve) => {
    const proc = spawn('ffprobe', [
      '-v', 'quiet',
      '-print_format', 'json',
      '-show_streams',
      '-select_streams', 'v:0',
      filePath,
    ]);
    let output = '';
    proc.stdout.on('data', (d) => (output += d));
    proc.on('close', () => {
      try {
        const stream = JSON.parse(output).streams?.[0];
        resolve({ width: stream?.width ?? null, height: stream?.height ?? null });
      } catch {
        resolve({ width: null, height: null });
      }
    });
    proc.on('error', () => resolve({ width: null, height: null }));
  });
}

// After audio upload: check codec and bitrate, set READY or NEEDS_PROCESSING
export async function processAudio(audioId) {
  const audio = await prisma.audio.findUnique({ where: { id: audioId } });
  if (!audio) return;

  try {
    const codec = await getAudioCodec(audio.path);
    const needsProcessing = codec !== 'aac' || (audio.bitrate && audio.bitrate > 128_000);
    await prisma.audio.update({
      where: { id: audioId },
      data: { status: needsProcessing ? 'NEEDS_PROCESSING' : 'READY' },
    });
  } catch (err) {
    console.error(`processAudio check failed for ${audioId}:`, err.message);
    await prisma.audio.update({ where: { id: audioId }, data: { status: 'NEEDS_PROCESSING' } });
  }
}

// User-triggered audio transcode to AAC 128k
export async function transcodeAudio(audioId) {
  const audio = await prisma.audio.findUnique({ where: { id: audioId } });
  if (!audio) return;

  const inputPath = audio.path;
  const outputPath = inputPath + '.transcoded.m4a';

  audioTranscodingProgress.set(audioId, 0);
  await prisma.audio.update({ where: { id: audioId }, data: { status: 'PROCESSING_IN_PROGRESS' } });

  try {
    await transcodeAudioFile(inputPath, outputPath, audio.duration, audioId);

    await fs.unlink(inputPath);
    await fs.rename(outputPath, inputPath);

    const duration = await getVideoDuration(inputPath);
    const newBitrate = await getVideoBitrate(inputPath);

    audioTranscodingProgress.set(audioId, 100);
    await prisma.audio.update({
      where: { id: audioId },
      data: { status: 'READY', duration: duration ?? audio.duration, ...(newBitrate && { bitrate: newBitrate }) },
    });
    audioTranscodingProgress.delete(audioId);
  } catch (err) {
    console.error(`Audio transcode failed for ${audioId}:`, err.message);
    await fs.unlink(outputPath).catch(() => {});
    await prisma.audio.update({ where: { id: audioId }, data: { status: 'ERROR' } });
    audioTranscodingProgress.delete(audioId);
  }
}

function transcodeAudioFile(inputPath, outputPath, totalDuration, audioId) {
  return new Promise((resolve, reject) => {
    const args = [
      '-i', inputPath,
      '-c:a', 'aac',
      '-b:a', '128k',
      '-vn',
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
        audioTranscodingProgress.set(audioId, pct);
      }
    });

    proc.on('close', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`FFmpeg exited with code ${code}`));
    });

    proc.on('error', reject);
  });
}

function getAudioCodec(filePath) {
  return new Promise((resolve) => {
    const proc = spawn('ffprobe', [
      '-v', 'quiet',
      '-print_format', 'json',
      '-show_streams',
      '-select_streams', 'a:0',
      filePath,
    ]);
    let output = '';
    proc.stdout.on('data', (d) => (output += d));
    proc.on('close', () => {
      try {
        resolve(JSON.parse(output).streams?.[0]?.codec_name ?? null);
      } catch {
        resolve(null);
      }
    });
    proc.on('error', () => resolve(null));
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

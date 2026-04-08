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
    const [badKeyframes, audioCodec, fps] = await Promise.all([
      checkNeedsTranscode(video.path),
      getAudioCodec(video.path),
      getVideoFps(video.path),
    ]);
    const needsTranscode = highBitrate || badKeyframes;
    await prisma.video.update({
      where: { id: videoId },
      data: { status: needsTranscode ? 'NEEDS_TRANSCODE' : 'READY', audioCodec, fps },
    });
  } catch (err) {
    console.error(`processVideo check failed for ${videoId}:`, err.message);
    await prisma.video.update({ where: { id: videoId }, data: { status: 'NEEDS_TRANSCODE' } });
  }
}

// User-triggered transcode
export async function transcodeVideo(videoId, targetBitrate = null) {
  const video = await prisma.video.findUnique({ where: { id: videoId } });
  if (!video) return;

  const inputPath = video.path;
  const outputPath = inputPath + '.transcoded.mp4';

  transcodingProgress.set(videoId, 0);
  await prisma.video.update({ where: { id: videoId }, data: { status: 'TRANSCODING' } });

  try {
    const fps = await getVideoFps(inputPath);
    const { width, height } = video.width && video.height
      ? { width: video.width, height: video.height }
      : await getVideoDimensions(inputPath);
    const bitrateParams = getBitrateParams(width, height, fps);
    if (targetBitrate) bitrateParams.bitrate = `${targetBitrate}k`;

    await transcode(inputPath, outputPath, video.duration, videoId, bitrateParams);

    await fs.unlink(inputPath);
    await fs.rename(outputPath, inputPath);

    const duration = await getVideoDuration(inputPath);
    const newBitrate = await getVideoBitrate(inputPath);
    const { width: newWidth, height: newHeight } = await getVideoDimensions(inputPath);
    const newFps = await getVideoFps(inputPath);

    transcodingProgress.set(videoId, 100);
    await prisma.video.update({
      where: { id: videoId },
      data: { status: 'READY', duration, audioCodec: 'aac', fps: newFps, ...(newBitrate && { bitrate: newBitrate }), ...(newWidth && { width: newWidth }), ...(newHeight && { height: newHeight }) },
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

function getVideoFps(filePath) {
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
        const raw = stream?.r_frame_rate ?? '30/1';
        const [num, den] = raw.split('/').map(Number);
        resolve(den ? num / den : 30);
      } catch {
        resolve(30);
      }
    });
    proc.on('error', () => resolve(30));
  });
}

function getBitrateParams(width, height, fps) {
  const is60 = fps > 40;
  const w = width ?? 1920;

  if (w >= 3840) {
    return is60
      ? { minrate: '18000k', bitrate: '22000k', maxrate: '25000k', bufsize: '50000k', gop: 120 }
      : { minrate: '13000k', bitrate: '16000k', maxrate: '18000k', bufsize: '36000k', gop: 60 };
  }
  if (w >= 2560) {
    return is60
      ? { minrate: '10000k', bitrate: '12000k', maxrate: '13000k', bufsize: '26000k', gop: 120 }
      : { minrate: '7000k',  bitrate: '9000k',  maxrate: '10000k', bufsize: '20000k', gop: 60 };
  }
  if (w >= 1920) {
    return is60
      ? { minrate: '6000k', bitrate: '6500k', maxrate: '7000k', bufsize: '14000k', gop: 120 }
      : { minrate: '4500k', bitrate: '5500k', maxrate: '6000k', bufsize: '12000k', gop: 60 };
  }
  if (w >= 1280) {
    return is60
      ? { minrate: '3500k', bitrate: '5000k', maxrate: '6000k', bufsize: '12000k', gop: 120 }
      : { minrate: '2500k', bitrate: '3500k', maxrate: '4000k', bufsize: '8000k',  gop: 60 };
  }
  return { minrate: '2000k', bitrate: '3000k', maxrate: '3500k', bufsize: '7000k', gop: 60 };
}

function transcode(inputPath, outputPath, totalDuration, videoId, bitrateParams) {
  return new Promise((resolve, reject) => {
    const { minrate, bitrate, maxrate, bufsize, gop } = bitrateParams;
    const args = [
      '-i', inputPath,
      '-c:v', 'libx264',
      '-preset', 'veryfast',
      '-b:v', bitrate,
      '-minrate', minrate,
      '-maxrate', maxrate,
      '-bufsize', bufsize,
      '-g', String(gop),
      '-keyint_min', String(gop),
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

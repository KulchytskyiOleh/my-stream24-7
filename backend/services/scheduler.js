import { PrismaClient } from '@prisma/client';
import { startStream, stopStream, isStreamRunning } from './ffmpeg.js';

const prisma = new PrismaClient();

export function startScheduler() {
  setInterval(runScheduler, 30_000);
  console.log('Scheduler started (30s interval)');
}

async function runScheduler() {
  const now = new Date();

  // Start scheduled streams that are OFFLINE and past their start time
  const toStart = await prisma.stream.findMany({
    where: { scheduleStart: { lte: now }, status: 'OFFLINE' },
  });

  for (const stream of toStart) {
    await prisma.stream.update({ where: { id: stream.id }, data: { scheduleStart: null } });
    if (!isStreamRunning(stream.id)) {
      try {
        await startStream(stream.id);
        console.log(`Scheduler: started stream ${stream.id} (${stream.name})`);
      } catch (err) {
        console.error(`Scheduler: failed to start stream ${stream.id}:`, err.message);
      }
    }
  }

  // Stop scheduled streams that are ONLINE and past their stop time
  const toStop = await prisma.stream.findMany({
    where: { scheduleStop: { lte: now }, status: 'ONLINE' },
  });

  for (const stream of toStop) {
    await prisma.stream.update({ where: { id: stream.id }, data: { scheduleStop: null } });
    try {
      await stopStream(stream.id);
      console.log(`Scheduler: stopped stream ${stream.id} (${stream.name})`);
    } catch (err) {
      console.error(`Scheduler: failed to stop stream ${stream.id}:`, err.message);
    }
  }
}

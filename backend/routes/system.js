import { Router } from 'express';
import os from 'os';
import { exec } from 'child_process';
import { promisify } from 'util';
import { requireAuth } from '../middleware/auth.js';

const execAsync = promisify(exec);
const router = Router();

router.get('/stats', requireAuth, async (req, res) => {
  const totalMem = os.totalmem();
  const freeMem = os.freemem();
  const loadAvg = os.loadavg();
  const cpuCount = os.cpus().length;

  let disk = null;
  try {
    const { stdout } = await execAsync('df -k / | tail -1');
    const [, total, used, avail] = stdout.trim().split(/\s+/);
    disk = {
      total: parseInt(total) * 1024,
      used: parseInt(used) * 1024,
      avail: parseInt(avail) * 1024,
    };
  } catch {}

  res.json({
    ram: { total: totalMem, used: totalMem - freeMem, free: freeMem },
    cpu: { load1: loadAvg[0], load5: loadAvg[1], cores: cpuCount },
    disk,
  });
});

export default router;

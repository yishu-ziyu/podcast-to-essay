import { runProcess } from './process-runner.mjs';

export function formatDuration(seconds) {
  const total = Math.floor(Number(seconds));
  if (!Number.isFinite(total) || total < 0) return null;
  const pad = (n) => String(n).padStart(2, '0');
  return `${pad(Math.floor(total / 3600))}:${pad(Math.floor((total % 3600) / 60))}:${pad(total % 60)}`;
}

// Duration is display-only: an unreadable file or a missing ffprobe yields null, never an error.
export async function probeDuration(file) {
  try {
    const out = await runProcess(process.env.FFPROBE_BIN || 'ffprobe', [
      '-v', 'error', '-show_entries', 'format=duration', '-of', 'default=noprint_wrappers=1:nokey=1', file,
    ], { timeoutMs: 30 * 1000 });
    return formatDuration(parseFloat(String(out).trim()));
  } catch {
    return null;
  }
}

import fsp from 'node:fs/promises';
import path from 'node:path';

export function createQuotaStore(file, limits, today) {
  const rows = new Map();
  let pending = null;

  function prune() {
    const day = today();
    for (const [key, row] of rows) if (!row || row.date !== day) rows.delete(key);
  }

  async function load() {
    try {
      const saved = JSON.parse(await fsp.readFile(file, 'utf8'));
      const day = today();
      for (const [key, row] of Object.entries(saved)) {
        if (row && row.date === day) rows.set(key, row);
      }
    } catch {
      // First run has no quota file yet.
    }
  }

  function persist() {
    if (pending) return;
    pending = setTimeout(() => {
      pending = null;
      prune();
      fsp.mkdir(path.dirname(file), { recursive: true })
        .then(() => fsp.writeFile(file, JSON.stringify(Object.fromEntries(rows), null, 2), 'utf8'))
        .catch(() => {});
    }, 500);
    pending.unref?.();
  }

  function entry(key) {
    const day = today();
    let row = rows.get(key);
    if (!row || row.date !== day) {
      row = { date: day, ingest: 0, transcribe: 0, clean: 0 };
      rows.set(key, row);
    }
    return row;
  }

  function left(key) {
    const row = entry(key);
    return {
      ingest: Math.max(0, limits.ingest - row.ingest),
      transcribe: Math.max(0, limits.transcribe - row.transcribe),
      clean: Math.max(0, limits.clean - row.clean),
    };
  }

  function take(key, kind) {
    const remaining = left(key);
    if (remaining[kind] <= 0) return '游客每日额度已用完，明天再来。长期或大量使用建议自部署。';
    entry(key)[kind] += 1;
    persist();
    return null;
  }

  return { load, left, take, limits };
}

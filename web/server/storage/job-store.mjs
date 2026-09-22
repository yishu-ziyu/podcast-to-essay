import fsp from 'node:fs/promises';
import path from 'node:path';

function isJobFile(name) {
  return name.endsWith('.json') && !name.includes('.tmp');
}

export function createJobStore(dir) {
  const cache = new Map();
  // ponytail: one write at a time. Progress lines otherwise share one temp name and rename throws ENOENT, which kills the process. Upgrade path: a lock per job id.
  let writeChain = Promise.resolve();
  let writeSeq = 0;

  async function load() {
    cache.clear();
    await fsp.mkdir(dir, { recursive: true });
    const names = await fsp.readdir(dir);
    for (const name of names) {
      if (!isJobFile(name)) continue;
      try {
        const job = JSON.parse(await fsp.readFile(path.join(dir, name), 'utf8'));
        if (job?.id) cache.set(job.id, job);
      } catch {
        // A half-written file must not become a job. Atomic rename avoids this;
        // ignore anything that still isn't JSON.
      }
    }
    return [...cache.values()];
  }

  function write(job) {
    const run = writeChain.then(() => writeBody(job));
    writeChain = run.then(() => {}, () => {});
    return run;
  }

  async function writeBody(job) {
    await fsp.mkdir(dir, { recursive: true });
    const dest = path.join(dir, `${job.id}.json`);
    const tmp = `${dest}.${process.pid}.${writeSeq += 1}.tmp`;
    const fh = await fsp.open(tmp, 'w');
    try {
      await fh.writeFile(JSON.stringify(job));
      await fh.sync();
    } finally {
      await fh.close();
    }
    await fsp.rename(tmp, dest);
    cache.set(job.id, job);
    return job;
  }

  async function recover(hasDurableResult) {
    await load();
    const changed = [];
    for (const job of cache.values()) {
      if (job.state !== 'running' && job.state !== 'paused') continue;
      // The child process is gone. A paused task cannot be SIGCONT'd after restart.
      const done = await hasDurableResult(job);
      const next = {
        ...job,
        state: done ? 'succeeded' : 'interrupted',
        stage: done ? (job.type === 'ingest' ? 'waiting_transcription' : job.stage) : job.stage,
        progress: null,
        finishedAt: done ? new Date().toISOString() : job.finishedAt,
        updatedAt: new Date().toISOString(),
        error: done ? null : job.error,
      };
      await write(next);
      changed.push(next);
    }
    return changed;
  }

  return {
    dir,
    load,
    write,
    recover,
    get(id) { return cache.get(id) || null; },
    all() { return [...cache.values()]; },
  };
}

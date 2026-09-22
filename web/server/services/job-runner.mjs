import { randomUUID } from 'node:crypto';
import { ACTIVE_STATES } from '../domain/job.mjs';

export function createJobRunner({ store, handlers, limits, log = () => {} }) {
  const cap = { ingest: 1, transcription: 1, article: 1, ...limits };
  const waiting = { ingest: [], transcription: [], article: [] };
  const running = { ingest: 0, transcription: 0, article: 0 };
  const listeners = new Map();
  const controls = new Map();
  // ponytail: one accept at a time in this process. Upgrade path: lock per episode key if accept itself starts doing network I/O.
  let acceptTail = Promise.resolve();

  function emit(job) {
    for (const fn of listeners.get(job.id) || []) {
      try { fn(job); } catch { /* a closed response must not stop the job */ }
    }
  }

  async function save(job, patch = {}) {
    const next = { ...job, ...patch, updatedAt: new Date().toISOString() };
    await store.write(next);
    emit(next);
    return next;
  }

  function cachedDuplicate({ requestId, type, episodeSlug, owner }) {
    const jobs = store.all();
    const who = owner || 'user';
    if (requestId) {
      const same = jobs.find((job) => job.requestId && job.requestId === requestId && (job.owner || 'user') === who);
      if (same) return same;
    }
    if (episodeSlug && type) {
      const active = jobs.find((job) => job.type === type && job.episodeSlug === episodeSlug && ACTIVE_STATES.has(job.state));
      if (!active) return null;
      if ((active.owner || 'user') !== who) {
        throw Object.assign(new Error('这一期已经有进行中的任务。'), { code: 'conflict' });
      }
      return active;
    }
    return null;
  }

  function enqueue(job) {
    const queue = waiting[job.type];
    if (!queue) return;
    if (!queue.includes(job.id)) queue.push(job.id);
    pump(job.type);
  }

  function pump(type) {
    while (running[type] < cap[type]) {
      const id = waiting[type].shift();
      if (!id) return;
      const job = store.get(id);
      if (!job || job.state !== 'queued') continue;
      running[type] += 1;
      void run(job).finally(() => {
        running[type] -= 1;
        pump(type);
      });
    }
  }

  async function run(job) {
    const started = Date.now();
    let current = await save(job, { state: 'running', startedAt: job.startedAt || new Date().toISOString() });
    log({ jobId: current.id, episodeSlug: current.episodeSlug, stage: current.stage, result: 'running' });
    const tools = {
      report: async (patch) => {
        const latest = store.get(current.id) || current;
        if (latest.state === 'cancelled') return latest;
        current = await save(latest, patch);
        return current;
      },
      control(api) { controls.set(job.id, api); },
      signal: null,
    };
    try {
      await handlers[job.type](current, tools);
      current = store.get(job.id) || current;
      if (current.state === 'running') {
        current = await save(current, { state: 'succeeded', finishedAt: new Date().toISOString(), progress: null, error: null });
      }
      log({
        jobId: current.id,
        episodeSlug: current.episodeSlug,
        stage: current.stage,
        durationMs: Date.now() - started,
        result: current.state,
        errorCode: current.error?.code || null,
      });
    } catch (err) {
      current = store.get(job.id) || current;
      if (current.state === 'cancelled') return current;
      const failure = err.failure || {
        code: 'internal_error',
        userMessage: '服务器内部出错。请稍后重试。',
        retryable: true,
        stage: current.stage,
      };
      failure.diagnosticId = job.id;
      current = await save(current, { state: 'failed', error: failure, finishedAt: new Date().toISOString(), progress: null });
      log({
        jobId: current.id,
        episodeSlug: current.episodeSlug,
        stage: current.stage,
        durationMs: Date.now() - started,
        result: 'failed',
        errorCode: failure.code,
        diagnosticId: job.id,
      });
    } finally {
      controls.delete(job.id);
    }
    return current;
  }

  function accept(input, options) {
    const run = acceptTail.then(() => acceptNow(input, options));
    acceptTail = run.then(() => {}, () => {});
    return run;
  }

  async function acceptNow(input, { charge } = {}) {
    const duplicate = cachedDuplicate(input);
    if (duplicate) return { job: duplicate, created: false };
    if (charge) {
      const denied = await charge();
      if (denied) throw Object.assign(new Error(denied), { code: 'quota' });
    }
    const now = new Date().toISOString();
    const job = await save({
      id: input.id || randomUUID(),
      type: input.type,
      episodeSlug: input.episodeSlug,
      sourceUrl: input.sourceUrl || null,
      state: 'queued',
      stage: input.stage || 'checking_url',
      progress: null,
      error: null,
      createdAt: now,
      updatedAt: now,
      startedAt: null,
      finishedAt: null,
      requestId: input.requestId || null,
      owner: input.owner || 'user',
      checkpoint: null,
      result: null,
      bindExisting: Boolean(input.bindExisting),
    }, {});
    enqueue(job);
    return { job, created: true };
  }

  async function boot(hasDurableResult) {
    await store.recover(hasDurableResult);
    for (const job of store.all()) {
      if (job.state === 'queued') enqueue(job);
    }
  }

  function watch(id, fn) {
    let set = listeners.get(id);
    if (!set) listeners.set(id, set = new Set());
    set.add(fn);
    const current = store.get(id);
    if (current) fn(current);
    return () => set.delete(fn);
  }

  function activeJob(type, episodeSlug) {
    return store.all().find((job) => job.type === type && job.episodeSlug === episodeSlug && ACTIVE_STATES.has(job.state)) || null;
  }

  async function pause(id) {
    const job = store.get(id);
    if (!job || job.state !== 'running') return job;
    controls.get(id)?.pause?.();
    return save(job, { state: 'paused' });
  }

  async function resumePaused(id) {
    const job = store.get(id);
    if (!job || job.state !== 'paused') return job;
    controls.get(id)?.resume?.();
    return save(job, { state: 'running' });
  }

  async function continueInterrupted(id) {
    const job = store.get(id);
    if (!job || job.state !== 'interrupted') return job;
    const next = await save(job, { state: 'queued', error: null, finishedAt: null, progress: null });
    enqueue(next);
    return next;
  }

  async function cancelEpisode(episodeSlug) {
    for (const job of store.all()) {
      if (job.episodeSlug !== episodeSlug || !ACTIVE_STATES.has(job.state)) continue;
      controls.get(job.id)?.kill?.();
      await save(job, { state: 'cancelled', finishedAt: new Date().toISOString() });
    }
  }

  function runningCount(type) {
    return running[type] || 0;
  }

  async function stop() {
    for (const job of store.all()) {
      if (job.state !== 'running' && job.state !== 'paused') continue;
      controls.get(job.id)?.kill?.();
      await save(job, { state: 'interrupted', progress: null });
    }
  }

  return {
    accept,
    boot,
    watch,
    pause,
    resumePaused,
    continueInterrupted,
    cancelEpisode,
    activeJob,
    runningCount,
    stop,
    get: (id) => store.get(id),
  };
}

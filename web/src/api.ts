export type EpisodeStatus = 'empty' | 'uploaded' | 'transcribed' | 'cleaned';

export interface Episode {
  slug: string;
  title: string | null;
  duration: string | null;
  source: string | null;
  sourceUrl?: string | null;
  originalName?: string | null;
  hasRaw: boolean;
  hasSrt: boolean;
  chunkCount: number;
  completedChunks: number;
  transcription: {
    state: 'running' | 'paused' | 'failed' | 'interrupted';
    error: string | null;
    jobId?: string | null;
    diagnosticId?: string | null;
  } | null;
  cleaned: boolean;
  cleanedAt: number | null;
  article: {
    provider: string;
    model: string;
    generatedAt: string;
    stats: { chars: number; paragraphs: number; headings: number };
    paraMap?: ([number, number] | null)[] | null;
  } | null;
  status: EpisodeStatus;
}

// Relative so the app also works behind a reverse-proxy path prefix (e.g. /lcw/).
const API = 'api';

export interface Session {
  owner: boolean;
  guest: {
    limits: { ingest: number; transcribe: number; clean: number };
    left: { ingest: number; transcribe: number; clean: number };
  } | null;
}

export async function getSession(): Promise<Session> {
  const r = await fetch(`${API}/health`);
  const d = (await r.json()) as { locked?: boolean; owner?: boolean; guest?: Session['guest'] };
  if (d.locked) throw new Error('locked');
  return { owner: Boolean(d.owner), guest: d.guest || null };
}

export async function login(password: string): Promise<void> {
  const r = await fetch(`${API}/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ password }),
  });
  if (!r.ok) throw new Error('密码不对。');
}

async function json<T>(r: Response): Promise<T> {
  if (!r.ok) {
    const e = await r.json().catch(() => ({}));
    throw new Error(e.error || `HTTP ${r.status}`);
  }
  return r.json() as Promise<T>;
}

export async function listEpisodes(): Promise<Episode[]> {
  const r = await fetch(`${API}/episodes`);
  const d = await json<{ episodes: Episode[] }>(r);
  return d.episodes;
}

export async function createEpisode(slug: string): Promise<void> {
  await json(await fetch(`${API}/episodes`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ slug }),
  }));
}

export async function deleteEpisode(slug: string): Promise<void> {
  await fetch(`${API}/episodes/${encodeURIComponent(slug)}`, { method: 'DELETE' });
}

export async function updateEpisodeTitle(slug: string, title: string): Promise<void> {
  await json(await fetch(`${API}/episodes/${encodeURIComponent(slug)}`, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ title }),
  }));
}

const AUDIO_EXT: Record<string, string> = {
  'audio/mpeg': '.mp3',
  'audio/mp3': '.mp3',
  'audio/wav': '.wav',
  'audio/x-wav': '.wav',
  'audio/wave': '.wav',
  'audio/mp4': '.m4a',
  'audio/x-m4a': '.m4a',
  'audio/aac': '.aac',
  'audio/flac': '.flac',
  'audio/ogg': '.ogg',
  'audio/opus': '.opus',
  'audio/webm': '.weba',
  'audio/x-ms-wma': '.wma',
  'audio/aiff': '.aiff',
  'audio/amr': '.amr',
  'video/mp4': '.mp4',
  'video/quicktime': '.mov',
  'video/webm': '.webm',
  'video/x-matroska': '.mkv',
  'video/x-msvideo': '.avi',
};

const BLOCK_EXT = /\.(js|mjs|cjs|sh|bash|zsh|ps1|bat|cmd|exe|php|html|htm|svg)$/i;

/** HTTP headers must be ISO-8859-1. Never put the original Chinese name here. */
export function sourceNameForUpload(file: File): string {
  const m = file.name.match(/(\.[a-z0-9]{2,5})$/i);
  let ext = m ? m[1].toLowerCase() : (AUDIO_EXT[file.type] || '');
  if (!ext || BLOCK_EXT.test(ext)) ext = AUDIO_EXT[file.type] || '.bin';
  return `source${ext}`;
}

export async function uploadAudio(slug: string, file: File): Promise<void> {
  const r = await fetch(`${API}/episodes/${encodeURIComponent(slug)}/audio`, {
    method: 'POST',
    headers: {
      'x-filename': sourceNameForUpload(file),
      'x-original-name': encodeURIComponent(file.name),
    },
    body: file,
  });
  if (!r.ok) {
    const e = await r.json().catch(() => ({}));
    throw new Error((e as { error?: string }).error || 'upload failed');
  }
}

export interface JobError {
  code: string;
  userMessage: string;
  retryable: boolean;
  stage: string;
  diagnosticId: string;
}

export interface JobView {
  id: string;
  type: string;
  episodeSlug: string;
  state: 'queued' | 'running' | 'paused' | 'succeeded' | 'failed' | 'interrupted' | 'cancelled';
  stage: string;
  progress: number | null;
  label: string;
  error: JobError | null;
  result: { provider?: string; model?: string } | null;
}

const TERMINAL = new Set(['succeeded', 'failed', 'interrupted', 'cancelled']);

export async function submitIngest(url: string): Promise<JobView> {
  const requestId = crypto.randomUUID();
  const r = await fetch(`${API}/ingests`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ url, requestId }),
  });
  return readJob(r);
}

export async function getJob(id: string): Promise<JobView> {
  const r = await fetch(`${API}/jobs/${encodeURIComponent(id)}`);
  const body = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error((body as { error?: string }).error || '任务状态读取失败');
  return (body as { job: JobView }).job;
}

export async function listJobs(): Promise<JobView[]> {
  const r = await fetch(`${API}/jobs`);
  const body = await r.json().catch(() => ({ jobs: [] }));
  if (!r.ok) return [];
  return (body as { jobs: JobView[] }).jobs || [];
}

export async function continueJob(id: string): Promise<JobView> {
  const r = await fetch(`${API}/jobs/${encodeURIComponent(id)}/continue`, { method: 'POST' });
  return readJob(r);
}

export function watchJob(id: string, onJob: (job: JobView) => void): () => void {
  let stop = false;
  const source = new EventSource(`${API}/jobs/${encodeURIComponent(id)}/events`);
  source.onmessage = (event) => {
    try { onJob(JSON.parse(event.data) as JobView); } catch { /* ignore a partial frame */ }
  };
  source.onerror = () => { source.close(); };
  const timer = window.setInterval(() => {
    if (stop) return;
    void getJob(id).then(onJob).catch(() => {});
  }, 1500);
  return () => {
    stop = true;
    window.clearInterval(timer);
    source.close();
  };
}

async function readJob(r: Response): Promise<JobView> {
  const body = await r.json().catch(() => ({})) as { error?: string; failure?: JobError; job?: JobView };
  if (!r.ok || !body.job) {
    const err = new Error(body.failure?.userMessage || body.error || `HTTP ${r.status}`);
    (err as Error & { failure?: JobError }).failure = body.failure;
    throw err;
  }
  return body.job;
}

export function jobSettled(job: JobView) {
  return TERMINAL.has(job.state);
}

export async function getTranscript(slug: string, type: 'raw' | 'srt' | 'cleaned'): Promise<string> {
  const r = await fetch(`${API}/episodes/${encodeURIComponent(slug)}/transcript?type=${type}`);
  if (!r.ok) throw new Error('transcript not found');
  return r.text();
}

export async function cleanEpisode(slug: string): Promise<JobView> {
  const r = await fetch(`${API}/episodes/${encodeURIComponent(slug)}/clean`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ requestId: crypto.randomUUID() }),
  });
  return readJob(r);
}

export async function controlTranscription(slug: string, action: 'pause' | 'resume'): Promise<{ paused: boolean }> {
  return json<{ ok: boolean; paused: boolean }>(await fetch(
    `${API}/episodes/${encodeURIComponent(slug)}/transcription/${action}`,
    { method: 'POST' },
  ));
}

export async function startTranscription(slug: string): Promise<JobView> {
  const r = await fetch(`${API}/episodes/${encodeURIComponent(slug)}/transcribe`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ requestId: crypto.randomUUID() }),
  });
  return readJob(r);
}

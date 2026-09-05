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
    state: 'running' | 'paused' | 'failed';
    error: string | null;
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

export interface TranscribeHandlers {
  onLog: (line: string) => void;
  onDone: (code: number) => void;
}

export interface IngestHandlers {
  onProgress: (message: string) => void;
  onReady: (episode: { slug: string; title: string }) => void;
  onFailed: (message: string) => void;
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

export function ingestUrlStream(url: string, h: IngestHandlers): void {
  fetch(`${API}/ingests`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ url }),
  })
    .then(async (r) => {
      if (!r.ok) {
        const e = await r.json().catch(() => ({}));
        throw new Error((e as { error?: string }).error || `HTTP ${r.status}`);
      }
      if (!r.body) { h.onFailed('下载中断'); return; }
      const reader = r.body.getReader();
      const decoder = new TextDecoder();
      let buf = '';
      let settled = false;
      const pump = (): void => {
        reader.read().then(({ done, value }) => {
          if (done) {
            if (!settled) h.onFailed('导入未完成，请重试。');
            return;
          }
          buf += decoder.decode(value, { stream: true });
          let idx: number;
          while ((idx = buf.indexOf('\n\n')) >= 0) {
            const chunk = buf.slice(0, idx);
            buf = buf.slice(idx + 2);
            let event = 'progress';
            const dataLines: string[] = [];
            for (const line of chunk.split('\n')) {
              if (line.startsWith('event:')) event = line.slice(6).trim();
              else if (line.startsWith('data:')) dataLines.push(line.slice(5).trim());
            }
            const text = dataLines.join('\n');
            const data = JSON.parse(text) as { message?: string; slug?: string; title?: string };
            if (event === 'ready' && data.slug && data.title) { settled = true; h.onReady({ slug: data.slug, title: data.title }); }
            else if (event === 'failed') { settled = true; h.onFailed(data.message || '未获取到可转录的音频'); }
            else if (event === 'progress') h.onProgress(data.message || '正在准备音轨…');
          }
          pump();
        });
      };
      pump();
    })
    .catch(() => { h.onFailed('无法连接下载服务，请重试。'); });
}

export async function getTranscript(slug: string, type: 'raw' | 'srt' | 'cleaned'): Promise<string> {
  const r = await fetch(`${API}/episodes/${encodeURIComponent(slug)}/transcript?type=${type}`);
  if (!r.ok) throw new Error('transcript not found');
  return r.text();
}

export async function cleanEpisode(slug: string): Promise<{ method: string; provider: string; model: string }> {
  const r = await fetch(`${API}/episodes/${encodeURIComponent(slug)}/clean`, { method: 'POST' });
  return json<{ ok: boolean; method: string; provider: string; model: string }>(r);
}

export async function controlTranscription(slug: string, action: 'pause' | 'resume'): Promise<{ paused: boolean }> {
  return json<{ ok: boolean; paused: boolean }>(await fetch(
    `${API}/episodes/${encodeURIComponent(slug)}/transcription/${action}`,
    { method: 'POST' },
  ));
}

// POST with SSE log streaming (fetch + ReadableStream reader).
export function transcribeStream(slug: string, h: TranscribeHandlers): void {
  fetch(`${API}/episodes/${encodeURIComponent(slug)}/transcribe`, { method: 'POST' })
    .then(async (r) => {
      if (!r.ok) {
        const e = await r.json().catch(() => ({}));
        throw new Error((e as { error?: string }).error || '转录未启动');
      }
      if (!r.body) { h.onDone(1); return; }
      const reader = r.body.getReader();
      const decoder = new TextDecoder();
      let buf = '';
      const pump = (): void => {
        reader.read().then(({ done, value }) => {
          if (done) return;
          buf += decoder.decode(value, { stream: true });
          let idx: number;
          while ((idx = buf.indexOf('\n\n')) >= 0) {
            const chunk = buf.slice(0, idx);
            buf = buf.slice(idx + 2);
            let event = 'log';
            const dataLines: string[] = [];
            for (const line of chunk.split('\n')) {
              if (line.startsWith('event:')) event = line.slice(6).trim();
              else if (line.startsWith('data:')) dataLines.push(line.slice(5).trim());
            }
            const text = dataLines.join('\n');
            if (event === 'done') h.onDone(Number(text) || 0);
            else h.onLog(text);
          }
          pump();
        });
      };
      pump();
    })
    .catch((e) => { h.onLog(e.message); h.onDone(1); });
}

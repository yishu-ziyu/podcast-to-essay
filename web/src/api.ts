export type EpisodeStatus = 'empty' | 'uploaded' | 'transcribed' | 'cleaned';

export interface Episode {
  slug: string;
  source: string | null;
  hasRaw: boolean;
  hasSrt: boolean;
  chunkCount: number;
  cleaned: boolean;
  cleanedAt: number | null;
  status: EpisodeStatus;
}

const API = '/api';

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

export async function uploadAudio(slug: string, file: File): Promise<void> {
  await fetch(`${API}/episodes/${encodeURIComponent(slug)}/audio`, {
    method: 'POST',
    headers: { 'x-filename': file.name },
    body: file,
  }).then((r) => { if (!r.ok) throw new Error('upload failed'); });
}

export async function getTranscript(slug: string, type: 'raw' | 'srt' | 'cleaned'): Promise<string> {
  const r = await fetch(`${API}/episodes/${encodeURIComponent(slug)}/transcript?type=${type}`);
  if (!r.ok) throw new Error('transcript not found');
  return r.text();
}

export async function cleanEpisode(slug: string): Promise<{ method: string }> {
  const r = await fetch(`${API}/episodes/${encodeURIComponent(slug)}/clean`, { method: 'POST' });
  return json<{ ok: boolean; file: string; method: string }>(r);
}

export interface TranscribeHandlers {
  onLog: (line: string) => void;
  onDone: (code: number) => void;
}

// POST with SSE log streaming (fetch + ReadableStream reader).
export function transcribeStream(slug: string, h: TranscribeHandlers): void {
  fetch(`${API}/episodes/${encodeURIComponent(slug)}/transcribe`, { method: 'POST' })
    .then((r) => {
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
    .catch((e) => { h.onLog('❌ ' + e.message); h.onDone(1); });
}

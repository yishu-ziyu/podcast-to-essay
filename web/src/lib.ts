import type { Episode } from './api';

export function todayStamp() {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

export function toSlug(input: string) {
  const raw = input.trim().toLowerCase().replace(/\s+/g, '-');
  if (/^\d{4}-\d{2}-\d{2}-/.test(raw)) return raw;
  const topic = raw.replace(/[^a-z0-9._-]/g, '').replace(/^-+|-+$/g, '');
  if (!topic) return '';
  return `${todayStamp()}-${topic}`;
}

function uniqueSlug(base: string, taken: string[]) {
  if (!taken.includes(base)) return base;
  let n = 2;
  while (taken.includes(`${base}-${n}`)) n += 1;
  return `${base}-${n}`;
}

export function slugFromFile(name: string, taken: string[]) {
  const base = name.replace(/\.[^.]+$/, '');
  const slug = toSlug(base) || `${todayStamp()}-audio`;
  return uniqueSlug(slug, taken);
}

export function extractUrl(text: string): string | null {
  const m = String(text || '').match(/https?:\/\/[^\s<>"']+/i);
  if (!m) return null;
  return m[0].replace(/[),.;!?，。]+$/, '');
}

export function slugFromUrl(raw: string, taken: string[]) {
  let u: URL;
  try { u = new URL(raw.trim()); }
  catch { return uniqueSlug(`${todayStamp()}-link`, taken); }
  const host = u.hostname.replace(/^www\./, '').toLowerCase();
  const path = u.pathname;
  const bv = path.match(/\/video\/(bv[\w]+)/i) || raw.match(/(BV[\w]{10})/i);
  if (bv || host.includes('bilibili') || host === 'b23.tv') {
    return uniqueSlug(`${todayStamp()}-${(bv?.[1] || 'bili').toLowerCase()}`, taken);
  }
  const dy = path.match(/\/video\/(\d+)/) || path.match(/\/share\/video\/(\d+)/);
  if (host.includes('douyin') || host.includes('iesdouyin') || host.includes('tiktok')) {
    return uniqueSlug(`${todayStamp()}-dy-${dy?.[1] || 'clip'}`, taken);
  }
  const yt = u.searchParams.get('v')
    || path.match(/\/shorts\/([\w-]+)/)?.[1]
    || (host.includes('youtu.be') ? path.split('/').filter(Boolean)[0] : null);
  if (host.includes('youtube') || host.includes('youtu.be')) {
    return uniqueSlug(`${todayStamp()}-yt-${yt || 'video'}`, taken);
  }
  if (host.includes('xiaoyuzhou')) {
    const id = path.split('/').filter(Boolean).pop() || 'ep';
    return uniqueSlug(`${todayStamp()}-xyz-${id.slice(0, 12)}`, taken);
  }
  const last = (path.split('/').filter(Boolean).pop() || host.split('.')[0] || 'link')
    .replace(/\.[a-z0-9]{2,5}$/i, '')
    .replace(/[^a-zA-Z0-9._-]/g, '')
    .slice(0, 40)
    .toLowerCase();
  return uniqueSlug(`${todayStamp()}-${last || 'link'}`, taken);
}

export function displayName(ep: Episode) {
  if (ep.title) return ep.title;
  if (ep.originalName) return ep.originalName.replace(/\.[^.]+$/, '');
  if (ep.source && !/^source\.[^.]+$/i.test(ep.source)) {
    return ep.source.replace(/\.[^.]+$/, '');
  }
  return '未命名';
}

export function displayDate(ep: Episode) {
  const m = ep.slug.match(/^(\d{4}-\d{2}-\d{2})/);
  return m ? m[1] : '';
}

export function currentStep(ep: Episode | null): 1 | 2 | 3 {
  if (!ep || !ep.source) return 1;
  if (ep.cleaned) return 3;
  if (!ep.hasRaw) return 2;
  return 3;
}

export type ArtUnitKind = 'h2' | 'h3' | 'quote' | 'p';
export interface ArtUnit { kind: ArtUnitKind; text: string; para: number | null; }

/**
 * Must enumerate identically to server articleStructure(), or the paragraph map misaligns.
 * Headings are matched per line, so a heading may be followed by body lines without a blank
 * line between them — those lines still belong to the paragraph right after the heading.
 */
export function articleUnits(text: string): ArtUnit[] {
  const units: ArtUnit[] = [];
  let para = 0;
  let buffer: string[] = [];

  const flush = () => {
    if (!buffer.length) return;
    const quoted = buffer.every((line) => /^>\s?/.test(line));
    const body = buffer.map((line) => line.replace(/^>\s?/, '')).join(' ').trim();
    units.push({ kind: quoted ? 'quote' : 'p', text: body, para: para++ });
    buffer = [];
  };

  for (const rawLine of String(text || '').split('\n')) {
    const line = rawLine.trim();
    if (!line) { flush(); continue; }
    const heading = line.match(/^(#{2,3})\s+(\S.*)$/);
    if (heading) {
      flush();
      units.push({ kind: heading[1] === '###' ? 'h3' : 'h2', text: heading[2].trim(), para: null });
      continue;
    }
    buffer.push(line);
  }
  flush();
  return units;
}

export interface SrtCue { index: number; start: number; end: number; text: string; }

export function parseTimecode(tc: string): number {
  const m = String(tc || '').trim().match(/(\d+):(\d{2}):(\d{2})[,.](\d{1,3})/);
  if (!m) return NaN;
  return Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]) + Number(`0.${m[4]}`);
}

export function parseSrt(srt: string): SrtCue[] {
  const cues: SrtCue[] = [];
  for (const block of String(srt || '').split(/\n\s*\n/)) {
    const lines = block.split('\n').map((l) => l.trim()).filter(Boolean);
    if (lines.length < 2) continue;
    const tline = lines.find((l) => l.includes('-->'));
    if (!tline) continue;
    const [a, b] = tline.split('-->').map((s) => parseTimecode(s));
    if (!Number.isFinite(a) || !Number.isFinite(b) || a > b) continue;
    const text = lines.slice(lines.indexOf(tline) + 1).join(' ').trim();
    if (!text) continue;
    cues.push({ index: cues.length, start: a, end: b, text });
  }
  return cues;
}

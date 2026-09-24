import { useEffect, useState, useRef, ReactNode } from 'react';
import { Episode, JobView, cleanEpisode, getTranscript, jobSettled, updateEpisodeTitle, watchJob } from '../api';
import { displayName, articleUnits, parseSrt, sourceLabel, SrtCue } from '../lib';
import ConfirmDialog from './ConfirmDialog';
import EditableTitle from './EditableTitle';

type Tab = 'cleaned' | 'raw' | 'srt' | 'source';

interface Props { episode: Episode; onCleaned: () => void; onToast: (msg: string | null) => void; }

const labels: Record<Tab, string> = { cleaned: '文章', raw: '初稿', srt: '分段稿', source: '素材' };

function tabsFor(episode: Episode): Tab[] {
  return ['cleaned', ...(episode.hasRaw ? ['raw' as const] : []), ...(episode.hasSrt ? ['srt' as const] : []), 'source'];
}

function renderArticle(text: string): ReactNode {
  return articleUnits(text).map((u, i) => {
    if (u.kind === 'h2') return <h2 key={`h2-${i}`}>{u.text}</h2>;
    if (u.kind === 'h3') return <h3 key={`h3-${i}`}>{u.text}</h3>;
    if (u.kind === 'quote') return <blockquote key={`q-${i}`}>{u.text}</blockquote>;
    return <p key={`p-${i}`}>{u.text}</p>;
  });
}

function SourcePanel({ episode }: { episode: Episode }) {
  const rows: [string, string][] = [];
  if (episode.duration) rows.push(['时长', episode.duration]);
  if (episode.chunkCount) rows.push(['分段', `${episode.chunkCount} 段，每段约 3 分钟`]);
  rows.push(['来源', episode.sourceUrl ? '网页链接' : '本地文件']);
  if (!episode.sourceUrl && episode.originalName) rows.push(['文件名', episode.originalName]);
  if (episode.asr) rows.push(['识别', episode.asr.model]);
  if (episode.article) rows.push(['整理', `${episode.article.model} · ${episode.article.stats.paragraphs} 段 · ${new Date(episode.article.generatedAt).toLocaleDateString('sv-SE')}`]);
  return (
    <div className="source-panel">
      <div className="source-strip">
        <span className="source-icon">♪</span>
        <div><b>{sourceLabel(episode)}</b><small>{displayName(episode)}</small></div>
        {episode.sourceUrl && <a className="button quiet link-button" href={episode.sourceUrl} target="_blank" rel="noreferrer">打开原链接 ↗</a>}
      </div>
      <dl className="source-facts">{rows.map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}</dl>
    </div>
  );
}

type ParaMap = ([number, number] | null)[] | null | undefined;

function validMap(map: ParaMap): ([number, number] | null)[] | null {
  if (!Array.isArray(map) || !map.length) return null;
  if (!map.every((e) => e === null || (Array.isArray(e) && e.length === 2 && Number.isFinite(e[0]) && Number.isFinite(e[1]) && e[0] >= 0 && e[1] >= e[0]))) return null;
  return map;
}

export default function TranscriptViewer({ episode, onCleaned, onToast }: Props) {
  const [tab, setTab] = useState<Tab>('cleaned');
  const [text, setText] = useState('');
  const [loading, setLoading] = useState(true);
  const [cleaning, setCleaning] = useState(false);
  const [cleanError, setCleanError] = useState<string | null>(null);
  const [fresh, setFresh] = useState(false);
  const [verify, setVerify] = useState(false);
  const [srtText, setSrtText] = useState('');
  const [selPara, setSelPara] = useState<number | null>(null);
  const [selCue, setSelCue] = useState<number | null>(null);
  const [openCue, setOpenCue] = useState<number | null>(null);
  const [confirmClean, setConfirmClean] = useState(false);
  const firstAt = useRef(episode.cleanedAt);
  const artRef = useRef<HTMLDivElement>(null);
  const segRef = useRef<HTMLDivElement>(null);

  const load = async (next: Tab) => {
    setTab(next);
    if (next === 'source') { setText(''); setLoading(false); return; }
    setLoading(true);
    try { setText(await getTranscript(episode.slug, next)); }
    catch { setText(''); }
    finally { setLoading(false); }
  };

  useEffect(() => { void load('cleaned'); }, [episode.slug]);

  useEffect(() => {
    if (episode.cleanedAt && episode.cleanedAt !== firstAt.current) {
      firstAt.current = episode.cleanedAt;
      setFresh(true);
      const t = window.setTimeout(() => setFresh(false), 1000);
      return () => window.clearTimeout(t);
    }
  }, [episode.cleanedAt]);

  const clean = async () => {
    if (!episode.hasRaw) return;
    setCleaning(true); setCleanError(null);
    try {
      const job = await cleanEpisode(episode.slug);
      await new Promise<void>((resolve, reject) => {
        const stop = watchJob(job.id, (next: JobView) => {
          if (!jobSettled(next)) return;
          stop();
          if (next.state === 'succeeded') resolve();
          else reject(new Error(next.error?.userMessage || '文章整理没有完成。'));
        });
      });
      await onCleaned();
      await load('cleaned');
      onToast('文章已重新生成。');
    } catch (error) {
      setCleanError((error as Error).message || '文章整理没有完成。');
      onToast('重新整理失败，原文章未被覆盖。');
    }
    finally { setCleaning(false); }
  };

  const rename = async (title: string) => {
    try {
      await updateEpisodeTitle(episode.slug, title);
      await onCleaned();
    } catch (error) {
      onToast('标题未保存：' + (error as Error).message);
      throw error;
    }
  };

  const copy = async () => {
    if (!text) return;
    await navigator.clipboard.writeText(text);
    onToast('已复制。');
  };

  const paraMap = validMap(episode.article?.paraMap);
  const cues: SrtCue[] = verify ? parseSrt(srtText) : [];
  const cuesForPara = (p: number): number[] => {
    const range = paraMap?.[p];
    if (!range) return [];
    return cues.filter((c) => c.start < range[1] && c.end > range[0]).map((c) => c.index);
  };
  const paraForCue = (cue: SrtCue): number | null => {
    if (!paraMap) return null;
    const mid = (cue.start + cue.end) / 2;
    const i = paraMap.findIndex((r) => r && mid >= r[0] && mid <= r[1]);
    return i < 0 ? null : i;
  };
  const exitVerify = () => { setVerify(false); setSelPara(null); setSelCue(null); setOpenCue(null); };
  const toggleVerify = async () => {
    if (verify) { exitVerify(); return; }
    if (tab !== 'cleaned') await load('cleaned');
    setVerify(true);
    if (episode.hasSrt && !srtText) {
      try { setSrtText(await getTranscript(episode.slug, 'srt')); }
      catch { setSrtText(''); }
    }
  };
  // Bring the counterpart into view; the clicked side is already on screen.
  const behavior: ScrollBehavior = window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth';
  const pickPara = (p: number) => {
    setSelPara(p); setSelCue(null);
    const first = cuesForPara(p)[0];
    const el = first === undefined ? null : segRef.current?.querySelector<HTMLElement>(`[data-cue="${first}"]`);
    if (el && segRef.current) segRef.current.scrollTo({ top: el.offsetTop - 14, behavior });
  };
  const pickCue = (cue: SrtCue) => {
    setOpenCue((open) => (open === cue.index ? null : cue.index));
    const p = paraForCue(cue);
    if (p === null) { setSelCue(cue.index); setSelPara(null); return; }
    setSelPara(p); setSelCue(null);
    artRef.current?.querySelector<HTMLElement>(`[data-para="${p}"]`)?.scrollIntoView({ block: 'center', behavior });
  };

  const units = verify ? articleUnits(text) : [];

  return <article className="reader">
    <header className="reader-header">
      <div className="reader-title"><p className="kicker">文章</p><EditableTitle value={displayName(episode)} onSave={rename} /><p className="reader-meta">{episode.article ? `AI 整理 · ${episode.article.model} · ${episode.article.stats.paragraphs} 段 · 事实请核对原稿` : '原始素材和初稿保留备查'}</p>{fresh && <span className="chip ok blink">已更新</span>}</div>
      <div className="reader-actions"><button type="button" className="button quiet" disabled={!episode.hasSrt} onClick={() => void toggleVerify()}>{verify ? '退出核对' : '核对'}</button><button type="button" className="button quiet" disabled={cleaning || !episode.hasRaw} onClick={() => setConfirmClean(true)}>{cleaning ? '整理中' : '重新整理'}</button><button type="button" className="button quiet" disabled={!text} onClick={copy}>复制</button></div>
    </header>
    <nav className="reader-tabs" aria-label="内容版本">{tabsFor(episode).map((item) => <button key={item} type="button" className={tab === item ? 'on' : ''} onClick={() => { if (verify) exitVerify(); void load(item); }}>{labels[item]}</button>)}</nav>
    {cleanError && <div className="inline-error reader-error" role="alert"><b>重新整理失败</b><span>{cleanError}</span><small>当前显示的仍是上次保存的文章。</small></div>}
    {tab === 'srt' && !verify && <p className="source-note">按约 3 分钟切分，仅用于定位和核对，不可直接作为视频字幕发布。</p>}
    {verify ? <div>
      <p className="verify-hint">{paraMap ? '点击任意一段，正文与分段稿互指定位。' : '暂无段落映射：两边独立浏览，重新整理可生成映射。'}</p>
      <div className="verify-grid">
        <div className="verify-art" ref={artRef}>{units.map((u, i) => {
          if (u.kind === 'h2') return <h2 key={`h2-${i}`}>{u.text}</h2>;
          if (u.kind === 'h3') return <h3 key={`h3-${i}`}>{u.text}</h3>;
          const synced = u.para !== null && (selPara === u.para || (selCue !== null && cues[selCue] && paraForCue(cues[selCue]) === u.para));
          return <p key={`p-${i}`} data-para={u.para ?? undefined} className={`ap${u.kind === 'quote' ? ' q' : ''}${synced ? ' sync' : ''}`} onClick={() => { if (u.para !== null) pickPara(u.para); }}>{u.text}</p>;
        })}</div>
        <div className="verify-seg" ref={segRef}>{cues.length ? cues.map((c) => {
          const synced = selCue === c.index || (selPara !== null && cuesForPara(selPara).includes(c.index));
          return <div key={c.index} data-cue={c.index} className={`cue${synced ? ' sync' : ''}`} onClick={() => pickCue(c)}><span className="tc">段 {String(c.index + 1).padStart(2, '0')} · {fmtTime(c.start)}</span><span className="tx">{openCue === c.index ? c.text : c.text.length > 120 ? c.text.slice(0, 120) + '…' : c.text}</span></div>;
        }) : <p className="verify-hint">暂无分段稿。</p>}</div>
      </div>
    </div> : tab === 'source' ? <SourcePanel episode={episode} /> : <div className={`reader-body ${tab === 'cleaned' ? 'article' : 'source'}`}>
      {loading ? <p className="reader-placeholder">正在打开…</p> : text ? tab === 'cleaned' ? renderArticle(text) : <pre>{text}</pre> : <p className="reader-placeholder">暂无内容。</p>}
    </div>}
    {confirmClean && <ConfirmDialog
      title="重新整理这篇文章？"
      detail="会用初稿重新生成文章，消耗一次整理额度。成功后替换现在的文章；失败的话，现在的文章保持不变。"
      confirmLabel="重新整理"
      onCancel={() => setConfirmClean(false)}
      onConfirm={() => { setConfirmClean(false); void clean(); }}
    />}
  </article>;
}

function fmtTime(sec: number): string {
  const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = Math.floor(sec % 60);
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

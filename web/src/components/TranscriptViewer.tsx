import { useEffect, useState, ReactNode } from 'react';
import { Episode, getTranscript, cleanEpisode } from '../api';
import { displayName } from '../lib';

type Tab = 'cleaned' | 'raw' | 'srt';

interface Props { episode: Episode; onCleaned: () => void; onToast: (msg: string | null) => void; }

const labels: Record<Tab, string> = { cleaned: '文章', raw: '初稿', srt: '分段稿' };

function tabsFor(episode: Episode): Tab[] {
  return ['cleaned', ...(episode.hasRaw ? ['raw' as const] : []), ...(episode.hasSrt ? ['srt' as const] : [])];
}

function renderArticle(text: string): ReactNode {
  const nodes: ReactNode[] = [];
  let paragraph: string[] = [];
  const flush = () => {
    if (paragraph.length) nodes.push(<p key={`p-${nodes.length}`}>{paragraph.join(' ')}</p>);
    paragraph = [];
  };

  for (const rawLine of text.trim().split('\n')) {
    const line = rawLine.trim();
    if (!line) { flush(); continue; }
    if (/^###\s+/.test(line)) { flush(); nodes.push(<h3 key={`h3-${nodes.length}`}>{line.replace(/^###\s+/, '')}</h3>); continue; }
    if (/^##\s+/.test(line)) { flush(); nodes.push(<h2 key={`h2-${nodes.length}`}>{line.replace(/^##\s+/, '')}</h2>); continue; }
    if (/^>\s+/.test(line)) { flush(); nodes.push(<blockquote key={`q-${nodes.length}`}>{line.replace(/^>\s+/, '')}</blockquote>); continue; }
    paragraph.push(line);
  }
  flush();
  return nodes;
}

export default function TranscriptViewer({ episode, onCleaned, onToast }: Props) {
  const [tab, setTab] = useState<Tab>('cleaned');
  const [text, setText] = useState('');
  const [loading, setLoading] = useState(true);
  const [cleaning, setCleaning] = useState(false);
  const [cleanError, setCleanError] = useState<string | null>(null);

  const load = async (next: Tab) => {
    setTab(next); setLoading(true);
    try { setText(await getTranscript(episode.slug, next)); }
    catch { setText(''); }
    finally { setLoading(false); }
  };

  useEffect(() => { void load('cleaned'); }, [episode.slug]);

  const clean = async () => {
    if (!episode.hasRaw) return;
    setCleaning(true); setCleanError(null);
    try {
      const result = await cleanEpisode(episode.slug);
      await onCleaned();
      await load('cleaned');
      onToast(`文章已由 ${result.model} 重新整理。`);
    } catch (error) {
      setCleanError((error as Error).message || '文章整理没有完成。');
      onToast('重新整理失败，原文章没有被覆盖。');
    }
    finally { setCleaning(false); }
  };

  const copy = async () => {
    if (!text) return;
    await navigator.clipboard.writeText(text);
    onToast('已复制到剪贴板。');
  };

  return <article className="reader">
    <header className="reader-header">
      <div className="reader-title"><p className="kicker">已成文</p><h1>{displayName(episode)}</h1><p className="reader-meta">{episode.article ? `AI 整理稿 · ${episode.article.model} · ${episode.article.stats.paragraphs} 个自然段 · 请核对事实` : '文章 · 原始素材和初稿仍然保留'}</p></div>
      <div className="reader-actions"><button type="button" className="button quiet" disabled={cleaning || !episode.hasRaw} onClick={clean}>{cleaning ? '整理中' : '重新整理'}</button><button type="button" className="button quiet" disabled={!text} onClick={copy}>复制</button></div>
    </header>
    <nav className="reader-tabs" aria-label="内容版本">{tabsFor(episode).map((item) => <button key={item} type="button" className={tab === item ? 'on' : ''} onClick={() => void load(item)}>{labels[item]}</button>)}</nav>
    {cleanError && <div className="inline-error reader-error" role="alert"><b>重新整理没有完成</b><span>{cleanError}</span><small>现在看到的仍是上一次成功保存的文章。</small></div>}
    {tab === 'srt' && <p className="source-note">按约 3 分钟切分，仅用于定位和核对内容，不是可直接发布的视频字幕。</p>}
    <div className={`reader-body ${tab === 'cleaned' ? 'article' : 'source'}`}>
      {loading ? <p className="reader-placeholder">正在打开…</p> : text ? tab === 'cleaned' ? renderArticle(text) : <pre>{text}</pre> : <p className="reader-placeholder">这一页还没有内容。</p>}
    </div>
  </article>;
}

import { useState, useEffect, ReactNode } from 'react';
import { Episode, getTranscript, cleanEpisode } from '../api';

type Tab = 'cleaned' | 'raw' | 'srt';

interface Props {
  episode: Episode;
  onCleaned: () => void;
  onToast: (msg: string | null) => void;
}

const TAB_LABEL: Record<Tab, string> = {
  cleaned: '清洗稿',
  raw: '原文',
  srt: '字幕',
};

function defaultTab(ep: Episode): Tab {
  if (ep.cleaned) return 'cleaned';
  if (ep.hasRaw) return 'raw';
  return 'cleaned';
}

function renderCleaned(text: string): ReactNode {
  const blocks = text.trim().split(/\n{2,}/).filter(Boolean);
  if (!blocks.length) return <p className="ghost">这卷还没有清洗稿。</p>;
  return blocks.map((block, i) => {
    const t = block.replace(/\n/g, ' ').replace(/\*\*/g, '').trim();
    const m = t.match(/^([^：:]{1,24})[：:]\s*(.+)$/);
    if (m && m[2] && m[1].length <= 16) {
      return (
        <p key={i}>
          <span className="who">{m[1]}</span>
          {m[2]}
        </p>
      );
    }
    return <p key={i}>{t}</p>;
  });
}

export default function TranscriptViewer({ episode, onCleaned, onToast }: Props) {
  const [tab, setTab] = useState<Tab>(() => defaultTab(episode));
  const [text, setText] = useState('');
  const [missing, setMissing] = useState(false);
  const [loading, setLoading] = useState(false);
  const [cleaning, setCleaning] = useState(false);

  const load = async (t: Tab) => {
    setTab(t);
    setLoading(true);
    setMissing(false);
    try {
      const content = await getTranscript(episode.slug, t);
      setText(content);
    } catch {
      setText('');
      setMissing(true);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load(defaultTab(episode));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [episode.slug, episode.cleaned, episode.hasRaw]);

  const onClean = async () => {
    if (!episode.hasRaw) { onToast('先转录，再洗'); return; }
    setCleaning(true);
    try {
      const result = await cleanEpisode(episode.slug);
      onToast(result.method === 'ai' ? '混元洗过了' : '按规则洗过了。设 HUNYUAN_API_KEY 才走模型');
      await onCleaned();
      await load('cleaned');
    } catch (e) {
      onToast('清洗失败: ' + (e as Error).message);
    } finally {
      setCleaning(false);
    }
  };

  const copy = async () => {
    if (!text) return;
    await navigator.clipboard.writeText(text);
    onToast('清洗稿已在剪贴板');
  };

  const title = episode.title || episode.slug;
  const blank = !episode.source && !episode.hasRaw && !episode.cleaned;
  if (blank) return null;

  return (
    <section className="sheet">
      <header className="tools is-on" id="win">
        {(Object.keys(TAB_LABEL) as Tab[]).map((t) => (
          <button
            key={t}
            type="button"
            className={tab === t ? 'tab on' : 'tab'}
            onClick={() => load(t)}
          >
            {TAB_LABEL[t]}
          </button>
        ))}
        <span className="sep" />
        <button type="button" className="tab" disabled={cleaning || !episode.hasRaw} onClick={onClean}>
          {cleaning ? '在洗…' : '洗一遍'}
        </button>
        <button type="button" className="tab" disabled={!text} onClick={copy}>抄走</button>
      </header>

      <div className="sheet-meta">
        <span>{episode.slug}</span>
        {episode.duration && <span>{episode.duration}</span>}
      </div>
      <h1>{title}</h1>

      <div className="body">
        {loading && <p className="ghost">纸还在抽屉里…</p>}
        {!loading && tab === 'cleaned' && !missing && renderCleaned(text)}
        {!loading && tab === 'cleaned' && missing && (
          <p className="ghost">
            {episode.hasRaw
              ? '原文在。点上面「洗一遍」，时间戳会掉下去。'
              : episode.source
                ? '音轨在了。点「开始转录」。'
                : '先投音轨，再转录。清洗稿是最后一页。'}
          </p>
        )}
        {!loading && tab !== 'cleaned' && !missing && (
          <pre className="instrument">{text}</pre>
        )}
        {!loading && tab !== 'cleaned' && missing && (
          <p className="ghost">这一面还是空的。</p>
        )}
      </div>
    </section>
  );
}

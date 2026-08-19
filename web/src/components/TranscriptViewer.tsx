import { useState, useEffect } from 'react';
import { Episode, getTranscript, cleanEpisode } from '../api';

type Tab = 'raw' | 'srt' | 'cleaned';

interface Props {
  episode: Episode;
  onCleaned: () => void;
  onToast: (msg: string | null) => void;
}

const TAB_LABEL: Record<Tab, string> = {
  raw: 'ASR 原始 (txt)',
  srt: '字幕 (srt)',
  cleaned: '清洗稿 (md)',
};

export default function TranscriptViewer({ episode, onCleaned, onToast }: Props) {
  const [tab, setTab] = useState<Tab>('raw');
  const [text, setText] = useState('');
  const [loading, setLoading] = useState(false);
  const [cleaning, setCleaning] = useState(false);

  const load = async (t: Tab) => {
    setTab(t);
    setLoading(true);
    try {
      const content = await getTranscript(episode.slug, t);
      setText(content);
    } catch {
      setText(`（暂无 ${TAB_LABEL[t]} 内容）`);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load('raw'); /* eslint-disable-next-line */ }, [episode.slug]);

  const onClean = async () => {
    if (!episode.hasRaw) { onToast('请先完成转录'); return; }
    setCleaning(true);
    try {
      const result = await cleanEpisode(episode.slug);
      const label = result.method === 'ai' ? '混元 AI 清洗 ✅' : '启发式清洗 ✅（设置 HUNYUAN_API_KEY 后切换 AI）';
      onToast(label);
      await onCleaned();
      await load('cleaned');
    } catch (e) {
      onToast('清洗失败: ' + (e as Error).message);
    } finally {
      setCleaning(false);
    }
  };

  const copy = () => {
    navigator.clipboard.writeText(text);
    onToast('已复制到剪贴板');
  };

  return (
    <section className="panel transcript-panel">
      <div className="panel-title tabs">
        {(Object.keys(TAB_LABEL) as Tab[]).map((t) => (
          <button
            key={t}
            className={tab === t ? 'tab active' : 'tab'}
            onClick={() => load(t)}
          >
            {TAB_LABEL[t]}
          </button>
        ))}
        <div className="spacer" />
        <button className="btn-secondary" disabled={cleaning || !episode.hasRaw} onClick={onClean}>
          {cleaning ? '清洗中…' : '✨ 清洗'}
        </button>
        <button className="btn-ghost" onClick={copy}>复制</button>
      </div>
      <div className="transcript-body">
        {loading ? <div className="hint">读取中…</div> : (
          <pre className="transcript-text">{text}</pre>
        )}
      </div>
    </section>
  );
}

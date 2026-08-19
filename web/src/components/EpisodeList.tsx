import { useState } from 'react';
import { Episode } from '../api';

const STATUS_LABEL: Record<Episode['status'], string> = {
  empty: '待上传',
  uploaded: '已上传',
  transcribed: '已转录',
  cleaned: '已清洗',
};

interface Props {
  episodes: Episode[];
  selected: string | null;
  loading: boolean;
  onSelect: (slug: string) => void;
  onCreate: (slug: string) => void;
  onDelete: (slug: string) => void;
}

export default function EpisodeList({ episodes, selected, loading, onSelect, onCreate, onDelete }: Props) {
  const [showNew, setShowNew] = useState(false);
  const [slug, setSlug] = useState('');

  const submit = () => {
    const s = slug.trim();
    if (!s) return;
    onCreate(s);
    setSlug('');
    setShowNew(false);
  };

  return (
    <div className="episode-list">
      <div className="episode-head">
        <span>期次（{episodes.length}）</span>
        <button className="btn-ghost" onClick={() => setShowNew((v) => !v)}>+ 新建</button>
      </div>

      {showNew && (
        <div className="new-episode">
          <input
            placeholder="slug，如 2026-07-08-topic"
            value={slug}
            onChange={(e) => setSlug(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && submit()}
          />
          <button className="btn-primary" onClick={submit}>创建</button>
        </div>
      )}

      {loading && episodes.length === 0 && <div className="hint">加载中…</div>}

      <ul>
        {episodes.map((ep) => (
          <li
            key={ep.slug}
            className={ep.slug === selected ? 'active' : ''}
            onClick={() => onSelect(ep.slug)}
          >
            <div className="ep-slug">{ep.slug}</div>
            <div className="ep-meta">
              <span className={`badge ${ep.status}`}>{STATUS_LABEL[ep.status]}</span>
              {ep.hasRaw && <span className="dot" title="asr_raw.txt">R</span>}
              {ep.hasSrt && <span className="dot" title="asr_raw.srt">S</span>}
              {ep.cleaned && <span className="dot" title="cleaned.md">C</span>}
            </div>
            <button
              className="btn-del"
              title="删除"
              onClick={(e) => { e.stopPropagation(); onDelete(ep.slug); }}
            >×</button>
          </li>
        ))}
      </ul>
    </div>
  );
}

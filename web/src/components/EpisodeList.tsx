import { Episode } from '../api';
import { displayDate, displayName } from '../lib';

const STATUS_LABEL: Record<Episode['status'], string> = {
  empty: '待投',
  uploaded: '待转',
  transcribed: '待洗',
  cleaned: '已洗',
};

interface Props {
  episodes: Episode[];
  selected: string | null;
  loading: boolean;
  onSelect: (slug: string) => void;
  onDelete: (slug: string) => void;
}

export default function EpisodeList({ episodes, selected, loading, onSelect, onDelete }: Props) {
  return (
    <div className="episode-list">
      {loading && episodes.length === 0 && <div className="hint">在找未做完的卷…</div>}

      <ul>
        {episodes.map((ep) => (
          <li
            key={ep.slug}
            className={[
              ep.slug === selected ? 'active' : '',
              ep.status === 'cleaned' ? 'done' : '',
              ep.status === 'uploaded' || ep.status === 'transcribed' ? 'open' : '',
            ].filter(Boolean).join(' ')}
            onClick={() => onSelect(ep.slug)}
          >
            <div className="ep-date">{displayDate(ep)}</div>
            <div className="ep-title">{displayName(ep)}</div>
            <div className="ep-meta">
              <span className={`st ${ep.status}`}>{STATUS_LABEL[ep.status]}</span>
              {ep.duration && <span>{ep.duration}</span>}
            </div>
            <button
              className="btn-del"
              type="button"
              title="撤掉音轨"
              onClick={(e) => { e.stopPropagation(); onDelete(ep.slug); }}
            >
              ×
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

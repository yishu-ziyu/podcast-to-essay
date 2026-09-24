import { Episode } from '../api';
import { displayDate, displayName } from '../lib';

interface Props {
  episodes: Episode[];
  selected: string | null;
  loading: boolean;
  onSelect: (slug: string) => void;
  onDelete?: (slug: string) => void;
}

export function statusFor(episode: Episode) {
  if (episode.transcription?.state === 'paused') return '已暂停';
  if (episode.transcription?.state === 'running') return '转录中';
  if (episode.transcription?.state === 'failed') return '需要处理';
  return { uploaded: '待转录', transcribed: '待整理', cleaned: '已生成文章', empty: '无素材' }[episode.status];
}

export default function EpisodeList({ episodes, selected, loading, onSelect, onDelete }: Props) {
  return (
    <div className="episode-list">
      {loading && !episodes.length && <p className="library-empty">加载中…</p>}
      {!loading && !episodes.length && <p className="library-empty">暂无条目。</p>}
      <ul>
        {episodes.map((episode) => (
          <li key={episode.slug} className={episode.slug === selected ? 'active' : ''}>
            <button type="button" className="episode-select" onClick={() => onSelect(episode.slug)}>
              <span className={`status-dot ${episode.transcription?.state || episode.status}`} />
              <span className="episode-copy"><span className="ep-title">{displayName(episode)}</span><span className="ep-meta">{statusFor(episode)}{episode.duration ? ` · ${episode.duration}` : ` · ${displayDate(episode)}`}</span></span>
            </button>
            {onDelete && <button className="btn-del" type="button" aria-label={`删除${displayName(episode)}`} onClick={() => onDelete(episode.slug)}>×</button>}
          </li>
        ))}
      </ul>
    </div>
  );
}

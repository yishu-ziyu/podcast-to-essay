import { Episode } from '../api';
import { displayDate, displayName } from '../lib';

interface Props {
  episodes: Episode[];
  selected: string | null;
  loading: boolean;
  onSelect: (slug: string) => void;
  onDelete: (slug: string) => void;
}

function statusFor(episode: Episode) {
  if (episode.transcription?.state === 'paused') return '已暂停';
  if (episode.transcription?.state === 'running') return '转录中';
  if (episode.transcription?.state === 'failed') return '需要处理';
  return { uploaded: '待转录', transcribed: '待成文', cleaned: '已成文', empty: '待投放' }[episode.status];
}

export default function EpisodeList({ episodes, selected, loading, onSelect, onDelete }: Props) {
  return (
    <div className="episode-list">
      <div className="library-summary"><span>全部内容</span><b>{episodes.length}</b></div>
      {loading && !episodes.length && <p className="library-empty">正在打开资料库…</p>}
      {!loading && !episodes.length && <p className="library-empty">还没有收进来的声音。</p>}
      <ul>
        {episodes.map((episode) => (
          <li key={episode.slug} className={episode.slug === selected ? 'active' : ''}>
            <button type="button" className="episode-select" onClick={() => onSelect(episode.slug)}>
              <span className={`status-dot ${episode.transcription?.state || episode.status}`} />
              <span className="episode-copy"><span className="ep-title">{displayName(episode)}</span><span className="ep-meta">{statusFor(episode)}{episode.duration ? ` · ${episode.duration}` : ` · ${displayDate(episode)}`}</span></span>
            </button>
            <button className="btn-del" type="button" aria-label={`撤掉${displayName(episode)}`} onClick={() => onDelete(episode.slug)}>×</button>
          </li>
        ))}
      </ul>
    </div>
  );
}

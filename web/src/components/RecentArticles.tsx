import { useEffect, useState } from 'react';
import { Episode, getTranscript } from '../api';
import { articleUnits, displayDate, displayName } from '../lib';
import { statusFor } from './EpisodeList';

interface Props {
  episodes: Episode[];
  onSelect: (slug: string) => void;
}

const SHOWN = 3;

function recency(episode: Episode) {
  return episode.cleanedAt ?? (Date.parse(displayDate(episode)) || 0);
}

export default function RecentArticles({ episodes, onSelect }: Props) {
  const recent = episodes.filter((episode) => episode.status !== 'empty').sort((a, b) => recency(b) - recency(a)).slice(0, SHOWN);
  const [excerpts, setExcerpts] = useState<Record<string, string>>({});
  const wanted = recent.filter((episode) => episode.cleaned).map((episode) => episode.slug).join('|');

  useEffect(() => {
    let stop = false;
    for (const slug of wanted ? wanted.split('|') : []) {
      getTranscript(slug, 'cleaned')
        .then((text) => {
          const first = articleUnits(text).find((unit) => unit.kind === 'p' || unit.kind === 'quote');
          if (!stop && first) setExcerpts((prev) => ({ ...prev, [slug]: first.text }));
        })
        .catch(() => { /* card still works without an excerpt */ });
    }
    return () => { stop = true; };
  }, [wanted]);

  if (!recent.length) return null;
  const rest = episodes.length - recent.length;

  return (
    <section className="recent" aria-labelledby="recent-title">
      <div className="recent-head">
        <h2 id="recent-title">最近</h2>
        {rest > 0 && <span>另有 {rest} 条在资料库</span>}
      </div>
      <ul>
        {recent.map((episode) => (
          <li key={episode.slug}>
            <button type="button" className="recent-card" onClick={() => onSelect(episode.slug)}>
              <span className="recent-title">{displayName(episode)}</span>
              <span className="recent-excerpt">{episode.cleaned ? excerpts[episode.slug] || '' : '还没有文章，点开继续处理。'}</span>
              <span className="recent-meta">{statusFor(episode)} · {episode.duration || displayDate(episode)}</span>
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}

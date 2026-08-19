import { useEffect, useState, useCallback } from 'react';
import { Episode, listEpisodes, deleteEpisode } from './api';
import EpisodeList from './components/EpisodeList';
import Workbench from './components/Workbench';
import TranscriptViewer from './components/TranscriptViewer';

export default function App() {
  const [episodes, setEpisodes] = useState<Episode[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [libraryOpen, setLibraryOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const next = await listEpisodes();
      setEpisodes(next);
      setSelected((previous) => {
        if (previous && next.some((episode) => episode.slug === previous)) return previous;
        return next.find((episode) => episode.status === 'uploaded' || episode.status === 'transcribed')?.slug || null;
      });
    } catch (error) {
      setToast('没能打开资料库：' + (error as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);

  const handleDelete = async (slug: string) => {
    if (!confirm('撤掉这一卷及其音轨？清洗稿会保留。')) return;
    try {
      await deleteEpisode(slug);
      setToast('这一卷已从资料库撤掉。');
      await refresh();
    } catch (error) {
      setToast('没有撤掉：' + (error as Error).message);
    }
  };

  const current = episodes.find((episode) => episode.slug === selected) || null;
  const reading = Boolean(current?.cleaned);
  const startNew = () => {
    setSelected(null);
    setLibraryOpen(false);
  };

  return (
    <div className={`app-shell${libraryOpen ? ' library-open' : ''}`}>
      <aside className="library" aria-label="资料库">
        <button
          type="button"
          className="library-toggle"
          aria-label={libraryOpen ? '收起资料库' : '打开资料库'}
          aria-expanded={libraryOpen}
          onClick={() => setLibraryOpen((open) => !open)}
        >
          <span className="hamburger" aria-hidden="true"><i /><i /></span>
          {libraryOpen && <span>资料库</span>}
        </button>
        {libraryOpen && (
          <EpisodeList
            episodes={episodes}
            selected={selected}
            loading={loading}
            onSelect={(slug) => { setSelected(slug); setLibraryOpen(false); }}
            onDelete={handleDelete}
          />
        )}
      </aside>

      <main className="app-main">
        <header className="app-header">
          <button type="button" className="wordmark" onClick={startNew}>录成文</button>
          <span className="header-context">{reading ? '阅读' : current ? '这一卷' : '新建'}</span>
          <button type="button" className="new-button" onClick={startNew}>＋ 新建</button>
        </header>
        <div className="stage">
          {reading && current ? (
            <TranscriptViewer episode={current} onCleaned={refresh} onToast={setToast} />
          ) : (
            <Workbench
              episode={current}
              episodes={episodes}
              onChanged={refresh}
              onSelect={setSelected}
              onToast={setToast}
            />
          )}
        </div>
      </main>

      {toast && <button type="button" className="toast" onClick={() => setToast(null)}>{toast}</button>}
    </div>
  );
}

import { useEffect, useState, useCallback } from 'react';
import { Episode, listEpisodes, deleteEpisode } from './api';
import EpisodeList from './components/EpisodeList';
import Workbench from './components/Workbench';
import TranscriptViewer from './components/TranscriptViewer';

export default function App() {
  const [episodes, setEpisodes] = useState<Episode[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const eps = await listEpisodes();
      setEpisodes(eps);
      setSelected((prev) => {
        if (prev && eps.find((e) => e.slug === prev)) return prev;
        const job = eps.find((e) => e.status === 'uploaded' || e.status === 'transcribed');
        return job ? job.slug : null;
      });
    } catch (e) {
      setToast('加载期次失败: ' + (e as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  const handleDelete = async (slug: string) => {
    if (!confirm(`删掉 ${slug} 的音轨和中间产物？清洗稿若已写出，会留在 cleaned/。`)) return;
    try {
      await deleteEpisode(slug);
      setToast(`已撤掉 ${slug}`);
      await refresh();
    } catch (e) {
      setToast('删除失败: ' + (e as Error).message);
    }
  };

  const current = episodes.find((e) => e.slug === selected) || null;
  const showPaper = Boolean(current?.cleaned);

  return (
    <div className="desk">
      <aside className="rail">
        <button type="button" className="brand" onClick={() => setSelected(null)}>
          <div className="mark">清洗稿</div>
        </button>
        <EpisodeList
          episodes={episodes}
          selected={selected}
          loading={loading}
          onSelect={setSelected}
          onDelete={handleDelete}
        />
      </aside>

      <main className="stage">
        {showPaper && current ? (
          <article className="paper" key={current.slug}>
            <button type="button" className="back" onClick={() => setSelected(null)}>投新的</button>
            <TranscriptViewer episode={current} onCleaned={refresh} onToast={setToast} />
          </article>
        ) : (
          <Workbench
            episode={current}
            episodes={episodes}
            onChanged={refresh}
            onSelect={setSelected}
            onToast={setToast}
          />
        )}
      </main>

      {toast && (
        <div className="toast" onClick={() => setToast(null)}>
          {toast}
        </div>
      )}
    </div>
  );
}

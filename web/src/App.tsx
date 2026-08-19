import { useEffect, useState, useCallback } from 'react';
import { Episode, listEpisodes, createEpisode, deleteEpisode } from './api';
import EpisodeList from './components/EpisodeList';
import UploadPanel from './components/UploadPanel';
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
      if (selected && !eps.find((e) => e.slug === selected)) setSelected(null);
      if (!selected && eps.length) setSelected(eps[0].slug);
    } catch (e) {
      setToast('加载期次失败: ' + (e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [selected]);

  useEffect(() => { refresh(); }, [refresh]);

  const handleCreate = async (slug: string) => {
    try {
      await createEpisode(slug);
      setToast(`已创建期次 ${slug}`);
      await refresh();
      setSelected(slug);
    } catch (e) {
      setToast('创建失败: ' + (e as Error).message);
    }
  };

  const handleDelete = async (slug: string) => {
    if (!confirm(`确认删除期次 ${slug}？（仅删除 raw 目录下的源文件与中间产物）`)) return;
    try {
      await deleteEpisode(slug);
      setToast(`已删除 ${slug}`);
      await refresh();
    } catch (e) {
      setToast('删除失败: ' + (e as Error).message);
    }
  };

  const current = episodes.find((e) => e.slug === selected) || null;

  return (
    <div className="app">
      <aside className="sidebar">
        <div className="brand">
          <span className="logo">🎙️</span>
          <div>
            <div className="title">Podcast → Essay</div>
            <div className="subtitle">转录工作台</div>
          </div>
        </div>
        <EpisodeList
          episodes={episodes}
          selected={selected}
          loading={loading}
          onSelect={setSelected}
          onCreate={handleCreate}
          onDelete={handleDelete}
        />
      </aside>

      <main className="main">
        {current ? (
          <>
            <UploadPanel episode={current} onChanged={refresh} onToast={setToast} />
            <TranscriptViewer episode={current} onCleaned={refresh} onToast={setToast} />
          </>
        ) : (
          <div className="empty-state">
            <h2>还没有期次</h2>
            <p>在左侧「新建期次」创建一个 slug（如 <code>2026-07-08-my-podcast</code>），然后上传音频开始转录。</p>
          </div>
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

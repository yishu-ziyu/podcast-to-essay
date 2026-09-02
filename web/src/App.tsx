import { useEffect, useState, useCallback, FormEvent } from 'react';
import { Episode, listEpisodes, deleteEpisode, getLockState, login } from './api';
import EpisodeList from './components/EpisodeList';
import Workbench from './components/Workbench';
import TranscriptViewer from './components/TranscriptViewer';

function Gate({ onUnlocked }: { onUnlocked: () => void }) {
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true); setError(null);
    try { await login(password); onUnlocked(); }
    catch (err) { setError((err as Error).message); }
    finally { setBusy(false); }
  };
  return (
    <div className="app-shell">
      <main className="app-main">
        <header className="app-header"><span className="wordmark">录成文</span></header>
        <div className="stage">
          <form className="gate" onSubmit={(event) => { void submit(event); }}>
            <label htmlFor="gate-password">访问密码</label>
            <input id="gate-password" type="password" autoFocus value={password} onChange={(event) => { setPassword(event.target.value); setError(null); }} />
            <button className="button primary" disabled={busy || !password}>{busy ? '验证中' : '进入'}</button>
            {error && <p className="field-hint error-text">{error}</p>}
          </form>
        </div>
      </main>
    </div>
  );
}

export default function App() {
  const [episodes, setEpisodes] = useState<Episode[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [libraryOpen, setLibraryOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [locked, setLocked] = useState<boolean | null>(null);

  useEffect(() => {
    getLockState().then(setLocked).catch(() => setLocked(false));
  }, []);

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
      setToast('资料库加载失败：' + (error as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { if (locked === false) void refresh(); }, [refresh, locked]);

  const handleDelete = async (slug: string) => {
    if (!confirm('删除该条目及其音轨？已生成的文章会保留。')) return;
    try {
      await deleteEpisode(slug);
      setToast('已删除。');
    } catch (error) {
      setToast('删除失败：' + (error as Error).message);
    }
  };

  const current = episodes.find((episode) => episode.slug === selected) || null;
  const reading = Boolean(current?.cleaned);
  const startNew = () => {
    setSelected(null);
    setLibraryOpen(false);
  };

  if (locked === null) return null;
  if (locked) return <Gate onUnlocked={() => setLocked(false)} />;

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
          <span className="header-context">{reading ? '文章' : current ? '条目' : '新建'}</span>
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

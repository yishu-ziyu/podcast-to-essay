import { useEffect, useState, useCallback, useRef, FormEvent } from 'react';
import { Episode, listEpisodes, deleteEpisode, getSession, login, Session } from './api';
import EpisodeList from './components/EpisodeList';
import Workbench from './components/Workbench';
import TranscriptViewer from './components/TranscriptViewer';

function OwnerLogin({ onClose, onLoggedIn }: { onClose: () => void; onLoggedIn: () => void }) {
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true); setError(null);
    try { await login(password); onLoggedIn(); }
    catch (err) { setError((err as Error).message); }
    finally { setBusy(false); }
  };
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <form className="gate" onClick={(event) => event.stopPropagation()} onSubmit={(event) => { void submit(event); }}>
        <label htmlFor="gate-password">所有者密码</label>
        <input id="gate-password" type="password" autoFocus value={password} onChange={(event) => { setPassword(event.target.value); setError(null); }} />
        <button className="button primary" disabled={busy || !password}>{busy ? '验证中' : '登录'}</button>
        {error && <p className="field-hint error-text">{error}</p>}
      </form>
    </div>
  );
}

export default function App() {
  const [episodes, setEpisodes] = useState<Episode[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [libraryOpen, setLibraryOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [toastLeaving, setToastLeaving] = useState(false);
  const toastTimer = useRef<number | null>(null);

  const showToast = useCallback((msg: string | null) => {
    if (toastTimer.current) window.clearTimeout(toastTimer.current);
    setToastLeaving(false);
    setToast(msg);
  }, []);

  const dismissToast = useCallback(() => {
    if (!toast || toastLeaving) return;
    setToastLeaving(true);
    toastTimer.current = window.setTimeout(() => { setToast(null); setToastLeaving(false); }, 130);
  }, [toast, toastLeaving]);
  const [session, setSession] = useState<Session | null>(null);
  const [loginOpen, setLoginOpen] = useState(false);

  useEffect(() => {
    getSession().then(setSession).catch(() => setSession({ owner: true, guest: null }));
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

  useEffect(() => { if (session) void refresh(); }, [refresh, session]);

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

  if (!session) return null;
  const guest = !session.owner ? session.guest : null;

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
            onDelete={session.owner ? handleDelete : undefined}
          />
        )}
      </aside>

      <main className="app-main">
        <header className="app-header">
          <button type="button" className="wordmark" onClick={startNew}>录成文</button>
          <span className="header-context">{reading ? '文章' : current ? '条目' : '新建'}</span>
          {session.owner
            ? <button type="button" className="new-button" onClick={startNew}>＋ 新建</button>
            : <button type="button" className="new-button" onClick={() => setLoginOpen(true)}>所有者登录</button>}
        </header>
        {guest && (
          <div className="guest-banner">
            <span>游客体验：今日剩余 导入 {guest.left.ingest} / 转录 {guest.left.transcribe} / 整理 {guest.left.clean}。数据仅本人可见。</span>
            <a href="https://github.com/yishu-ziyu/podcast-to-essay" target="_blank" rel="noreferrer">长期或大量使用，建议自部署</a>
          </div>
        )}
        <div className="stage">
          {reading && current ? (
            <TranscriptViewer episode={current} onCleaned={refresh} onToast={showToast} />
          ) : (
            <Workbench
              episode={current}
              episodes={episodes}
              onChanged={refresh}
              onSelect={setSelected}
              onToast={showToast}
            />
          )}
        </div>
      </main>

      {loginOpen && <OwnerLogin onClose={() => setLoginOpen(false)} onLoggedIn={async () => { setLoginOpen(false); setSession(await getSession()); await refresh(); }} />}
      {toast && <button type="button" className={`toast${toastLeaving ? ' leaving' : ''}`} onClick={dismissToast}>{toast}</button>}
    </div>
  );
}

import { useEffect, useState, useCallback, useRef, FormEvent } from 'react';
import { Episode, listEpisodes, deleteEpisode, getSession, login, Session } from './api';
import EpisodeList from './components/EpisodeList';
import Workbench from './components/Workbench';
import TranscriptViewer from './components/TranscriptViewer';
import ConfirmDialog from './components/ConfirmDialog';
import { FirstSightHint, GuidedTour, useOnboarding } from './components/Onboarding';
import { displayName } from './lib';

function OwnerLogin({ onClose, onLoggedIn }: { onClose: () => void; onLoggedIn: () => void }) {
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
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
        <div className="gate-head">
          <label htmlFor="gate-password">所有者密码</label>
          <button type="button" className="gate-close" aria-label="关闭" onClick={onClose}>✕</button>
        </div>
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
    if (!msg) return;
    toastTimer.current = window.setTimeout(() => {
      setToastLeaving(true);
      toastTimer.current = window.setTimeout(() => { setToast(null); setToastLeaving(false); }, 130);
    }, 4000);
  }, []);

  const dismissToast = useCallback(() => {
    if (!toast || toastLeaving) return;
    if (toastTimer.current) window.clearTimeout(toastTimer.current);
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
      showToast('资料库加载失败：' + (error as Error).message);
    } finally {
      setLoading(false);
    }
  }, [showToast]);

  useEffect(() => { if (session) void refresh(); }, [refresh, session]);

  const [pendingDelete, setPendingDelete] = useState<Episode | null>(null);
  const handleDelete = (slug: string) => setPendingDelete(episodes.find((episode) => episode.slug === slug) || null);
  const confirmDelete = async () => {
    if (!pendingDelete) return;
    const { slug } = pendingDelete;
    setPendingDelete(null);
    try {
      await deleteEpisode(slug);
      showToast('已删除。');
      // 列表不会自己更新：删完不刷新的话，条目仍留在资料库里，看起来像没删掉。
      await refresh();
    } catch (error) {
      showToast('删除失败：' + (error as Error).message);
    }
  };

  const current = episodes.find((episode) => episode.slug === selected) || null;
  const reading = Boolean(current?.cleaned);
  const libraryToggle = useRef<HTMLButtonElement>(null);
  const libraryClose = useRef<HTMLButtonElement>(null);
  const closeLibrary = useCallback(() => {
    setLibraryOpen(false);
    libraryToggle.current?.focus();
  }, []);

  // The drawer stays mounted so it can slide out; move focus in and let Esc close it.
  useEffect(() => {
    if (!libraryOpen) return;
    libraryClose.current?.focus();
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') closeLibrary(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [libraryOpen, closeLibrary]);

  const onboarding = useOnboarding();
  const replayTour = () => {
    onboarding.replayTour();
    setSelected(null);
    closeLibrary();
  };

  const startNew = () => {
    setSelected(null);
    setLibraryOpen(false);
  };

  if (!session) return null;
  const guest = !session.owner ? session.guest : null;

  return (
    <div className="app-shell">
      <main className="app-main">
        <header className="app-header">
          <div className="header-start">
            <button
              ref={libraryToggle}
              type="button"
              className="library-toggle"
              data-tour="library"
              aria-label="打开资料库"
              aria-expanded={libraryOpen}
              aria-controls="library"
              onClick={() => setLibraryOpen(true)}
            >
              <span className="hamburger" aria-hidden="true"><i /><i /></span>
            </button>
            <button type="button" className="wordmark" onClick={startNew}>誊清</button>
          </div>
          <span className="header-context">{reading ? '文章' : current ? '条目' : ''}</span>
          {!session.owner
            ? <button type="button" className="new-button" onClick={() => setLoginOpen(true)}>所有者登录</button>
            : current ? <button type="button" className="new-button" onClick={startNew}>＋ 新建</button> : <span />}
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

      <div className={`drawer-backdrop${libraryOpen ? ' open' : ''}`} onClick={closeLibrary} aria-hidden="true" />
      <aside id="library" className={`library${libraryOpen ? ' open' : ''}`} aria-label="资料库" role="dialog" aria-modal="true">
        <div className="library-head">
          <span>资料库<b>{episodes.length}</b></span>
          <button ref={libraryClose} type="button" className="library-close" aria-label="关闭资料库" onClick={closeLibrary}>✕</button>
        </div>
        <EpisodeList
          episodes={episodes}
          selected={selected}
          loading={loading}
          onSelect={(slug) => { setSelected(slug); closeLibrary(); }}
          onDelete={session.owner ? handleDelete : undefined}
        />
        <button type="button" className="library-replay" onClick={replayTour}>重新看引导</button>
      </aside>

      {/* Nothing else may sit on top: the drawer, a dialog, or the login form. */}
      <GuidedTour seen={onboarding.seen} active={!current && !libraryOpen && !pendingDelete && !loginOpen} onSeen={onboarding.markSeen} onFinish={onboarding.finishTour} />
      <FirstSightHint id="spot.verify" seen={onboarding.seen} active={reading && !libraryOpen && !pendingDelete && !loginOpen} onSeen={onboarding.markSeen} />

      {pendingDelete && <ConfirmDialog
        title={`删除「${displayName(pendingDelete).length > 28 ? displayName(pendingDelete).slice(0, 28) + '…' : displayName(pendingDelete)}」？`}
        detail="音轨、初稿、分段稿和文章会一起删除，不能撤销。"
        confirmLabel="删除"
        danger
        onCancel={() => setPendingDelete(null)}
        onConfirm={() => void confirmDelete()}
      />}
      {loginOpen && <OwnerLogin onClose={() => setLoginOpen(false)} onLoggedIn={async () => { setLoginOpen(false); setSession(await getSession()); await refresh(); }} />}
      {toast && <button type="button" className={`toast${toastLeaving ? ' leaving' : ''}`} onClick={dismissToast}>{toast}</button>}
    </div>
  );
}

import { useEffect, useRef, useState } from 'react';
import { Episode, JobError, JobView, cleanEpisode, continueJob, controlTranscription, createEpisode, getJob, jobSettled, listJobs, startTranscription, submitIngest, updateEpisodeTitle, uploadAudio, watchJob } from '../api';
import { displayName, extractUrl, slugFromFile, sourceLabel } from '../lib';
import ConfirmDialog from './ConfirmDialog';
import EditableTitle from './EditableTitle';
import RecentArticles from './RecentArticles';

interface Props {
  episode: Episode | null;
  episodes: Episode[];
  onChanged: () => Promise<void> | void;
  onSelect: (slug: string) => void;
  onToast: (msg: string | null) => void;
}

const FILE_ACCEPT = ['audio/*', 'video/*', '.mp3', '.wav', '.m4a', '.flac', '.ogg', '.mp4', '.mov', '.mkv', '.webm'].join(',');

function progressText(episode: Episode) {
  if (!episode.chunkCount) return '正在准备音轨';
  return `已完成 ${episode.completedChunks} / ${episode.chunkCount} 段`;
}

const JOURNEY = ['导入素材', '转成初稿', '整理成文'];

function Journey({ active }: { active: number }) {
  return (
    <ol className="journey compact" aria-label="从素材到文章的三个步骤">
      {JOURNEY.map((title, index) => {
        const number = index + 1;
        const done = number < active;
        const current = number === active;
        return (
          <li key={title} className={`${done ? 'done' : ''}${current ? ' current' : ''}`} aria-current={current ? 'step' : undefined}>
            <span className="journey-index" aria-hidden="true">{done ? '✓' : number}</span>
            <div><b>{title}</b></div>
          </li>
        );
      })}
    </ol>
  );
}

export default function Workbench({ episode, episodes, onChanged, onSelect, onToast }: Props) {
  const fileRef = useRef<HTMLInputElement>(null);
  const lastRef = useRef<{ kind: 'file'; file: File } | { kind: 'url'; url: string } | null>(null);
  const [urlDraft, setUrlDraft] = useState('');
  const [over, setOver] = useState(false);
  const [nudge, setNudge] = useState(false);
  const linkRef = useRef<HTMLInputElement>(null);
  const [importing, setImporting] = useState(false);
  const [importProgress, setImportProgress] = useState<string | null>(null);
  const [importFail, setImportFail] = useState<{ message: string; diagnosticId?: string; jobId?: string; continuable?: boolean } | null>(null);
  const [transcribing, setTranscribing] = useState(false);
  const [paused, setPaused] = useState(false);
  const [controlling, setControlling] = useState(false);
  const [logs, setLogs] = useState<string[]>([]);
  const [cleaning, setCleaning] = useState(false);
  const [cleanFail, setCleanFail] = useState<string | null>(null);
  const [titleDraft, setTitleDraft] = useState('');
  const [savingTitle, setSavingTitle] = useState(false);
  const [confirmReplace, setConfirmReplace] = useState(false);

  const watchStop = useRef<(() => void) | null>(null);

  const applyJob = (job: JobView, resolve?: (job: JobView) => void, reject?: (error: Error) => void) => {
    setImportProgress(job.label || '服务器已接收');
    if (!jobSettled(job)) return;
    watchStop.current?.();
    watchStop.current = null;
    if (job.state === 'succeeded') resolve?.(job);
    else if (job.state === 'interrupted') {
      const error = new Error('任务因服务重启中断，已完成内容仍在，可以继续。') as Error & { jobId?: string; continuable?: boolean };
      error.jobId = job.id;
      error.continuable = true;
      reject?.(error);
    } else {
      const error = new Error(job.error?.userMessage || '导入没有完成');
      (error as Error & { failure?: JobError }).failure = job.error || undefined;
      reject?.(error);
    }
  };

  const follow = (job: JobView) => new Promise<JobView>((resolve, reject) => {
    watchStop.current?.();
    watchStop.current = watchJob(job.id, (next) => applyJob(next, resolve, reject));
  });

  useEffect(() => {
    let stop = false;
    void (async () => {
      const jobs = await listJobs().catch(() => [] as JobView[]);
      if (stop) return;
      const active = jobs.find((item) => item.type === 'ingest' && ['queued', 'running', 'paused', 'interrupted'].includes(item.state));
      const savedId = sessionStorage.getItem('p2e.job');
      const saved = !active && savedId ? await getJob(savedId).catch(() => null) : null;
      const job = active || (saved?.type === 'ingest' && saved.state === 'failed' ? saved : null);
      if (!job || stop) return;
      if (job.state === 'interrupted') {
        setImportFail({ message: '任务因服务重启中断，已完成内容仍在，可以继续。', jobId: job.id, continuable: true });
        return;
      }
      if (job.state === 'failed') {
        setImportFail({ message: job.error?.userMessage || '导入没有完成', diagnosticId: job.error?.diagnosticId });
        return;
      }
      setImporting(true);
      setImportProgress(job.label || '服务器已接收');
      try {
        const done = await follow(job);
        if (stop) return;
        sessionStorage.removeItem('p2e.job');
        await onChanged();
        onSelect(done.episodeSlug);
      } catch (error) {
        const failed = error as Error & { failure?: JobError; jobId?: string; continuable?: boolean };
        if (!stop) setImportFail({ message: failed.message, diagnosticId: failed.failure?.diagnosticId, jobId: failed.jobId, continuable: failed.continuable });
      } finally {
        if (!stop) { setImporting(false); setImportProgress(null); }
      }
    })();
    return () => { stop = true; watchStop.current?.(); };
  }, [onChanged, onSelect]);
  const serverState = episode?.transcription?.state;
  const isWorking = transcribing || serverState === 'running' || serverState === 'paused';
  const isPaused = paused || serverState === 'paused';
  const unnamed = Boolean(episode && !episode.title && !episode.originalName);
  const validDraftUrl = extractUrl(urlDraft);
  const activeStep = episode?.status === 'transcribed' ? 3 : episode ? 2 : 1;

  useEffect(() => {
    setTitleDraft(episode?.title || '');
    setLogs([]);
    setCleanFail(null);
    setPaused(episode?.transcription?.state === 'paused');
    setTranscribing(episode?.transcription?.state === 'running');
  }, [episode?.slug]);

  useEffect(() => {
    if (!isWorking) return;
    const timer = window.setInterval(() => { void onChanged(); }, 2500);
    return () => window.clearInterval(timer);
  }, [isWorking, onChanged]);

  const takeFile = async (file?: File) => {
    if (!file) return;
    lastRef.current = { kind: 'file', file };
    setImporting(true); setImportFail(null); setImportProgress('正在放好你的文件…');
    const replacing = Boolean(episode?.source && !episode.cleaned);
    try {
      let slug = episode && !episode.cleaned ? episode.slug : '';
      if (!slug) {
        const taken = episodes.map((item) => item.slug);
        let lastError: Error | null = null;
        for (let attempt = 0; attempt < 5 && !slug; attempt += 1) {
          const candidate = attempt === 0
            ? slugFromFile(file.name, taken)
            : `${slugFromFile(file.name, taken)}-${attempt + 1}`;
          try {
            await createEpisode(candidate);
            slug = candidate;
            onSelect(candidate);
          } catch (err) {
            if (!/exists/i.test((err as Error).message)) throw err;
            lastError = err as Error;
          }
        }
        if (!slug) throw lastError || new Error('无法创建条目');
      }
      await uploadAudio(slug, file);
      await onChanged();
      onSelect(slug);
      onToast(replacing ? '音轨已更换，需要重新转录。' : '素材已导入。');
    } catch (error) {
      setImportFail({ message: (error as Error).message || '上传失败' });
    } finally {
      setImporting(false); setImportProgress(null);
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  const takeUrl = async (raw: string) => {
    const url = extractUrl(raw);
    if (!url) { setImportFail({ message: '请输入完整链接。' }); return; }
    lastRef.current = { kind: 'url', url };
    setImporting(true); setImportFail(null); setImportProgress('服务器已接收');
    try {
      const job = await submitIngest(url);
      sessionStorage.setItem('p2e.job', job.id);
      setImportProgress(job.label || '服务器已接收');
      const done = await follow(job);
      sessionStorage.removeItem('p2e.job');
      await onChanged();
      onSelect(done.episodeSlug);
      setUrlDraft('');
      onToast('素材已导入。');
    } catch (error) {
      const failed = error as Error & { failure?: JobError; jobId?: string; continuable?: boolean };
      setImportFail({
        message: failed.message || '没有拿到音轨',
        diagnosticId: failed.failure?.diagnosticId,
        jobId: failed.jobId,
        continuable: failed.continuable,
      });
    } finally {
      setImporting(false); setImportProgress(null);
    }
  };

  const resumeInterrupted = async () => {
    if (!importFail?.jobId) return;
    const held = importFail.jobId;
    setImporting(true); setImportFail(null); setImportProgress('服务器已接收');
    try {
      const job = await continueJob(held);
      const done = await follow(job);
      await onChanged();
      onSelect(done.episodeSlug);
      onToast('素材已导入。');
    } catch (error) {
      const failed = error as Error & { failure?: JobError; jobId?: string; continuable?: boolean };
      setImportFail({ message: failed.message, diagnosticId: failed.failure?.diagnosticId, jobId: failed.jobId || held, continuable: failed.continuable === true });
    } finally {
      setImporting(false); setImportProgress(null);
    }
  };

  const retryImport = () => {
    const last = lastRef.current;
    if (last?.kind === 'file') void takeFile(last.file);
    else if (last?.kind === 'url') void takeUrl(last.url);
  };

  const beginTranscription = () => {
    if (!episode?.source) return;
    setTranscribing(true); setPaused(false);
    void (async () => {
      try {
        const job = episode.transcription?.state === 'interrupted' && episode.transcription.jobId
          ? await continueJob(episode.transcription.jobId)
          : await startTranscription(episode.slug);
        await new Promise<void>((resolve, reject) => {
          const stop = watchJob(job.id, (next) => {
            if (!jobSettled(next)) return;
            stop();
            if (next.state === 'succeeded') resolve();
            else reject(new Error(next.error?.userMessage || '转录没有完成'));
          });
        });
        await onChanged();
        onToast('初稿已生成。');
      } catch (error) {
        await onChanged();
        onToast((error as Error).message || '转录没有完成');
      } finally {
        setTranscribing(false); setPaused(false);
      }
    })();
  };

  const toggleTranscription = async () => {
    if (!episode) return;
    setControlling(true);
    try {
      const result = await controlTranscription(episode.slug, isPaused ? 'resume' : 'pause');
      setPaused(result.paused);
      await onChanged();
      onToast(result.paused ? '已暂停。' : '已继续转录。');
    } catch (error) {
      onToast((error as Error).message || '操作失败。');
    } finally { setControlling(false); }
  };

  // Server clears drafts and chunks on replace; only ask when there is something to lose.
  const replaceSource = () => {
    if (episode && (episode.hasRaw || episode.completedChunks > 0)) setConfirmReplace(true);
    else fileRef.current?.click();
  };

  const saveTitle = async () => {
    if (!episode || !titleDraft.trim()) return;
    setSavingTitle(true);
    try {
      await updateEpisodeTitle(episode.slug, titleDraft.trim());
      await onChanged();
    } catch (error) { onToast('标题未保存：' + (error as Error).message); }
    finally { setSavingTitle(false); }
  };

  const rename = async (title: string) => {
    if (!episode) return;
    try {
      await updateEpisodeTitle(episode.slug, title);
      await onChanged();
    } catch (error) {
      onToast('标题未保存：' + (error as Error).message);
      throw error;
    }
  };

  const clean = async () => {
    if (!episode?.hasRaw) return;
    setCleaning(true); setCleanFail(null);
    try {
      const job = await cleanEpisode(episode.slug);
      await new Promise<void>((resolve, reject) => {
        const stop = watchJob(job.id, (next) => {
          if (!jobSettled(next)) return;
          stop();
          if (next.state === 'succeeded') resolve();
          else reject(new Error(next.error?.userMessage || '文章整理没有完成。'));
        });
      });
      await onChanged();
      onToast('文章已生成。');
    } catch (error) {
      const message = (error as Error).message || '文章整理没有完成。';
      setCleanFail(message);
      onToast('整理失败，初稿保留。');
    }
    finally { setCleaning(false); }
  };

  return (
    <section className={`workbench${episode ? ' has-episode' : ''}`}>
      <input ref={fileRef} type="file" accept={FILE_ACCEPT} hidden onChange={(event) => void takeFile(event.target.files?.[0])} />

      {!episode && <div className="home">
        <h1 className="home-title">把视频或播客整理成文章。</h1>
        <form
          className={`intake-card${over ? ' over' : ''}`}
          noValidate
          onSubmit={(event) => {
            event.preventDefault();
            if (validDraftUrl) void takeUrl(urlDraft);
            else { setNudge(true); linkRef.current?.focus(); }
          }}
          onDragOver={(event) => { event.preventDefault(); setOver(true); }}
          onDragLeave={(event) => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setOver(false); }}
          onDrop={(event) => { event.preventDefault(); setOver(false); void takeFile(event.dataTransfer.files?.[0]); }}
        >
          <input
            id="source-link"
            data-tour="link"
            ref={linkRef}
            type="text"
            inputMode="url"
            autoComplete="off"
            aria-label="素材链接"
            aria-describedby="intake-hint"
            value={urlDraft}
            disabled={importing}
            placeholder={over ? '松开，导入这个文件' : '粘贴 B 站、抖音、播客链接，或拖入文件'}
            onChange={(event) => { setUrlDraft(event.target.value); setImportFail(null); setNudge(false); }}
          />
          <div className="intake-bar">
            <button type="button" className="file-pick" data-tour="file" disabled={importing} onClick={() => fileRef.current?.click()}>＋ 选择本地文件</button>
            <span id="intake-hint" className="intake-hint error-text" aria-live="polite">
              {urlDraft.trim() && !validDraftUrl ? '链接需以 http:// 或 https:// 开头。' : nudge ? '先粘贴链接，或选择本地文件。' : ''}
            </span>
            <button className="button primary" disabled={importing}>{importing ? '导入中' : '导入'}</button>
          </div>
        </form>
        <p className="home-steps">导入 → 转成初稿 → 整理成文<span>每一步都由你手动开始</span></p>
      </div>}

      {importing && <div className="notice working"><span className="spinner" /><div><b>{importProgress || '正在准备素材…'}</b><p>完成后自动加入资料库。</p></div></div>}
      {importFail && <div className="notice error" role="alert"><div><b>{importFail.continuable ? '导入中断' : '导入失败'}</b><p>{importFail.message}</p>{importFail.diagnosticId && <small className="diagnostic">诊断号 {importFail.diagnosticId}</small>}</div>{importFail.continuable && importFail.jobId ? <button type="button" className="text-button" onClick={() => void resumeInterrupted()}>继续</button> : lastRef.current && <button type="button" className="text-button" onClick={retryImport}>重试</button>}</div>}

      {!episode && <RecentArticles episodes={episodes} onSelect={onSelect} />}

      {episode && <>
        <Journey active={activeStep} />
        <header className="session-header">
          <div><p className="kicker">{serverState === 'interrupted' ? '转录中断' : serverState === 'failed' ? '转录失败' : episode.status === 'uploaded' ? '素材已就绪' : episode.status === 'transcribed' ? '初稿已生成' : '处理中'}</p>{unnamed ? <h1>{displayName(episode)}</h1> : <EditableTitle value={displayName(episode)} onSave={rename} />}</div>
          <span className={`state-chip ${serverState === 'failed' || serverState === 'interrupted' ? 'failed' : isWorking ? 'active' : episode.status}`}>{isPaused ? '已暂停' : isWorking ? '转录中' : serverState === 'interrupted' ? '已中断' : serverState === 'failed' ? '转录失败' : episode.status === 'uploaded' ? '待转录' : '待整理'}</span>
        </header>
        <div className="source-strip"><span className="source-icon">♪</span><div><b>{sourceLabel(episode)}</b><small>{episode.chunkCount ? `${episode.chunkCount} 段` : '原始文件已保存'}{episode.duration ? ` · ${episode.duration}` : ''}</small></div>{!isWorking && <button type="button" className="text-button" onClick={replaceSource}>更换</button>}</div>

        {unnamed && <form className="title-editor" onSubmit={(event) => { event.preventDefault(); void saveTitle(); }}><label htmlFor="episode-title">先命名，再开始转录。</label><input id="episode-title" value={titleDraft} onChange={(event) => setTitleDraft(event.target.value)} placeholder="节目名 · 主题" /><button className="button quiet" disabled={savingTitle || !titleDraft.trim()}>{savingTitle ? '保存中' : '保存'}</button></form>}

        {episode.status === 'uploaded' && !isWorking && !episode.transcription && <div className="focus-card"><p className="card-eyebrow">下一步</p><h2>转成逐字初稿。</h2><p>按约 3 分钟分段识别，消耗转录额度；可随时暂停或稍后继续。</p><button type="button" className="button primary large" disabled={unnamed} onClick={beginTranscription}>开始转录</button></div>}

        {episode.status === 'uploaded' && !isWorking && !episode.transcription && <div className="focus-card dim" aria-disabled="true"><p className="card-eyebrow">第 3 步</p><h2>整理成文章。</h2><p>初稿生成后点亮，初稿和分段稿保留备查。</p><button type="button" className="button primary large" disabled>整理成文章</button></div>}

        {isWorking && <div className="focus-card processing"><div className="progress-head"><div><p className="card-eyebrow">{isPaused ? '已暂停' : '正在转录'}</p><h2>{isPaused ? `已暂停 · ${progressText(episode)}` : progressText(episode)}</h2></div><span className="pulse" /></div><div className="inst-track" role="progressbar" aria-label="转录进度" aria-valuemin={0} aria-valuemax={episode.chunkCount || 1} aria-valuenow={Math.min(episode.completedChunks, episode.chunkCount || 1)}><span className="playhead" aria-hidden="true" style={{ left: `${episode.chunkCount ? Math.min(100, episode.completedChunks / episode.chunkCount * 100) : 8}%` }} />{Array.from({ length: episode.chunkCount || 1 }, (_, i) => <span key={i} className={`tick${i < episode.completedChunks ? ' done' : i === episode.completedChunks && !isPaused ? ' now' : ''}`} />)}</div><p>{isPaused ? '已完成部分已保存，继续时从断点接续。' : '可离开页面，任务在后台保留。'}</p><button type="button" className="button quiet" disabled={controlling} onClick={toggleTranscription}>{controlling ? '请稍候' : isPaused ? '继续转录' : '暂停'}</button></div>}

        {isWorking && <div className="focus-card dim" aria-disabled="true"><p className="card-eyebrow">第 3 步</p><h2>整理成文章。</h2><p>初稿生成后点亮。</p><button type="button" className="button primary large" disabled>整理成文章</button></div>}

        {episode.status === 'uploaded' && !isWorking && episode.transcription?.state === 'interrupted' && <div className="focus-card blocked"><p className="card-eyebrow">转录中断</p><h2>任务因服务重启中断，已完成内容仍在，可以继续。</h2><p>已完成的片段会直接复用，不会重新请求转录。</p><button type="button" className="button primary" disabled={unnamed} onClick={beginTranscription}>继续</button></div>}

        {episode.status === 'uploaded' && !isWorking && episode.transcription?.state === 'failed' && <div className="focus-card blocked"><p className="card-eyebrow">转录失败</p><h2>{episode.transcription.error?.includes('额度') ? '转录额度已用尽。' : '转录未完成。'}</h2><p>{episode.transcription.error?.includes('额度') ? '额度恢复或充值后再继续。' : episode.transcription.error || '可以稍后继续。'}</p>{episode.transcription.diagnosticId && <small className="diagnostic">诊断号 {episode.transcription.diagnosticId}</small>}<div className="recovery-note">{episode.completedChunks > 0 ? `已保存 ${episode.completedChunks} / ${episode.chunkCount} 段，继续时从断点接续。` : `尚未完成任何片段，共 ${episode.chunkCount || 1} 段。`}</div><div className="recovery-actions">{episode.transcription.error?.includes('额度') && <a className="button quiet link-button" href="https://platform.stepfun.com/" target="_blank" rel="noreferrer">查看额度</a>}<button type="button" className="button primary" disabled={unnamed} onClick={beginTranscription}>{episode.completedChunks > 0 ? '继续' : '重试'}</button></div></div>}

        {episode.status === 'transcribed' && <div className="focus-card"><p className="card-eyebrow">初稿已生成</p><h2>整理成文章。</h2><p>{cleaning ? '正在整理，完成前不会覆盖已有文章。' : '初稿和分段稿保留备查；未通过结构检查的结果不会写入文章。'}</p><button type="button" className="button primary large" disabled={cleaning} onClick={clean}>{cleaning ? '整理中' : '整理成文章'}</button>{cleanFail && <div className="inline-error" role="alert"><b>未生成文章</b><span>{cleanFail}</span><small>初稿和已有文章未被覆盖。</small></div>}</div>}

        {confirmReplace && <ConfirmDialog
          title="更换音轨？"
          detail={`会删除现有${episode.hasRaw ? '初稿和分段稿' : '已转录的片段'}，之后需要重新转录，会消耗转录额度。标题保留。`}
          confirmLabel="更换并清空"
          onCancel={() => setConfirmReplace(false)}
          onConfirm={() => { setConfirmReplace(false); fileRef.current?.click(); }}
        />}

        {logs.length > 0 && <details className="process-details"><summary>处理日志</summary><pre>{logs.join('\n')}</pre></details>}
      </>}
    </section>
  );
}

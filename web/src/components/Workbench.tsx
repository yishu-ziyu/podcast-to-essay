import { useEffect, useRef, useState } from 'react';
import { Episode, cleanEpisode, controlTranscription, createEpisode, ingestUrlStream, transcribeStream, updateEpisodeTitle, uploadAudio } from '../api';
import { displayName, extractUrl, slugFromFile } from '../lib';

interface Props {
  episode: Episode | null;
  episodes: Episode[];
  onChanged: () => Promise<void> | void;
  onSelect: (slug: string) => void;
  onToast: (msg: string | null) => void;
}

const FILE_ACCEPT = ['audio/*', 'video/*', '.mp3', '.wav', '.m4a', '.flac', '.ogg', '.mp4', '.mov', '.mkv', '.webm'].join(',');

function sourceLabel(episode: Episode) {
  if (episode.sourceUrl) {
    try { return new URL(episode.sourceUrl).hostname.replace(/^www\./, ''); } catch { return '链接素材'; }
  }
  return episode.originalName || episode.source || '音轨';
}

function progressText(episode: Episode) {
  if (!episode.chunkCount) return '正在准备音轨';
  return `已完成 ${episode.completedChunks} / ${episode.chunkCount} 段`;
}

export default function Workbench({ episode, episodes, onChanged, onSelect, onToast }: Props) {
  const fileRef = useRef<HTMLInputElement>(null);
  const lastRef = useRef<{ kind: 'file'; file: File } | { kind: 'url'; url: string } | null>(null);
  const [urlDraft, setUrlDraft] = useState('');
  const [over, setOver] = useState(false);
  const [importing, setImporting] = useState(false);
  const [importProgress, setImportProgress] = useState<string | null>(null);
  const [importFail, setImportFail] = useState<string | null>(null);
  const [transcribing, setTranscribing] = useState(false);
  const [paused, setPaused] = useState(false);
  const [controlling, setControlling] = useState(false);
  const [logs, setLogs] = useState<string[]>([]);
  const [cleaning, setCleaning] = useState(false);
  const [cleanFail, setCleanFail] = useState<string | null>(null);
  const [titleDraft, setTitleDraft] = useState('');
  const [savingTitle, setSavingTitle] = useState(false);

  const serverState = episode?.transcription?.state;
  const isWorking = transcribing || serverState === 'running' || serverState === 'paused';
  const isPaused = paused || serverState === 'paused';
  const unnamed = Boolean(episode && !episode.title && !episode.originalName);
  const validDraftUrl = extractUrl(urlDraft);

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

  const ensureSlug = async (make: () => string) => {
    let slug = episode?.slug;
    if (!slug || episode?.cleaned) {
      slug = make();
      await createEpisode(slug);
      onSelect(slug);
    }
    return slug;
  };

  const takeFile = async (file?: File) => {
    if (!file) return;
    lastRef.current = { kind: 'file', file };
    setImporting(true); setImportFail(null); setImportProgress('正在放好你的文件…');
    try {
      const slug = await ensureSlug(() => slugFromFile(file.name, episodes.map((item) => item.slug)));
      await uploadAudio(slug, file);
      await onChanged();
      onSelect(slug);
      onToast('音轨已经就位。');
    } catch (error) {
      setImportFail((error as Error).message || '上传失败');
    } finally {
      setImporting(false); setImportProgress(null);
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  const takeUrl = async (raw: string) => {
    const url = extractUrl(raw);
    if (!url) { setImportFail('请贴一条完整的链接。'); return; }
    lastRef.current = { kind: 'url', url };
    setImporting(true); setImportFail(null); setImportProgress('正在读取素材信息…');
    try {
      let readySlug = '';
      await new Promise<void>((resolve, reject) => {
        ingestUrlStream(url, {
          onProgress: setImportProgress,
          onReady: ({ slug }) => { readySlug = slug; resolve(); },
          onFailed: (message) => reject(new Error(message)),
        });
      });
      await onChanged();
      onSelect(readySlug);
      setUrlDraft('');
      onToast('音轨已经就位。');
    } catch (error) {
      setImportFail((error as Error).message || '没有拿到音轨');
    } finally {
      setImporting(false); setImportProgress(null);
    }
  };

  const retryImport = () => {
    const last = lastRef.current;
    if (last?.kind === 'file') void takeFile(last.file);
    else if (last?.kind === 'url') void takeUrl(last.url);
  };

  const startTranscription = () => {
    if (!episode?.source) return;
    setTranscribing(true); setPaused(false); setLogs([]);
    transcribeStream(episode.slug, {
      onLog: (line) => {
        setLogs((old) => [...old, line].slice(-16));
      },
      onDone: async (code) => {
        setTranscribing(false); setPaused(false);
        await onChanged();
        onToast(code === 0 ? '初稿已经准备好。' : null);
      },
    });
  };

  const toggleTranscription = async () => {
    if (!episode) return;
    setControlling(true);
    try {
      const result = await controlTranscription(episode.slug, isPaused ? 'resume' : 'pause');
      setPaused(result.paused);
      await onChanged();
      onToast(result.paused ? '已暂停，可以放心离开。' : '继续转录。');
    } catch (error) {
      onToast((error as Error).message || '没能改变转录状态。');
    } finally { setControlling(false); }
  };

  const saveTitle = async () => {
    if (!episode || !titleDraft.trim()) return;
    setSavingTitle(true);
    try {
      await updateEpisodeTitle(episode.slug, titleDraft.trim());
      await onChanged();
    } catch (error) { onToast('标题没有保存：' + (error as Error).message); }
    finally { setSavingTitle(false); }
  };

  const clean = async () => {
    if (!episode?.hasRaw) return;
    setCleaning(true); setCleanFail(null);
    try {
      const result = await cleanEpisode(episode.slug);
      await onChanged();
      onToast(`文章已由 ${result.model} 整理好。`);
    } catch (error) {
      const message = (error as Error).message || '文章整理没有完成。';
      setCleanFail(message);
      onToast('整理失败，初稿仍然保留。');
    }
    finally { setCleaning(false); }
  };

  return (
    <section className={`workbench${episode ? ' has-episode' : ''}`}>
      <input ref={fileRef} type="file" accept={FILE_ACCEPT} hidden onChange={(event) => void takeFile(event.target.files?.[0])} />

      {!episode && <>
        <header className="welcome">
          <p className="kicker">把声音留下来</p>
          <h1>从一段声音开始。</h1>
          <p>先收好素材；转录与整理由你决定何时开始。原文件、初稿和文章始终留在同一卷里。</p>
        </header>
        <div className="composer">
          <label htmlFor="source-link">贴一个视频、播客或网页链接</label>
          <form onSubmit={(event) => { event.preventDefault(); void takeUrl(urlDraft); }}>
            <input id="source-link" type="url" value={urlDraft} disabled={importing} placeholder="https://…" onChange={(event) => { setUrlDraft(event.target.value); setImportFail(null); }} />
            <button className="button primary" disabled={importing || !validDraftUrl}>{importing ? '准备中' : '取音轨'}</button>
          </form>
          {urlDraft.trim() && !validDraftUrl && <p className="field-hint error-text">请输入以 http:// 或 https:// 开头的完整链接。</p>}
          <div className="or"><span /> 或 <span /></div>
          <button type="button" className={`file-drop${over ? ' over' : ''}`} disabled={importing} onClick={() => fileRef.current?.click()} onDragOver={(event) => { event.preventDefault(); setOver(true); }} onDragLeave={() => setOver(false)} onDrop={(event) => { event.preventDefault(); setOver(false); void takeFile(event.dataTransfer.files?.[0]); }}>
            <b>选择或拖进一个音频、视频文件</b><small>支持 MP3、MP4、M4A、WAV 等常见格式</small>
          </button>
        </div>
        <ol className="flow-expectation"><li><b>01</b> 收好素材</li><li><b>02</b> 转成初稿</li><li><b>03</b> 整理成文</li></ol>
      </>}

      {importing && <div className="notice working"><span className="spinner" /><div><b>{importProgress || '正在准备素材…'}</b><p>不需要停在这里，完成后会放进资料库。</p></div></div>}
      {importFail && <div className="notice error"><div><b>这次没有拿到音轨</b><p>{importFail}</p></div>{lastRef.current && <button type="button" className="text-button" onClick={retryImport}>再试一次</button>}</div>}

      {episode && <>
        <header className="session-header">
          <div><p className="kicker">{serverState === 'failed' ? '转录遇到问题' : episode.status === 'uploaded' ? '素材已就绪' : episode.status === 'transcribed' ? '初稿已就绪' : '进行中'}</p><h1>{displayName(episode)}</h1></div>
          <span className={`state-chip ${serverState === 'failed' ? 'failed' : isWorking ? 'active' : episode.status}`}>{isPaused ? '已暂停' : isWorking ? '转录中' : serverState === 'failed' ? '需要处理' : episode.status === 'uploaded' ? '待转录' : '待整理'}</span>
        </header>
        <div className="source-strip"><span className="source-icon">♪</span><div><b>{sourceLabel(episode)}</b><small>{episode.chunkCount ? `${episode.chunkCount} 段素材` : '原始文件已保存'}{episode.duration ? ` · ${episode.duration}` : ''}</small></div><button type="button" className="text-button" onClick={() => fileRef.current?.click()}>换素材</button></div>

        {unnamed && <form className="title-editor" onSubmit={(event) => { event.preventDefault(); void saveTitle(); }}><label htmlFor="episode-title">给这卷起个名字，再开始。</label><input id="episode-title" value={titleDraft} onChange={(event) => setTitleDraft(event.target.value)} placeholder="例如：节目名 · 主题" /><button className="button quiet" disabled={savingTitle || !titleDraft.trim()}>{savingTitle ? '保存中' : '保存'}</button></form>}

        {episode.status === 'uploaded' && !isWorking && !episode.transcription && <div className="focus-card"><p className="card-eyebrow">下一步</p><h2>把它转成可读的初稿。</h2><p>会按约 3 分钟分段识别并使用转录额度；开始后可暂停、离开或稍后继续。</p><button type="button" className="button primary large" disabled={unnamed} onClick={startTranscription}>开始转录</button></div>}

        {isWorking && <div className="focus-card processing"><div className="progress-head"><div><p className="card-eyebrow">{isPaused ? '已暂停' : '正在转录'}</p><h2>{isPaused ? `停在 ${progressText(episode)}` : progressText(episode)}</h2></div><span className="pulse" /></div><div className="progress-track"><i style={{ width: episode.chunkCount ? `${Math.min(100, episode.completedChunks / episode.chunkCount * 100)}%` : '8%' }} /></div><p>{isPaused ? '已完成的内容已经保存。继续后会从这里接上。' : '可以离开这个页面；这卷会继续留在资料库里。'}</p><button type="button" className="button quiet" disabled={controlling} onClick={toggleTranscription}>{controlling ? '处理中' : isPaused ? '继续转录' : '暂停'}</button></div>}

        {episode.status === 'uploaded' && !isWorking && episode.transcription?.state === 'failed' && <div className="focus-card blocked"><p className="card-eyebrow">需要处理</p><h2>{episode.transcription.error?.includes('额度') ? '转录额度已用尽。' : '这次转录没有完成。'}</h2><p>{episode.transcription.error || '完成的片段已经保留，准备好后可从这里继续。'}</p><div className="recovery-note">{episode.completedChunks > 0 ? `已保存 ${episode.completedChunks} / ${episode.chunkCount} 段，下次会从这里接上。` : `尚未完成任何片段，共 ${episode.chunkCount || 1} 段。`}</div><div className="recovery-actions">{episode.transcription.error?.includes('额度') && <a className="button quiet link-button" href="https://platform.stepfun.com/" target="_blank" rel="noreferrer">打开额度控制台</a>}<button type="button" className="button primary" disabled={unnamed} onClick={startTranscription}>{episode.completedChunks > 0 ? '继续转录' : '重试转录'}</button></div></div>}

        {episode.status === 'transcribed' && <div className="focus-card"><p className="card-eyebrow">初稿已就绪</p><h2>现在，把口语整理成文章。</h2><p>{cleaning ? '正在通读完整初稿、提炼结构并重新成文。完成前不会把草稿标成文章。' : '会保留初稿和分段稿，方便之后核对；只有通过结构检查的结果才会进入文章页。'}</p><button type="button" className="button primary large" disabled={cleaning} onClick={clean}>{cleaning ? '正在整理…' : '整理成文章'}</button>{cleanFail && <div className="inline-error" role="alert"><b>这次没有生成文章</b><span>{cleanFail}</span><small>初稿和之前的文章都没有被覆盖。</small></div>}</div>}

        {logs.length > 0 && <details className="process-details"><summary>查看处理细节</summary><pre>{logs.join('\n')}</pre></details>}
      </>}
    </section>
  );
}

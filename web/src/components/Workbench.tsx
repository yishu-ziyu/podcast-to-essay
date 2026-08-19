import { useEffect, useRef, useState } from 'react';
import { Episode, cleanEpisode, createEpisode, getTranscript, ingestUrlStream, transcribeStream, uploadAudio } from '../api';
import { currentStep, displayName, extractUrl, slugFromFile, slugFromUrl } from '../lib';

interface Props {
  episode: Episode | null;
  episodes: Episode[];
  onChanged: () => Promise<void> | void;
  onSelect: (slug: string) => void;
  onToast: (msg: string | null) => void;
}

const FILE_ACCEPT = [
  'audio/*',
  'video/*',
  '.mp3', '.wav', '.m4a', '.aac', '.flac', '.ogg', '.opus', '.wma', '.aiff', '.aif', '.caf', '.amr', '.mka', '.weba',
  '.mp4', '.m4v', '.mov', '.mkv', '.webm', '.avi', '.ts', '.mpeg', '.mpg', '.3gp',
].join(',');

function formatSize(n: number) {
  if (n < 1024 * 1024) return `${Math.max(1, Math.round(n / 1024))} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

function urlFromDrop(dt: DataTransfer): string | null {
  const uri = dt.getData('text/uri-list')
    .split('\n')
    .map((s) => s.trim())
    .find((s) => s && !s.startsWith('#') && /^https?:\/\//i.test(s));
  if (uri) return uri;
  return extractUrl(dt.getData('text/plain') || dt.getData('text') || '');
}

export default function Workbench({ episode, episodes, onChanged, onSelect, onToast }: Props) {
  const fileRef = useRef<HTMLInputElement>(null);
  const lastRef = useRef<{ kind: 'file'; file: File } | { kind: 'url'; url: string } | null>(null);
  const [over, setOver] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [uploadFail, setUploadFail] = useState<string | null>(null);
  const [localName, setLocalName] = useState<string | null>(null);
  const [localSize, setLocalSize] = useState<number | null>(null);
  const [urlDraft, setUrlDraft] = useState('');
  const [transcribing, setTranscribing] = useState(false);
  const [logs, setLogs] = useState<string[]>([]);
  const [cleaning, setCleaning] = useState(false);
  const [rawText, setRawText] = useState('');

  const step = currentStep(episode);

  useEffect(() => {
    setUploadFail(null);
    setLocalName(episode?.originalName || episode?.title || episode?.source || null);
    setLocalSize(null);
    setLogs([]);
    setRawText('');
    if (episode?.hasRaw) {
      getTranscript(episode.slug, 'raw').then(setRawText).catch(() => setRawText(''));
    }
  }, [episode?.slug, episode?.source, episode?.hasRaw, episode?.originalName]);

  useEffect(() => {
    if (step !== 1) return;
    const onPaste = (e: ClipboardEvent) => {
      const tag = (e.target as HTMLElement | null)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA') return;
      const url = extractUrl(e.clipboardData?.getData('text') || '');
      if (!url) return;
      e.preventDefault();
      void takeUrl(url);
    };
    window.addEventListener('paste', onPaste);
    return () => window.removeEventListener('paste', onPaste);
  });

  const ensureSlug = async (make: () => string) => {
    let slug = episode?.slug;
    if (!slug || episode?.cleaned) {
      slug = make();
      await createEpisode(slug);
      onSelect(slug);
    }
    return slug;
  };

  const takeFile = async (file: File | undefined) => {
    if (!file) return;
    lastRef.current = { kind: 'file', file };
    setUploading(true);
    setUploadFail(null);
    setLocalName(file.name);
    setLocalSize(file.size);
    setLogs([]);
    try {
      const slug = await ensureSlug(() => slugFromFile(file.name, episodes.map((e) => e.slug)));
      await uploadAudio(slug, file);
      onToast(`音轨已落下：${file.name}`);
      await onChanged();
    } catch (err) {
      setUploadFail((err as Error).message || '上传失败');
      onToast('上传失败: ' + (err as Error).message);
      await onChanged();
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  const takeUrl = async (raw: string) => {
    const url = extractUrl(raw);
    if (!url) {
      onToast('这不是一条能打开的链接');
      return;
    }
    lastRef.current = { kind: 'url', url };
    setUploading(true);
    setUploadFail(null);
    setLocalName(url);
    setLocalSize(null);
    setLogs([]);
    setUrlDraft(url);
    try {
      const slug = await ensureSlug(() => slugFromUrl(url, episodes.map((e) => e.slug)));
      await new Promise<void>((resolve, reject) => {
        let fail = '拉取失败';
        ingestUrlStream(slug, url, {
          onLog: (line) => {
            if (line.startsWith('❌')) fail = line.replace(/^❌\s*/, '');
            setLogs((l) => [...l, line].slice(-12));
          },
          onDone: (code) => { if (code === 0) resolve(); else reject(new Error(fail)); },
        });
      });
      onToast('链接里的音轨已落下');
      await onChanged();
    } catch (err) {
      setUploadFail((err as Error).message || '拉取失败');
      onToast('拉取失败: ' + (err as Error).message);
      await onChanged();
    } finally {
      setUploading(false);
    }
  };

  const retry = () => {
    const last = lastRef.current;
    if (last?.kind === 'file') return void takeFile(last.file);
    if (last?.kind === 'url') return void takeUrl(last.url);
    fileRef.current?.click();
  };

  const onTranscribe = () => {
    if (!episode?.source) { onToast('先投音轨'); return; }
    setTranscribing(true);
    setLogs([]);
    transcribeStream(episode.slug, {
      onLog: (line) => setLogs((l) => [...l, line].slice(-12)),
      onDone: async (code) => {
        setTranscribing(false);
        onToast(code === 0 ? '转录完了，可以洗' : `转录停了（退出码 ${code}）`);
        await onChanged();
      },
    });
  };

  const onClean = async () => {
    if (!episode?.hasRaw) { onToast('先转录，再洗'); return; }
    setCleaning(true);
    try {
      const result = await cleanEpisode(episode.slug);
      onToast(result.method === 'ai' ? '混元洗过了' : '按规则洗过了。设 HUNYUAN_API_KEY 才走模型');
      await onChanged();
    } catch (e) {
      onToast('清洗失败: ' + (e as Error).message);
    } finally {
      setCleaning(false);
    }
  };

  return (
    <section className="job">
      <input
        ref={fileRef}
        type="file"
        accept={FILE_ACCEPT}
        hidden
        onChange={(e) => takeFile(e.target.files?.[0])}
      />

      {episode && (
        <div className="job-bar">
          <div className="job-name">{displayName(episode)}</div>
          <ol className="steps" aria-label="这一卷做到哪一步">
            <li className={step === 1 ? 'now' : step > 1 ? 'done' : ''}>投</li>
            <li className={step === 2 ? 'now' : step > 2 ? 'done' : ''}>转</li>
            <li className={step === 3 ? 'now' : ''}>洗</li>
          </ol>
        </div>
      )}

      {step === 1 && (
        <>
          <button
            type="button"
            id="drop"
            className={`dropzone job-drop${over ? ' is-over' : ''}`}
            disabled={uploading}
            onClick={() => fileRef.current?.click()}
            onDragOver={(e) => { e.preventDefault(); setOver(true); }}
            onDragLeave={() => setOver(false)}
            onDrop={(e) => {
              e.preventDefault();
              setOver(false);
              if (e.dataTransfer.files?.[0]) {
                void takeFile(e.dataTransfer.files[0]);
                return;
              }
              const url = urlFromDrop(e.dataTransfer);
              if (url) void takeUrl(url);
            }}
          >
            <span className="arrow" aria-hidden>↓</span>
            <b>{uploading ? '音轨落下…' : '把音轨或链接投进来'}</b>
            <small>音频、视频、B站 / 抖音 / 播客链接。丢进来就开始这一卷。</small>
          </button>
          <form
            className="url-row"
            onSubmit={(e) => {
              e.preventDefault();
              void takeUrl(urlDraft);
            }}
          >
            <input
              value={urlDraft}
              disabled={uploading}
              placeholder="或贴链接，回车"
              onChange={(e) => setUrlDraft(e.target.value)}
            />
            <button type="submit" className="btn-primary" disabled={uploading || !urlDraft.trim()}>取</button>
          </form>
        </>
      )}

      {uploadFail && (
        <div className="row">
          <div className="ico bad">!</div>
          <div>
            <div className="name">{localName}</div>
            <div className="meta bad">{uploadFail}</div>
          </div>
          <button type="button" className="try" onClick={retry}>Try Again</button>
        </div>
      )}

      {step === 1 && (uploading || logs.length > 0) && (
        <pre className="logs">{logs.join('\n') || '正在收…'}</pre>
      )}

      {step === 2 && episode && (
        <div className="job-body">
          <div className="files">
            <div className="row">
              <div className="ico ok">♪</div>
              <div>
                <div className="name">{localName || episode.originalName || episode.title || episode.source}</div>
                <div className="meta">
                  {localSize != null ? formatSize(localSize) : '已在柜子里'}
                  {episode.chunkCount > 0 ? ` · ${episode.chunkCount} 块` : ''}
                </div>
              </div>
              <button type="button" className="icon-btn" onClick={() => fileRef.current?.click()}>换</button>
            </div>
          </div>
          {!transcribing && (
            <button type="button" className="btn-primary job-cta" onClick={onTranscribe}>
              开始转录
            </button>
          )}
          {transcribing && <p className="wait">正在切成约 3 分钟一块，逐段识别。</p>}
          {(transcribing || logs.length > 0) && (
            <pre className="logs">{logs.join('\n') || 'ffmpeg 在切块…'}</pre>
          )}
        </div>
      )}

      {step === 3 && episode && !episode.cleaned && (
        <div className="job-body">
          <p className="wait">原文带时间戳。洗一遍，时间戳会掉下去，合成段落。</p>
          <button type="button" className="btn-primary job-cta" disabled={cleaning} onClick={onClean}>
            {cleaning ? '在洗…' : '洗一遍'}
          </button>
          <pre className="instrument job-raw">{rawText || '在取原文…'}</pre>
        </div>
      )}
    </section>
  );
}

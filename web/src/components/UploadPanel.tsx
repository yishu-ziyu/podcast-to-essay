import { useRef, useState } from 'react';
import { Episode, uploadAudio, transcribeStream } from '../api';

interface Props {
  episode: Episode;
  onChanged: () => void;
  onToast: (msg: string | null) => void;
}

export default function UploadPanel({ episode, onChanged, onToast }: Props) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [transcribing, setTranscribing] = useState(false);
  const [logs, setLogs] = useState<string[]>([]);

  const onFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    try {
      await uploadAudio(episode.slug, file);
      onToast(`已上传 ${file.name}`);
      await onChanged();
    } catch (err) {
      onToast('上传失败: ' + (err as Error).message);
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  const onTranscribe = () => {
    if (!episode.source) { onToast('请先上传音频'); return; }
    setTranscribing(true);
    setLogs([]);
    transcribeStream(episode.slug, {
      onLog: (line) => setLogs((l) => [...l, line].slice(-200)),
      onDone: async (code) => {
        setTranscribing(false);
        onToast(code === 0 ? '转录完成 ✅' : `转录结束（退出码 ${code}）`);
        await onChanged();
      },
    });
  };

  return (
    <section className="panel upload-panel">
      <div className="panel-title">
        <span>{episode.slug}</span>
        {episode.source && <span className="muted">源文件: {episode.source}</span>}
      </div>

      <div className="actions">
        <input
          ref={fileRef}
          type="file"
          accept="audio/*"
          style={{ display: 'none' }}
          onChange={onFile}
        />
        <button className="btn-primary" disabled={uploading} onClick={() => fileRef.current?.click()}>
          {uploading ? '上传中…' : episode.source ? '重新上传音频' : '上传音频'}
        </button>
        <button className="btn-secondary" disabled={transcribing || !episode.source} onClick={onTranscribe}>
          {transcribing ? '转录中…' : '▶ 开始转录'}
        </button>
        {episode.hasRaw && (
          <span className="muted small">{episode.chunkCount} chunks · asr_raw.txt 就绪</span>
        )}
      </div>

      {logs.length > 0 && (
        <pre className="logs">{logs.join('\n')}</pre>
      )}
    </section>
  );
}

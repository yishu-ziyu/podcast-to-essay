export const JOB_STATES = ['queued', 'running', 'paused', 'succeeded', 'failed', 'interrupted', 'cancelled'];
export const ACTIVE_STATES = new Set(['queued', 'running', 'paused']);
export const TERMINAL_STATES = new Set(['succeeded', 'failed', 'cancelled']);

const STAGE_LABEL = {
  checking_url: '检查链接',
  reading_info: '读取视频信息',
  downloading_media: '下载媒体',
  extracting_audio: '提取音频',
  source_saved: '已保存素材',
  waiting_transcription: '等待转录',
  transcribing: '正在转录',
  writing_article: '正在整理',
};

export function isActive(state) {
  return ACTIVE_STATES.has(state);
}

// Projection is what the page renders. The job file remains the fact.
export function projectJob(job) {
  if (!job) return null;
  const percent = job.stage === 'downloading_media' && Number.isFinite(job.progress) ? job.progress : null;
  let label = STAGE_LABEL[job.stage] || '处理中';
  if (job.state === 'queued') label = '服务器已接收';
  else if (job.state === 'interrupted') label = '任务因服务重启中断，已完成内容仍在，可以继续。';
  else if (job.state === 'paused') label = '已暂停';
  else if (percent != null) label = `${label} · ${percent}%`;
  return {
    id: job.id,
    type: job.type,
    episodeSlug: job.episodeSlug,
    sourceUrl: job.sourceUrl || null,
    state: job.state,
    stage: job.stage,
    progress: percent,
    label,
    error: job.error || null,
    result: job.result || null,
    createdAt: job.createdAt,
    updatedAt: job.updatedAt,
    startedAt: job.startedAt,
    finishedAt: job.finishedAt,
    requestId: job.requestId || null,
  };
}

export function publicReceipt(job) {
  return {
    jobId: job.id,
    episodeSlug: job.episodeSlug,
    state: job.state,
    requestId: job.requestId || null,
    type: job.type,
  };
}

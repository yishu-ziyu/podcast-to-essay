import { randomUUID } from 'node:crypto';

export const ERROR_CODES = [
  'invalid_source_url',
  'unsupported_page',
  'extractor_unavailable',
  'extractor_outdated',
  'login_required',
  'platform_refused',
  'no_media_found',
  'timeout',
  'file_too_large',
  'disk_full',
  'transcription_auth_failed',
  'transcription_quota_exhausted',
  'internal_error',
];

const RETRYABLE = new Set([
  'extractor_outdated',
  'platform_refused',
  'timeout',
  'disk_full',
  'internal_error',
  // Transcription resumes from the failed chunk once the quota is topped up.
  'transcription_quota_exhausted',
]);

// Node's fetch reports an unreachable service as TypeError('fetch failed') with the socket error in `cause`.
const NETWORK_CODES = new Set(['ECONNRESET', 'ECONNREFUSED', 'ENOTFOUND', 'EAI_AGAIN', 'EHOSTUNREACH', 'ENETUNREACH', 'UND_ERR_SOCKET', 'UND_ERR_CONNECT_TIMEOUT']);

export function isNetworkError(err) {
  return (err?.name === 'TypeError' && err?.message === 'fetch failed')
    || NETWORK_CODES.has(err?.cause?.code)
    || NETWORK_CODES.has(err?.code);
}

export function platformLabel(platform) {
  if (platform === 'bilibili') return 'B 站';
  if (platform === 'douyin') return '抖音';
  if (platform === 'direct') return '这个文件';
  return '该站点';
}

export function messageFor(code, platform = 'unknown') {
  const name = platformLabel(platform);
  switch (code) {
    case 'invalid_source_url':
      return '这不是一条能导入的链接。';
    case 'unsupported_page':
      return '这不是具体的视频或音频。请打开要导入的那一条，再复制分享链接。';
    case 'extractor_unavailable':
      return '服务器上的下载组件无法启动。请先修复 yt-dlp 或 ffmpeg 后再试。';
    case 'extractor_outdated':
      return '下载组件版本过旧，请更新后重试。';
    case 'login_required':
      return `${name}要求登录后才能读取这个内容。可以改用本地文件，或由管理员配置 cookies 后再试。`;
    case 'platform_refused':
      return `${name}拒绝了这次读取。请稍后重试，或改用本地文件。`;
    case 'no_media_found':
      return `没有从${name}拿到可转录的音频。请确认链接是具体视频，或改用本地文件。`;
    case 'timeout':
      return '下载超时。请重试，或改用本地文件。';
    case 'file_too_large':
      return '文件超过 1.5 GB，无法导入。';
    case 'disk_full':
      return '服务器磁盘空间不足，导入已停止。请腾出空间后再试。';
    case 'transcription_auth_failed':
      return '转录服务授权失效，请检查设置后重试。';
    case 'transcription_quota_exhausted':
      return '转录服务额度已用尽。补充额度后可以从这一段继续。';
    default:
      return '服务器内部出错。请稍后重试。';
  }
}

export function makeError({ code, userMessage, stage, diagnosticId, retryable, platform }) {
  const safeCode = ERROR_CODES.includes(code) ? code : 'internal_error';
  return {
    code: safeCode,
    userMessage: userMessage || messageFor(safeCode, platform),
    retryable: retryable ?? RETRYABLE.has(safeCode),
    stage: stage || 'internal',
    diagnosticId: diagnosticId || randomUUID(),
  };
}

export function failureForClassification(classified) {
  if (classified.kind === 'invalid_url') {
    return makeError({
      code: 'invalid_source_url',
      userMessage: classified.reason || messageFor('invalid_source_url'),
      stage: 'checking_url',
      retryable: false,
    });
  }
  return makeError({
    code: 'unsupported_page',
    userMessage: classified.reason || messageFor('unsupported_page', classified.platform),
    stage: 'checking_url',
    retryable: false,
    platform: classified.platform,
  });
}

function codeFromExtractorText(text) {
  const body = String(text || '');
  if (/python3/.test(body) && /No such file or directory/.test(body)) return 'extractor_unavailable';
  if (/ffmpeg.*(not found|No such file)|ffprobe.*(not found|No such file)/i.test(body)) return 'extractor_unavailable';
  if (/yt-dlp: not found|command not found/i.test(body)) return 'extractor_unavailable';
  if (/login required|requires login|sign in to|use --cookies|this video is private/i.test(body)) return 'login_required';
  if (/HTTP Error 401|HTTP Error 403|HTTP Error 412|Precondition Failed/i.test(body)) return 'platform_refused';
  if (/timed out|timeout|超时/i.test(body)) return 'timeout';
  if (/No space left on device|ENOSPC/i.test(body)) return 'disk_full';
  return '';
}

export function interpretExtractor(text, platform, stage) {
  const code = codeFromExtractorText(text) || 'no_media_found';
  return makeError({ code, stage: stage || 'downloading_media', platform });
}

export function failureFromUnknown(err, { platform = 'unknown', stage = 'internal' } = {}) {
  if (err?.failure?.code) return err.failure;
  if (err?.code === 'extractor_unavailable' || err?.code === 'ENOENT') {
    return makeError({ code: 'extractor_unavailable', stage, platform });
  }
  if (err?.code === 'extractor_outdated' || err?.code === 'YTDLP_OUTDATED') {
    return makeError({ code: 'extractor_outdated', stage, platform });
  }
  if (err?.name === 'TimeoutError' || err?.code === 'timeout' || err?.code === 'ETIMEDOUT' || err?.code === 'ABORT_ERR') {
    return makeError({ code: 'timeout', stage, platform });
  }
  if (err?.code === 'ENOSPC' || err?.code === 'disk_full') {
    return makeError({ code: 'disk_full', stage, platform });
  }
  if (err?.code === 'file_too_large') return makeError({ code: 'file_too_large', stage, platform });
  // Before the ERROR_CODES branch: callers tag unknown errors as internal_error with the raw message.
  if (isNetworkError(err)) {
    return makeError({ code: 'internal_error', userMessage: '网络连不上外部服务。已完成的部分已保存，稍后重试即可。', stage, platform });
  }
  if (ERROR_CODES.includes(err?.code)) {
    return makeError({ code: err.code, userMessage: err.userMessage, stage, platform });
  }
  const fromText = codeFromExtractorText(err?.output || '');
  if (fromText) return makeError({ code: fromText, stage, platform });
  return makeError({ code: 'internal_error', stage, platform });
}

// transcribe.mjs reports a coded failure on an `@@error` line; without one, its last `❌` line is the message.
export function failureFromTranscriber(coded, stderrTail, { diagnosticId } = {}) {
  if (coded?.code) return makeError({ code: coded.code, userMessage: coded.userMessage, stage: 'transcribing', diagnosticId });
  return failureFromUnknown(
    Object.assign(new Error(stderrTail || '转录没有完成'), { code: 'internal_error', userMessage: stderrTail || '转录未完成，已完成的片段已保留。' }),
    { stage: 'transcribing' },
  );
}

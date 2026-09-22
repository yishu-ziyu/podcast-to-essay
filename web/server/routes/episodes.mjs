import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { articleConfig } from '../article.mjs';
import { classifyMediaUrl } from '../domain/media-url.mjs';
import { failureForClassification, makeError } from '../domain/errors.mjs';
import { projectJob, publicReceipt } from '../domain/job.mjs';
import { BLOCK_EXT, extFromName } from '../services/media-ingest.mjs';
import { corsHeaders, sendFailure, sendJSON } from '../http.mjs';

function requestIdOf(body) {
  const raw = String(body.requestId || '').trim();
  if (/^[A-Za-z0-9._-]{8,80}$/.test(raw)) return raw;
  return randomUUID();
}

async function acceptJob(res, ctx, input, charge) {
  try {
    const accepted = await ctx.runner.accept(input, { charge });
    return sendJSON(res, accepted.created ? 202 : 200, {
      receipt: publicReceipt(accepted.job),
      job: projectJob(accepted.job),
    });
  } catch (err) {
    if (err.code === 'quota') return sendJSON(res, 429, { error: err.message });
    if (err.code === 'conflict') return sendJSON(res, 409, { error: err.message });
    throw err;
  }
}

export async function handleEpisodes(req, res, ctx) {
  const { method, parts, url } = ctx.route;
  const viewer = () => ctx.access.viewer(req, res);
  const charge = (who, kind) => (who.owner ? null : ctx.quota.take(ctx.access.quotaKey(who), kind));

  if (method === 'POST' && parts[1] === 'ingests' && parts.length === 2) {
    const who = viewer();
    const body = await ctx.readBody(req);
    const link = String(body.url || '').trim();
    const classified = classifyMediaUrl(link);
    if (!classified.supported) return sendFailure(res, 400, failureForClassification(classified));
    const reserved = ctx.jobs.all()
      .filter((job) => job.type === 'ingest' && ['queued', 'running', 'paused', 'interrupted'].includes(job.state))
      .map((job) => job.episodeSlug);
    const episodeSlug = await ctx.episodes.allocateSlug(classified.normalizedUrl, reserved);
    return acceptJob(res, ctx, {
      type: 'ingest',
      episodeSlug,
      sourceUrl: classified.normalizedUrl,
      requestId: requestIdOf(body),
      owner: who.tag,
      stage: 'checking_url',
    }, () => charge(who, 'ingest'));
  }

  if (method === 'GET' && parts[1] === 'episodes' && parts.length === 2) {
    const who = viewer();
    const episodes = [];
    for (const episode of await ctx.episodes.list(ctx.jobs.all())) {
      if (await ctx.episodes.canAccess(episode.slug, who)) episodes.push(episode);
    }
    return sendJSON(res, 200, { episodes });
  }

  if (method === 'POST' && parts[1] === 'episodes' && parts.length === 2) {
    const who = viewer();
    const body = await ctx.readBody(req);
    const slug = String(body.slug || '').trim();
    if (!ctx.episodes.safeSlug.test(slug)) return sendJSON(res, 400, { error: 'invalid slug' });
    if (ctx.episodes.exists(slug)) return sendJSON(res, 409, { error: 'episode exists' });
    const denied = charge(who, 'ingest');
    if (denied) return sendJSON(res, 429, { error: denied });
    await ctx.episodes.create(slug, who.owner ? null : who.tag);
    return sendJSON(res, 201, { ok: true, slug });
  }

  if (parts[1] !== 'episodes' || parts.length < 3) return false;
  const slug = parts[2];
  if (!ctx.episodes.safeSlug.test(slug)) return sendJSON(res, 400, { error: 'invalid slug' });
  const who = viewer();
  if (!(await ctx.episodes.canAccess(slug, who))) return sendJSON(res, 404, { error: 'not found' });

  if (method === 'DELETE' && parts.length === 3) {
    if (!who.owner) return sendJSON(res, 403, { error: '仅所有者可删除。' });
    if (!ctx.episodes.exists(slug)) return sendJSON(res, 404, { error: 'not found' });
    await ctx.runner.cancelEpisode(slug);
    await ctx.episodes.remove(slug);
    return sendJSON(res, 200, { ok: true });
  }

  if (method === 'PATCH' && parts.length === 3) {
    if (!ctx.episodes.exists(slug)) return sendJSON(res, 404, { error: 'episode not found' });
    const title = String((await ctx.readBody(req)).title || '').trim();
    if (!title) return sendJSON(res, 400, { error: '标题不能为空' });
    await ctx.episodes.setTitle(slug, title);
    return sendJSON(res, 200, { ok: true, title });
  }

  if (method === 'POST' && parts[3] === 'audio') {
    if (!ctx.episodes.exists(slug)) return sendJSON(res, 404, { error: 'episode not found' });
    const rawName = String(req.headers['x-filename'] || 'source.mp3');
    let filename = rawName;
    try { filename = decodeURIComponent(rawName); } catch { /* keep the raw header */ }
    const ext = path.extname(filename).toLowerCase();
    if (BLOCK_EXT.has(ext)) return sendJSON(res, 400, { error: '这不是音轨或视频' });
    const safeExt = extFromName(filename) || '.bin';
    let originalName = '';
    try { originalName = decodeURIComponent(String(req.headers['x-original-name'] || '')); } catch { /* optional */ }
    try {
      const file = await ctx.episodes.saveAudio(slug, {
        filename: `source${safeExt}`,
        originalName,
        stream: req,
        maxBytes: ctx.maxUploadBytes,
        blocked: (name) => BLOCK_EXT.has(name),
      });
      return sendJSON(res, 200, { ok: true, file });
    } catch (err) {
      if (err.status === 400) return sendJSON(res, 400, { error: err.message });
      if (err.code === 'file_too_large') {
        return sendFailure(res, 413, makeError({ code: 'file_too_large', stage: 'saving', userMessage: '文件太大' }));
      }
      throw err;
    }
  }

  if (method === 'POST' && parts[3] === 'from-url') {
    if (!ctx.episodes.exists(slug)) return sendJSON(res, 404, { error: 'episode not found' });
    const body = await ctx.readBody(req);
    const link = String(body.url || '').trim();
    const classified = classifyMediaUrl(link);
    if (!classified.supported) return sendFailure(res, 400, failureForClassification(classified));
    return acceptJob(res, ctx, {
      type: 'ingest',
      episodeSlug: slug,
      sourceUrl: classified.normalizedUrl,
      requestId: requestIdOf(body),
      owner: who.tag,
      stage: 'checking_url',
      bindExisting: true,
    }, () => charge(who, 'ingest'));
  }

  if (method === 'POST' && parts[3] === 'transcription' && (parts[4] === 'pause' || parts[4] === 'resume')) {
    const active = ctx.runner.activeJob('transcription', slug);
    if (!active) return sendJSON(res, 409, { error: '当前没有进行中的转录。' });
    const paused = parts[4] === 'pause';
    if ((active.state === 'paused') === paused) return sendJSON(res, 200, { ok: true, paused });
    const next = paused ? await ctx.runner.pause(active.id) : await ctx.runner.resumePaused(active.id);
    if (!next || next.state === active.state) return sendJSON(res, 409, { error: '转录已结束。' });
    await ctx.episodes.writeTranscriptionState(slug, paused ? 'paused' : 'running');
    return sendJSON(res, 200, { ok: true, paused });
  }

  if (method === 'POST' && parts[3] === 'transcribe') {
    if (!ctx.episodes.exists(slug)) return sendJSON(res, 404, { error: 'episode not found' });
    if (!process.env.STEP_API_KEY && !process.env.ANTHROPIC_AUTH_TOKEN) {
      return sendFailure(res, 409, makeError({
        code: 'transcription_auth_failed',
        userMessage: '还没有配置转录服务，暂时不能转录。',
        stage: 'transcribing',
        retryable: false,
      }));
    }
    const body = await ctx.readBody(req).catch(() => ({}));
    return acceptJob(res, ctx, {
      type: 'transcription',
      episodeSlug: slug,
      requestId: requestIdOf(body),
      owner: who.tag,
      stage: 'transcribing',
    }, () => charge(who, 'transcribe'));
  }

  if (method === 'GET' && parts[3] === 'transcript') {
    const type = url.searchParams.get('type') || 'raw';
    const text = await ctx.episodes.readTranscript(slug, type);
    if (text == null) return sendJSON(res, 404, { error: 'not found', type });
    res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8', ...corsHeaders(req) });
    return res.end(text);
  }

  if (method === 'POST' && parts[3] === 'clean') {
    if (!ctx.episodes.exists(slug)) return sendJSON(res, 404, { error: 'not found' });
    const rawText = await ctx.episodes.readTranscript(slug, 'raw');
    if (rawText == null) return sendJSON(res, 404, { error: 'no asr_raw.txt' });
    try { articleConfig(); }
    catch (err) {
      return sendFailure(res, 409, makeError({
        code: 'internal_error',
        userMessage: err.message,
        stage: 'writing_article',
        retryable: false,
      }));
    }
    const body = await ctx.readBody(req).catch(() => ({}));
    return acceptJob(res, ctx, {
      type: 'article',
      episodeSlug: slug,
      requestId: requestIdOf(body),
      owner: who.tag,
      stage: 'writing_article',
    }, () => charge(who, 'clean'));
  }

  return false;
}

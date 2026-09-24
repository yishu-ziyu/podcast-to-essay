import fsp from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { failureFromUnknown } from '../domain/errors.mjs';
import { ingestUrl } from './media-ingest.mjs';
import { generateArticle } from '../article.mjs';

export function createHandlers({ episodes, ingests, home }) {
  return {
    async ingest(job, tools) {
      const stageDir = path.join(ingests, job.id);
      await fsp.rm(stageDir, { recursive: true, force: true });
      await fsp.mkdir(stageDir, { recursive: true });
      try {
        await tools.report({ stage: 'checking_url', progress: null });
        const got = await ingestUrl(job.sourceUrl, stageDir, home, (progress) => {
          void tools.report({ stage: progress.stage, progress: progress.percent ?? null }).catch((err) => {
            console.error(JSON.stringify({ t: new Date().toISOString(), result: 'report_failed', errorCode: err.code || 'internal_error', jobId: job.id }));
          });
        });
        if (job.bindExisting) {
          await episodes.adoptSource(job.episodeSlug, stageDir, {
            url: job.sourceUrl,
            title: got.title,
            file: got.file,
          });
        } else {
          await episodes.publishIngest({
            slug: job.episodeSlug,
            stageDir,
            owner: job.owner,
            url: job.sourceUrl,
            title: got.title,
            file: got.file,
          });
        }
        await tools.report({ stage: 'waiting_transcription', checkpoint: 'source_saved', progress: null });
      } catch (err) {
        await fsp.rm(stageDir, { recursive: true, force: true }).catch(() => {});
        if (err.failure) throw err;
        throw Object.assign(err, { failure: failureFromUnknown(err, { stage: 'downloading_media' }) });
      }
    },

    async transcription(job, tools) {
      const episodeDir = episodes.dir(job.episodeSlug);
      const script = await episodes.writeScript(episodeDir);
      await episodes.writeTranscriptionState(job.episodeSlug, 'running');
      await tools.report({ stage: 'transcribing', progress: null });
      const child = spawn('bash', [script], {
        cwd: episodeDir,
        env: process.env,
        detached: process.platform !== 'win32',
      });
      let coded = null;
      let stderrTail = '';
      tools.control({
        pause() {
          if (process.platform !== 'win32' && child.pid) process.kill(-child.pid, 'SIGSTOP');
          else child.kill('SIGSTOP');
        },
        resume() {
          if (process.platform !== 'win32' && child.pid) process.kill(-child.pid, 'SIGCONT');
          else child.kill('SIGCONT');
        },
        kill() {
          try {
            if (process.platform !== 'win32' && child.pid) process.kill(-child.pid, 'SIGKILL');
            else child.kill('SIGKILL');
          } catch { /* already gone */ }
        },
      });
      const take = (chunk) => {
        for (const line of chunk.toString().split('\n')) {
          if (!line) continue;
          if (line.startsWith('@@error ')) {
            try { coded = JSON.parse(line.slice(8)); } catch { /* ignore malformed diagnostic */ }
          } else if (line.startsWith('❌')) {
            stderrTail = line.replace(/^❌\s*/, '');
          }
        }
      };
      child.stdout.on('data', take);
      child.stderr.on('data', take);
      const code = await new Promise((resolve) => {
        child.on('exit', (exitCode) => resolve(exitCode ?? 1));
        child.on('error', () => resolve(1));
      });
      if (code !== 0) {
        const failure = coded?.code
          ? {
            code: coded.code,
            userMessage: coded.userMessage,
            retryable: coded.code === 'transcription_quota_exhausted' || coded.code === 'internal_error',
            stage: 'transcribing',
            diagnosticId: job.id,
          }
          : failureFromUnknown(
            Object.assign(new Error(stderrTail || '转录没有完成'), { code: 'internal_error', userMessage: stderrTail || '转录未完成，已完成的片段已保留。' }),
            { stage: 'transcribing' },
          );
        await episodes.writeTranscriptionState(job.episodeSlug, 'failed', failure.userMessage);
        throw Object.assign(new Error(failure.userMessage), { failure });
      }
      await episodes.writeTranscriptionState(job.episodeSlug, 'complete');
    },

    async article(job, tools) {
      await tools.report({ stage: 'writing_article', progress: null });
      const rawText = await episodes.readTranscript(job.episodeSlug, 'raw');
      if (rawText == null) {
        throw Object.assign(new Error('no asr_raw.txt'), {
          failure: failureFromUnknown(Object.assign(new Error('没有逐字稿，还不能整理。'), { code: 'internal_error', userMessage: '没有逐字稿，还不能整理。' }), { stage: 'writing_article' }),
        });
      }
      const disk = await episodes.readMeta(episodes.dir(job.episodeSlug));
      try {
        const result = await generateArticle({
          title: disk?.title || disk?.originalName || job.episodeSlug,
          rawText,
        });
        await episodes.writeArticle(job.episodeSlug, result.text, result.meta);
        await tools.report({
          stage: 'writing_article',
          result: { provider: result.meta.provider, model: result.meta.model },
        });
      } catch (err) {
        const failure = failureFromUnknown(
          Object.assign(err, { code: 'internal_error', userMessage: err.message || '文章整理失败，原稿保留。' }),
          { stage: 'writing_article' },
        );
        throw Object.assign(err, { failure });
      }
    },
  };
}

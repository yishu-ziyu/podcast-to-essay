import { projectJob, publicReceipt } from '../domain/job.mjs';
import { corsHeaders, sendJSON } from '../http.mjs';

const JOB_ID = /^[0-9a-f-]{36}$/i;

function visible(job, viewer) {
  if (!job) return false;
  if (viewer.owner) return true;
  return job.owner === viewer.tag;
}

export async function handleJobs(req, res, ctx) {
  const { method, parts } = ctx.route;
  if (parts[1] !== 'jobs') return false;
  const viewer = ctx.access.viewer(req, res);

  if (method === 'GET' && parts.length === 2) {
    const jobs = ctx.jobs.all()
      .filter((job) => visible(job, viewer))
      .filter((job) => job.state !== 'succeeded' && job.state !== 'cancelled')
      .sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)))
      .slice(0, 20)
      .map(projectJob);
    return sendJSON(res, 200, { jobs });
  }

  const id = parts[2] || '';
  if (!JOB_ID.test(id)) return sendJSON(res, 404, { error: 'not found' });
  const job = ctx.jobs.get(id);
  if (!visible(job, viewer)) return sendJSON(res, 404, { error: 'not found' });

  if (method === 'GET' && parts.length === 3) return sendJSON(res, 200, { job: projectJob(job) });

  if (method === 'GET' && parts[3] === 'events' && parts.length === 4) {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
      ...corsHeaders(req),
    });
    const unsubscribe = ctx.runner.watch(id, (next) => {
      if (!res.writableEnded) res.write(`data: ${JSON.stringify(projectJob(next))}\n\n`);
    });
    const beat = setInterval(() => {
      if (!res.writableEnded) res.write(': ping\n\n');
    }, 15000);
    beat.unref?.();
    req.on('close', () => {
      clearInterval(beat);
      unsubscribe();
    });
    return undefined;
  }

  if (method === 'POST' && parts[3] === 'continue' && parts.length === 4) {
    if (job.state !== 'interrupted') return sendJSON(res, 409, { error: '这个任务现在不能继续。' });
    const next = await ctx.runner.continueInterrupted(id);
    return sendJSON(res, 202, { receipt: publicReceipt(next), job: projectJob(next) });
  }

  return false;
}

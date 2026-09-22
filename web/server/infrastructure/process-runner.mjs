import { spawn } from 'node:child_process';

export function runProcess(command, args, { cwd, timeoutMs, onLine, env = process.env } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd, env });
    let output = '';
    const take = (chunk) => {
      const text = chunk.toString();
      output += text;
      if (!onLine) return;
      for (const line of text.split('\n')) {
        const trimmed = line.trim();
        if (trimmed) onLine(trimmed.slice(0, 240));
      }
    };
    child.stdout?.on('data', take);
    child.stderr?.on('data', take);
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      reject(Object.assign(new Error('拉取超时'), { code: 'timeout', output }));
    }, timeoutMs);
    child.on('error', (error) => {
      clearTimeout(timer);
      const missing = error.code === 'ENOENT';
      reject(Object.assign(new Error(missing ? '下载组件无法启动' : error.message), {
        code: missing ? 'extractor_unavailable' : 'internal_error',
        output,
      }));
    });
    child.on('exit', (code) => {
      clearTimeout(timer);
      if (code === 0) resolve(output);
      else reject(Object.assign(new Error(`exit ${code}`), { code: 'extractor_failed', output }));
    });
  });
}

// Dev launcher: starts the Vite dev server (frontend :5173) and the Node
// backend (:8787) together so the app can be developed in a normal browser.
// No external deps — uses Node's built-in child_process.
import { spawn } from 'node:child_process';

const procs = [];

function run(cmd, args, name, env = {}) {
  const p = spawn(cmd, args, {
    stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, ...env },
  });
  const tag = `\x1b[36m[${name}]\x1b[0m`;
  const pipe = (stream, out) => {
    stream.on('data', (d) => out.write(tag + ' ' + d));
  };
  pipe(p.stdout, process.stdout);
  pipe(p.stderr, process.stderr);
  p.on('exit', (code) => {
    console.log(`${tag} exited with ${code}`);
    shutdown(code ?? 0);
  });
  procs.push(p);
  return p;
}

function shutdown(code = 0) {
  for (const p of procs) {
    try { p.kill(); } catch {}
  }
  process.exit(code);
}

process.on('SIGINT', () => shutdown(0));
process.on('SIGTERM', () => shutdown(0));

const API_PORT = process.env.API_PORT || process.env.PORT || '8787';
run(process.execPath, ['node_modules/vite/bin/vite.js'], 'vite', { IS_DEV: '1', API_PORT, PORT: API_PORT });
run(process.execPath, ['server/index.mjs'], 'server', { IS_DEV: '1', PORT: API_PORT });

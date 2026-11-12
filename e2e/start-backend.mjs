// Prepares the E2E database, then starts the API and the dispatcher as one Playwright web server
// and stops both together. (Playwright starts web servers before globalSetup, so the database is
// prepared here.)
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { prepareDatabase } from './prepare-db.mjs';

await prepareDatabase(process.env.DATABASE_URL);

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const children = ['api', 'dispatcher'].map((app) =>
  spawn(process.execPath, ['dist/main.js'], {
    cwd: path.join(root, 'apps', app),
    env: process.env,
    stdio: 'inherit',
  }),
);

let stopping = false;
const stop = (code) => {
  if (stopping) return;
  stopping = true;
  for (const child of children) child.kill('SIGTERM');
  setTimeout(() => process.exit(code), 3000).unref();
};

for (const child of children) {
  child.on('exit', (code) => {
    if (!stopping) {
      console.error(`backend process exited unexpectedly (${code})`);
      stop(1);
    }
  });
}
process.on('SIGTERM', () => stop(0));
process.on('SIGINT', () => stop(0));

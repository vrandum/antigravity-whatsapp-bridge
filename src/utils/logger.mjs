import fs from 'node:fs';
import path from 'node:path';

const LOG_DIR = path.resolve('logs');
fs.mkdirSync(LOG_DIR, { recursive: true });

function getLogFile() {
  const day = new Date().toISOString().slice(0, 10);
  return path.join(LOG_DIR, `bridge-${day}.log`);
}

export function logEvent(direction, detail, meta = {}) {
  const entry = {
    ts: new Date().toISOString(),
    direction,
    detail,
    ...meta,
  };
  const line = JSON.stringify(entry);
  fs.appendFileSync(getLogFile(), line + '\n', 'utf8');
  console.log(`[${entry.ts}] [${direction}] ${detail}`);
}

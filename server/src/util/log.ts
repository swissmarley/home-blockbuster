type Level = 'debug' | 'info' | 'warn' | 'error';

const order: Record<Level, number> = { debug: 10, info: 20, warn: 30, error: 40 };
const envLevel = (process.env.LOG_LEVEL ?? 'info').toLowerCase() as Level;
const threshold = order[envLevel] ?? order.info;

function write(level: Level, scope: string, msg: string, extra?: unknown): void {
  if (order[level] < threshold || process.env.VITEST) return;
  // Local wall-clock time (set TZ in Docker), so log lines line up with what the household sees.
  const now = new Date();
  const time = [now.getHours(), now.getMinutes(), now.getSeconds()].map((n) => String(n).padStart(2, '0')).join(':');
  const line = `${time} ${level.toUpperCase().padEnd(5)} [${scope}] ${msg}`;
  const out = level === 'error' || level === 'warn' ? console.error : console.log;
  if (extra === undefined) out(line);
  else out(line, extra instanceof Error ? extra.message : extra);
}

export interface Logger {
  debug(msg: string, extra?: unknown): void;
  info(msg: string, extra?: unknown): void;
  warn(msg: string, extra?: unknown): void;
  error(msg: string, extra?: unknown): void;
}

export function createLogger(scope: string): Logger {
  return {
    debug: (m, e) => write('debug', scope, m, e),
    info: (m, e) => write('info', scope, m, e),
    warn: (m, e) => write('warn', scope, m, e),
    error: (m, e) => write('error', scope, m, e),
  };
}

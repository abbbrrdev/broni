// ═══════════════════════════════════════════════════════════
//  L O G G E R  —  простое логирование с префиксами
// ═══════════════════════════════════════════════════════════

type LogLevel = 'info' | 'warn' | 'error';

const ICONS: Record<LogLevel, string> = {
  info:  'ℹ️',
  warn:  '⚠️',
  error: '❌',
};

function log(level: LogLevel, tag: string, message: string, data?: unknown) {
  const icon = ICONS[level];
  const prefix = `${icon} [${tag}]`;
  const fn = level === 'error' ? console.error : level === 'warn' ? console.warn : console.log;
  data !== undefined ? fn(prefix, message, data) : fn(prefix, message);
}

export const logger = {
  info:  (tag: string, msg: string, data?: unknown) => log('info', tag, msg, data),
  warn:  (tag: string, msg: string, data?: unknown) => log('warn', tag, msg, data),
  error: (tag: string, msg: string, data?: unknown) => log('error', tag, msg, data),
};

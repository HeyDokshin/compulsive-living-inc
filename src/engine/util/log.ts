export type LogLevel = 'info' | 'warn' | 'error'
export interface LogRecord {
  level: LogLevel
  source: string
  message: string
  time: number
}

type Sink = (r: LogRecord) => void
const sinks = new Set<Sink>()

export function addLogSink(sink: Sink): () => void {
  sinks.add(sink)
  return () => sinks.delete(sink)
}

export interface Logger {
  info(...args: unknown[]): void
  warn(...args: unknown[]): void
  error(...args: unknown[]): void
}

const fmt = (args: unknown[]) => args.map((a) => (a instanceof Error ? a.message : typeof a === 'string' ? a : JSON.stringify(a))).join(' ')

export function createLogger(source: string): Logger {
  const emit = (level: LogLevel, args: unknown[]) => {
    console[level === 'info' ? 'log' : level](`[${source}]`, ...args)
    const rec = { level, source, message: fmt(args), time: Date.now() }
    for (const s of sinks) s(rec)
  }
  return {
    info: (...a) => emit('info', a),
    warn: (...a) => emit('warn', a),
    error: (...a) => emit('error', a),
  }
}

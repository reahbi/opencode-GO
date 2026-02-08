const PREFIXES = {
  telegram: '[TELEGRAM]',
  opencode: '[OPENCODE]',
  session: '[SESSION]',
  state: '[STATE]',
  bot: '[BOT]',
  queue: '[QUEUE]',
  interactive: '[INTERACTIVE]',
  summary: '[SUMMARY]',
  watcher: '[WATCHER]',
  coordination: '[COORDINATION]',
  group: '[GROUP]',
  debate: '[DEBATE]',
  review: '[REVIEW]',
  registry: '[REGISTRY]',
  tunnel: '[TUNNEL]',
  voice: '[VOICE]',
  hookbot: '[HOOKBOT]',
} as const

type LogContext = keyof typeof PREFIXES

let instancePrefix = ''

export function setInstancePrefix(name: string): void {
  instancePrefix = name ? `[${name}] ` : ''
}

function formatMessage(context: LogContext, message: string): string {
  return `${instancePrefix}${PREFIXES[context]} ${message}`
}

export const logger = {
  info(context: LogContext, message: string, ...args: unknown[]) {
    console.log(formatMessage(context, message), ...args)
  },
  error(context: LogContext, message: string, ...args: unknown[]) {
    console.error(formatMessage(context, message), ...args)
  },
  warn(context: LogContext, message: string, ...args: unknown[]) {
    console.warn(formatMessage(context, message), ...args)
  },
  debug(context: LogContext, message: string, ...args: unknown[]) {
    if (process.env.DEBUG) {
      console.debug(formatMessage(context, message), ...args)
    }
  },
}

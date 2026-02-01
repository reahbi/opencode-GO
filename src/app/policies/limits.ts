export const LIMITS = {
  /** Maximum length for a single Telegram message (with safety margin) */
  MAX_MESSAGE_LENGTH: 3500,

  /** Maximum number of split messages before file fallback */
  MAX_MESSAGE_CHUNKS: 5,

  /** Character count above which we send as .md file */
  FILE_FALLBACK_THRESHOLD: 15000,

  /** Typing action refresh interval (ms) */
  TYPING_INTERVAL_MS: 5000,

  /** Maximum prompt retries */
  MAX_PROMPT_RETRIES: 2,

  /** Interaction TTL (ms) — 5 minutes */
  INTERACTION_TTL_MS: 5 * 60 * 1000,

  /** Server restart max attempts */
  MAX_SERVER_RESTARTS: 5,

  /** Server restart backoff base (ms) */
  SERVER_RESTART_BACKOFF_MS: 2000,
} as const

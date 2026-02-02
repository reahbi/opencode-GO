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

  /** Target character count for summary output (instructed to the model) */
  SUMMARY_OUTPUT_TARGET: 2000,

  /** Hard cap for summary HTML output — must stay under Telegram's 4096 limit with tag overhead */
  SUMMARY_HTML_HARD_CAP: 3200,

  /** Minimum trigger threshold users can set (must be > SUMMARY_OUTPUT_TARGET) */
  SUMMARY_MIN_TRIGGER: 2000,
} as const

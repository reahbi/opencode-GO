/** Telegram message length limit */
export const TELEGRAM_MAX_MESSAGE_LENGTH = 4096

/** Safe threshold for HTML messages (leaves room for tags + escaping) */
export const SAFE_MESSAGE_LENGTH = 3500

/** Maximum number of split messages before falling back to file */
export const MAX_MESSAGE_CHUNKS = 5

/** Threshold above which response is sent as .md file */
export const FILE_FALLBACK_THRESHOLD = 15000

/** Typing action refresh interval in ms */
export const TYPING_INTERVAL_MS = 5000

/** Maximum server restart attempts */
export const MAX_SERVER_RESTARTS = 5

/** Default interaction TTL in ms (5 minutes) */
export const INTERACTION_TTL_MS = 5 * 60 * 1000

/** Default OpenCode server URL */
export const DEFAULT_SERVER_URL = 'http://127.0.0.1:4096'

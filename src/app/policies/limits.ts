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

  /** Interaction TTL (ms) — 10 minutes */
  INTERACTION_TTL_MS: 10 * 60 * 1000,

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

  // ── Group / Coordination ────────────────────────────────

  /** Maximum rounds in a single debate session */
  MAX_DEBATE_ROUNDS: 6,

  /** Polling interval for coordination file during active debate (ms) */
  COORDINATION_POLL_INTERVAL_MS: 2000,

  /** Maximum wait time for a debate response from the other bot (ms) */
  DEBATE_RESPONSE_TIMEOUT_MS: 15 * 60 * 1000,  // 15 minutes

  /** Coordination event TTL — ignore events older than this (ms) */
  COORDINATION_EVENT_TTL_MS: 10 * 60 * 1000,

  /** Maximum size of a single coordination JSONL file before daily rotation (bytes) */
  COORDINATION_MAX_FILE_SIZE: 10 * 1024 * 1024,

  // ── Bot Registry ───────────────────────────────────────────

  REGISTRY_HEARTBEAT_INTERVAL_MS: 60 * 1000,

  REGISTRY_STALE_THRESHOLD_MS: 3 * 60 * 1000,

  // ── Message Queue ────────────────────────────────────────
  /** Maximum number of queued messages per chat */
  MAX_QUEUED_MESSAGES: 5,

  /** Maximum total characters across all queued messages */
  MAX_QUEUED_CHARS: 10000,

  // ── Inactivity Detection ─────────────────────────────────
  /** Time without activity before warning (ms) — 30 minutes */
  INACTIVITY_WARNING_MS: 30 * 60 * 1000,

  /** Interval to check for inactivity (ms) — 5 minutes */
  INACTIVITY_CHECK_INTERVAL_MS: 5 * 60 * 1000,

  // ── Voice Response History ─────────────────────────────────
  /** Maximum number of voice responses to keep per chat */
  VOICE_HISTORY_MAX: 50,

  /** Voice response TTL (ms) — 24 hours */
  VOICE_HISTORY_TTL_MS: 24 * 60 * 60 * 1000,

  /** Safety cap for voice summary text length */
  VOICE_SUMMARY_HARD_CAP: 5000,

  /** Minimum content length for auto voice trigger */
  VOICE_AUTO_MIN_CONTENT: 200,

  // ── Hook Bot ──────────────────────────────────────────────
  /** Time without file activity before a hook session is considered completed (ms) — 90 seconds */
  HOOK_IDLE_THRESHOLD_MS: 90_000,

  /** Time before hook session is considered stalled (ms) — 30 minutes */
  HOOK_STALL_WARNING_MS: 30 * 60 * 1000,

  /** Interval to check for hook session stalls (ms) — 5 minutes */
  HOOK_STALL_CHECK_INTERVAL_MS: 5 * 60 * 1000,

  /** Polling interval for hook completion backfill (ms) — 3 minutes */
  HOOK_COMPLETION_POLL_INTERVAL_MS: 3 * 60 * 1000,

  /** Only consider sessions updated within this window for poll-based completion (ms) — 15 minutes */
  HOOK_COMPLETION_POLL_RECENT_WINDOW_MS: 15 * 60 * 1000,

  // ── Rate Limiting ─────────────────────────────────────────
  /** Rate limit: max messages per user per minute */
  RATE_LIMIT_PER_MINUTE: 20,

  /** Rate limit: max non-question callbacks per user per minute */
  RATE_LIMIT_CALLBACKS_PER_MINUTE: 60,

  /** Rate limit: cooldown message */
  RATE_LIMIT_COOLDOWN_MS: 60_000,

  // ── Summary Service ─────────────────────────────────────────
  /** Timeout for CLI summary subprocess (ms) */
  SUMMARY_TIMEOUT_MS: 60_000,

  /** Maximum input characters before truncation for summary */
  SUMMARY_MAX_INPUT_CHARS: 30_000,

  // ── File Lock / Registry ────────────────────────────────────
  /** Delay between read retries on corrupted registry file (ms) */
  LOCK_READ_RETRY_DELAY_MS: 50,

  /** Maximum read retries for corrupted registry file */
  LOCK_READ_MAX_RETRIES: 3,

  /** Time before a lock file is considered stale (ms) */
  LOCK_STALE_MS: 10_000,

  /** Maximum lock acquisition attempts */
  LOCK_MAX_ATTEMPTS: 20,

  // ── Thinking Token Budgets ──────────────────────────────────
  /** Token budget for normal thinking (keyword-triggered) */
  THINKING_NORMAL_TOKENS: 10_000,

  /** Token budget for deep thinking (keyword-triggered) */
  THINKING_DEEP_TOKENS: 50_000,

  // ── Delivery / Preview ──────────────────────────────────────
  /** Maximum characters for inline preview before file fallback */
  PREVIEW_MAX_CHARS: 2000,

  /** Safe total message length for completion notifications (under Telegram 4096 + HTML overhead) */
  COMPLETION_SAFE_LENGTH: 3900,

  // ── External API ────────────────────────────────────────────
  /** Timeout for Whisper transcription API call (ms) */
  WHISPER_TIMEOUT_MS: 60_000,

  /** Timeout for health check / server readiness probe (ms) */
  HEALTH_CHECK_TIMEOUT_MS: 5_000,

  /** Timeout for Telegram Bot API verification calls (ms) */
  TELEGRAM_API_TIMEOUT_MS: 10_000,
} as const

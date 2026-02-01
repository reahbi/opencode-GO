import type { Context } from 'grammy'

const HELP_TEXT = `<b>OpenCaddy Commands</b>

<b>Session</b>
/new [title] — Start new session
/list — List sessions
/resume [n] — Resume session #n
/abort — Abort current task

<b>Agent</b>
/agents — Select AI agent

<b>General</b>
/status — Current status
/help — This message

Send any text to chat with OpenCode.`

export function helpCommand() {
  return async (ctx: Context) => {
    await ctx.reply(HELP_TEXT, { parse_mode: 'HTML' })
  }
}

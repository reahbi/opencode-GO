import type { Context } from 'grammy'

export function helpCommand(instanceName?: string) {
  const header = instanceName
    ? `<b>OpenCaddy — ${instanceName}</b>`
    : `<b>OpenCaddy Commands</b>`

  const helpText = `${header}

<b>Session</b>
/new [title] — Start new session
/list — List sessions
/resume [n] — Resume session #n
/abort — Abort current task
/history — Export session history

<b>Agent</b>
/agents — Select AI agent

<b>Multi-Bot</b>
/debate [topic] — Start debate between bots
/review [target] — Request code review
/bots — List registered bots
/addbot — Add new bot (DM only)
/cancel — Cancel addbot wizard

<b>General</b>
/status — Current status
/settings — Bot settings
/help — This message

Send any text to chat with OpenCode.`

  return async (ctx: Context) => {
    await ctx.reply(helpText, { parse_mode: 'HTML' })
  }
}

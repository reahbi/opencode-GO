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

<b>Agent</b>
/agents — Select AI agent

<b>General</b>
/status — Current status
/help — This message

Send any text to chat with OpenCode.`

  return async (ctx: Context) => {
    await ctx.reply(helpText, { parse_mode: 'HTML' })
  }
}

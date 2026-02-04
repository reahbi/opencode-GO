import type { Context } from 'grammy'

export function helpCommand(instanceName?: string) {
  const header = instanceName
    ? `<b>OpenCode-Go — ${instanceName}</b>`
    : `<b>OpenCode-Go Commands</b>`

  const helpText = `${header}

<b>Session</b>
/new [title] — Start new session
/list — List sessions
/resume [n] — Resume session #n
/abort — Abort current task
/history — Export session history

<b>Queue & Undo</b>
/queue [msg] — Queue message while AI busy
/clearqueue — Clear queued messages
/showqueue — Show queue status
/undo — Undo last AI response
/redo — Redo undone response

<b>Agent</b>
/agents — Select AI agent

<b>Settings</b>
/settings — Bot settings (summary, output, etc.)
/groupsettings — Group settings (debate rounds, bots)

<b>Multi-Bot</b>
/debate [topic] — Start debate between bots
/review [target] — Request code review
/bots — List registered bots
/addbot — Add new bot (DM only)
/cancel — Cancel addbot wizard

<b>Project</b>
/git — Git status, diff, log

<b>General</b>
/start — Welcome & status overview
/status — Current status
/help — This message

Send any text to chat with OpenCode.`

  return async (ctx: Context) => {
    await ctx.reply(helpText, { parse_mode: 'HTML' })
  }
}

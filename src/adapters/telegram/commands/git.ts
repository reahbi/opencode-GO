import type { Context } from 'grammy'
import { InlineKeyboard, InputFile } from 'grammy'
import { exec } from 'node:child_process'
import { promisify } from 'node:util'
import type { StateStore } from '../../../domain/ports/StateStore.js'
import { escapeHtml } from '../../../shared/formatResponse.js'

const execAsync = promisify(exec)

const GIT_TIMEOUT_MS = 10_000
const MAX_BUFFER_BYTES = 1024 * 1024

interface GitExecResult {
  stdout: string
  stderr: string
}

async function execGit(cwd: string, args: string): Promise<GitExecResult> {
  try {
    const { stdout, stderr } = await execAsync(`git ${args}`, {
      cwd,
      timeout: GIT_TIMEOUT_MS,
      maxBuffer: MAX_BUFFER_BYTES,
    })
    return { stdout: stdout.trim(), stderr: stderr.trim() }
  } catch (err) {
    const error = err as Error & { stdout?: string; stderr?: string }
    return {
      stdout: error.stdout?.trim() ?? '',
      stderr: error.stderr?.trim() ?? error.message,
    }
  }
}

async function isGitRepo(cwd: string): Promise<boolean> {
  const result = await execGit(cwd, 'rev-parse --is-inside-work-tree')
  return result.stdout === 'true'
}

async function getGitBranch(cwd: string): Promise<string> {
  const result = await execGit(cwd, 'branch --show-current')
  return result.stdout || 'detached HEAD'
}

async function getGitStatus(cwd: string): Promise<string> {
  const result = await execGit(cwd, 'status --short')
  return result.stdout
}

async function getGitDiffStats(cwd: string): Promise<string> {
  const staged = await execGit(cwd, 'diff --cached --stat')
  const unstaged = await execGit(cwd, 'diff --stat')
  
  const parts: string[] = []
  if (staged.stdout) {
    parts.push('<b>Staged:</b>\n<code>' + escapeHtml(staged.stdout) + '</code>')
  }
  if (unstaged.stdout) {
    parts.push('<b>Unstaged:</b>\n<code>' + escapeHtml(unstaged.stdout) + '</code>')
  }
  
  return parts.join('\n\n') || 'No changes'
}

async function getGitDiffFull(cwd: string): Promise<string> {
  const result = await execGit(cwd, 'diff HEAD')
  return result.stdout
}

async function getGitLog(cwd: string, count = 5): Promise<string> {
  const result = await execGit(cwd, `log --oneline -n ${count}`)
  return result.stdout
}

async function getGitRemote(cwd: string): Promise<string> {
  const result = await execGit(cwd, 'remote get-url origin 2>/dev/null')
  return result.stdout
}

function buildGitKeyboard(): InlineKeyboard {
  return new InlineKeyboard()
    .text('📋 Diff', 'git:diff')
    .text('📄 Full Diff', 'git:diff-full')
    .row()
    .text('📜 Log', 'git:log')
    .text('🔄 Refresh', 'git:refresh')
}

export function gitCommand(state: StateStore) {
  return async (ctx: Context) => {
    const chatId = ctx.chat?.id
    if (!chatId) return

    const chatState = await state.getChatState(chatId)
    const projectDir = chatState.activeProjectDirectory

    if (!projectDir) {
      await ctx.reply('No active project. Start a session first with /new')
      return
    }

    if (!(await isGitRepo(projectDir))) {
      await ctx.reply(`<b>Not a Git repository</b>\n\nProject: <code>${escapeHtml(projectDir)}</code>`, {
        parse_mode: 'HTML',
      })
      return
    }

    const [branch, status, log, remote] = await Promise.all([
      getGitBranch(projectDir),
      getGitStatus(projectDir),
      getGitLog(projectDir, 3),
      getGitRemote(projectDir),
    ])

    const statusLines = status.split('\n').filter(Boolean)
    const staged = statusLines.filter(l => l[0] !== ' ' && l[0] !== '?').length
    const unstaged = statusLines.filter(l => l[1] !== ' ' && l[0] !== '?').length
    const untracked = statusLines.filter(l => l.startsWith('??')).length

    const lines = [
      `<b>Git Status</b>`,
      ``,
      `🌿 Branch: <code>${escapeHtml(branch)}</code>`,
    ]

    if (remote) {
      const repoMatch = remote.match(/[:/]([^/]+\/[^/]+?)(?:\.git)?$/)
      if (repoMatch) {
        lines.push(`📦 Repo: <code>${escapeHtml(repoMatch[1])}</code>`)
      }
    }

    lines.push(``)

    if (staged || unstaged || untracked) {
      const changes: string[] = []
      if (staged) changes.push(`${staged} staged`)
      if (unstaged) changes.push(`${unstaged} modified`)
      if (untracked) changes.push(`${untracked} untracked`)
      lines.push(`📝 Changes: ${changes.join(', ')}`)
    } else {
      lines.push(`✅ Working tree clean`)
    }

    if (status) {
      const previewLines = statusLines.slice(0, 8)
      const preview = previewLines.map(l => escapeHtml(l)).join('\n')
      lines.push(``)
      lines.push(`<code>${preview}</code>`)
      if (statusLines.length > 8) {
        lines.push(`<i>... and ${statusLines.length - 8} more</i>`)
      }
    }

    if (log) {
      lines.push(``)
      lines.push(`<b>Recent commits:</b>`)
      const logLines = log.split('\n').map(l => {
        const [hash, ...rest] = l.split(' ')
        return `• <code>${hash}</code> ${escapeHtml(rest.join(' '))}`
      })
      lines.push(logLines.join('\n'))
    }

    await ctx.reply(lines.join('\n'), {
      parse_mode: 'HTML',
      reply_markup: buildGitKeyboard(),
    })
  }
}

export async function handleGitCallback(
  ctx: Context,
  action: string,
  state: StateStore,
): Promise<void> {
  const chatId = ctx.chat?.id
  if (!chatId) return

  const chatState = await state.getChatState(chatId)
  const projectDir = chatState.activeProjectDirectory

  if (!projectDir) {
    await ctx.answerCallbackQuery({ text: 'No active project' })
    return
  }

  if (!(await isGitRepo(projectDir))) {
    await ctx.answerCallbackQuery({ text: 'Not a git repository' })
    return
  }

  try {
    switch (action) {
      case 'diff': {
        await ctx.answerCallbackQuery()
        const diff = await getGitDiffStats(projectDir)
        await ctx.reply(`<b>Git Diff (stats)</b>\n\n${diff}`, {
          parse_mode: 'HTML',
          reply_markup: new InlineKeyboard()
            .text('📄 Full Diff', 'git:diff-full')
            .text('🔙 Back', 'git:refresh'),
        })
        break
      }

      case 'diff-full': {
        await ctx.answerCallbackQuery()
        const fullDiff = await getGitDiffFull(projectDir)
        
        if (!fullDiff) {
          await ctx.reply('No changes to show')
          return
        }

        if (fullDiff.length > 3500) {
          const buffer = Buffer.from(fullDiff, 'utf-8')
          await ctx.replyWithDocument(new InputFile(buffer, 'diff.patch'), {
            caption: '📄 Full diff (too long for message)',
          })
        } else {
          await ctx.reply(`<b>Full Diff</b>\n\n<pre>${escapeHtml(fullDiff)}</pre>`, {
            parse_mode: 'HTML',
            reply_markup: new InlineKeyboard().text('🔙 Back', 'git:refresh'),
          })
        }
        break
      }

      case 'log': {
        await ctx.answerCallbackQuery()
        const log = await getGitLog(projectDir, 10)
        
        if (!log) {
          await ctx.reply('No commits yet')
          return
        }

        const logLines = log.split('\n').map(l => {
          const [hash, ...rest] = l.split(' ')
          return `<code>${hash}</code> ${escapeHtml(rest.join(' '))}`
        })

        await ctx.reply(`<b>Git Log (last 10)</b>\n\n${logLines.join('\n')}`, {
          parse_mode: 'HTML',
          reply_markup: new InlineKeyboard().text('🔙 Back', 'git:refresh'),
        })
        break
      }

      case 'refresh': {
        await ctx.answerCallbackQuery({ text: 'Refreshing...' })
        const gitHandler = gitCommand(state)
        await gitHandler(ctx)
        break
      }

      default:
        await ctx.answerCallbackQuery({ text: 'Unknown action' })
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    await ctx.answerCallbackQuery({ text: `Error: ${message.slice(0, 50)}` })
  }
}

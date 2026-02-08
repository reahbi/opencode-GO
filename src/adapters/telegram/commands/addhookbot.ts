import type { Context } from 'grammy'
import type { StateStore } from '../../../domain/ports/StateStore.js'
import type { ChatOutputPort } from '../../../domain/ports/ChatOutputPort.js'
import type { Button } from '../../../domain/models.js'
import { logger } from '../../../shared/logger.js'
import { promises as fs } from 'node:fs'
import { resolve } from 'node:path'

interface AddhookbotWizardState {
  token: string
  username: string
  selectedProjects: { directory: string; name: string }[]
  mode: 'all' | 'selected'
  chatId?: number
  tokenAttempts?: number
}

interface OpenCodeProject {
  worktree: string
  name?: string
}

const MAX_TOKEN_ATTEMPTS = 3
const wizards = new Map<number, AddhookbotWizardState>()

function escapeHtml(t: string): string {
  return t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

async function fetchProjects(serverUrl: string, username: string, password: string): Promise<OpenCodeProject[]> {
  const headers: Record<string, string> = {}
  if (password) {
    headers['Authorization'] = `Basic ${Buffer.from(`${username}:${password}`).toString('base64')}`
  }
  const res = await fetch(`${serverUrl}/project`, {
    headers,
    signal: AbortSignal.timeout(5000),
  })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  const projects = await res.json() as OpenCodeProject[]
  return projects.filter(p => p.worktree !== '/')
}

export function addhookbotCommand(state: StateStore) {
  return async (ctx: Context) => {
    const chatId = ctx.chat?.id
    if (!chatId) return
    if (ctx.chat?.type !== 'private') {
      await ctx.reply('Only available in DM.')
      return
    }

    wizards.delete(chatId)

    const chatState = await state.getChatState(chatId)
    chatState.awaitingInput = 'addhookbot_token'
    await state.saveChatState(chatId, chatState)

    await ctx.reply(
      [
        '<b>📡 Hook Bot Setup Wizard</b>',
        '',
        'This will configure a hook bot that sends notifications when AI sessions complete.',
        '',
        'Send the bot token from BotFather.',
        '',
        'Type /cancel to cancel.',
      ].join('\n'),
      { parse_mode: 'HTML' },
    )
  }
}

export async function handleAddhookbotToken(
  chatId: number,
  text: string,
  state: StateStore,
  output: ChatOutputPort,
  serverUrl: string,
  serverUsername: string,
  serverPassword: string,
): Promise<boolean> {
  const token = text.trim()

  let wizard = wizards.get(chatId) || { token: '', username: '', selectedProjects: [], mode: 'all' as const, tokenAttempts: 0 }
  wizard.tokenAttempts = (wizard.tokenAttempts || 0) + 1
  wizards.set(chatId, wizard)

  let username = ''
  try {
    const res = await fetch(`https://api.telegram.org/bot${token}/getMe`, {
      signal: AbortSignal.timeout(10000),
    })
    const data = await res.json() as { ok: boolean; result?: { username?: string } }
    if (!data.ok || !data.result?.username) {
      if (wizard.tokenAttempts >= MAX_TOKEN_ATTEMPTS) {
        wizards.delete(chatId)
        const chatState = await state.getChatState(chatId)
        chatState.awaitingInput = null
        await state.saveChatState(chatId, chatState)
        await output.sendText(chatId, `❌ Invalid bot token. Maximum attempts (${MAX_TOKEN_ATTEMPTS}) reached.\n\nWizard cancelled. Use /addhookbot to start again.`)
        return true
      }
      const remaining = MAX_TOKEN_ATTEMPTS - wizard.tokenAttempts
      await output.sendText(chatId, `❌ Invalid bot token. Please try again. (${remaining} attempt${remaining > 1 ? 's' : ''} remaining)\n\nType /cancel to cancel.`)
      return true
    }
    username = data.result.username
  } catch {
    if (wizard.tokenAttempts >= MAX_TOKEN_ATTEMPTS) {
      wizards.delete(chatId)
      const chatState = await state.getChatState(chatId)
      chatState.awaitingInput = null
      await state.saveChatState(chatId, chatState)
      await output.sendText(chatId, `❌ Cannot connect to Telegram API. Maximum attempts (${MAX_TOKEN_ATTEMPTS}) reached.\n\nWizard cancelled. Use /addhookbot to start again.`)
      return true
    }
    const remaining = MAX_TOKEN_ATTEMPTS - wizard.tokenAttempts
    await output.sendText(chatId, `❌ Cannot connect to Telegram API. Please try again. (${remaining} attempt${remaining > 1 ? 's' : ''} remaining)\n\nType /cancel to cancel.`)
    return true
  }

  wizard = { token, username, selectedProjects: [], mode: 'all', tokenAttempts: 0 }
  wizards.set(chatId, wizard)

  const chatState = await state.getChatState(chatId)
  chatState.awaitingInput = null
  await state.saveChatState(chatId, chatState)

  let projects: OpenCodeProject[] = []
  try {
    projects = await fetchProjects(serverUrl, serverUsername, serverPassword)
  } catch {
    logger.debug('registry', 'Failed to fetch projects for addhookbot wizard')
  }

  if (projects.length > 0) {
    const buttons: Button[] = [
      { label: '📡 All projects', callbackData: 'ahb:all' },
    ]
    for (const p of projects) {
      const name = p.name || p.worktree.split('/').pop() || p.worktree
      buttons.push({
        label: `⬜ ${name}`,
        callbackData: `ahb_proj:${p.worktree}:select`,
      })
    }
    buttons.push({ label: '✅ Done', callbackData: 'ahb:done' })

    await output.sendInteraction(
      chatId,
      `✅ <b>@${escapeHtml(username)}</b> verified\n\nSelect projects to monitor:\n<i>(Toggle individual projects or select all)</i>`,
      buttons,
    )
  } else {
    wizard.mode = 'all'
    wizards.set(chatId, wizard)

    const cs = await state.getChatState(chatId)
    cs.awaitingInput = 'addhookbot_chatid'
    await state.saveChatState(chatId, cs)

    await output.sendText(
      chatId,
      `✅ <b>@${escapeHtml(username)}</b> verified\n\nMode: <b>📡 All projects</b>\n\nSend the chat ID for notifications.\nDefault: <code>${chatId}</code> (this chat)\n\nSend <code>default</code> to use current chat, or enter a numeric chat ID.`,
      'HTML',
    )
  }

  return true
}

export async function handleAddhookbotAllCallback(
  chatId: number,
  state: StateStore,
  output: ChatOutputPort,
): Promise<void> {
  const wizard = wizards.get(chatId)
  if (!wizard) {
    await output.sendText(chatId, '❌ No wizard in progress. Start with /addhookbot.')
    return
  }

  wizard.mode = 'all'
  wizard.selectedProjects = []
  wizards.set(chatId, wizard)

  const chatState = await state.getChatState(chatId)
  chatState.awaitingInput = 'addhookbot_chatid'
  await state.saveChatState(chatId, chatState)

  await output.sendText(
    chatId,
    `Mode: <b>📡 All projects</b>\n\nSend the chat ID for notifications.\nDefault: <code>${chatId}</code> (this chat)\n\nSend <code>default</code> to use current chat, or enter a numeric chat ID.`,
    'HTML',
  )
}

export async function handleAddhookbotProjectCallback(
  chatId: number,
  projectDir: string,
  action: 'select' | 'deselect',
  state: StateStore,
  output: ChatOutputPort,
  serverUrl: string,
  serverUsername: string,
  serverPassword: string,
): Promise<void> {
  const wizard = wizards.get(chatId)
  if (!wizard) {
    await output.sendText(chatId, '❌ No wizard in progress. Start with /addhookbot.')
    return
  }

  wizard.mode = 'selected'

  if (action === 'select') {
    if (!wizard.selectedProjects.find(p => p.directory === projectDir)) {
      const name = projectDir.split('/').pop() || projectDir
      wizard.selectedProjects.push({ directory: projectDir, name })
    }
  } else {
    wizard.selectedProjects = wizard.selectedProjects.filter(p => p.directory !== projectDir)
  }
  wizards.set(chatId, wizard)

  let projects: OpenCodeProject[] = []
  try {
    projects = await fetchProjects(serverUrl, serverUsername, serverPassword)
  } catch {
    logger.debug('registry', 'Failed to fetch projects for addhookbot wizard')
  }

  const buttons: Button[] = [
    { label: '📡 All projects', callbackData: 'ahb:all' },
  ]
  for (const p of projects) {
    const name = p.name || p.worktree.split('/').pop() || p.worktree
    const isSelected = wizard.selectedProjects.some(sp => sp.directory === p.worktree)
    buttons.push({
      label: `${isSelected ? '✅' : '⬜'} ${name}`,
      callbackData: `ahb_proj:${p.worktree}:${isSelected ? 'deselect' : 'select'}`,
    })
  }
  buttons.push({ label: '✅ Done', callbackData: 'ahb:done' })

  const selectedCount = wizard.selectedProjects.length
  await output.sendInteraction(
    chatId,
    `✅ <b>@${escapeHtml(wizard.username)}</b> verified\n\nSelect projects to monitor (${selectedCount} selected):\n<i>(Toggle individual projects or select all)</i>`,
    buttons,
  )
}

export async function handleAddhookbotDoneCallback(
  chatId: number,
  state: StateStore,
  output: ChatOutputPort,
): Promise<void> {
  const wizard = wizards.get(chatId)
  if (!wizard) {
    await output.sendText(chatId, '❌ No wizard in progress. Start with /addhookbot.')
    return
  }

  if (wizard.mode === 'selected' && wizard.selectedProjects.length === 0) {
    await output.sendText(chatId, '⚠️ No projects selected. Select at least one project or choose "📡 All projects".')
    return
  }

  const chatState = await state.getChatState(chatId)
  chatState.awaitingInput = 'addhookbot_chatid'
  await state.saveChatState(chatId, chatState)

  const modeText = wizard.mode === 'all'
    ? '📡 All projects'
    : `📁 ${wizard.selectedProjects.length} project${wizard.selectedProjects.length > 1 ? 's' : ''}`

  await output.sendText(
    chatId,
    `Mode: <b>${modeText}</b>\n\nSend the chat ID for notifications.\nDefault: <code>${chatId}</code> (this chat)\n\nSend <code>default</code> to use current chat, or enter a numeric chat ID.`,
    'HTML',
  )
}

export async function handleAddhookbotChatId(
  chatId: number,
  text: string,
  state: StateStore,
  output: ChatOutputPort,
): Promise<boolean> {
  const wizard = wizards.get(chatId)
  if (!wizard) {
    await output.sendText(chatId, '❌ No wizard in progress. Start with /addhookbot.')
    return true
  }

  const trimmed = text.trim().toLowerCase()
  let targetChatId: number

  if (trimmed === 'default') {
    targetChatId = chatId
  } else {
    const parsed = parseInt(trimmed, 10)
    if (!Number.isFinite(parsed)) {
      await output.sendText(chatId, '❌ Invalid chat ID. Enter a numeric chat ID or <code>default</code>.', 'HTML')
      return true
    }
    targetChatId = parsed
  }

  wizard.chatId = targetChatId
  wizards.set(chatId, wizard)

  const chatState = await state.getChatState(chatId)
  chatState.awaitingInput = null
  await state.saveChatState(chatId, chatState)

  await finishAddhookbot(chatId, state, output)
  return true
}

async function appendHookBotToEcosystem(wizard: AddhookbotWizardState): Promise<boolean> {
  const configPath = resolve(process.cwd(), 'ecosystem.config.cjs')
  try {
    let content = await fs.readFile(configPath, 'utf-8')

    if (content.includes(`name: 'opencode-go-hookbot'`)) {
      return true
    }

    const entry = [
      `    {`,
      `      name: 'opencode-go-hookbot',`,
      `      script: 'src/hookBot.ts',`,
      `      interpreter: 'bun',`,
      `      cwd: '${process.cwd()}',`,
      `      env: {`,
      '        PATH: `${process.env.HOME}/.bun/bin:${process.env.PATH}`,',
      `        HOOK_CONFIG_PATH: 'data/hook-config.json',`,
      `        OPENCODE_SERVER_URL: '${process.env.OPENCODE_SERVER_URL ?? 'http://127.0.0.1:4096'}',`,
      `        OPENCODE_SERVER_USERNAME: '${process.env.OPENCODE_SERVER_USERNAME ?? 'opencode'}',`,
      `        OPENCODE_SERVER_PASSWORD: '${process.env.OPENCODE_SERVER_PASSWORD ?? ''}',`,
      `      },`,
      `      autorestart: true,`,
      `      max_memory_restart: '512M',`,
      `    },`,
    ].join('\n')

    const insertPos = content.lastIndexOf('  ],')
    if (insertPos === -1) return false

    content = content.slice(0, insertPos) + entry + '\n\n' + content.slice(insertPos)
    await fs.writeFile(configPath, content, 'utf-8')
    return true
  } catch {
    return false
  }
}

async function finishAddhookbot(
  chatId: number,
  state: StateStore,
  output: ChatOutputPort,
): Promise<void> {
  const wizard = wizards.get(chatId)
  if (!wizard) {
    await output.sendText(chatId, '❌ Wizard state lost. Start again with /addhookbot.')
    return
  }

  const targetChatId = wizard.chatId ?? chatId
  const serverUrl = process.env.OPENCODE_SERVER_URL ?? 'http://127.0.0.1:4096'
  const serverUsername = process.env.OPENCODE_SERVER_USERNAME ?? 'opencode'
  const serverPassword = process.env.OPENCODE_SERVER_PASSWORD ?? ''

  const configData = {
    botToken: wizard.token,
    chatId: targetChatId,
    projects: wizard.selectedProjects,
    serverUrl,
    serverUsername,
    serverPassword,
    mode: wizard.mode,
  }

  const configDir = resolve(process.cwd(), 'data')
  const configPath = resolve(configDir, 'hook-config.json')

  try {
    await fs.mkdir(configDir, { recursive: true })
    await fs.writeFile(configPath, JSON.stringify(configData, null, 2), 'utf-8')
  } catch (error) {
    await output.sendText(chatId, `❌ Failed to save config: ${escapeHtml(error instanceof Error ? error.message : 'unknown')}`)
    wizards.delete(chatId)
    return
  }

  const ecosystemAppended = await appendHookBotToEcosystem(wizard)

  const chatState = await state.getChatState(chatId)
  chatState.awaitingInput = null
  await state.saveChatState(chatId, chatState)

  const modeText = wizard.mode === 'all'
    ? '📡 All projects'
    : `📁 ${wizard.selectedProjects.map(p => p.name).join(', ')}`

  const ecosystemStatus = ecosystemAppended
    ? '✅ Auto-added to ecosystem.config.cjs'
    : '⚠️ Failed to update ecosystem.config.cjs — add manually'

  const buttons: Button[] = [
    { label: '🚀 Start now (PM2)', callbackData: 'ahb_start:start' },
    { label: '📋 Save config only', callbackData: 'ahb_start:skip' },
  ]

  await output.sendInteraction(chatId, [
    `✅ <b>Hook bot configured!</b>`,
    ``,
    `📋 <b>@${escapeHtml(wizard.username)}</b>`,
    `   Mode: ${modeText}`,
    `   Chat ID: <code>${targetChatId}</code>`,
    `   Config: <code>data/hook-config.json</code>`,
    ``,
    ecosystemStatus,
  ].join('\n'), buttons)

  logger.info('registry', `Hook bot configured via wizard: @${wizard.username}`)
}

export async function handleAddhookbotStartCallback(
  chatId: number,
  action: 'start' | 'skip',
  output: ChatOutputPort,
): Promise<void> {
  const wizard = wizards.get(chatId)

  if (action === 'skip') {
    wizards.delete(chatId)
    await output.sendText(chatId, '📋 Config saved to <code>data/hook-config.json</code>.\nAdd to ecosystem.config.cjs manually and start with PM2.', 'HTML')
    return
  }

  if (!wizard) {
    wizards.delete(chatId)
    await output.sendText(chatId, '❌ Wizard state lost. Start again with /addhookbot.')
    return
  }

  const pm2Name = 'opencode-go-hookbot'
  await output.sendText(chatId, `🚀 Starting <code>${escapeHtml(pm2Name)}</code>...`, 'HTML')

  const tmpConfigPath = `/tmp/${pm2Name}.config.json`
  try {
    const appConfig = {
      apps: [{
        name: pm2Name,
        script: 'src/hookBot.ts',
        interpreter: 'bun',
        cwd: process.cwd(),
        autorestart: true,
        max_memory_restart: '512M',
        env: {
          PATH: `${process.env.HOME}/.bun/bin:${process.env.PATH}`,
          HOOK_CONFIG_PATH: 'data/hook-config.json',
          OPENCODE_SERVER_URL: process.env.OPENCODE_SERVER_URL ?? 'http://127.0.0.1:4096',
          OPENCODE_SERVER_USERNAME: process.env.OPENCODE_SERVER_USERNAME ?? 'opencode',
          OPENCODE_SERVER_PASSWORD: process.env.OPENCODE_SERVER_PASSWORD ?? '',
        },
      }],
    }

    await fs.writeFile(tmpConfigPath, JSON.stringify(appConfig, null, 2), 'utf-8')

    const proc = Bun.spawn(['pm2', 'start', tmpConfigPath], {
      cwd: process.cwd(),
      stdout: 'pipe',
      stderr: 'pipe',
    })
    const exitCode = await proc.exited

    await fs.unlink(tmpConfigPath).catch(() => {})

    if (exitCode === 0) {
      wizards.delete(chatId)
      await output.sendText(chatId, `✅ <code>${escapeHtml(pm2Name)}</code> started!`, 'HTML')
    } else {
      const stderr = await new Response(proc.stderr).text()
      await output.sendText(chatId, `❌ PM2 start failed (exit ${exitCode})\n<pre>${escapeHtml(stderr.slice(0, 500))}</pre>`, 'HTML')
    }
  } catch (error) {
    await fs.unlink(tmpConfigPath).catch(() => {})
    await output.sendText(chatId, `❌ PM2 execution failed: ${escapeHtml(error instanceof Error ? error.message : 'unknown')}`, 'HTML')
  }
}

export function cancelAddhookbotWizard(chatId: number): void {
  wizards.delete(chatId)
}

/** Clear addhookbot wizard state if active (used when other commands are invoked) */
export async function clearAddhookbotIfActive(chatId: number, state: StateStore): Promise<boolean> {
  const chatState = await state.getChatState(chatId)
  if (chatState.awaitingInput === 'addhookbot_token' || chatState.awaitingInput === 'addhookbot_chatid') {
    chatState.awaitingInput = null
    await state.saveChatState(chatId, chatState)
    wizards.delete(chatId)
    return true
  }
  return false
}

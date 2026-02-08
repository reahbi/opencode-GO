import type { Context } from 'grammy'
import type { StateStore } from '../../../domain/ports/StateStore.js'
import type { BotRegistryPort } from '../../../domain/ports/BotRegistryPort.js'
import type { CustomAgentPort } from '../../../domain/ports/CustomAgentPort.js'
import type { ChatOutputPort } from '../../../domain/ports/ChatOutputPort.js'
import type { Button } from '../../../domain/models.js'
import { logger } from '../../../shared/logger.js'
import { promises as fs } from 'node:fs'
import { resolve } from 'node:path'

interface AddBotWizardState {
  token: string
  username: string
  role?: 'writer' | 'reader'
  projectDir?: string
  instanceName?: string
  customAgentId?: string
  tokenAttempts?: number
}

const MAX_TOKEN_ATTEMPTS = 3
const wizards = new Map<number, AddBotWizardState>()

function escapeHtml(t: string): string {
  return t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

interface OpenCodeProject {
  worktree: string
  name?: string
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

export function addbotCommand(state: StateStore) {
  return async (ctx: Context) => {
    const chatId = ctx.chat?.id
    if (!chatId) return
    if (ctx.chat?.type !== 'private') {
      await ctx.reply('Only available in DM.')
      return
    }

    // Reset any existing wizard state
    wizards.delete(chatId)

    const chatState = await state.getChatState(chatId)
    chatState.awaitingInput = 'addbot_token'
    await state.saveChatState(chatId, chatState)

    await ctx.reply(
      [
        '<b>🤖 Add Bot Wizard</b>',
        '',
        'Send the bot token from BotFather.',
        '',
        'Type /cancel to cancel.',
      ].join('\n'),
      { parse_mode: 'HTML' },
    )
  }
}

export async function handleAddbotToken(
  chatId: number,
  text: string,
  state: StateStore,
  output: ChatOutputPort,
): Promise<boolean> {
  const token = text.trim()

  // Get or create wizard state to track attempts
  let wizard = wizards.get(chatId) || { token: '', username: '', tokenAttempts: 0 }
  wizard.tokenAttempts = (wizard.tokenAttempts || 0) + 1
  wizards.set(chatId, wizard)

  let username = ''
  try {
    const res = await fetch(`https://api.telegram.org/bot${token}/getMe`, {
      signal: AbortSignal.timeout(10000),
    })
    const data = await res.json() as { ok: boolean; result?: { username?: string } }
    if (!data.ok || !data.result?.username) {
      // Check if max attempts reached
      if (wizard.tokenAttempts >= MAX_TOKEN_ATTEMPTS) {
        wizards.delete(chatId)
        const chatState = await state.getChatState(chatId)
        chatState.awaitingInput = null
        await state.saveChatState(chatId, chatState)
        await output.sendText(chatId, `❌ Invalid bot token. Maximum attempts (${MAX_TOKEN_ATTEMPTS}) reached.\n\nWizard cancelled. Use /addbot to start again.`)
        return true
      }
      const remaining = MAX_TOKEN_ATTEMPTS - wizard.tokenAttempts
      await output.sendText(chatId, `❌ Invalid bot token. Please try again. (${remaining} attempt${remaining > 1 ? 's' : ''} remaining)\n\nType /cancel to cancel.`)
      return true
    }
    username = data.result.username
  } catch {
    // Check if max attempts reached
    if (wizard.tokenAttempts >= MAX_TOKEN_ATTEMPTS) {
      wizards.delete(chatId)
      const chatState = await state.getChatState(chatId)
      chatState.awaitingInput = null
      await state.saveChatState(chatId, chatState)
      await output.sendText(chatId, `❌ Cannot connect to Telegram API. Maximum attempts (${MAX_TOKEN_ATTEMPTS}) reached.\n\nWizard cancelled. Use /addbot to start again.`)
      return true
    }
    const remaining = MAX_TOKEN_ATTEMPTS - wizard.tokenAttempts
    await output.sendText(chatId, `❌ Cannot connect to Telegram API. Please try again. (${remaining} attempt${remaining > 1 ? 's' : ''} remaining)\n\nType /cancel to cancel.`)
    return true
  }

  // Success - reset attempts and update wizard state
  wizard = { token, username, tokenAttempts: 0 }
  wizards.set(chatId, wizard)

  const chatState = await state.getChatState(chatId)
  chatState.awaitingInput = null
  await state.saveChatState(chatId, chatState)

  const buttons: Button[] = [
    { label: '✏️ Writer', callbackData: 'addbot:writer' },
    { label: '🔒 Reader', callbackData: 'addbot:reader' },
  ]
  await output.sendInteraction(
    chatId,
    `✅ <b>@${escapeHtml(username)}</b> verified\n\nSelect a role:`,
    buttons,
  )

  return true
}

export async function handleAddbotRoleCallback(
  chatId: number,
  role: 'writer' | 'reader',
  state: StateStore,
  output: ChatOutputPort,
  serverUrl: string,
  serverUsername: string,
  serverPassword: string,
): Promise<void> {
  const wizard = wizards.get(chatId)
  if (!wizard) {
    await output.sendText(chatId, '❌ No wizard in progress. Start with /addbot.')
    return
  }

  wizard.role = role
  wizards.set(chatId, wizard)

  let projects: OpenCodeProject[] = []
  try {
    projects = await fetchProjects(serverUrl, serverUsername, serverPassword)
  } catch {
    logger.debug('registry', 'Failed to fetch projects for addbot wizard')
  }

  if (projects.length > 0) {
    const buttons: Button[] = projects.map(p => ({
      label: `📁 ${p.name || p.worktree.split('/').pop() || p.worktree}`,
      callbackData: `addbot_proj:${p.worktree}`,
    }))
    buttons.push({ label: '✏️ Enter manually', callbackData: 'addbot_proj:__manual__' })

    await output.sendInteraction(
      chatId,
      `Role: <b>${role === 'writer' ? '✏️ Writer' : '🔒 Reader'}</b>\n\nSelect a project:`,
      buttons,
    )
  } else {
    const chatState = await state.getChatState(chatId)
    chatState.awaitingInput = 'addbot_project'
    await state.saveChatState(chatId, chatState)

    await output.sendText(
      chatId,
      `Role: <b>${role === 'writer' ? '✏️ Writer' : '🔒 Reader'}</b>\n\nSend the project directory path.\n(e.g. <code>/home/user/my-project</code>)`,
      'HTML',
    )
  }
}

export async function handleAddbotProjectCallback(
  chatId: number,
  projectDir: string,
  state: StateStore,
  output: ChatOutputPort,
  registry: BotRegistryPort,
  serverUrl: string,
  customAgents?: CustomAgentPort,
): Promise<void> {
  if (projectDir === '__manual__') {
    const chatState = await state.getChatState(chatId)
    chatState.awaitingInput = 'addbot_project'
    await state.saveChatState(chatId, chatState)
    await output.sendText(chatId, 'Send the project directory path.\n(e.g. <code>/home/user/my-project</code>)', 'HTML')
    return
  }

  await startCustomAgentSelection(chatId, projectDir, state, output, registry, serverUrl, customAgents)
}

export async function handleAddbotProjectText(
  chatId: number,
  text: string,
  state: StateStore,
  output: ChatOutputPort,
  registry: BotRegistryPort,
  serverUrl: string,
  customAgents?: CustomAgentPort,
): Promise<boolean> {
  const projectDir = text.trim()
  if (!projectDir.startsWith('/')) {
    await output.sendText(chatId, '❌ Please enter an absolute path. (e.g. /home/user/project)')
    return true
  }

  await startCustomAgentSelection(chatId, projectDir, state, output, registry, serverUrl, customAgents)
  return true
}

async function startCustomAgentSelection(
  chatId: number,
  projectDir: string,
  state: StateStore,
  output: ChatOutputPort,
  registry: BotRegistryPort,
  serverUrl: string,
  customAgents?: CustomAgentPort,
): Promise<void> {
  const wizard = wizards.get(chatId)
  if (!wizard) {
    await output.sendText(chatId, '❌ Wizard state lost. Start again with /addbot.')
    return
  }

  wizard.projectDir = projectDir
  wizard.customAgentId = undefined
  wizards.set(chatId, wizard)

  if (!customAgents) {
    await finishAddbot(chatId, projectDir, state, output, registry, serverUrl)
    return
  }

  const agents = await customAgents.list()
  const buttons: Button[] = agents.map(agent => ({
    label: `🎭 ${agent.name}`,
    callbackData: `addbot_agent:${agent.id}`,
  }))
  buttons.push({ label: '⏭️ Skip', callbackData: 'addbot_agent:__skip__' })
  buttons.push({ label: '✨ Create new', callbackData: 'addbot_agent:__new__' })

  await output.sendInteraction(
    chatId,
    agents.length > 0
      ? 'Select an optional custom agent for this bot:'
      : 'No custom agents found yet. You can skip or create one first.',
    buttons,
  )
}

export async function handleAddbotAgentCallback(
  chatId: number,
  agentId: string,
  state: StateStore,
  output: ChatOutputPort,
  registry: BotRegistryPort,
  serverUrl: string,
): Promise<void> {
  const wizard = wizards.get(chatId)
  if (!wizard || !wizard.projectDir) {
    await output.sendText(chatId, '❌ Wizard state lost. Start again with /addbot.')
    return
  }

  if (agentId === '__new__') {
    const chatState = await state.getChatState(chatId)
    chatState.awaitingInput = null
    await state.saveChatState(chatId, chatState)
    wizards.delete(chatId)
    await output.sendText(chatId, 'Use /makeagent to create a custom agent first, then run /addbot again.')
    return
  }

  wizard.customAgentId = agentId === '__skip__' ? undefined : agentId
  wizards.set(chatId, wizard)

  await finishAddbot(chatId, wizard.projectDir, state, output, registry, serverUrl)
}

async function appendToEcosystemConfig(wizard: AddBotWizardState): Promise<boolean> {
  const configPath = resolve(process.cwd(), 'ecosystem.config.cjs')
  try {
    let content = await fs.readFile(configPath, 'utf-8')

    if (content.includes(`name: 'opencode-go-${wizard.instanceName}'`)) {
      return true
    }

    const entry = [
      `    {`,
      `      name: 'opencode-go-${wizard.instanceName}',`,
      `      script: 'src/main.ts',`,
      `      interpreter: 'bun',`,
      `      cwd: '${process.cwd()}',`,
      `      env: {`,
      '        PATH: `${process.env.HOME}/.bun/bin:${process.env.PATH}`,',
      `        BOT_TOKEN: '${wizard.token}',`,
      `        ALLOWED_USER_IDS: '${process.env.ALLOWED_USER_IDS ?? ''}',`,
      `        DEFAULT_PROJECT: '${wizard.projectDir}',`,
      `        INSTANCE_NAME: '${wizard.instanceName}',`,
      `        STATE_DIR: 'data/instances/${wizard.instanceName}',`,
      `        OPENCODE_SERVER_URL: '${process.env.OPENCODE_SERVER_URL ?? 'http://127.0.0.1:4096'}',`,
      `        OPENCODE_SERVER_USERNAME: '${process.env.OPENCODE_SERVER_USERNAME ?? 'opencode'}',`,
      `        OPENCODE_SERVER_PASSWORD: '${process.env.OPENCODE_SERVER_PASSWORD ?? ''}',`,
      `        BOT_ROLE: '${wizard.role}',`,
      ...(wizard.customAgentId ? [`        DEFAULT_CUSTOM_AGENT: '${wizard.customAgentId}',`] : []),
      `        GROUP_CHAT_ENABLED: 'true',`,
      `        COORDINATION_DIR,`,
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

async function finishAddbot(
  chatId: number,
  projectDir: string,
  state: StateStore,
  output: ChatOutputPort,
  registry: BotRegistryPort,
  serverUrl: string,
): Promise<void> {
  const wizard = wizards.get(chatId)
  if (!wizard || !wizard.role) {
    await output.sendText(chatId, '❌ Wizard state lost. Start again with /addbot.')
    return
  }

  let instanceName = wizard.username.toLowerCase()
    .replace(/bot$/i, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    || wizard.username.toLowerCase()

  // If the same botUsername is already registered under a different key, reuse that key
  const existing = await registry.list()
  const prev = existing.find(b => b.botUsername.toLowerCase() === wizard.username.toLowerCase())
  if (prev && prev.instanceName !== instanceName) {
    await registry.unregister(prev.instanceName)
    logger.info('registry', `Replaced old entry "${prev.instanceName}" for @${wizard.username}`)
  } else if (prev) {
    instanceName = prev.instanceName
  }

  wizard.projectDir = projectDir
  wizard.instanceName = instanceName

  await registry.register({
    instanceName,
    botUsername: wizard.username,
    botRole: wizard.role,
    projectDir,
    serverUrl,
    lastSeen: 0,
  })

  const chatState = await state.getChatState(chatId)
  chatState.awaitingInput = null
  await state.saveChatState(chatId, chatState)

  const ecosystemAppended = await appendToEcosystemConfig(wizard)

  const buttons: Button[] = [
    { label: '🚀 Start now (PM2)', callbackData: `addbot_start:${instanceName}` },
    { label: '📋 Save config only', callbackData: 'addbot_start:skip' },
  ]

  const ecosystemStatus = ecosystemAppended
    ? '✅ Auto-added to ecosystem.config.cjs'
    : '⚠️ Failed to update ecosystem.config.cjs — add manually'

  await output.sendInteraction(chatId, [
    `✅ <b>Bot registered!</b>`,
    ``,
    `📋 <b>@${escapeHtml(wizard.username)}</b>`,
    `   Instance: <code>${escapeHtml(instanceName)}</code>`,
    `   Role: ${wizard.role === 'writer' ? '✏️ Writer' : '🔒 Reader'}`,
    `   Project: <code>${escapeHtml(projectDir)}</code>`,
    `   Custom Agent: ${wizard.customAgentId ? `<code>${escapeHtml(wizard.customAgentId)}</code>` : 'None'}`,
    ``,
    ecosystemStatus,
  ].join('\n'), buttons)

  logger.info('registry', `Bot added via wizard: @${wizard.username} as ${wizard.role}`)
}

export async function handleAddbotStartCallback(
  chatId: number,
  instanceName: string,
  output: ChatOutputPort,
): Promise<void> {
  const wizard = wizards.get(chatId)

  if (instanceName === 'skip') {
    wizards.delete(chatId)
    await output.sendText(chatId, '📋 Config saved. Add to ecosystem.config.cjs manually and start with PM2.')
    return
  }

  if (!wizard || !wizard.role || !wizard.projectDir) {
    wizards.delete(chatId)
    await output.sendText(chatId, '❌ Wizard state lost. Start again with /addbot.')
    return
  }

  const pm2Name = `opencode-go-${instanceName}`
  await output.sendText(chatId, `🚀 Starting <code>${escapeHtml(pm2Name)}</code>...`, 'HTML')

  const tmpConfigPath = `/tmp/${pm2Name}.config.json`
  try {
    const appConfig = {
      apps: [{
        name: pm2Name,
        script: 'src/main.ts',
        interpreter: 'bun',
        cwd: process.cwd(),
        autorestart: true,
        max_memory_restart: '512M',
        env: {
          PATH: `${process.env.HOME}/.bun/bin:${process.env.PATH}`,
          BOT_TOKEN: wizard.token,
          ALLOWED_USER_IDS: process.env.ALLOWED_USER_IDS ?? '',
          DEFAULT_PROJECT: wizard.projectDir,
          INSTANCE_NAME: instanceName,
          STATE_DIR: `data/instances/${instanceName}`,
          OPENCODE_SERVER_URL: process.env.OPENCODE_SERVER_URL ?? 'http://127.0.0.1:4096',
          OPENCODE_SERVER_USERNAME: process.env.OPENCODE_SERVER_USERNAME ?? 'opencode',
          OPENCODE_SERVER_PASSWORD: process.env.OPENCODE_SERVER_PASSWORD ?? '',
          BOT_ROLE: wizard.role,
          ...(wizard.customAgentId ? { DEFAULT_CUSTOM_AGENT: wizard.customAgentId } : {}),
          GROUP_CHAT_ENABLED: 'true',
          COORDINATION_DIR: process.env.COORDINATION_DIR ?? '/tmp/opencode-go-coordination',
          ...(process.env.DEFAULT_AGENT ? { DEFAULT_AGENT: process.env.DEFAULT_AGENT } : {}),
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

export function cancelAddbotWizard(chatId: number): void {
  wizards.delete(chatId)
}

/** Clear addbot wizard state if active (used when other commands are invoked) */
export async function clearAddbotIfActive(chatId: number, state: StateStore): Promise<boolean> {
  const chatState = await state.getChatState(chatId)
  if (chatState.awaitingInput === 'addbot_token' || chatState.awaitingInput === 'addbot_project') {
    chatState.awaitingInput = null
    await state.saveChatState(chatId, chatState)
    wizards.delete(chatId)
    return true
  }
  return false
}

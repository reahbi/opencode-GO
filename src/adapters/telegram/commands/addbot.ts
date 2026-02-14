import type { Context } from 'grammy'
import { InlineKeyboard } from 'grammy'
import type { StateStore } from '../../../domain/ports/StateStore.js'
import type { BotRegistryPort } from '../../../domain/ports/BotRegistryPort.js'
import type { CustomAgentPort } from '../../../domain/ports/CustomAgentPort.js'
import type { ChatOutputPort } from '../../../domain/ports/ChatOutputPort.js'
import type { Button } from '../../../domain/models.js'
import { escapeHtml } from '../../../shared/formatResponse.js'
import { logger } from '../../../shared/logger.js'
import { updateChatState } from '../../../app/usecases/stateUpdate.js'
import { promises as fs } from 'node:fs'
import { resolve } from 'node:path'
import { homedir } from 'node:os'

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

/**
 * Get recent projects from Claude Code's project directory
 * Returns array of absolute paths sorted by most recently used
 */
async function getClaudeCodeProjects(): Promise<string[]> {
  try {
    const projectsDir = resolve(homedir(), '.claude', 'projects')
    const entries = await fs.readdir(projectsDir, { withFileTypes: true })

    // Get directories with their modification times
    const dirs = await Promise.all(
      entries
        .filter(entry => entry.isDirectory())
        .map(async entry => {
          const fullPath = resolve(projectsDir, entry.name)
          const stats = await fs.stat(fullPath)
          // Convert directory name back to path: -home-nosky-claude-go -> /home/nosky/claude-go
          const projectPath = '/' + entry.name.slice(1).replace(/-/g, '/')
          return { path: projectPath, mtime: stats.mtime.getTime() }
        })
    )

    // Sort by most recently modified and return paths
    return dirs
      .sort((a, b) => b.mtime - a.mtime)
      .map(d => d.path)
  } catch (error) {
    logger.debug('registry', `Failed to read Claude Code projects: ${error}`)
    return []
  }
}


export function addbotCommand(state: StateStore, registry?: BotRegistryPort) {
  return async (ctx: Context) => {
    const chatId = ctx.chat?.id
    if (!chatId) return
    if (ctx.chat?.type !== 'private') {
      await ctx.reply('Only available in DM.')
      return
    }

    // Toggle: if bots exist, show list with remove buttons
    if (registry) {
      const bots = await registry.list()
      if (bots.length > 0) {
        const kb = new InlineKeyboard()
        for (const b of bots) {
          kb.text(`❌ @${b.botUsername} (${b.botRole})`, `addbot_rm:${b.instanceName}`).row()
        }
        kb.text('➕ Add new bot', 'addbot_new')

        const lines = [
          '<b>🤖 Registered Bots</b>',
          '',
          ...bots.map(b => `• <b>@${escapeHtml(b.botUsername)}</b> — ${b.botRole === 'writer' ? '✏️ Writer' : '🔒 Reader'} — <code>${escapeHtml(b.projectDir)}</code>`),
          '',
          'Tap ❌ to remove, or add a new bot.',
        ]

        await ctx.reply(lines.join('\n'), { parse_mode: 'HTML', reply_markup: kb })
        return
      }
    }

    // No existing bots — start wizard
    wizards.delete(chatId)

    await updateChatState(state, chatId, (chatState) => {
      chatState.awaitingInput = 'addbot_token'
      chatState.awaitingInputStartedAt = Date.now()
    })

    const kb = new InlineKeyboard().text('❌ Cancel', 'addbot_cancel')

    await ctx.reply(
      [
        '<b>🤖 Add Bot Wizard</b>',
        '',
        'Send the bot token from BotFather.',
        '',
        'Type /cancel to cancel, or tap the button below.',
      ].join('\n'),
      { parse_mode: 'HTML', reply_markup: kb },
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
        await updateChatState(state, chatId, (chatState) => {
          chatState.awaitingInput = null
        })
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
      await updateChatState(state, chatId, (chatState) => {
        chatState.awaitingInput = null
      })
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

  await updateChatState(state, chatId, (chatState) => {
    chatState.awaitingInput = null
    chatState.awaitingInputStartedAt = undefined
  })

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
  registry: BotRegistryPort,
): Promise<void> {
  const wizard = wizards.get(chatId)
  if (!wizard) {
    await output.sendText(chatId, '❌ No wizard in progress. Start with /addbot.')
    return
  }

  wizard.role = role
  wizards.set(chatId, wizard)

  // Get projects from both Claude Code recent projects and registered bots
  const claudeProjects = await getClaudeCodeProjects()
  const bots = await registry.list()
  const registryProjects = bots.map(b => b.projectDir).filter(Boolean)

  // Combine and deduplicate, prioritizing Claude Code recent projects
  const allProjects = [...new Set([...claudeProjects, ...registryProjects])]

  if (allProjects.length > 0) {
    const buttons: Button[] = allProjects.map(dir => ({
      label: `📁 ${dir.split('/').pop() || dir}`,
      callbackData: `addbot_proj:${dir}`,
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
  customAgents?: CustomAgentPort,
): Promise<void> {
  if (projectDir === '__manual__') {
    const chatState = await state.getChatState(chatId)
    chatState.awaitingInput = 'addbot_project'
    await state.saveChatState(chatId, chatState)
    await output.sendText(chatId, 'Send the project directory path.\n(e.g. <code>/home/user/my-project</code>)', 'HTML')
    return
  }

  await startCustomAgentSelection(chatId, projectDir, state, output, registry, customAgents)
}

export async function handleAddbotProjectText(
  chatId: number,
  text: string,
  state: StateStore,
  output: ChatOutputPort,
  registry: BotRegistryPort,
  customAgents?: CustomAgentPort,
): Promise<boolean> {
  const projectDir = text.trim()
  if (!projectDir.startsWith('/')) {
    await output.sendText(chatId, '❌ Please enter an absolute path. (e.g. /home/user/project)')
    return true
  }

  await startCustomAgentSelection(chatId, projectDir, state, output, registry, customAgents)
  return true
}

async function startCustomAgentSelection(
  chatId: number,
  projectDir: string,
  state: StateStore,
  output: ChatOutputPort,
  registry: BotRegistryPort,
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
    await finishAddbot(chatId, projectDir, state, output, registry)
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

  await finishAddbot(chatId, wizard.projectDir, state, output, registry)
}

async function appendToEcosystemConfig(wizard: AddBotWizardState): Promise<boolean> {
  const configPath = resolve(process.cwd(), 'ecosystem.config.cjs')
  try {
    let content = await fs.readFile(configPath, 'utf-8')

    if (content.includes(`name: 'claude-go-${wizard.instanceName}'`)) {
      return true
    }

    const entry = [
      `    {`,
      `      name: 'claude-go-${wizard.instanceName}',`,
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
      `        CLAUDE_MODEL: '${process.env.CLAUDE_MODEL ?? 'claude-sonnet-4-5'}',`,
      `        BOT_ROLE: '${wizard.role}',`,
      ...(wizard.customAgentId ? [`        DEFAULT_CUSTOM_AGENT: '${wizard.customAgentId}',`] : []),
      `        GROUP_CHAT_ENABLED: 'true',`,
      `        COORDINATION_DIR: '${process.env.COORDINATION_DIR ?? 'data/coordination'}',`,
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
    serverUrl: '',
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

  const pm2Name = `claude-go-${instanceName}`
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
          CLAUDE_MODEL: process.env.CLAUDE_MODEL ?? 'claude-sonnet-4-5',
          BOT_ROLE: wizard.role,
          ...(wizard.customAgentId ? { DEFAULT_CUSTOM_AGENT: wizard.customAgentId } : {}),
          GROUP_CHAT_ENABLED: 'true',
          COORDINATION_DIR: process.env.COORDINATION_DIR ?? '/tmp/claude-go-coordination',
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

export async function handleAddbotRemoveCallback(
  chatId: number,
  instanceName: string,
  output: ChatOutputPort,
  registry: BotRegistryPort,
): Promise<void> {
  try {
    await registry.unregister(instanceName)

    const pm2Name = `claude-go-${instanceName}`
    try {
      const proc = Bun.spawn(['pm2', 'delete', pm2Name], {
        cwd: process.cwd(),
        stdout: 'pipe',
        stderr: 'pipe',
      })
      await proc.exited
    } catch { /* PM2 process may not exist */ }

    await removeFromEcosystemConfig(instanceName)

    await output.sendText(chatId, `✅ Bot <code>${escapeHtml(instanceName)}</code> removed and PM2 process stopped.`, 'HTML')
    logger.info('registry', `Bot removed via toggle: ${instanceName}`)
  } catch (error) {
    await output.sendText(chatId, `❌ Failed to remove bot: ${escapeHtml(error instanceof Error ? error.message : 'unknown')}`, 'HTML')
  }
}

async function removeFromEcosystemConfig(instanceName: string): Promise<boolean> {
  const configPath = resolve(process.cwd(), 'ecosystem.config.cjs')
  try {
    let content = await fs.readFile(configPath, 'utf-8')
    const marker = `name: 'claude-go-${instanceName}'`
    if (!content.includes(marker)) return true

    const idx = content.indexOf(marker)
    let blockStart = content.lastIndexOf('    {', idx)
    let blockEnd = content.indexOf('    },', idx)
    if (blockStart === -1 || blockEnd === -1) return false
    blockEnd += '    },'.length

    while (blockEnd < content.length && content[blockEnd] === '\n') blockEnd++

    content = content.slice(0, blockStart) + content.slice(blockEnd)
    await fs.writeFile(configPath, content, 'utf-8')
    return true
  } catch {
    return false
  }
}

export async function startAddbotWizard(
  chatId: number,
  state: StateStore,
  output: ChatOutputPort,
): Promise<void> {
  wizards.delete(chatId)

  const chatState = await state.getChatState(chatId)
  chatState.awaitingInput = 'addbot_token'
  chatState.awaitingInputStartedAt = Date.now()
  await state.saveChatState(chatId, chatState)

  const buttons: Button[] = [{ label: '❌ Cancel', callbackData: 'addbot_cancel' }]
  await output.sendInteraction(chatId, [
    '<b>🤖 Add Bot Wizard</b>',
    '',
    'Send the bot token from BotFather.',
    '',
    'Type /cancel to cancel, or tap the button below.',
  ].join('\n'), buttons)
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

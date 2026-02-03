import type { Context } from 'grammy'
import type { StateStore } from '../../../domain/ports/StateStore.js'
import type { BotRegistryPort } from '../../../domain/ports/BotRegistryPort.js'
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
}

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
      await ctx.reply('DM에서만 사용할 수 있습니다.')
      return
    }

    const chatState = await state.getChatState(chatId)
    chatState.awaitingInput = 'addbot_token'
    await state.saveChatState(chatId, chatState)

    await ctx.reply(
      [
        '<b>🤖 봇 추가 마법사</b>',
        '',
        'BotFather에서 발급받은 새 봇의 토큰을 보내주세요.',
        '',
        '취소하려면 /cancel 을 입력하세요.',
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

  let username = ''
  try {
    const res = await fetch(`https://api.telegram.org/bot${token}/getMe`, {
      signal: AbortSignal.timeout(10000),
    })
    const data = await res.json() as { ok: boolean; result?: { username?: string } }
    if (!data.ok || !data.result?.username) {
      await output.sendText(chatId, '❌ 유효하지 않은 봇 토큰입니다. 다시 보내주세요.')
      return true
    }
    username = data.result.username
  } catch {
    await output.sendText(chatId, '❌ Telegram API에 연결할 수 없습니다. 다시 시도해주세요.')
    return true
  }

  wizards.set(chatId, { token, username })

  const chatState = await state.getChatState(chatId)
  chatState.awaitingInput = null
  await state.saveChatState(chatId, chatState)

  const buttons: Button[] = [
    { label: '✏️ Writer', callbackData: 'addbot:writer' },
    { label: '🔒 Reader', callbackData: 'addbot:reader' },
  ]
  await output.sendInteraction(
    chatId,
    `✅ <b>@${escapeHtml(username)}</b> 확인됨\n\n역할을 선택하세요:`,
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
    await output.sendText(chatId, '❌ 진행 중인 마법사가 없습니다. /addbot 으로 다시 시작하세요.')
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
    buttons.push({ label: '✏️ 직접 입력', callbackData: 'addbot_proj:__manual__' })

    await output.sendInteraction(
      chatId,
      `역할: <b>${role === 'writer' ? '✏️ Writer' : '🔒 Reader'}</b>\n\n프로젝트를 선택하세요:`,
      buttons,
    )
  } else {
    const chatState = await state.getChatState(chatId)
    chatState.awaitingInput = 'addbot_project'
    await state.saveChatState(chatId, chatState)

    await output.sendText(
      chatId,
      `역할: <b>${role === 'writer' ? '✏️ Writer' : '🔒 Reader'}</b>\n\n프로젝트 디렉토리 경로를 보내주세요.\n(예: <code>/home/user/my-project</code>)`,
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
): Promise<void> {
  if (projectDir === '__manual__') {
    const chatState = await state.getChatState(chatId)
    chatState.awaitingInput = 'addbot_project'
    await state.saveChatState(chatId, chatState)
    await output.sendText(chatId, '프로젝트 디렉토리 경로를 보내주세요.\n(예: <code>/home/user/my-project</code>)', 'HTML')
    return
  }

  await finishAddbot(chatId, projectDir, state, output, registry, serverUrl)
}

export async function handleAddbotProjectText(
  chatId: number,
  text: string,
  state: StateStore,
  output: ChatOutputPort,
  registry: BotRegistryPort,
  serverUrl: string,
): Promise<boolean> {
  const projectDir = text.trim()
  if (!projectDir.startsWith('/')) {
    await output.sendText(chatId, '❌ 절대 경로를 입력해주세요. (예: /home/user/project)')
    return true
  }

  await finishAddbot(chatId, projectDir, state, output, registry, serverUrl)
  return true
}

async function appendToEcosystemConfig(wizard: AddBotWizardState): Promise<boolean> {
  const configPath = resolve(process.cwd(), 'ecosystem.config.cjs')
  try {
    let content = await fs.readFile(configPath, 'utf-8')

    if (content.includes(`name: 'opencaddy-${wizard.instanceName}'`)) {
      return true
    }

    const entry = [
      `    {`,
      `      name: 'opencaddy-${wizard.instanceName}',`,
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
    await output.sendText(chatId, '❌ 마법사 상태가 유실되었습니다. /addbot 으로 다시 시작하세요.')
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
    { label: '🚀 지금 시작 (PM2)', callbackData: `addbot_start:${instanceName}` },
    { label: '📋 설정만 저장', callbackData: 'addbot_start:skip' },
  ]

  const ecosystemStatus = ecosystemAppended
    ? '✅ ecosystem.config.cjs에 자동 추가됨'
    : '⚠️ ecosystem.config.cjs 수정 실패 — 수동으로 추가하세요'

  await output.sendInteraction(chatId, [
    `✅ <b>봇 등록 완료!</b>`,
    ``,
    `📋 <b>@${escapeHtml(wizard.username)}</b>`,
    `   Instance: <code>${escapeHtml(instanceName)}</code>`,
    `   Role: ${wizard.role === 'writer' ? '✏️ Writer' : '🔒 Reader'}`,
    `   Project: <code>${escapeHtml(projectDir)}</code>`,
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
    await output.sendText(chatId, '📋 설정이 저장되었습니다. 수동으로 ecosystem.config.cjs에 추가한 뒤 PM2로 시작하세요.')
    return
  }

  if (!wizard || !wizard.role || !wizard.projectDir) {
    wizards.delete(chatId)
    await output.sendText(chatId, '❌ 마법사 상태가 유실되었습니다. /addbot 으로 다시 시작하세요.')
    return
  }

  const pm2Name = `opencaddy-${instanceName}`
  await output.sendText(chatId, `🚀 <code>${escapeHtml(pm2Name)}</code> 시작 시도 중...`, 'HTML')

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
          GROUP_CHAT_ENABLED: 'true',
          COORDINATION_DIR: process.env.COORDINATION_DIR ?? '/tmp/opencaddy-coordination',
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
      await output.sendText(chatId, `✅ <code>${escapeHtml(pm2Name)}</code> 시작됨!`, 'HTML')
    } else {
      const stderr = await new Response(proc.stderr).text()
      await output.sendText(chatId, `❌ PM2 시작 실패 (exit ${exitCode})\n<pre>${escapeHtml(stderr.slice(0, 500))}</pre>`, 'HTML')
    }
  } catch (error) {
    await fs.unlink(tmpConfigPath).catch(() => {})
    await output.sendText(chatId, `❌ PM2 실행 실패: ${escapeHtml(error instanceof Error ? error.message : 'unknown')}`, 'HTML')
  }
}

export function cancelAddbotWizard(chatId: number): void {
  wizards.delete(chatId)
}

import type { Context } from 'grammy'
import { updateChatState } from '../../../app/usecases/stateUpdate.js'
import type { UserSettings } from '../../../domain/models.js'
import type { StateStore } from '../../../domain/ports/StateStore.js'

type PermissionMode = UserSettings['permissionMode']

function createPermissionModeCommand(state: StateStore, permissionMode: PermissionMode) {
  return async (ctx: Context) => {
    const chatId = ctx.chat?.id
    if (!chatId) return

    const isGroup = ctx.chat?.type === 'group' || ctx.chat?.type === 'supergroup'
    const threadId = isGroup ? ctx.message?.message_thread_id : undefined

    await updateChatState(state, chatId, (chatState) => {
      chatState.settings.permissionMode = permissionMode
    }, threadId)

    await ctx.reply(`Permission mode set to <code>${permissionMode}</code>.`, { parse_mode: 'HTML' })
  }
}

export function planCommand(state: StateStore) {
  return createPermissionModeCommand(state, 'plan')
}

export function askCommand(state: StateStore) {
  return createPermissionModeCommand(state, 'ask')
}

export function bypassCommand(state: StateStore) {
  return createPermissionModeCommand(state, 'bypass')
}

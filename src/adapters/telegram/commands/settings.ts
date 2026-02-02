import type { Context } from 'grammy'
import { InlineKeyboard } from 'grammy'
import type { StateStore } from '../../../domain/ports/StateStore.js'
import type { UserSettings } from '../../../domain/models.js'

function settingsText(s: UserSettings): string {
  const format = s.outputMode === 'formatted' ? 'Formatted ✅' : 'Raw'
  const summary = s.summaryMode ? 'ON ✅' : 'OFF'
  const model = s.summaryModel
    ? `${s.summaryModel.modelID} (${s.summaryModel.providerID})`
    : 'not selected'
  const threshold = s.summaryThreshold.toLocaleString()

  return [
    '<b>⚙️ Settings</b>',
    '',
    `📝 Output: ${format}`,
    `📊 AI Summary: ${summary}`,
    `🤖 Model: ${model}`,
    `📏 Trigger: ${threshold}+ chars`,
  ].join('\n')
}

function settingsKeyboard(): InlineKeyboard {
  return new InlineKeyboard()
    .text('📝 Toggle Format', 'settings:format')
    .text('📊 Toggle Summary', 'settings:summary')
    .row()
    .text('🤖 Select Model', 'settings:model')
    .text('📏 Set Threshold', 'settings:threshold')
}

export function settingsCommand(state: StateStore) {
  return async (ctx: Context) => {
    const chatId = ctx.chat?.id
    if (!chatId) return
    const chatState = await state.getChatState(chatId)
    await ctx.reply(settingsText(chatState.settings), {
      parse_mode: 'HTML',
      reply_markup: settingsKeyboard(),
    })
  }
}

export { settingsText, settingsKeyboard }

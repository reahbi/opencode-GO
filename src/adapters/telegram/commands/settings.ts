import type { Context } from 'grammy'
import { InlineKeyboard } from 'grammy'
import type { StateStore } from '../../../domain/ports/StateStore.js'
import type { UserSettings } from '../../../domain/models.js'

function settingsText(s: UserSettings, instanceName?: string): string {
  const format = s.outputMode === 'formatted' ? 'Formatted ✅' : 'Raw'
  const summary = s.summaryMode ? 'ON ✅' : 'OFF'
  const model = s.summaryModel
    ? `${s.summaryModel.modelID} (${s.summaryModel.providerID})`
    : 'not selected'
  const threshold = s.summaryThreshold.toLocaleString()
  const histFmt = s.historyFormat === 'html' ? 'HTML ✅' : 'Markdown'
  const histLimit = s.historyLimit ? `Last ${s.historyLimit} messages` : 'All messages'

  const header = instanceName ? `<b>⚙️ Settings</b> <i>(${instanceName})</i>` : '<b>⚙️ Settings</b>'
  return [
    header,
    '',
    `📝 Output: ${format}`,
    `📊 AI Summary: ${summary}`,
    `🤖 Model: ${model}`,
    `📏 Trigger: ${threshold}+ chars`,
    '',
    '<b>📜 Session History Export</b>',
    `   File format: ${histFmt}`,
    `   Included: ${histLimit}`,
  ].join('\n')
}

function settingsKeyboard(): InlineKeyboard {
  return new InlineKeyboard()
    .text('📝 Toggle Format', 'settings:format')
    .text('📊 Toggle Summary', 'settings:summary')
    .row()
    .text('🤖 Select Model', 'settings:model')
    .text('📏 Set Threshold', 'settings:threshold')
    .row()
    .text('📜 History Format', 'settings:histformat')
    .text('📜 History Limit', 'settings:histlimit')
}

export function settingsCommand(state: StateStore, instanceName?: string) {
  return async (ctx: Context) => {
    const chatId = ctx.chat?.id
    if (!chatId) return
    const isGroup = ctx.chat?.type === 'group' || ctx.chat?.type === 'supergroup'
    const chatState = await state.getChatState(chatId)
    await ctx.reply(settingsText(chatState.settings, isGroup ? instanceName : undefined), {
      parse_mode: 'HTML',
      reply_markup: settingsKeyboard(),
    })
  }
}

export { settingsText, settingsKeyboard }

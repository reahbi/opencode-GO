import { Bot, InputFile, InlineKeyboard } from 'grammy'
import type { Context } from 'grammy'
import type { ParseMode } from '@grammyjs/types'
import type { ChatOutputPort } from '../../domain/ports/ChatOutputPort.js'
import type { OutputHandle, Button } from '../../domain/models.js'

export type BotInstance = Bot<Context>
const _MARKER = 'v2-fix-applied'
void _MARKER

export function createBot(token: string): BotInstance {
  const bot = new Bot<Context>(token)
  
  bot.api.config.use((prev, method, payload, signal) => {
    if (!('parse_mode' in payload) || payload.parse_mode === undefined) {
      (payload as Record<string, unknown>).parse_mode = 'HTML'
    }
    return prev(method, payload, signal)
  })
  
  return bot
}

export function createChatOutputAdapter(bot: BotInstance): ChatOutputPort {
  return {
    async sendText(chatId: number, text: string, parseMode?: string): Promise<OutputHandle> {
      const mode = (parseMode ?? 'HTML') as ParseMode
      try {
        const msg = await bot.api.sendMessage(chatId, text, { parse_mode: mode })
        return String(msg.message_id)
      } catch (err) {
        const errMsg = err instanceof Error ? err.message : ''
        if (mode === 'MarkdownV2' && errMsg.includes("can't parse entities")) {
          const plain = text.replace(/\\([_*\[\]()~`>#+\-=|{}.!\\])/g, '$1')
          const msg = await bot.api.sendMessage(chatId, plain)
          return String(msg.message_id)
        }
        throw err
      }
    },

    async editText(chatId: number, handle: OutputHandle, text: string, parseMode?: string): Promise<void> {
      const messageId = parseInt(handle, 10)
      const mode = (parseMode ?? 'HTML') as ParseMode
      try {
        await bot.api.editMessageText(chatId, messageId, text, { parse_mode: mode })
      } catch (err: unknown) {
        const errMsg = err instanceof Error ? err.message : ''
        if (errMsg.includes('message is not modified')) return
        if (mode === 'MarkdownV2' && errMsg.includes("can't parse entities")) {
          const plain = text.replace(/\\([_*\[\]()~`>#+\-=|{}.!\\])/g, '$1')
          await bot.api.editMessageText(chatId, messageId, plain)
          return
        }
        throw err
      }
    },

    async sendFile(chatId: number, content: Buffer, filename: string, caption?: string): Promise<void> {
      const file = new InputFile(content, filename)
      await bot.api.sendDocument(chatId, file, { caption })
    },

    async sendInteraction(chatId: number, text: string, buttons: Button[]): Promise<OutputHandle> {
      const keyboard = new InlineKeyboard()
      for (const btn of buttons) {
        if (btn.url) {
          keyboard.url(btn.label, btn.url).row()
        } else if (btn.callbackData) {
          keyboard.text(btn.label, btn.callbackData).row()
        }
      }
      const msg = await bot.api.sendMessage(chatId, text, { parse_mode: 'HTML', reply_markup: keyboard })
      return String(msg.message_id)
    },

    async editInteraction(chatId: number, handle: OutputHandle, text: string, buttons: Button[]): Promise<void> {
      const messageId = parseInt(handle, 10)
      const keyboard = new InlineKeyboard()
      for (const btn of buttons) {
        if (btn.url) {
          keyboard.url(btn.label, btn.url).row()
        } else if (btn.callbackData) {
          keyboard.text(btn.label, btn.callbackData).row()
        }
      }
      try {
        await bot.api.editMessageText(chatId, messageId, text, { parse_mode: 'HTML', reply_markup: keyboard })
      } catch (err: unknown) {
        const errMsg = err instanceof Error ? err.message : ''
        if (errMsg.includes('message is not modified')) return
        throw err
      }
    },

    async sendTypingAction(chatId: number): Promise<void> {
      await bot.api.sendChatAction(chatId, 'typing')
    }
  }
}

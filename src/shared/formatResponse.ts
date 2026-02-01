import telegramifyMarkdown from 'telegramify-markdown'

const MDV2_RESERVED = /\\\\([_*\[\]()~`>#+\-=|{}.!\\])/g

export function formatMarkdownV2(markdown: string): string {
  try {
    const raw = telegramifyMarkdown(markdown, 'escape')
    return raw.replace(MDV2_RESERVED, '\\$1')
  } catch {
    return escapeMarkdownV2(markdown)
  }
}

function escapeMarkdownV2(text: string): string {
  return text.replace(/([_*\[\]()~`>#+\-=|{}.!\\])/g, '\\$1')
}

export function escapeHtml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

const TELEGRAM_VOID_TAGS = new Set(['br', 'hr'])
const TELEGRAM_ALLOWED_TAGS = new Set([
  'b', 'strong', 'i', 'em', 'u', 'ins', 's', 'strike', 'del',
  'code', 'pre', 'a', 'blockquote', 'tg-spoiler', 'tg-emoji',
])

export function sanitizeTelegramHtml(html: string): string {
  const openStack: string[] = []
  const cleaned = html.replace(/<\/?([a-z][a-z0-9-]*)[^>]*\/?>/gi, (match, tagName: string) => {
    const tag = tagName.toLowerCase()
    if (!TELEGRAM_ALLOWED_TAGS.has(tag)) return ''
    if (TELEGRAM_VOID_TAGS.has(tag)) return match

    const isClosing = match.startsWith('</')
    if (isClosing) {
      const idx = openStack.lastIndexOf(tag)
      if (idx === -1) return ''
      let closeTags = ''
      while (openStack.length > idx) {
        closeTags += `</${openStack.pop()}>`
      }
      return closeTags
    }

    openStack.push(tag)
    return match
  })

  let suffix = ''
  while (openStack.length > 0) {
    suffix += `</${openStack.pop()}>`
  }

  return cleaned + suffix
}

export function stripHtml(html: string): string {
  return html.replace(/<[^>]+>/g, '')
}

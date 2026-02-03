import { describe, it, expect } from 'bun:test'
import {
  escapeHtml,
  sanitizeTelegramHtml,
  stripHtml,
  formatMarkdownV2,
} from '../../shared/formatResponse.js'

describe('formatResponse', () => {
  describe('escapeHtml', () => {
    it('escapes less-than character', () => {
      expect(escapeHtml('<div>')).toBe('&lt;div&gt;')
    })

    it('escapes greater-than character', () => {
      expect(escapeHtml('a > b')).toBe('a &gt; b')
    })

    it('escapes ampersand character', () => {
      expect(escapeHtml('foo & bar')).toBe('foo &amp; bar')
    })

    it('escapes all special chars together', () => {
      expect(escapeHtml('<script>alert("&")</script>'))
        .toBe('&lt;script&gt;alert("&amp;")&lt;/script&gt;')
    })

    it('handles empty string', () => {
      expect(escapeHtml('')).toBe('')
    })

    it('handles string with no special chars', () => {
      expect(escapeHtml('plain text')).toBe('plain text')
    })
  })

  describe('sanitizeTelegramHtml', () => {
    it('preserves allowed tags: b, i, code', () => {
      const input = '<b>bold</b> <i>italic</i> <code>code</code>'
      expect(sanitizeTelegramHtml(input)).toBe(input)
    })

    it('removes disallowed tags like script but keeps content', () => {
      const input = '<script>alert(1)</script>hello'
      expect(sanitizeTelegramHtml(input)).toBe('alert(1)hello')
    })

    it('removes disallowed tags like div but keeps content', () => {
      const input = '<div>content</div>'
      expect(sanitizeTelegramHtml(input)).toBe('content')
    })

    it('preserves nested allowed tags', () => {
      const input = '<b><i>bold italic</i></b>'
      expect(sanitizeTelegramHtml(input)).toBe(input)
    })

    it('auto-closes unclosed tags', () => {
      const input = '<b>bold'
      expect(sanitizeTelegramHtml(input)).toBe('<b>bold</b>')
    })

    it('removes orphan closing tags', () => {
      const input = 'hello</b>'
      expect(sanitizeTelegramHtml(input)).toBe('hello')
    })

    it('handles empty string', () => {
      expect(sanitizeTelegramHtml('')).toBe('')
    })

    it('preserves pre and a tags', () => {
      const input = '<pre>code block</pre> <a href="url">link</a>'
      expect(sanitizeTelegramHtml(input)).toBe(input)
    })

    it('handles mixed allowed and disallowed tags', () => {
      const input = '<div><b>bold</b><script>bad</script></div>'
      expect(sanitizeTelegramHtml(input)).toBe('<b>bold</b>bad')
    })
  })

  describe('stripHtml', () => {
    it('removes all HTML tags', () => {
      expect(stripHtml('<b>bold</b> text')).toBe('bold text')
    })

    it('removes nested tags', () => {
      expect(stripHtml('<div><span>nested</span></div>')).toBe('nested')
    })

    it('handles empty string', () => {
      expect(stripHtml('')).toBe('')
    })

    it('handles string with no tags', () => {
      expect(stripHtml('plain text')).toBe('plain text')
    })

    it('removes self-closing tags', () => {
      expect(stripHtml('before<br/>after')).toBe('beforeafter')
    })

    it('removes tags with attributes', () => {
      expect(stripHtml('<a href="url" class="link">text</a>')).toBe('text')
    })
  })

  describe('formatMarkdownV2', () => {
    it('escapes basic MarkdownV2 special characters', () => {
      const result = formatMarkdownV2('hello_world')
      expect(result).toContain('\\')
    })

    it('handles empty string', () => {
      const result = formatMarkdownV2('')
      expect(result).toBe('')
    })

    it('formats code blocks', () => {
      const input = '```\ncode\n```'
      const result = formatMarkdownV2(input)
      expect(result).toContain('```')
    })

    it('handles plain text without special chars', () => {
      const result = formatMarkdownV2('hello world')
      expect(result).toBeTruthy()
      expect(typeof result).toBe('string')
    })

    it('does not throw on complex markdown input', () => {
      const result = formatMarkdownV2('**bold** _italic_')
      expect(typeof result).toBe('string')
    })
  })
})

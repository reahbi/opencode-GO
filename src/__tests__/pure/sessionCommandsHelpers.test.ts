import { describe, it, expect } from 'bun:test'
import {
  formatTimestamp,
  messagesToMarkdown,
  messagesToHtml,
} from '../../app/usecases/sessionCommands.js'
import { escapeHtml } from '../../shared/formatResponse.js'
import { buildHistoryMessage } from '../helpers/builders.js'

describe('sessionCommands helpers', () => {
  describe('escapeHtml', () => {
    it('escapes less-than character', () => {
      expect(escapeHtml('<tag>')).toBe('&lt;tag&gt;')
    })

    it('escapes greater-than character', () => {
      expect(escapeHtml('a > b')).toBe('a &gt; b')
    })

    it('escapes ampersand character', () => {
      expect(escapeHtml('foo & bar')).toBe('foo &amp; bar')
    })

    it('handles empty string', () => {
      expect(escapeHtml('')).toBe('')
    })
  })

  describe('formatTimestamp', () => {
    it('formats timestamp to Korean locale', () => {
      const ms = Date.parse('2024-01-15T10:30:00Z')
      const result = formatTimestamp(ms)
      
      expect(result).toContain('2024')
      expect(typeof result).toBe('string')
    })

    it('handles zero timestamp', () => {
      const result = formatTimestamp(0)
      expect(typeof result).toBe('string')
    })

    it('formats current time without error', () => {
      const now = Date.now()
      const result = formatTimestamp(now)
      expect(typeof result).toBe('string')
      expect(result.length).toBeGreaterThan(0)
    })
  })

  describe('messagesToMarkdown', () => {
    it('includes title as H1 heading', () => {
      const md = messagesToMarkdown('Test Session', 'ses-123', [])
      
      expect(md).toContain('# Test Session')
    })

    it('includes session ID', () => {
      const md = messagesToMarkdown('Test', 'ses-456', [])
      
      expect(md).toContain('ses-456')
    })

    it('handles empty messages array', () => {
      const md = messagesToMarkdown('Empty', 'ses-000', [])
      
      expect(md).toContain('# Empty')
      expect(md).toContain('ses-000')
    })

    it('formats user message with emoji', () => {
      const msg = buildHistoryMessage({ role: 'user' })
      const md = messagesToMarkdown('Title', 'ses-1', [msg])
      
      expect(md).toContain('👤 User')
    })

    it('formats assistant message with emoji', () => {
      const msg = buildHistoryMessage({ role: 'assistant' })
      const md = messagesToMarkdown('Title', 'ses-1', [msg])
      
      expect(md).toContain('🤖 Assistant')
    })

    it('includes text content from message parts', () => {
      const msg = buildHistoryMessage({
        parts: [{ type: 'text', text: 'Hello world' }],
      })
      const md = messagesToMarkdown('Title', 'ses-1', [msg])
      
      expect(md).toContain('Hello world')
    })

    it('formats tool part', () => {
      const msg = buildHistoryMessage({
        parts: [{ type: 'tool', tool: 'read', title: 'file.ts', status: 'success' }],
      })
      const md = messagesToMarkdown('Title', 'ses-1', [msg])
      
      expect(md).toContain('🔧')
      expect(md).toContain('read')
      expect(md).toContain('file.ts')
      expect(md).toContain('success')
    })

    it('formats subtask part', () => {
      const msg = buildHistoryMessage({
        parts: [{ type: 'subtask', description: 'Process data', agent: 'worker' }],
      })
      const md = messagesToMarkdown('Title', 'ses-1', [msg])
      
      expect(md).toContain('🔀')
      expect(md).toContain('Subtask')
      expect(md).toContain('worker')
      expect(md).toContain('Process data')
    })

    it('separates messages with horizontal rule', () => {
      const msg1 = buildHistoryMessage()
      const msg2 = buildHistoryMessage()
      const md = messagesToMarkdown('Title', 'ses-1', [msg1, msg2])
      
      expect(md).toContain('---')
    })
  })

  describe('messagesToHtml', () => {
    it('returns valid HTML document', () => {
      const html = messagesToHtml('Test', 'ses-1', [])
      
      expect(html).toContain('<!DOCTYPE html>')
      expect(html).toContain('<html')
      expect(html).toContain('</html>')
    })

    it('includes title in head and body', () => {
      const html = messagesToHtml('My Session', 'ses-1', [])
      
      expect(html).toContain('<title>My Session</title>')
      expect(html).toContain('<h1>My Session</h1>')
    })

    it('includes session ID and message count', () => {
      const msg = buildHistoryMessage()
      const html = messagesToHtml('Title', 'ses-123', [msg])
      
      expect(html).toContain('ses-123')
      expect(html).toContain('1 messages')
    })

    it('escapes HTML in title', () => {
      const html = messagesToHtml('<script>alert(1)</script>', 'ses-1', [])
      
      expect(html).toContain('&lt;script&gt;')
      expect(html).not.toContain('<script>alert(1)</script>')
    })

    it('includes CSS styles', () => {
      const html = messagesToHtml('Test', 'ses-1', [])
      
      expect(html).toContain('<style>')
      expect(html).toContain('body{')
    })

    it('formats user message with appropriate class', () => {
      const msg = buildHistoryMessage({ role: 'user' })
      const html = messagesToHtml('Title', 'ses-1', [msg])
      
      expect(html).toContain('class="msg user"')
      expect(html).toContain('👤 User')
    })

    it('formats assistant message with appropriate class', () => {
      const msg = buildHistoryMessage({ role: 'assistant' })
      const html = messagesToHtml('Title', 'ses-1', [msg])
      
      expect(html).toContain('class="msg assistant"')
      expect(html).toContain('🤖 Assistant')
    })

    it('escapes HTML in message text', () => {
      const msg = buildHistoryMessage({
        parts: [{ type: 'text', text: '<div>test</div>' }],
      })
      const html = messagesToHtml('Title', 'ses-1', [msg])
      
      expect(html).toContain('&lt;div&gt;')
    })

    it('converts code blocks to pre tags', () => {
      const msg = buildHistoryMessage({
        parts: [{ type: 'text', text: '```js\nconst x = 1\n```' }],
      })
      const html = messagesToHtml('Title', 'ses-1', [msg])
      
      expect(html).toContain('<pre><code>')
    })

    it('converts inline code to code tags', () => {
      const msg = buildHistoryMessage({
        parts: [{ type: 'text', text: 'use `const` keyword' }],
      })
      const html = messagesToHtml('Title', 'ses-1', [msg])
      
      expect(html).toContain('<code>const</code>')
    })

    it('converts newlines to br tags', () => {
      const msg = buildHistoryMessage({
        parts: [{ type: 'text', text: 'line 1\nline 2' }],
      })
      const html = messagesToHtml('Title', 'ses-1', [msg])
      
      expect(html).toContain('<br>')
    })
  })
})

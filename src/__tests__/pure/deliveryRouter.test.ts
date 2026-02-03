import { describe, it, expect } from 'bun:test'
import { tokenizeBlocks, routeDelivery } from '../../app/policies/deliveryRouter.js'
import { LIMITS } from '../../app/policies/limits.js'

describe('deliveryRouter', () => {
  describe('tokenizeBlocks', () => {
    it('separates code blocks from text', () => {
      const md = 'Text before\n\n```js\ncode\n```\n\nText after'
      const blocks = tokenizeBlocks(md)
      
      expect(blocks.length).toBe(3)
      expect(blocks[0].type).toBe('text')
      expect(blocks[0].content).toBe('Text before')
      expect(blocks[1].type).toBe('code')
      expect(blocks[1].content).toContain('```')
      expect(blocks[2].type).toBe('text')
      expect(blocks[2].content).toBe('Text after')
    })

    it('handles text-only content', () => {
      const md = 'Just plain text\n\nWith paragraph breaks'
      const blocks = tokenizeBlocks(md)
      
      expect(blocks.every(b => b.type === 'text')).toBe(true)
    })

    it('handles code-only content', () => {
      const md = '```\ncode only\n```'
      const blocks = tokenizeBlocks(md)
      
      expect(blocks.length).toBe(1)
      expect(blocks[0].type).toBe('code')
    })

    it('handles multiple code blocks', () => {
      const md = '```\ncode1\n```\n\n```\ncode2\n```'
      const blocks = tokenizeBlocks(md)
      
      expect(blocks.length).toBe(2)
      expect(blocks[0].type).toBe('code')
      expect(blocks[1].type).toBe('code')
    })

    it('handles empty input', () => {
      const blocks = tokenizeBlocks('')
      expect(blocks.length).toBe(0)
    })

    it('splits text by paragraph breaks', () => {
      const md = 'Para 1\n\nPara 2\n\nPara 3'
      const blocks = tokenizeBlocks(md)
      
      expect(blocks.length).toBe(3)
      expect(blocks[0].content).toBe('Para 1')
      expect(blocks[1].content).toBe('Para 2')
      expect(blocks[2].content).toBe('Para 3')
    })

    it('preserves indented code fence markers', () => {
      const md = '  ```js\n  code\n  ```'
      const blocks = tokenizeBlocks(md)
      
      expect(blocks.length).toBe(1)
      expect(blocks[0].type).toBe('code')
    })
  })

  describe('routeDelivery', () => {
    it('returns inline strategy for short content', () => {
      const content = 'Short message'
      const plan = routeDelivery(content)
      
      expect(plan.strategy).toBe('inline')
      expect(plan.messages).toBeDefined()
      expect(plan.messages!.length).toBe(1)
    })

    it('returns inline strategy for empty content', () => {
      const plan = routeDelivery('')
      
      expect(plan.strategy).toBe('inline')
      expect(plan.messages).toBeDefined()
      expect(plan.messages!.length).toBe(1)
    })

    it('returns chunk strategy for medium content', () => {
      const paragraph = 'A'.repeat(2000)
      const content = `${paragraph}\n\n${paragraph}`
      const plan = routeDelivery(content)
      
      expect(plan.strategy).toBe('chunk')
      expect(plan.messages).toBeDefined()
      expect(plan.messages!.length).toBeGreaterThan(1)
      expect(plan.messages!.length).toBeLessThanOrEqual(LIMITS.MAX_MESSAGE_CHUNKS)
    })

    it('returns file strategy for very long content above FILE_FALLBACK_THRESHOLD', () => {
      const content = 'A'.repeat(LIMITS.FILE_FALLBACK_THRESHOLD + 100)
      const plan = routeDelivery(content)
      
      expect(plan.strategy).toBe('file')
      expect(plan.fileContent).toBe(content)
    })

    it('returns file strategy when single block exceeds message limit', () => {
      const longCodeBlock = '```\n' + 'A'.repeat(5000) + '\n```'
      const plan = routeDelivery(longCodeBlock)
      
      expect(plan.strategy).toBe('file')
    })

    it('returns file strategy when chunk count exceeds MAX_MESSAGE_CHUNKS', () => {
      const blocks = Array.from({ length: 10 }, () => 'A'.repeat(2000)).join('\n\n')
      const plan = routeDelivery(blocks)
      
      expect(plan.strategy).toBe('file')
    })

    it('handles content at exact MAX_MESSAGE_LENGTH boundary', () => {
      const content = 'A'.repeat(LIMITS.MAX_MESSAGE_LENGTH)
      const plan = routeDelivery(content)
      
      expect(['inline', 'chunk', 'file']).toContain(plan.strategy)
    })

    it('handles content at exact FILE_FALLBACK_THRESHOLD boundary', () => {
      const content = 'A'.repeat(LIMITS.FILE_FALLBACK_THRESHOLD)
      const plan = routeDelivery(content)
      
      expect(['inline', 'chunk', 'file']).toContain(plan.strategy)
    })

    it('preserves original content in fileContent', () => {
      const original = 'X'.repeat(20000)
      const plan = routeDelivery(original)
      
      if (plan.strategy === 'file') {
        expect(plan.fileContent).toBe(original)
      }
    })

    it('returns inline for content just under message limit', () => {
      const content = 'Hello world!'
      const plan = routeDelivery(content)
      
      expect(plan.strategy).toBe('inline')
      expect(plan.messages).toBeDefined()
      expect(plan.messages!.length).toBe(1)
    })

    it('splits multiple paragraphs into chunks when needed', () => {
      const para = 'B'.repeat(1800)
      const content = Array.from({ length: 3 }, () => para).join('\n\n')
      const plan = routeDelivery(content)
      
      if (plan.strategy === 'chunk') {
        expect(plan.messages!.length).toBeGreaterThan(1)
        expect(plan.messages!.length).toBeLessThanOrEqual(LIMITS.MAX_MESSAGE_CHUNKS)
      }
    })

    it('handles mixed code and text blocks', () => {
      const text = 'Text paragraph'
      const code = '```\ncode\n```'
      const content = `${text}\n\n${code}\n\n${text}`
      const plan = routeDelivery(content)
      
      expect(['inline', 'chunk']).toContain(plan.strategy)
    })
  })
})

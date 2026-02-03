import { describe, it, expect } from 'bun:test'
import { structuralExtract } from '../../shared/structuralExtract.js'

describe('structuralExtract', () => {
  it('extracts H1 heading', () => {
    const md = '# Main Title\n\nSome content'
    const result = structuralExtract(md)
    expect(result).toContain('<b>Main Title</b>')
  })

  it('extracts multiple headings (H1, H2, H3)', () => {
    const md = '# H1\n## H2\n### H3\ntext'
    const result = structuralExtract(md)
    expect(result).toContain('<b>H1</b>')
    expect(result).toContain('<b>H2</b>')
    expect(result).toContain('<b>H3</b>')
  })

  it('extracts file paths from backticks', () => {
    const md = 'Modified `src/app/test.ts` and `lib/utils.js`'
    const result = structuralExtract(md)
    expect(result).toContain('Changed files:')
    expect(result).toContain('<code>src/app/test.ts</code>')
    expect(result).toContain('<code>lib/utils.js</code>')
  })

  it('extracts bullet points (hyphen)', () => {
    const md = '- First item\n- Second item'
    const result = structuralExtract(md)
    expect(result).toContain('- First item')
    expect(result).toContain('- Second item')
  })

  it('extracts bullet points (asterisk)', () => {
    const md = '* First item\n* Second item'
    const result = structuralExtract(md)
    expect(result).toContain('* First item')
    expect(result).toContain('* Second item')
  })

  it('extracts numbered lists', () => {
    const md = '1. First\n2. Second\n3. Third'
    const result = structuralExtract(md)
    expect(result).toContain('1. First')
    expect(result).toContain('2. Second')
  })

  it('skips content inside code blocks', () => {
    const md = '```\n# Not a heading\n- Not a bullet\n```\n# Real heading'
    const result = structuralExtract(md)
    expect(result).toContain('<b>Real heading</b>')
    expect(result).not.toContain('Not a heading')
  })

  it('handles empty input', () => {
    const result = structuralExtract('')
    expect(result).toBe('')
  })

  it('returns original content when no structure found', () => {
    const plainText = 'Just plain text without any structure'
    const result = structuralExtract(plainText)
    expect(result).toBe(plainText)
  })

  it('truncates oversized content to 3500 chars with ellipsis', () => {
    const longHeading = 'A'.repeat(4000)
    const md = `# ${longHeading}`
    const result = structuralExtract(md)
    expect(result.length).toBeLessThanOrEqual(3500)
    expect(result).toContain('...')
  })

  it('limits file paths to 20 entries', () => {
    const files = Array.from({ length: 25 }, (_, i) => `\`path/file${i}.ts\``).join(' ')
    const result = structuralExtract(files)
    const matches = result.match(/<code>/g)
    expect(matches).toBeTruthy()
    expect(matches!.length).toBeLessThanOrEqual(20)
  })

  it('limits bullets to 15 entries', () => {
    const bullets = Array.from({ length: 20 }, (_, i) => `- Item ${i}`).join('\n')
    const result = structuralExtract(bullets)
    const lines = result.split('\n').filter(l => l.startsWith('- Item'))
    expect(lines.length).toBeLessThanOrEqual(15)
  })

  it('escapes HTML in headings', () => {
    const md = '# Title with <script>alert(1)</script>'
    const result = structuralExtract(md)
    expect(result).toContain('&lt;script&gt;')
    expect(result).not.toContain('<script>')
  })
})

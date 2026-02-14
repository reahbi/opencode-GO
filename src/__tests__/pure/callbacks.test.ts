import { describe, expect, it } from 'bun:test'
import { parseCallback } from '../../adapters/telegram/ui/callbacks.js'

describe('parseCallback', () => {
  it('parses addhookbot reconfigure callback', () => {
    expect(parseCallback('ahb:reconfigure')).toEqual({ type: 'addhookbot_reconfigure' })
  })

  it('parses model selection callbacks in sm format', () => {
    expect(parseCallback('sm:anthropic/claude-sonnet-4-5')).toEqual({
      type: 'selectmodel',
      value: 'anthropic/claude-sonnet-4-5',
    })
  })

  it('parses legacy model selection callbacks in selectmodel format', () => {
    expect(parseCallback('selectmodel:anthropic/claude-haiku-4-5')).toEqual({
      type: 'selectmodel',
      value: 'anthropic/claude-haiku-4-5',
    })
  })
})

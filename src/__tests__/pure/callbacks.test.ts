import { describe, expect, it } from 'bun:test'
import { parseCallback } from '../../adapters/telegram/ui/callbacks.js'

describe('parseCallback', () => {
  it('parses addhookbot reconfigure callback', () => {
    expect(parseCallback('ahb:reconfigure')).toEqual({ type: 'addhookbot_reconfigure' })
  })
})

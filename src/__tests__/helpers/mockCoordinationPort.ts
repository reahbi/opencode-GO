import type { CoordinationPort, CoordinationEvent } from '../../domain/ports/CoordinationPort.js'
import { mock } from 'bun:test'

export function createMockCoordinationPort(
  overrides: Partial<CoordinationPort> = {},
): CoordinationPort {
  const publish: CoordinationPort['publish'] = mock(() => Promise.resolve())

  const poll: CoordinationPort['poll'] = mock(() =>
    Promise.resolve<{ events: CoordinationEvent[]; newOffset: number }>({
      events: [],
      newOffset: 0,
    }),
  )

  const currentOffset: CoordinationPort['currentOffset'] = mock(() => Promise.resolve(0))

  const defaults: CoordinationPort = {
    publish,
    poll,
    currentOffset,
  }

  return { ...defaults, ...overrides }
}

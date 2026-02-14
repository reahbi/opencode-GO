# Write Tests

Procedure for adding or modifying tests in claude-go.

## When to Use

- Adding tests for a new feature or module
- Adding missing test coverage for existing code
- Modifying test infrastructure (helpers, builders, mocks)

## When NOT to Use

- **Debugging a failing test** — read the test file and source it tests, then fix directly
- **Running tests only** — just run `bun test`, no skill needed
- **Fixing a flaky test** — investigate the root cause directly, don't rewrite the test

## Test Framework

- **Runner**: `bun:test` (built-in, zero dependencies)
- **Config**: `bunfig.toml` at project root
- **Types**: Included via `@types/bun`

## Directory Structure

```
src/__tests__/
├── smoke.test.ts              # Framework verification
├── helpers/
│   ├── index.ts               # Re-exports all helpers
│   ├── mockClaudeAgentPort.ts # ClaudeAgentPort mock factory
│   ├── mockSessionStore.ts    # SessionStorePort mock factory
│   ├── mockChatOutputPort.ts  # ChatOutputPort mock factory
│   ├── mockStateStore.ts      # StateStore mock factory
│   ├── mockCoordinationPort.ts
│   ├── mockBotRegistryPort.ts
│   ├── mockGroupSettingsPort.ts
│   ├── builders.ts            # Test data builders
│   └── async.ts               # Async test utilities
├── pure/                      # Pure function tests (no mocks)
├── integration/               # Real file I/O tests
└── usecases/                  # Usecase tests (mocked ports)
```

## Placement Rules

1. **Pure function** (no side effects) → `src/__tests__/pure/`
2. **Usecase** (business logic with mocked ports) → `src/__tests__/usecases/`
3. **Adapter with real I/O** (file system, network) → `src/__tests__/integration/`

## Conventions

- **Naming**: `{module}.test.ts`
- **Mocking**: Only mock at port boundaries. Use `createMock*Port()` factories from `helpers/`.
- **No `any`**: Full type safety in tests. Mock factories return typed port objects.
- **Builders**: Use `build*()` helpers from `helpers/builders.ts` for test data.
- **Async**: Use `createDeferredPromise()` from `helpers/async.ts` for controlling async flow.
- **New port methods**: If adding a port method, update the corresponding mock factory in `helpers/`.

## Template: Usecase Test

```typescript
import { describe, it, expect, beforeEach } from 'bun:test';
import { createMockStateStore, createMockChatOutputPort } from '../helpers/index.js';
import { buildChatState } from '../helpers/builders.js';

describe('myFeature', () => {
  let stateStore: ReturnType<typeof createMockStateStore>;
  let output: ReturnType<typeof createMockChatOutputPort>;

  beforeEach(() => {
    stateStore = createMockStateStore();
    output = createMockChatOutputPort();
  });

  it('should do the expected thing', async () => {
    const state = buildChatState({ /* overrides */ });
    stateStore.getChatState.mockResolvedValue(state);

    // Act
    // Assert
  });
});
```

## Validation

```bash
bun test              # All tests pass
bun test --coverage   # Check coverage if needed
```

import { StateStore } from '../../domain/ports/StateStore.js';
import { ChatState, PendingInteraction, createDefaultChatState, createDefaultUserSettings } from '../../domain/models.js';
import { logger } from '../../shared/logger.js';
import { LIMITS } from '../../app/policies/limits.js';
import { promises as fs } from 'node:fs';
import { resolve } from 'node:path';

export function createJsonStateStore(dataDir?: string, envDefaultAgent?: string): StateStore {
  const dir = dataDir || resolve(process.cwd(), 'data');
  const filepath = resolve(dir, 'state.json');
  const instanceConfigPath = resolve(dir, 'instance.json');
  const locks = new Map<number, Promise<void>>();

  async function ensureFile(): Promise<void> {
    try {
      await fs.access(filepath);
    } catch {
      await fs.mkdir(dir, { recursive: true });
      await atomicWrite({});
    }
  }

  async function atomicWrite(data: Record<string, ChatState>): Promise<void> {
    const random = Math.random().toString(36).substring(7);
    const tmpPath = `${filepath}.tmp.${random}`;
    await fs.writeFile(tmpPath, JSON.stringify(data, null, 2), 'utf-8');
    await fs.rename(tmpPath, filepath);
  }

  async function readState(): Promise<Record<string, ChatState>> {
    await ensureFile();
    try {
      const content = await fs.readFile(filepath, 'utf-8');
      return JSON.parse(content);
    } catch (error) {
      logger.warn('state', `Failed to parse state file: ${error}`);
      return {};
    }
  }

  function migratePendingInteraction(raw: Record<string, unknown>): PendingInteraction {
    const pi = raw as Partial<PendingInteraction>
    return {
      interactionId: pi.interactionId ?? '',
      sessionId: pi.sessionId ?? '',
      requestId: pi.requestId ?? '',
      type: pi.type ?? 'question',
      expiresAt: pi.expiresAt ?? 0,
      messageHandle: pi.messageHandle,
      questions: pi.questions,
      collectedAnswers: pi.collectedAnswers,
      currentQuestionIndex: pi.currentQuestionIndex,
      phase: pi.phase,
    }
  }

  function migrateState(raw: Partial<ChatState>): ChatState {
    const defaults = createDefaultChatState()
    const state: ChatState = {
      ...defaults,
      ...raw,
      settings: raw.settings ? { ...createDefaultUserSettings(), ...raw.settings } : defaults.settings,
      awaitingInput: raw.awaitingInput ?? null,
      awaitingInteractionId: raw.awaitingInteractionId ?? null,
    }
    if (state.settings.summaryThreshold < LIMITS.SUMMARY_MIN_TRIGGER) {
      state.settings.summaryThreshold = LIMITS.SUMMARY_MIN_TRIGGER
    }
    if (state.pendingInteractions) {
      state.pendingInteractions = state.pendingInteractions.map(
        pi => migratePendingInteraction(pi as unknown as Record<string, unknown>)
      )
    }
    return state
  }

  async function getChatState(chatId: number): Promise<ChatState> {
    const state = await readState();
    const raw = state[String(chatId)]
    return raw ? migrateState(raw) : createDefaultChatState();
  }

  async function saveChatState(chatId: number, chatState: ChatState): Promise<void> {
    const state = await readState();
    state[String(chatId)] = chatState;
    await atomicWrite(state);
    logger.debug('state', `Saved state for chat ${chatId}`);
  }

  async function withChatLock<T>(chatId: number, fn: () => Promise<T>): Promise<T> {
    const previous = locks.get(chatId) || Promise.resolve();

    const current = (async () => {
      await previous;
      return await fn();
    })();

    locks.set(chatId, current.then(() => undefined, () => undefined));

    return current;
  }

  async function getDefaultAgent(): Promise<string | null> {
    try {
      const content = await fs.readFile(instanceConfigPath, 'utf-8')
      const config = JSON.parse(content) as { defaultAgent?: string | null }
      if (config.defaultAgent) return config.defaultAgent
    } catch {}
    return envDefaultAgent || null
  }

  async function setDefaultAgent(agent: string | null): Promise<void> {
    let config: Record<string, unknown> = {}
    try {
      const content = await fs.readFile(instanceConfigPath, 'utf-8')
      config = JSON.parse(content) as Record<string, unknown>
    } catch {}
    config.defaultAgent = agent
    await fs.mkdir(dir, { recursive: true })
    const random = Math.random().toString(36).substring(7)
    const tmpPath = `${instanceConfigPath}.tmp.${random}`
    await fs.writeFile(tmpPath, JSON.stringify(config, null, 2), 'utf-8')
    await fs.rename(tmpPath, instanceConfigPath)
  }

  return {
    getChatState,
    saveChatState,
    withChatLock,
    getDefaultAgent,
    setDefaultAgent,
  };
}

import type { ModelInfo } from '../../domain/ports/OpenCodePort.js'

const EXCLUDE_MODEL = /embed|tts|audio|image|live/i
const OLD_MODEL = /1\.5-|20240|3-opus|3-sonnet-2024/i
const PREVIEW_MODEL = /\bpreview\b/i
const LIGHTWEIGHT = /\bflash\b|\blite\b|\bhaiku\b|\bmini\b|\bnano\b/i

function normalizeToken(input: string): string {
  return input.toLowerCase().replace(/[^a-z0-9]/g, '')
}

function parseModelDate(input: string): number {
  const ymd = input.match(/(20\d{2})-(\d{2})-(\d{2})/)
  if (ymd) {
    const parsed = Date.parse(`${ymd[1]}-${ymd[2]}-${ymd[3]}T00:00:00Z`)
    if (Number.isFinite(parsed)) return parsed
  }

  const compact = input.match(/(20\d{2})(\d{2})(\d{2})/)
  if (compact) {
    const parsed = Date.parse(`${compact[1]}-${compact[2]}-${compact[3]}T00:00:00Z`)
    if (Number.isFinite(parsed)) return parsed
  }

  return 0
}

function modelRecencyScore(model: ModelInfo): number {
  if (model.releaseDate) {
    const parsed = Date.parse(model.releaseDate)
    if (Number.isFinite(parsed)) return parsed
  }
  return Math.max(parseModelDate(model.modelID), parseModelDate(model.name))
}

function isOAuthModel(model: ModelInfo): boolean {
  if (model.authKind === 'oauth') return true
  return /\(oauth\)/i.test(model.name)
}

function preferredOpenAIIndex(model: ModelInfo): number {
  if (model.providerID !== 'openai') return Number.MAX_SAFE_INTEGER
  const token = normalizeToken(`${model.modelID} ${model.name}`)

  if (token.includes('gpt53') && token.includes('codex') && token.includes('spark')) return 0
  if (token.includes('gpt53') && token.includes('codex')) return 1
  if (token.includes('gpt52')) return 2

  return Number.MAX_SAFE_INTEGER
}

function authPriority(model: ModelInfo): number {
  if (isOAuthModel(model)) return 0
  if (model.authKind === 'api') return 1
  if (model.authKind === 'env') return 2
  if (model.providerConnected) return 3
  return 4
}

export function isSummaryCandidate(model: ModelInfo): boolean {
  const id = model.modelID
  const name = model.name
  if (EXCLUDE_MODEL.test(id)) return false
  if (OLD_MODEL.test(id)) return false
  if (PREVIEW_MODEL.test(id) || PREVIEW_MODEL.test(name)) return false

  if (model.providerID === 'openai') return true
  if (isOAuthModel(model)) return true
  if (LIGHTWEIGHT.test(id)) return true
  if (model.providerID === 'opencode') return true
  if (model.providerID === 'antigravity') return true

  return false
}

export function sortSummaryModels(models: ModelInfo[]): ModelInfo[] {
  return [...models].sort((a, b) => {
    const preferredDiff = preferredOpenAIIndex(a) - preferredOpenAIIndex(b)
    if (preferredDiff !== 0) return preferredDiff

    const authDiff = authPriority(a) - authPriority(b)
    if (authDiff !== 0) return authDiff

    const aOpenAI = a.providerID === 'openai'
    const bOpenAI = b.providerID === 'openai'
    if (aOpenAI !== bOpenAI) return aOpenAI ? -1 : 1

    const recencyDiff = modelRecencyScore(b) - modelRecencyScore(a)
    if (recencyDiff !== 0) return recencyDiff

    const aIsAntigravity = a.providerID === 'antigravity'
    const bIsAntigravity = b.providerID === 'antigravity'
    if (aIsAntigravity !== bIsAntigravity) return aIsAntigravity ? -1 : 1

    if (a.providerID !== b.providerID) return a.providerID.localeCompare(b.providerID)
    return a.name.localeCompare(b.name)
  })
}

export interface ProviderGroup {
  providerID: string
  models: ModelInfo[]
}

export function groupModelsByProvider(models: ModelInfo[]): ProviderGroup[] {
  const map = new Map<string, ModelInfo[]>()
  for (const m of models) {
    let list = map.get(m.providerID)
    if (!list) {
      list = []
      map.set(m.providerID, list)
    }
    list.push(m)
  }
  return [...map.entries()]
    .map(([providerID, models]) => ({ providerID, models }))
    .sort((a, b) => b.models.length - a.models.length)
}

export function sortModelsNewestFirst(models: ModelInfo[]): ModelInfo[] {
  return [...models].sort((a, b) => {
    const authDiff = authPriority(a) - authPriority(b)
    if (authDiff !== 0) return authDiff
    const recencyDiff = modelRecencyScore(b) - modelRecencyScore(a)
    if (recencyDiff !== 0) return recencyDiff
    return a.name.localeCompare(b.name)
  })
}

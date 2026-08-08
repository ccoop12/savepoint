export const DEFAULT_AUTO_CHECKPOINT_INTERVAL_MINUTES = 10
export const DEFAULT_AUTO_CHECKPOINT_DEBOUNCE_MS = 5_000

export type AutoCheckpointDecisionReason =
  'disabled' | 'unchanged' | 'debouncing' | 'rate-limited' | 'ready'

export interface AutoCheckpointDecision {
  shouldCreate: boolean
  reason: AutoCheckpointDecisionReason
  nextCheckAt: number | null
}

export interface AutoCheckpointDecisionInput {
  enabled: boolean
  currentFingerprint: string
  lastCheckpointFingerprint?: string | null
  candidateFirstObservedAt?: number | null
  lastAutomaticCheckpointAt?: number | string | Date | null
  now?: number | string | Date
  intervalMinutes?: number
  debounceMs?: number
}

function timestamp(value: number | string | Date | undefined | null): number | null {
  if (value === undefined || value === null) return null
  const result = typeof value === 'number' ? value : new Date(value).getTime()
  return Number.isFinite(result) ? result : null
}

/** Pure policy function: no timers, filesystem access, or persistence side effects. */
export function decideAutoCheckpoint(input: AutoCheckpointDecisionInput): AutoCheckpointDecision {
  const now = timestamp(input.now) ?? Date.now()
  if (!input.enabled) return { shouldCreate: false, reason: 'disabled', nextCheckAt: null }
  if (!input.currentFingerprint || input.currentFingerprint === input.lastCheckpointFingerprint) {
    return { shouldCreate: false, reason: 'unchanged', nextCheckAt: null }
  }

  const debounceMs = Math.max(0, input.debounceMs ?? DEFAULT_AUTO_CHECKPOINT_DEBOUNCE_MS)
  const observedAt = timestamp(input.candidateFirstObservedAt)
  const debounceEndsAt = (observedAt ?? now) + debounceMs
  if (observedAt === null || now < debounceEndsAt) {
    return { shouldCreate: false, reason: 'debouncing', nextCheckAt: debounceEndsAt }
  }

  const intervalMinutes = Math.max(
    1,
    input.intervalMinutes ?? DEFAULT_AUTO_CHECKPOINT_INTERVAL_MINUTES
  )
  const lastAutomatic = timestamp(input.lastAutomaticCheckpointAt)
  const rateLimitEndsAt = lastAutomatic === null ? null : lastAutomatic + intervalMinutes * 60_000
  if (rateLimitEndsAt !== null && now < rateLimitEndsAt) {
    return { shouldCreate: false, reason: 'rate-limited', nextCheckAt: rateLimitEndsAt }
  }
  return { shouldCreate: true, reason: 'ready', nextCheckAt: null }
}

interface ObservedCandidate {
  fingerprint: string
  firstObservedAt: number
}

/** Keeps only debounce observation state; callers remain responsible for timers and writes. */
export class AutoCheckpointScheduler {
  readonly #candidates = new Map<string, ObservedCandidate>()

  evaluate(
    repositoryId: string,
    input: Omit<AutoCheckpointDecisionInput, 'candidateFirstObservedAt'>
  ): AutoCheckpointDecision {
    const now = timestamp(input.now) ?? Date.now()
    const previous = this.#candidates.get(repositoryId)
    const candidate =
      previous?.fingerprint === input.currentFingerprint
        ? previous
        : { fingerprint: input.currentFingerprint, firstObservedAt: now }
    this.#candidates.set(repositoryId, candidate)
    const decision = decideAutoCheckpoint({
      ...input,
      now,
      candidateFirstObservedAt: candidate.firstObservedAt
    })
    if (
      decision.reason === 'disabled' ||
      decision.reason === 'unchanged' ||
      decision.shouldCreate
    ) {
      this.#candidates.delete(repositoryId)
    }
    return decision
  }

  reset(repositoryId?: string): void {
    if (repositoryId === undefined) this.#candidates.clear()
    else this.#candidates.delete(repositoryId)
  }
}

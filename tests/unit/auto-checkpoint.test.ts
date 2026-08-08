import { describe, expect, it } from 'vitest'
import {
  AutoCheckpointScheduler,
  DEFAULT_AUTO_CHECKPOINT_INTERVAL_MINUTES,
  decideAutoCheckpoint
} from '../../src/shared'

const NOW = Date.parse('2026-01-02T12:00:00.000Z')

describe('automatic checkpoint policy', () => {
  it('is opt-in and skips unchanged state', () => {
    expect(
      decideAutoCheckpoint({ enabled: false, currentFingerprint: 'new', now: NOW }).reason
    ).toBe('disabled')
    expect(
      decideAutoCheckpoint({
        enabled: true,
        currentFingerprint: 'same',
        lastCheckpointFingerprint: 'same',
        now: NOW
      }).reason
    ).toBe('unchanged')
  })

  it('debounces a newly observed state', () => {
    expect(
      decideAutoCheckpoint({
        enabled: true,
        currentFingerprint: 'new',
        candidateFirstObservedAt: NOW - 4_999,
        now: NOW,
        debounceMs: 5_000
      })
    ).toEqual({ shouldCreate: false, reason: 'debouncing', nextCheckAt: NOW + 1 })
  })

  it('rate limits automatic checkpoints to ten minutes by default', () => {
    const lastAutomaticCheckpointAt = NOW - 9 * 60_000
    const decision = decideAutoCheckpoint({
      enabled: true,
      currentFingerprint: 'new',
      candidateFirstObservedAt: NOW - 10_000,
      lastAutomaticCheckpointAt,
      now: NOW
    })
    expect(DEFAULT_AUTO_CHECKPOINT_INTERVAL_MINUTES).toBe(10)
    expect(decision).toEqual({
      shouldCreate: false,
      reason: 'rate-limited',
      nextCheckAt: lastAutomaticCheckpointAt + 10 * 60_000
    })
  })

  it('becomes ready after both the debounce and configured interval', () => {
    expect(
      decideAutoCheckpoint({
        enabled: true,
        currentFingerprint: 'new',
        candidateFirstObservedAt: NOW - 30_000,
        lastAutomaticCheckpointAt: NOW - 15 * 60_000,
        intervalMinutes: 10,
        now: NOW
      })
    ).toEqual({ shouldCreate: true, reason: 'ready', nextCheckAt: null })
  })

  it('restarts debounce when the observed working-tree state changes', () => {
    const scheduler = new AutoCheckpointScheduler()
    expect(
      scheduler.evaluate('repo', { enabled: true, currentFingerprint: 'one', now: NOW }).reason
    ).toBe('debouncing')
    expect(
      scheduler.evaluate('repo', { enabled: true, currentFingerprint: 'one', now: NOW + 5_000 })
        .reason
    ).toBe('ready')
    expect(
      scheduler.evaluate('repo', { enabled: true, currentFingerprint: 'two', now: NOW + 6_000 })
        .reason
    ).toBe('debouncing')
  })
})

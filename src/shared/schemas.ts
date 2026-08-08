import { z } from 'zod'

/** Runtime-validated values shared by Electron's untrusted IPC boundary. */
export const checkpointOriginSchema = z.enum(['manual', 'automatic'])
export const gitFileStatusSchema = z.enum([
  'added',
  'modified',
  'deleted',
  'renamed',
  'copied',
  'untracked',
  'ignored',
  'conflicted',
  'unknown'
])

const nonEmptyText = z.string().trim().min(1)
const identifier = z.string().trim().min(1).max(200)
const gitPathText = z.string().min(1).max(32_767)
const isoDateTime = z.iso.datetime({ offset: true })
export const safeExternalUrlSchema = z
  .url()
  .max(2_048)
  .refine(
    (value) => {
      const parsed = new URL(value)
      return parsed.protocol === 'https:' && !parsed.username && !parsed.password
    },
    {
      message: 'Only credential-free HTTPS URLs are supported'
    }
  )

export const checkpointContextSchema = z
  .object({
    title: z.string().trim().max(200).default(''),
    goal: z.string().trim().max(10_000).default(''),
    completed: z.string().trim().max(20_000).default(''),
    nextAction: z.string().trim().max(10_000).default(''),
    blockers: z.string().trim().max(10_000).default(''),
    notes: z.string().trim().max(50_000).default(''),
    tags: z.array(z.string().trim().min(1).max(80)).max(50).default([]),
    links: z.array(safeExternalUrlSchema).max(100).default([]),
    commands: z.array(z.string().trim().min(1).max(4_000)).max(100).default([])
  })
  .strict()

export const gitFileSchema = z
  .object({
    path: gitPathText,
    status: gitFileStatusSchema,
    staged: z.boolean(),
    previousPath: gitPathText.nullable().default(null),
    additions: z.number().int().nonnegative().nullable().default(null),
    deletions: z.number().int().nonnegative().nullable().default(null)
  })
  .strict()

export const gitStatusCountsSchema = z
  .object({
    staged: z.number().int().nonnegative(),
    modified: z.number().int().nonnegative(),
    added: z.number().int().nonnegative(),
    deleted: z.number().int().nonnegative(),
    renamed: z.number().int().nonnegative(),
    copied: z.number().int().nonnegative(),
    untracked: z.number().int().nonnegative(),
    conflicted: z.number().int().nonnegative()
  })
  .strict()

export const gitDiffStatsSchema = z
  .object({
    filesChanged: z.number().int().nonnegative(),
    insertions: z.number().int().nonnegative(),
    deletions: z.number().int().nonnegative()
  })
  .strict()

export const recentCommitSchema = z
  .object({
    hash: z.string().regex(/^[0-9a-f]{7,64}$/i),
    shortHash: z.string().regex(/^[0-9a-f]{4,16}$/i),
    subject: z.string().trim().max(500),
    authorName: z.string().trim().max(200),
    authoredAt: isoDateTime
  })
  .strict()

export const gitSnapshotSchema = z
  .object({
    branch: z.string().trim().min(1).max(500),
    commitHash: z.string().regex(/^[0-9a-f]{7,64}$/i),
    shortCommitHash: z.string().regex(/^[0-9a-f]{4,16}$/i),
    isClean: z.boolean(),
    files: z.array(gitFileSchema).max(20_000),
    counts: gitStatusCountsSchema,
    diffStats: gitDiffStatsSchema,
    recentCommits: z.array(recentCommitSchema).max(50).default([])
  })
  .strict()

export const checkpointSchema = z
  .object({
    id: identifier,
    repositoryId: identifier,
    createdAt: isoDateTime,
    origin: checkpointOriginSchema,
    context: checkpointContextSchema,
    git: gitSnapshotSchema,
    fingerprint: z.string().regex(/^[0-9a-f]{64}$/i)
  })
  .strict()

export const createCheckpointInputSchema = z
  .object({
    repositoryId: identifier,
    origin: checkpointOriginSchema.default('manual'),
    context: checkpointContextSchema,
    git: gitSnapshotSchema
  })
  .strict()

/** Renderer-safe request. Git state and origin are supplied by the trusted main process. */
export const createCheckpointRequestSchema = z
  .object({
    repositoryId: identifier,
    context: checkpointContextSchema
  })
  .strict()

export const updateCheckpointInputSchema = z
  .object({
    id: identifier,
    context: checkpointContextSchema.partial()
  })
  .strict()

export const repositorySchema = z
  .object({
    id: identifier,
    name: z.string().trim().min(1).max(255),
    path: z.string().min(1).max(32_767),
    createdAt: isoDateTime,
    updatedAt: isoDateTime,
    autoCheckpointEnabled: z.boolean().default(false),
    autoCheckpointIntervalMinutes: z.number().int().min(1).max(1_440).default(10),
    exclusionPatterns: z.array(z.string().trim().min(1).max(1_000)).max(200).default([])
  })
  .strict()

export const registerRepositoryInputSchema = z
  .object({ path: z.string().trim().min(1).max(32_767) })
  .strict()

export const updateRepositoryInputSchema = z
  .object({
    id: identifier,
    autoCheckpointEnabled: z.boolean().optional(),
    autoCheckpointIntervalMinutes: z.number().int().min(1).max(1_440).optional(),
    exclusionPatterns: z.array(z.string().trim().min(1).max(1_000)).max(200).optional()
  })
  .strict()
  .refine(
    ({ autoCheckpointEnabled, autoCheckpointIntervalMinutes, exclusionPatterns }) =>
      autoCheckpointEnabled !== undefined ||
      autoCheckpointIntervalMinutes !== undefined ||
      exclusionPatterns !== undefined,
    { message: 'At least one repository setting must be provided' }
  )

export const listCheckpointsInputSchema = z
  .object({
    repositoryId: identifier.optional(),
    branch: z.string().trim().min(1).max(500).optional(),
    tag: z.string().trim().min(1).max(80).optional(),
    origin: checkpointOriginSchema.optional(),
    search: z.string().trim().max(500).optional(),
    limit: z.number().int().min(1).max(500).default(100),
    offset: z.number().int().nonnegative().default(0)
  })
  .strict()

export const repositoryIdInputSchema = z.object({ repositoryId: identifier }).strict()
export const checkpointIdInputSchema = z.object({ checkpointId: identifier }).strict()
export const compareCheckpointsInputSchema = z
  .object({ baseCheckpointId: identifier, targetCheckpointId: identifier })
  .strict()
export const exportCheckpointInputSchema = z
  .object({ checkpointId: identifier, format: z.enum(['markdown', 'json']) })
  .strict()
export const openExternalInputSchema = z.object({ url: safeExternalUrlSchema }).strict()
export const systemPathInputSchema = z
  .object({
    path: z
      .string()
      .trim()
      .min(1)
      .max(32_767)
      .refine((path) => !path.includes('\0'))
  })
  .strict()
export const copyTextInputSchema = z.object({ text: z.string().max(1_000_000) }).strict()

export const appSettingsSchema = z
  .object({
    theme: z.enum(['dark', 'light', 'system']).default('dark'),
    defaultAutoCheckpointIntervalMinutes: z.number().int().min(1).max(1_440).default(10),
    onboardingComplete: z.boolean().default(false)
  })
  .strict()

export const updateSettingsInputSchema = appSettingsSchema.partial().strict()

export type CheckpointOrigin = z.infer<typeof checkpointOriginSchema>
export type GitFileStatus = z.infer<typeof gitFileStatusSchema>
export type GitFile = z.infer<typeof gitFileSchema>
export type GitStatusCounts = z.infer<typeof gitStatusCountsSchema>
export type GitDiffStats = z.infer<typeof gitDiffStatsSchema>
export type RecentCommit = z.infer<typeof recentCommitSchema>
export type GitSnapshot = z.infer<typeof gitSnapshotSchema>
export type CheckpointContext = z.infer<typeof checkpointContextSchema>
export type Checkpoint = z.infer<typeof checkpointSchema>
export type CreateCheckpointInput = z.infer<typeof createCheckpointInputSchema>
export type CreateCheckpointRequest = z.infer<typeof createCheckpointRequestSchema>
export type UpdateCheckpointInput = z.infer<typeof updateCheckpointInputSchema>
export type Repository = z.infer<typeof repositorySchema>
export type RegisterRepositoryInput = z.infer<typeof registerRepositoryInputSchema>
export type UpdateRepositoryInput = z.infer<typeof updateRepositoryInputSchema>
export type ListCheckpointsInput = z.infer<typeof listCheckpointsInputSchema>
export type AppSettings = z.infer<typeof appSettingsSchema>

export const IPC_CHANNELS = {
  repositoriesList: 'repositories:list',
  repositoriesSelectAndRegister: 'repositories:select-and-register',
  repositoriesUpdate: 'repositories:update',
  repositoriesRefresh: 'repositories:refresh',
  checkpointsList: 'checkpoints:list',
  checkpointsCreate: 'checkpoints:create',
  checkpointsUpdate: 'checkpoints:update',
  checkpointsDelete: 'checkpoints:delete',
  checkpointsCompare: 'checkpoints:compare',
  checkpointsExport: 'checkpoints:export',
  checkpointsResume: 'checkpoints:resume',
  checkpointsChanged: 'checkpoints:changed',
  settingsGet: 'settings:get',
  settingsUpdate: 'settings:update',
  systemOpenPath: 'system:open-path',
  systemOpenInVSCode: 'system:open-in-vscode',
  systemOpenExternal: 'system:open-external',
  systemCopyText: 'system:copy-text'
} as const

export type IpcChannel = (typeof IPC_CHANNELS)[keyof typeof IPC_CHANNELS]

/** A serializable, renderer-safe error returned across IPC. */
export const ipcErrorSchema = z
  .object({
    code: nonEmptyText,
    message: nonEmptyText,
    details: z.record(z.string(), z.unknown()).optional()
  })
  .strict()

export const ipcResultSchema = <T extends z.ZodType>(valueSchema: T) =>
  z.discriminatedUnion('ok', [
    z.object({ ok: z.literal(true), value: valueSchema }).strict(),
    z.object({ ok: z.literal(false), error: ipcErrorSchema }).strict()
  ])

export type IpcError = z.infer<typeof ipcErrorSchema>
export type IpcResult<T> = { ok: true; value: T } | { ok: false; error: IpcError }

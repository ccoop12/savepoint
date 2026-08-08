import type { ChangedFile, Checkpoint, CheckpointDraft } from './types'

export const relativeTime = (iso: string): string => {
  const delta = new Date(iso).getTime() - Date.now()
  const minutes = Math.round(delta / 60_000)
  const formatter = new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' })
  if (Math.abs(minutes) < 60) return formatter.format(minutes, 'minute')
  const hours = Math.round(minutes / 60)
  if (Math.abs(hours) < 24) return formatter.format(hours, 'hour')
  const days = Math.round(hours / 24)
  if (Math.abs(days) < 7) return formatter.format(days, 'day')
  return new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' }).format(
    new Date(iso)
  )
}

export const fullDate = (iso: string): string =>
  new Intl.DateTimeFormat(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit'
  }).format(new Date(iso))

export const titleCase = (value: string): string =>
  value.length ? value.charAt(0).toUpperCase() + value.slice(1) : value

export const fileStatusLabel = (file: ChangedFile): string =>
  file.status === 'untracked' ? 'Untracked' : titleCase(file.status)

export const checkpointToDraft = (checkpoint: Checkpoint): CheckpointDraft => ({
  title: checkpoint.title,
  goal: checkpoint.goal,
  completed: checkpoint.completed,
  nextAction: checkpoint.nextAction,
  blockers: checkpoint.blockers,
  notes: checkpoint.notes,
  tags: [...checkpoint.tags],
  urls: [...checkpoint.urls],
  commands: [...checkpoint.commands]
})

export const resumeMarkdown = (
  checkpoint: Checkpoint
): string => `## Resume context: ${checkpoint.title}

Goal: ${checkpoint.goal}
Completed: ${checkpoint.completed || 'Nothing recorded'}
Next: ${checkpoint.nextAction}
Blockers: ${checkpoint.blockers || 'None'}
Git: ${checkpoint.branch} @ ${checkpoint.shortCommitHash}
Changed files: ${checkpoint.files.map((file) => file.path).join(', ') || 'None'}
`

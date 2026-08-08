import {
  AlertCircle,
  ArrowLeftRight,
  ArrowRight,
  BookOpen,
  Box,
  GitBranch as Branch,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  CircleDot,
  Clock3,
  Code2,
  Copy,
  Database,
  Download,
  ExternalLink,
  EyeOff,
  FileCode2,
  FileDiff,
  FileJson,
  FileText,
  Filter,
  Flag,
  FolderGit2,
  FolderOpen,
  GitCommitHorizontal,
  History,
  Info,
  Keyboard,
  Layers3,
  Link2,
  ListFilter,
  LoaderCircle,
  LockKeyhole,
  Menu,
  Moon,
  Pencil,
  Plus,
  RefreshCw,
  RotateCcw,
  Search,
  Settings2,
  ShieldCheck,
  Sparkles,
  Sun,
  Tag,
  TerminalSquare,
  Trash2,
  X
} from 'lucide-react'
import {
  type FormEvent,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
  useCallback,
  useEffect,
  useRef,
  useState
} from 'react'

import { getRendererApi, isDemoMode } from './api'
import { checkpointToDraft, fileStatusLabel, fullDate, relativeTime } from './format'
import type {
  AppSnapshot,
  AppView,
  ChangedFile,
  Checkpoint,
  CheckpointDraft,
  CheckpointOrigin,
  Repository,
  ResumeSummary,
  SavePointRendererApi,
  Settings,
  ThemePreference
} from './types'

const EMPTY_DRAFT: CheckpointDraft = {
  title: '',
  goal: '',
  completed: '',
  nextAction: '',
  blockers: '',
  notes: '',
  tags: [],
  urls: [],
  commands: []
}

const NAV_ITEMS: Array<{
  id: AppView
  label: string
  icon: typeof Layers3
  shortcut?: string
}> = [
  { id: 'dashboard', label: 'Overview', icon: Layers3 },
  { id: 'timeline', label: 'Timeline', icon: History, shortcut: 'G T' },
  { id: 'compare', label: 'Compare', icon: ArrowLeftRight },
  { id: 'privacy', label: 'Privacy', icon: ShieldCheck },
  { id: 'settings', label: 'Settings', icon: Settings2 }
]

export default function App(): React.JSX.Element {
  const appApi = getRendererApi()
  const [snapshot, setSnapshot] = useState<AppSnapshot | null>(null)
  const [selectedRepositoryId, setSelectedRepositoryId] = useState('')
  const [view, setView] = useState<AppView>('dashboard')
  const [detailId, setDetailId] = useState<string | null>(null)
  const [resumeId, setResumeId] = useState<string | null>(null)
  const [composerOpen, setComposerOpen] = useState(false)
  const [searchOpen, setSearchOpen] = useState(false)
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [toast, setToast] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const searchInputRef = useRef<HTMLInputElement>(null)
  const shortcutPrefixRef = useRef<number | null>(null)

  const load = useCallback(async () => {
    try {
      const next = await appApi.load()
      setSnapshot(next)
      setSelectedRepositoryId((current) =>
        next.repositories.some((repository) => repository.id === current)
          ? current
          : (next.repositories[0]?.id ?? '')
      )
    } catch (loadError) {
      setError(normalizeError(loadError))
    }
  }, [appApi])

  useEffect(() => {
    void load()
  }, [load])

  useEffect(
    () =>
      appApi.onCheckpointsChanged((checkpoints) => {
        setSnapshot((current) => {
          if (!current) return current
          const repositories = current.repositories.map((repository) => {
            const latest = checkpoints.find(
              (checkpoint) => checkpoint.repositoryId === repository.id
            )
            return {
              ...repository,
              latestCheckpointAt: latest?.createdAt,
              latestGoal: latest?.goal,
              latestNextAction: latest?.nextAction
            }
          })
          return { ...current, repositories, checkpoints }
        })
      }),
    [appApi]
  )

  useEffect(() => {
    if (!toast) return
    const timeout = window.setTimeout(() => setToast(null), 3200)
    return () => window.clearTimeout(timeout)
  }, [toast])

  useEffect(() => {
    const theme = snapshot?.settings.theme ?? 'dark'
    const resolved =
      theme === 'system'
        ? window.matchMedia('(prefers-color-scheme: light)').matches
          ? 'light'
          : 'dark'
        : theme
    document.documentElement.dataset.theme = resolved
  }, [snapshot?.settings.theme])

  useEffect(() => {
    const handleKeyboard = (event: KeyboardEvent): void => {
      const modifier = event.ctrlKey || event.metaKey
      if (modifier && event.key.toLowerCase() === 'n') {
        event.preventDefault()
        if (snapshot?.repositories.length) setComposerOpen(true)
      }
      if (modifier && event.key.toLowerCase() === 'k') {
        event.preventDefault()
        setView('timeline')
        setSearchOpen(true)
        window.setTimeout(() => searchInputRef.current?.focus(), 0)
      }
      if (event.key === '/' && !isFormControl(event.target)) {
        event.preventDefault()
        setView('timeline')
        setSearchOpen(true)
        window.setTimeout(() => searchInputRef.current?.focus(), 0)
      }
      if (event.key === 'Escape') {
        setComposerOpen(false)
        setDetailId(null)
        setSearchOpen(false)
        setSidebarOpen(false)
      }
      if (!modifier && event.key.toLowerCase() === 'g' && !isFormControl(event.target)) {
        shortcutPrefixRef.current = Date.now()
      }
      if (
        !modifier &&
        event.key.toLowerCase() === 't' &&
        !isFormControl(event.target) &&
        shortcutPrefixRef.current !== null &&
        Date.now() - shortcutPrefixRef.current < 1_200
      ) {
        shortcutPrefixRef.current = null
        setView('timeline')
      }
    }
    window.addEventListener('keydown', handleKeyboard)
    return () => window.removeEventListener('keydown', handleKeyboard)
  }, [snapshot?.repositories.length])

  if (!snapshot) {
    return (
      <div className="launch-screen" role="status">
        <img src="/savepoint-mark.svg" width="46" height="46" alt="" />
        <LoaderCircle className="spin" size={20} />
        <span>Opening your workspaces…</span>
      </div>
    )
  }

  const repository =
    snapshot.repositories.find((item) => item.id === selectedRepositoryId) ??
    snapshot.repositories[0]
  const checkpoint = snapshot.checkpoints.find((item) => item.id === detailId) ?? null
  const resumeCheckpoint =
    snapshot.checkpoints.find((item) => item.id === resumeId) ??
    snapshot.checkpoints.find((item) => item.repositoryId === repository?.id) ??
    snapshot.checkpoints[0]
  const resumeRepository = snapshot.repositories.find(
    (item) => item.id === resumeCheckpoint?.repositoryId
  )

  const mutateSnapshot = (mutator: (current: AppSnapshot) => AppSnapshot): void => {
    setSnapshot((current) => (current ? mutator(current) : current))
  }

  const selectRepository = async (): Promise<void> => {
    setBusy(true)
    setError(null)
    try {
      const result = await appApi.selectRepository()
      if (result.error) {
        setError(result.error)
        return
      }
      if (result.repository) {
        mutateSnapshot((current) => ({
          ...current,
          repositories: current.repositories.some((item) => item.id === result.repository?.id)
            ? current.repositories
            : [...current.repositories, result.repository as Repository]
        }))
        setSelectedRepositoryId(result.repository.id)
        setToast(`${result.repository.name} added to SavePoint`)
        setView('dashboard')
      }
    } catch (selectionError) {
      setError(normalizeError(selectionError))
    } finally {
      setBusy(false)
    }
  }

  const createCheckpoint = async (draft: CheckpointDraft): Promise<void> => {
    if (!repository) return
    setBusy(true)
    try {
      const created = await appApi.createCheckpoint(repository.id, draft)
      mutateSnapshot((current) => ({
        ...current,
        checkpoints: [created, ...current.checkpoints],
        repositories: current.repositories.map((item) =>
          item.id === repository.id
            ? {
                ...item,
                latestCheckpointAt: created.createdAt,
                latestGoal: created.goal,
                latestNextAction: created.nextAction
              }
            : item
        )
      }))
      setComposerOpen(false)
      setDetailId(created.id)
      setToast('Checkpoint saved — your context is safe')
    } catch (createError) {
      setError(normalizeError(createError))
    } finally {
      setBusy(false)
    }
  }

  const updateCheckpoint = async (id: string, draft: CheckpointDraft): Promise<void> => {
    setBusy(true)
    try {
      const updated = await appApi.updateCheckpoint(id, draft)
      mutateSnapshot((current) => ({
        ...current,
        checkpoints: current.checkpoints.map((item) => (item.id === id ? updated : item))
      }))
      setToast('Checkpoint updated')
    } catch (updateError) {
      setError(normalizeError(updateError))
    } finally {
      setBusy(false)
    }
  }

  const deleteCheckpoint = async (id: string): Promise<void> => {
    setBusy(true)
    try {
      await appApi.deleteCheckpoint(id)
      mutateSnapshot((current) => ({
        ...current,
        checkpoints: current.checkpoints.filter((item) => item.id !== id)
      }))
      setDetailId(null)
      setToast('Checkpoint deleted')
    } catch (deleteError) {
      setError(normalizeError(deleteError))
    } finally {
      setBusy(false)
    }
  }

  const showResume = (id: string): void => {
    setResumeId(id)
    setDetailId(null)
    setView('resume')
  }

  if (!snapshot.repositories.length) {
    return (
      <Onboarding
        onSelect={() => void selectRepository()}
        busy={busy}
        error={error}
        demoMode={isDemoMode}
      />
    )
  }

  return (
    <div className="app-shell">
      <a className="skip-link" href="#main-content">
        Skip to content
      </a>
      <Sidebar
        open={sidebarOpen}
        view={view}
        repositories={snapshot.repositories}
        selectedRepositoryId={repository?.id ?? ''}
        onView={(next) => {
          setView(next)
          setSidebarOpen(false)
        }}
        onRepository={(id) => {
          setSelectedRepositoryId(id)
          setView('dashboard')
          setSidebarOpen(false)
        }}
        onAddRepository={() => void selectRepository()}
        busy={busy}
      />

      <main id="main-content" className="app-main">
        <AppHeader
          repository={repository}
          view={view}
          onMenu={() => setSidebarOpen((current) => !current)}
          onSearch={() => {
            setView('timeline')
            setSearchOpen(true)
            window.setTimeout(() => searchInputRef.current?.focus(), 0)
          }}
          onCreate={() => setComposerOpen(true)}
        />

        {error && (
          <div className="error-banner" role="alert">
            <AlertCircle size={17} />
            <span>{error}</span>
            <button
              className="icon-button"
              onClick={() => setError(null)}
              aria-label="Dismiss error"
            >
              <X size={16} />
            </button>
          </div>
        )}

        <div className="view-frame">
          {view === 'dashboard' && repository && (
            <Dashboard
              repository={repository}
              checkpoints={snapshot.checkpoints.filter(
                (item) => item.repositoryId === repository.id
              )}
              onRefresh={async () => {
                setBusy(true)
                try {
                  const refreshed = await appApi.refreshRepository(repository.id)
                  mutateSnapshot((current) => ({
                    ...current,
                    repositories: current.repositories.map((item) =>
                      item.id === refreshed.id ? refreshed : item
                    )
                  }))
                  setToast('Repository status refreshed')
                } catch (refreshError) {
                  setError(normalizeError(refreshError))
                } finally {
                  setBusy(false)
                }
              }}
              onCreate={() => setComposerOpen(true)}
              onDetail={setDetailId}
              onTimeline={() => setView('timeline')}
              onResume={showResume}
              busy={busy}
            />
          )}

          {view === 'timeline' && (
            <TimelineView
              checkpoints={snapshot.checkpoints}
              repositories={snapshot.repositories}
              initialRepositoryId={repository?.id ?? ''}
              onDetail={setDetailId}
              onCreate={() => setComposerOpen(true)}
              searchOpen={searchOpen}
              setSearchOpen={setSearchOpen}
              searchInputRef={searchInputRef}
            />
          )}

          {view === 'compare' && (
            <CompareView checkpoints={snapshot.checkpoints} repositories={snapshot.repositories} />
          )}

          {view === 'resume' && (
            <ResumeView
              checkpoint={resumeCheckpoint}
              repository={resumeRepository}
              api={appApi}
              onToast={setToast}
            />
          )}

          {view === 'privacy' && <PrivacyView />}

          {view === 'settings' && repository && (
            <SettingsView
              key={repository.id}
              settings={{
                ...snapshot.settings,
                autoCheckpointMinutes: repository.autoCheckpointIntervalMinutes,
                exclusionPatterns: repository.exclusionPatterns
              }}
              repository={repository}
              onSettings={async (settings) => {
                const updated = await appApi.updateSettings(settings, repository.id)
                mutateSnapshot((current) => ({
                  ...current,
                  settings: updated,
                  repositories: current.repositories.map((item) =>
                    item.id === repository.id
                      ? {
                          ...item,
                          autoCheckpointIntervalMinutes: settings.autoCheckpointMinutes,
                          exclusionPatterns: settings.exclusionPatterns
                        }
                      : item
                  )
                }))
                setToast('Settings saved')
              }}
              onAutoCheckpoint={async (enabled) => {
                const updated = await appApi.setAutoCheckpoint(repository.id, enabled)
                mutateSnapshot((current) => ({
                  ...current,
                  repositories: current.repositories.map((item) =>
                    item.id === updated.id ? updated : item
                  )
                }))
                setToast(enabled ? 'Automatic checkpoints enabled' : 'Automatic checkpoints paused')
              }}
            />
          )}
        </div>
      </main>

      {composerOpen && repository && (
        <CheckpointComposer
          repository={repository}
          busy={busy}
          onClose={() => setComposerOpen(false)}
          onSubmit={(draft) => void createCheckpoint(draft)}
        />
      )}

      {checkpoint && (
        <CheckpointDetail
          checkpoint={checkpoint}
          repository={
            snapshot.repositories.find((item) => item.id === checkpoint.repositoryId) ?? repository
          }
          busy={busy}
          api={appApi}
          onClose={() => setDetailId(null)}
          onUpdate={(draft) => void updateCheckpoint(checkpoint.id, draft)}
          onDelete={() => void deleteCheckpoint(checkpoint.id)}
          onResume={() => showResume(checkpoint.id)}
          onToast={setToast}
        />
      )}

      {toast && (
        <div className="toast" role="status">
          <CheckCircle2 size={18} />
          {toast}
        </div>
      )}
    </div>
  )
}

function Sidebar({
  open,
  view,
  repositories,
  selectedRepositoryId,
  onView,
  onRepository,
  onAddRepository,
  busy
}: {
  open: boolean
  view: AppView
  repositories: Repository[]
  selectedRepositoryId: string
  onView: (view: AppView) => void
  onRepository: (id: string) => void
  onAddRepository: () => void
  busy: boolean
}): React.JSX.Element {
  return (
    <aside className={`sidebar ${open ? 'is-open' : ''}`} aria-label="Primary navigation">
      <div className="brand-lockup">
        <img src="/savepoint-mark.svg" width="30" height="30" alt="" />
        <span>SavePoint</span>
        <span className="version-chip">0.1</span>
      </div>

      <nav className="nav-stack">
        <p className="nav-label">Workspace</p>
        {NAV_ITEMS.slice(0, 3).map((item) => {
          const Icon = item.icon
          return (
            <button
              key={item.id}
              className={`nav-item ${view === item.id ? 'active' : ''}`}
              onClick={() => onView(item.id)}
              aria-current={view === item.id ? 'page' : undefined}
            >
              <Icon size={17} />
              <span>{item.label}</span>
              {item.shortcut && <kbd>{item.shortcut}</kbd>}
            </button>
          )
        })}
      </nav>

      <div className="repository-nav">
        <div className="nav-section-heading">
          <p className="nav-label">Repositories</p>
          <button
            className="icon-button quiet"
            onClick={onAddRepository}
            disabled={busy}
            aria-label="Add repository"
          >
            <Plus size={15} />
          </button>
        </div>
        <div className="repository-list">
          {repositories.map((repository) => (
            <button
              key={repository.id}
              className={`repository-nav-item ${selectedRepositoryId === repository.id ? 'active' : ''}`}
              onClick={() => onRepository(repository.id)}
            >
              <span className={`repo-indicator ${repository.isClean ? 'clean' : 'changed'}`} />
              <span className="truncate">{repository.name}</span>
              {!repository.isClean && (
                <span className="change-count">{sumChanges(repository)}</span>
              )}
            </button>
          ))}
        </div>
      </div>

      <nav className="nav-stack sidebar-footer">
        {NAV_ITEMS.slice(3).map((item) => {
          const Icon = item.icon
          return (
            <button
              key={item.id}
              className={`nav-item ${view === item.id ? 'active' : ''}`}
              onClick={() => onView(item.id)}
              aria-current={view === item.id ? 'page' : undefined}
            >
              <Icon size={17} />
              <span>{item.label}</span>
            </button>
          )
        })}
        <div className="local-badge">
          <LockKeyhole size={13} />
          Local only
          <span className="status-dot" />
        </div>
      </nav>
    </aside>
  )
}

function AppHeader({
  repository,
  view,
  onMenu,
  onSearch,
  onCreate
}: {
  repository?: Repository
  view: AppView
  onMenu: () => void
  onSearch: () => void
  onCreate: () => void
}): React.JSX.Element {
  const label = NAV_ITEMS.find((item) => item.id === view)?.label ?? 'Resume'
  return (
    <header className="app-header">
      <button className="icon-button mobile-menu" onClick={onMenu} aria-label="Toggle navigation">
        <Menu size={18} />
      </button>
      <div className="breadcrumb">
        {repository && <span className="muted">{repository.name}</span>}
        <ChevronRight size={14} />
        <strong>{view === 'resume' ? 'Resume briefing' : label}</strong>
      </div>
      <div className="header-actions">
        <button className="search-trigger" onClick={onSearch} aria-label="Search checkpoints">
          <Search size={16} />
          <span>Search</span>
          <kbd>Ctrl/⌘ K</kbd>
        </button>
        <button
          className="button primary compact"
          onClick={onCreate}
          data-testid="create-checkpoint"
        >
          <Plus size={16} />
          <span>Checkpoint</span>
          <kbd>Ctrl/⌘ N</kbd>
        </button>
      </div>
    </header>
  )
}

function Dashboard({
  repository,
  checkpoints,
  onRefresh,
  onCreate,
  onDetail,
  onTimeline,
  onResume,
  busy
}: {
  repository: Repository
  checkpoints: Checkpoint[]
  onRefresh: () => Promise<void>
  onCreate: () => void
  onDetail: (id: string) => void
  onTimeline: () => void
  onResume: (id: string) => void
  busy: boolean
}): React.JSX.Element {
  const latest = checkpoints[0]
  return (
    <div className="dashboard page-enter" data-testid="dashboard-view">
      <section className="repository-hero">
        <div className="repo-heading">
          <div className="repo-icon">
            <FolderGit2 size={24} />
          </div>
          <div>
            <div className="eyebrow-row">
              <span className={`working-state ${repository.isClean ? 'clean' : 'changed'}`}>
                <span />
                {repository.isClean ? 'Working tree clean' : 'Changes in progress'}
              </span>
              {repository.autoCheckpointEnabled && (
                <span className="auto-label">
                  <RotateCcw size={12} /> Auto on
                </span>
              )}
            </div>
            <h1>{repository.name}</h1>
            <p className="repo-path">{repository.path}</p>
          </div>
        </div>
        <div className="hero-actions">
          <button
            className="icon-button outlined"
            onClick={() => void onRefresh()}
            disabled={busy}
            aria-label="Refresh repository status"
          >
            <RefreshCw size={17} className={busy ? 'spin' : ''} />
          </button>
          <button className="button primary" onClick={onCreate}>
            <Flag size={17} /> Create checkpoint
          </button>
        </div>
      </section>

      <section className="status-strip" aria-label="Current Git status">
        <div className="branch-summary">
          <Branch size={17} />
          <div>
            <span>Branch</span>
            <strong>{repository.branch}</strong>
          </div>
        </div>
        <div className="commit-summary">
          <GitCommitHorizontal size={17} />
          <div>
            <span>HEAD</span>
            <code>{repository.shortCommit}</code>
          </div>
        </div>
        <StatusMetric label="Modified" value={repository.counts.modified} tone="amber" />
        <StatusMetric label="Added" value={repository.counts.added} tone="green" />
        <StatusMetric label="Deleted" value={repository.counts.deleted} tone="red" />
        <StatusMetric label="Renamed" value={repository.counts.renamed} tone="neutral" />
        <StatusMetric label="Staged" value={repository.counts.staged} tone="blue" />
        <StatusMetric label="Untracked" value={repository.counts.untracked} tone="neutral" />
      </section>

      <div className="dashboard-grid">
        <section className="focus-panel">
          <div className="section-heading">
            <div>
              <p className="section-kicker">Last known context</p>
              <h2>Pick up where you left off</h2>
            </div>
            {latest && (
              <span className="time-label">
                <Clock3 size={13} /> {relativeTime(latest.createdAt)}
              </span>
            )}
          </div>
          {latest ? (
            <>
              <div className="goal-block">
                <span className="context-label">
                  <CircleDot size={14} /> Current goal
                </span>
                <p>{latest.goal}</p>
              </div>
              <div className="next-action-block">
                <div className="next-number">01</div>
                <div>
                  <span>Next action</span>
                  <strong>{latest.nextAction}</strong>
                </div>
                <button className="button secondary compact" onClick={() => onResume(latest.id)}>
                  Resume <ArrowRight size={15} />
                </button>
              </div>
              {latest.blockers && (
                <div className="blocker-inline">
                  <AlertCircle size={15} />
                  <span>{latest.blockers}</span>
                </div>
              )}
            </>
          ) : (
            <EmptyState
              icon={<Flag size={22} />}
              title="No saved context yet"
              body="Create the first checkpoint for this repository."
              action={
                <button className="button primary" onClick={onCreate}>
                  Create checkpoint
                </button>
              }
            />
          )}
        </section>

        <section className="activity-panel">
          <div className="section-heading compact-heading">
            <div>
              <p className="section-kicker">Working tree</p>
              <h2>Change activity</h2>
            </div>
          </div>
          <div
            className="activity-visual"
            aria-label={`${sumChanges(repository)} working tree changes`}
          >
            <div className="activity-number">{sumChanges(repository)}</div>
            <div>
              <strong>tracked changes</strong>
              <span>{repository.counts.staged} ready to commit</span>
            </div>
          </div>
          <div className="change-bar" aria-hidden="true">
            <span
              className="bar-modified"
              style={{ flex: Math.max(repository.counts.modified, 0.2) }}
            />
            <span className="bar-added" style={{ flex: Math.max(repository.counts.added, 0.2) }} />
            <span
              className="bar-deleted"
              style={{ flex: Math.max(repository.counts.deleted, 0.2) }}
            />
            <span
              className="bar-untracked"
              style={{ flex: Math.max(repository.counts.untracked, 0.2) }}
            />
          </div>
          <div className="change-legend">
            <span>
              <i className="legend-modified" /> Modified
            </span>
            <span>
              <i className="legend-added" /> Added
            </span>
            <span>
              <i className="legend-deleted" /> Deleted
            </span>
            <span>
              <i className="legend-untracked" /> Untracked
            </span>
          </div>
          <div className="privacy-note">
            <EyeOff size={15} />
            <span>File names and stats only. Source contents stay untouched.</span>
          </div>
        </section>
      </div>

      <section className="recent-section">
        <div className="section-heading">
          <div>
            <p className="section-kicker">History</p>
            <h2>Recent checkpoints</h2>
          </div>
          <button className="text-button" onClick={onTimeline}>
            View timeline <ArrowRight size={14} />
          </button>
        </div>
        <div className="checkpoint-table">
          {checkpoints.slice(0, 4).map((item, index) => (
            <CheckpointRow
              key={item.id}
              checkpoint={item}
              isLatest={index === 0}
              onClick={() => onDetail(item.id)}
            />
          ))}
        </div>
      </section>
    </div>
  )
}

function StatusMetric({
  label,
  value,
  tone
}: {
  label: string
  value: number
  tone: string
}): React.JSX.Element {
  return (
    <div className="status-metric">
      <i className={`metric-dot ${tone}`} />
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  )
}

function CheckpointRow({
  checkpoint,
  repository,
  isLatest,
  onClick
}: {
  checkpoint: Checkpoint
  repository?: Repository
  isLatest?: boolean
  onClick: () => void
}): React.JSX.Element {
  return (
    <button className="checkpoint-row" onClick={onClick}>
      <span className={`timeline-node ${isLatest ? 'latest' : ''}`}>
        <span />
      </span>
      <span className="checkpoint-copy">
        <span className="checkpoint-title-line">
          <strong>{checkpoint.title}</strong>
          <span className={`origin-badge ${checkpoint.origin}`}>
            {checkpoint.origin === 'automatic' && <RotateCcw size={11} />}
            {checkpoint.origin}
          </span>
        </span>
        <span className="checkpoint-subtitle">{checkpoint.nextAction}</span>
        <span className="checkpoint-tags">
          {repository && <span className="repo-tag">{repository.name}</span>}
          {checkpoint.tags.slice(0, 3).map((tag) => (
            <span key={tag}>#{tag}</span>
          ))}
        </span>
      </span>
      <span className="checkpoint-git">
        <Branch size={13} />
        <span>{checkpoint.branch}</span>
        <code>{checkpoint.shortCommitHash}</code>
      </span>
      <span className="checkpoint-stats">
        <span>+{checkpoint.diffStats.insertions}</span>
        <span>−{checkpoint.diffStats.deletions}</span>
      </span>
      <time dateTime={checkpoint.createdAt}>{relativeTime(checkpoint.createdAt)}</time>
      <ChevronRight size={16} className="row-chevron" />
    </button>
  )
}

function TimelineView({
  checkpoints,
  repositories,
  initialRepositoryId,
  onDetail,
  onCreate,
  searchOpen,
  setSearchOpen,
  searchInputRef
}: {
  checkpoints: Checkpoint[]
  repositories: Repository[]
  initialRepositoryId: string
  onDetail: (id: string) => void
  onCreate: () => void
  searchOpen: boolean
  setSearchOpen: (open: boolean) => void
  searchInputRef: React.RefObject<HTMLInputElement | null>
}): React.JSX.Element {
  const [query, setQuery] = useState('')
  const [repositoryId, setRepositoryId] = useState(initialRepositoryId)
  const [branch, setBranch] = useState('all')
  const [origin, setOrigin] = useState<'all' | CheckpointOrigin>('all')
  const [tag, setTag] = useState('all')
  const [filtersOpen, setFiltersOpen] = useState(false)
  const tags = [...new Set(checkpoints.flatMap((item) => item.tags))].sort()
  const branches = [...new Set(checkpoints.map((item) => item.branch))].sort()
  const filtered = checkpoints.filter((checkpoint) => {
    const haystack = [
      checkpoint.title,
      checkpoint.goal,
      checkpoint.completed,
      checkpoint.nextAction,
      checkpoint.notes,
      ...checkpoint.tags,
      ...checkpoint.files.map((file) => file.path)
    ]
      .join(' ')
      .toLowerCase()
    return (
      (!query.trim() || haystack.includes(query.trim().toLowerCase())) &&
      (repositoryId === 'all' || checkpoint.repositoryId === repositoryId) &&
      (branch === 'all' || checkpoint.branch === branch) &&
      (origin === 'all' || checkpoint.origin === origin) &&
      (tag === 'all' || checkpoint.tags.includes(tag))
    )
  })
  const activeFilterCount = [
    repositoryId !== 'all',
    branch !== 'all',
    origin !== 'all',
    tag !== 'all'
  ].filter(Boolean).length

  return (
    <div className="timeline-view page-enter" data-testid="timeline-view">
      <div className="page-heading">
        <div>
          <p className="section-kicker">Every saved state</p>
          <h1>Checkpoint timeline</h1>
          <p>Search the decisions and Git state that shaped your work.</p>
        </div>
        <button className="button primary" onClick={onCreate}>
          <Plus size={16} /> New checkpoint
        </button>
      </div>
      <div className="timeline-toolbar">
        <label className={`search-field ${searchOpen ? 'expanded' : ''}`}>
          <Search size={17} />
          <span className="sr-only">Search checkpoints</span>
          <input
            ref={searchInputRef}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onFocus={() => setSearchOpen(true)}
            placeholder="Search goals, files, tags…"
          />
          {query && (
            <button
              className="icon-button quiet"
              onClick={() => setQuery('')}
              aria-label="Clear search"
            >
              <X size={14} />
            </button>
          )}
          <kbd>/</kbd>
        </label>
        <button
          className={`button secondary ${filtersOpen ? 'active' : ''}`}
          onClick={() => setFiltersOpen((value) => !value)}
        >
          <ListFilter size={16} /> Filters{' '}
          {activeFilterCount > 0 && <span className="filter-count">{activeFilterCount}</span>}
        </button>
      </div>
      {filtersOpen && (
        <div className="filter-panel">
          <SelectField label="Repository" value={repositoryId} onChange={setRepositoryId}>
            <option value="all">All repositories</option>
            {repositories.map((item) => (
              <option key={item.id} value={item.id}>
                {item.name}
              </option>
            ))}
          </SelectField>
          <SelectField label="Branch" value={branch} onChange={setBranch}>
            <option value="all">All branches</option>
            {branches.map((item) => (
              <option key={item} value={item}>
                {item}
              </option>
            ))}
          </SelectField>
          <SelectField
            label="Origin"
            value={origin}
            onChange={(value) => setOrigin(value as 'all' | CheckpointOrigin)}
          >
            <option value="all">Manual + automatic</option>
            <option value="manual">Manual only</option>
            <option value="automatic">Automatic only</option>
          </SelectField>
          <SelectField label="Tag" value={tag} onChange={setTag}>
            <option value="all">All tags</option>
            {tags.map((item) => (
              <option key={item} value={item}>
                {item}
              </option>
            ))}
          </SelectField>
          <button
            className="text-button reset-filter"
            onClick={() => {
              setRepositoryId('all')
              setBranch('all')
              setOrigin('all')
              setTag('all')
            }}
          >
            <RotateCcw size={14} /> Reset
          </button>
        </div>
      )}
      <div className="result-line">
        <span>
          {filtered.length} {filtered.length === 1 ? 'checkpoint' : 'checkpoints'}
        </span>
        <span>Newest first</span>
      </div>
      {filtered.length ? (
        <div className="timeline-list">
          {filtered.map((checkpoint, index) => (
            <CheckpointRow
              key={checkpoint.id}
              checkpoint={checkpoint}
              repository={repositories.find((item) => item.id === checkpoint.repositoryId)}
              isLatest={index === 0}
              onClick={() => onDetail(checkpoint.id)}
            />
          ))}
        </div>
      ) : (
        <EmptyState
          icon={<Search size={23} />}
          title="No checkpoints match"
          body="Try a broader search or reset the active filters."
          action={
            <button
              className="button secondary"
              onClick={() => {
                setQuery('')
                setRepositoryId('all')
                setBranch('all')
                setOrigin('all')
                setTag('all')
              }}
            >
              Clear search and filters
            </button>
          }
        />
      )}
    </div>
  )
}

function CompareView({
  checkpoints,
  repositories
}: {
  checkpoints: Checkpoint[]
  repositories: Repository[]
}): React.JSX.Element {
  const comparableRepositories = repositories.filter(
    (repository) => checkpoints.filter((item) => item.repositoryId === repository.id).length >= 2
  )
  const [compareRepositoryId, setCompareRepositoryId] = useState(
    comparableRepositories[0]?.id ?? ''
  )
  const repoCheckpoints = checkpoints.filter((item) => item.repositoryId === compareRepositoryId)
  const [baseId, setBaseId] = useState(repoCheckpoints.at(-1)?.id ?? '')
  const [targetId, setTargetId] = useState(repoCheckpoints[0]?.id ?? '')
  useEffect(() => {
    const selectedCheckpoints = checkpoints.filter(
      (item) => item.repositoryId === compareRepositoryId
    )
    setBaseId(selectedCheckpoints.at(-1)?.id ?? '')
    setTargetId(selectedCheckpoints[0]?.id ?? '')
  }, [checkpoints, compareRepositoryId])
  const base = repoCheckpoints.find((item) => item.id === baseId)
  const target = repoCheckpoints.find((item) => item.id === targetId)
  const comparison = base && target ? compareCheckpoints(base, target) : null

  return (
    <div className="compare-view page-enter" data-testid="compare-view">
      <div className="page-heading">
        <div>
          <p className="section-kicker">Then and now</p>
          <h1>Compare checkpoints</h1>
          <p>See how Git state and human context changed between sessions.</p>
        </div>
        <div className="compare-repository-field">
          <SelectField
            label="Repository"
            value={compareRepositoryId}
            onChange={setCompareRepositoryId}
          >
            {comparableRepositories.map((repository) => (
              <option key={repository.id} value={repository.id}>
                {repository.name}
              </option>
            ))}
          </SelectField>
          <small>Only repositories with two or more checkpoints</small>
        </div>
      </div>
      <section className="compare-picker">
        <CheckpointSelect
          label="Earlier checkpoint"
          value={baseId}
          checkpoints={repoCheckpoints}
          onChange={setBaseId}
        />
        <div className="compare-arrow">
          <ArrowRight size={20} />
        </div>
        <CheckpointSelect
          label="Later checkpoint"
          value={targetId}
          checkpoints={repoCheckpoints}
          onChange={setTargetId}
        />
      </section>
      {comparison && base && target ? (
        <div className="comparison-results">
          <section className="compare-summary-card">
            <div className="compare-summary-head">
              <div>
                <span>Elapsed time</span>
                <strong>{formatDuration(base.createdAt, target.createdAt)}</strong>
              </div>
              <div className="commit-path">
                <code>{base.shortCommitHash}</code>
                <ArrowRight size={15} />
                <code>{target.shortCommitHash}</code>
              </div>
              <span className={`branch-change ${base.branch === target.branch ? 'same' : ''}`}>
                <Branch size={14} />{' '}
                {base.branch === target.branch
                  ? 'Same branch'
                  : `${base.branch} → ${target.branch}`}
              </span>
            </div>
            <div className="compare-totals">
              <span>
                <strong>{comparison.added.length}</strong> added
              </span>
              <span>
                <strong>{comparison.removed.length}</strong> removed
              </span>
              <span>
                <strong>{comparison.changed.length}</strong> changed
              </span>
              <span>
                <strong>{comparison.unchanged.length}</strong> unchanged
              </span>
            </div>
          </section>
          <div className="compare-columns">
            <section className="compare-context">
              <div className="section-heading compact-heading">
                <div>
                  <p className="section-kicker">Context drift</p>
                  <h2>What changed</h2>
                </div>
              </div>
              <ContextDiff label="Goal" before={base.goal} after={target.goal} />
              <ContextDiff label="Next action" before={base.nextAction} after={target.nextAction} />
              <ContextDiff label="Blockers" before={base.blockers} after={target.blockers} />
            </section>
            <section className="compare-files">
              <div className="section-heading compact-heading">
                <div>
                  <p className="section-kicker">Working tree</p>
                  <h2>File movement</h2>
                </div>
              </div>
              <FileGroup title="Added since" tone="added" files={comparison.added} />
              <StatusTransitionGroup changes={comparison.changed} />
              <FileGroup title="No longer changed" tone="deleted" files={comparison.removed} />
            </section>
          </div>
          <div className="compare-disclaimer">
            <Info size={15} />
            <span>
              Comparison uses captured file metadata and context fields. SavePoint does not store or
              compare source contents.
            </span>
          </div>
        </div>
      ) : (
        <EmptyState
          icon={<ArrowLeftRight size={24} />}
          title="Two checkpoints needed"
          body="Create another checkpoint in the same repository to compare sessions."
        />
      )}
    </div>
  )
}

function ResumeView({
  checkpoint,
  repository,
  api,
  onToast
}: {
  checkpoint?: Checkpoint
  repository?: Repository
  api: SavePointRendererApi
  onToast: (message: string) => void
}): React.JSX.Element {
  const [briefing, setBriefing] = useState<ResumeSummary | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [retryKey, setRetryKey] = useState(0)

  useEffect(() => {
    if (!checkpoint) return
    let active = true
    setBriefing(null)
    setLoadError(null)
    void api
      .resumeCheckpoint(checkpoint.id)
      .then((summary) => {
        if (active) setBriefing(summary)
      })
      .catch((resumeError: unknown) => {
        if (active) setLoadError(normalizeError(resumeError))
      })
    return () => {
      active = false
    }
  }, [api, checkpoint, retryKey])

  if (!checkpoint) {
    return (
      <EmptyState
        icon={<BookOpen size={24} />}
        title="Nothing to resume yet"
        body="Create a checkpoint first, then return here for a re-entry briefing."
      />
    )
  }

  if (loadError) {
    return (
      <div className="resume-view page-enter">
        <EmptyState
          icon={<AlertCircle size={24} />}
          title="The briefing could not be refreshed"
          body={loadError}
          action={
            <button className="button secondary" onClick={() => setRetryKey((value) => value + 1)}>
              <RefreshCw size={15} /> Try again
            </button>
          }
        />
      </div>
    )
  }

  if (!briefing) {
    return (
      <div className="resume-view resume-loading" role="status">
        <LoaderCircle className="spin" size={22} />
        <span>Checking the repository’s current state…</span>
      </div>
    )
  }

  const difference = briefing.currentStateDifference
  const drifted = Boolean(
    difference &&
    (difference.branchChanged ||
      difference.commitChanged ||
      difference.cleanStateChanged ||
      difference.filesAddedSinceCheckpoint.length ||
      difference.filesRemovedSinceCheckpoint.length ||
      difference.filesChangedSinceCheckpoint.length)
  )
  const copy = async (text: string, label: string): Promise<void> => {
    await api.copyText(text)
    onToast(`${label} copied`)
  }

  return (
    <div className="resume-view page-enter" data-testid="resume-view">
      <div className="resume-masthead">
        <div className="resume-symbol">
          <Flag size={22} />
        </div>
        <div>
          <p className="section-kicker">Fresh re-entry briefing</p>
          <h1>{briefing.title}</h1>
          <p>
            Saved {fullDate(briefing.capturedAt)} · {briefing.branch} at{' '}
            <code>{briefing.commitHash.slice(0, 7)}</code>
          </p>
        </div>
        <span className={`drift-badge ${drifted ? 'drifted' : ''}`}>
          {drifted ? <AlertCircle size={14} /> : <Check size={14} />}
          {drifted ? 'Repository has moved' : 'Matches current state'}
        </span>
      </div>
      <div className="resume-layout">
        <div className="resume-primary">
          <section className="briefing-section doing">
            <span className="briefing-index">01</span>
            <div>
              <p className="section-kicker">You were doing</p>
              <h2>{briefing.whatYouWereDoing}</h2>
            </div>
          </section>
          <section className="briefing-section">
            <span className="briefing-index">02</span>
            <div>
              <p className="section-kicker">You completed</p>
              <p>{briefing.completed || 'No completed work was recorded.'}</p>
            </div>
          </section>
          <section className="briefing-section next">
            <span className="briefing-index">03</span>
            <div>
              <p className="section-kicker">Start here</p>
              <h2>{briefing.nextRecommendedAction}</h2>
            </div>
            <ArrowRight size={20} />
          </section>
          {briefing.blockers && briefing.blockers !== 'No blockers recorded.' && (
            <section className="resume-blocker">
              <AlertCircle size={17} />
              <div>
                <strong>Before you continue</strong>
                <p>{briefing.blockers}</p>
              </div>
            </section>
          )}

          <ResumeDrift difference={difference} drifted={drifted} />

          <section className="resume-files">
            <div className="section-heading compact-heading">
              <div>
                <p className="section-kicker">Captured working tree</p>
                <h2>{briefing.changedFiles.length} changed files</h2>
              </div>
            </div>
            <div className="resume-file-list">
              {briefing.changedFiles.map((file) => (
                <div className="resume-file-row" key={file.path}>
                  <span className={`file-status ${file.status}`}>
                    {file.status === 'modified'
                      ? 'M'
                      : file.status === 'added'
                        ? 'A'
                        : file.status === 'deleted'
                          ? 'D'
                          : file.status === 'renamed'
                            ? 'R'
                            : '?'}
                  </span>
                  <FileCode2 size={14} />
                  <code>{file.path}</code>
                  {file.staged && <span className="staged-label">staged</span>}
                </div>
              ))}
            </div>
          </section>

          {(briefing.commands.length > 0 || briefing.links.length > 0) && (
            <div className="resume-resources">
              {briefing.commands.length > 0 && (
                <section className="resume-resource-card">
                  <p className="section-kicker">Useful commands</p>
                  {briefing.commands.map((command) => (
                    <button
                      key={command}
                      onClick={() => void copy(command, 'Command')}
                      aria-label={`Copy command ${command}`}
                    >
                      <code>{command}</code>
                      <Copy size={13} />
                    </button>
                  ))}
                </section>
              )}
              {briefing.links.length > 0 && (
                <section className="resume-resource-card">
                  <p className="section-kicker">Relevant HTTPS links</p>
                  {briefing.links.map((url) => (
                    <button
                      key={url}
                      onClick={() => void safeOpenExternal(api, url, onToast)}
                      aria-label={`Open link ${url}`}
                    >
                      <span className="truncate">{url}</span>
                      <ExternalLink size={13} />
                    </button>
                  ))}
                </section>
              )}
            </div>
          )}
        </div>
        <aside className="resume-actions">
          <div className="section-heading compact-heading">
            <div>
              <p className="section-kicker">Safe actions</p>
              <h2>Get moving</h2>
            </div>
          </div>
          {repository && (
            <>
              <button
                className="action-tile"
                onClick={() => void api.openRepository(repository.id, 'folder')}
              >
                <FolderOpen size={18} />
                <span>
                  <strong>Open repository</strong>
                  <small>Show in file manager</small>
                </span>
                <ExternalLink size={14} />
              </button>
              <button
                className="action-tile"
                onClick={() => void api.openRepository(repository.id, 'vscode')}
              >
                <Code2 size={18} />
                <span>
                  <strong>Open in VS Code</strong>
                  <small>Launch workspace</small>
                </span>
                <ExternalLink size={14} />
              </button>
            </>
          )}
          <button className="action-tile" onClick={() => void copy(briefing.branch, 'Branch name')}>
            <Branch size={18} />
            <span>
              <strong>Copy branch</strong>
              <small>{briefing.branch}</small>
            </span>
            <Copy size={14} />
          </button>
          {briefing.checkoutCommand ? (
            <button
              className="action-tile"
              onClick={() => void copy(briefing.checkoutCommand as string, 'Checkout command')}
            >
              <TerminalSquare size={18} />
              <span>
                <strong>Copy safe switch command</strong>
                <small>{briefing.checkoutCommand}</small>
              </span>
              <Copy size={14} />
            </button>
          ) : (
            <div className="action-tile disabled-action">
              <TerminalSquare size={18} />
              <span>
                <strong>Switch command unavailable</strong>
                <small>The captured branch is not safe to place in a command.</small>
              </span>
              <LockKeyhole size={14} />
            </div>
          )}
          <button
            className="action-tile"
            onClick={() => void copy(briefing.markdown, 'Checkpoint Markdown')}
          >
            <FileText size={18} />
            <span>
              <strong>Copy checkpoint Markdown</strong>
              <small>Full portable session briefing</small>
            </span>
            <Copy size={14} />
          </button>
          <button
            className="action-tile accent"
            onClick={() => void copy(briefing.assistantContext, 'Assistant context')}
          >
            <Sparkles size={18} />
            <span>
              <strong>Copy assistant context</strong>
              <small>Concise context for a coding assistant</small>
            </span>
            <Copy size={14} />
          </button>
          <div className="safety-callout">
            <ShieldCheck size={16} />
            <span>
              Commands are copied, never run. SavePoint never switches branches or changes your
              working tree.
            </span>
          </div>
        </aside>
      </div>
    </div>
  )
}

function ResumeDrift({
  difference,
  drifted
}: {
  difference: ResumeSummary['currentStateDifference']
  drifted: boolean
}): React.JSX.Element {
  if (!difference) {
    return (
      <section className="resume-drift" data-testid="resume-drift">
        <Info size={17} />
        <div>
          <strong>Current repository state unavailable</strong>
          <p>The checkpoint is still complete, but drift could not be calculated.</p>
        </div>
      </section>
    )
  }

  return (
    <section className={`resume-drift ${drifted ? 'drifted' : ''}`} data-testid="resume-drift">
      <div className="resume-drift-heading">
        <div>
          {drifted ? <AlertCircle size={17} /> : <CheckCircle2 size={17} />}
          <span>
            <small>Repository now</small>
            <strong>
              {drifted ? 'Current state differs from this checkpoint' : 'No drift detected'}
            </strong>
          </span>
        </div>
        <span className="drift-counts">
          +{difference.filesAddedSinceCheckpoint.length} / −
          {difference.filesRemovedSinceCheckpoint.length} / ~
          {difference.filesChangedSinceCheckpoint.length}
        </span>
      </div>
      <div className="drift-git-grid">
        <div>
          <span>Branch</span>
          <code>{difference.checkpointBranch}</code>
          <ArrowRight size={13} />
          <code>{difference.currentBranch}</code>
        </div>
        <div>
          <span>Commit</span>
          <code>{difference.checkpointCommit.slice(0, 7)}</code>
          <ArrowRight size={13} />
          <code>{difference.currentCommit.slice(0, 7)}</code>
        </div>
      </div>
      {(difference.filesAddedSinceCheckpoint.length > 0 ||
        difference.filesRemovedSinceCheckpoint.length > 0 ||
        difference.filesChangedSinceCheckpoint.length > 0) && (
        <div className="drift-file-grid">
          {difference.filesAddedSinceCheckpoint.map((path) => (
            <span key={`added-${path}`}>
              <b>+</b>
              <code>{path}</code>
            </span>
          ))}
          {difference.filesRemovedSinceCheckpoint.map((path) => (
            <span key={`removed-${path}`}>
              <b>−</b>
              <code>{path}</code>
            </span>
          ))}
          {difference.filesChangedSinceCheckpoint.map((path) => (
            <span key={`changed-${path}`}>
              <b>~</b>
              <code>{path}</code>
            </span>
          ))}
        </div>
      )}
    </section>
  )
}

function PrivacyView(): React.JSX.Element {
  return (
    <div className="privacy-view page-enter">
      <div className="page-heading">
        <div>
          <p className="section-kicker">A product constraint, not a promise</p>
          <h1>Your code stays yours.</h1>
          <p>
            SavePoint is useful without an account, a network connection, or access to source
            contents.
          </p>
        </div>
        <div className="privacy-shield">
          <ShieldCheck size={30} />
        </div>
      </div>
      <section className="privacy-principle">
        <div className="principle-number">01</div>
        <div>
          <h2>Everything lives on this device</h2>
          <p>
            Checkpoints are stored in a local database inside your operating system’s
            application-data directory. SavePoint has no cloud backend, analytics, telemetry, or
            account system.
          </p>
        </div>
        <Database size={26} />
      </section>
      <div className="privacy-grid">
        <section className="privacy-card">
          <EyeOff size={20} />
          <h2>What we never collect</h2>
          <ul>
            <li>Source-file contents or complete diffs</li>
            <li>Shell or browser history</li>
            <li>Clipboard contents</li>
            <li>Environment variables or tokens</li>
            <li>Editor telemetry</li>
          </ul>
        </section>
        <section className="privacy-card">
          <Filter size={20} />
          <h2>What is filtered</h2>
          <ul>
            <li>
              <code>.env</code> and environment variants
            </li>
            <li>Private keys and certificates</li>
            <li>Credential and token-like paths</li>
            <li>Git-ignored files</li>
            <li>Your custom exclusion patterns</li>
          </ul>
        </section>
        <section className="privacy-card">
          <FileDiff size={20} />
          <h2>What checkpoints keep</h2>
          <ul>
            <li>Branch and commit identifiers</li>
            <li>Changed-file paths and statuses</li>
            <li>Aggregate insertion/deletion counts</li>
            <li>Recent commit metadata</li>
            <li>Context you choose to write</li>
          </ul>
        </section>
      </div>
      <section className="privacy-boundary">
        <div>
          <LockKeyhole size={18} />
          <h2>The trust boundary</h2>
        </div>
        <p>
          The renderer cannot read files or execute shell commands. A narrow, validated bridge
          requests specific operations from Electron’s isolated main process. External links require
          a safe protocol.
        </p>
        <div className="boundary-flow">
          <span>React renderer</span>
          <ArrowRight size={16} />
          <span>Validated IPC</span>
          <ArrowRight size={16} />
          <span>Local Git + SQLite</span>
        </div>
      </section>
    </div>
  )
}

function SettingsView({
  settings,
  repository,
  onSettings,
  onAutoCheckpoint
}: {
  settings: Settings
  repository: Repository
  onSettings: (settings: Settings) => Promise<void>
  onAutoCheckpoint: (enabled: boolean) => Promise<void>
}): React.JSX.Element {
  const [draft, setDraft] = useState(settings)
  const [patterns, setPatterns] = useState(settings.exclusionPatterns.join('\n'))
  const [saving, setSaving] = useState(false)
  const save = async (): Promise<void> => {
    setSaving(true)
    try {
      await onSettings({ ...draft, exclusionPatterns: lines(patterns) })
    } finally {
      setSaving(false)
    }
  }
  return (
    <div className="settings-view page-enter">
      <div className="page-heading">
        <div>
          <p className="section-kicker">Preferences</p>
          <h1>Settings</h1>
          <p>Control capture cadence, appearance, and repository exclusions.</p>
        </div>
        <button className="button primary" onClick={() => void save()} disabled={saving}>
          {saving ? <LoaderCircle className="spin" size={16} /> : <Check size={16} />} Save changes
        </button>
      </div>
      <div className="settings-layout">
        <section className="settings-section">
          <div className="settings-heading">
            <Sun size={19} />
            <div>
              <h2>Appearance</h2>
              <p>Use the theme that fits your workspace.</p>
            </div>
          </div>
          <div className="theme-picker">
            {(['dark', 'light', 'system'] as ThemePreference[]).map((theme) => (
              <button
                key={theme}
                className={draft.theme === theme ? 'active' : ''}
                onClick={() => setDraft({ ...draft, theme })}
              >
                {theme === 'dark' ? (
                  <Moon size={17} />
                ) : theme === 'light' ? (
                  <Sun size={17} />
                ) : (
                  <Box size={17} />
                )}
                <span>{theme}</span>
                {draft.theme === theme && <Check size={14} />}
              </button>
            ))}
          </div>
        </section>
        <section className="settings-section">
          <div className="settings-heading">
            <RotateCcw size={19} />
            <div>
              <h2>Automatic checkpoints</h2>
              <p>Capture meaningful Git changes after activity settles.</p>
            </div>
          </div>
          <label className="toggle-row">
            <div>
              <strong>Enable for {repository.name}</strong>
              <span>Opt-in per repository; duplicate states are skipped.</span>
            </div>
            <input
              type="checkbox"
              role="switch"
              checked={repository.autoCheckpointEnabled}
              onChange={(event) => void onAutoCheckpoint(event.target.checked)}
            />
            <span className="switch-ui" />
          </label>
          <label className="field-inline">
            <span>Minimum interval</span>
            <select
              value={draft.autoCheckpointMinutes}
              onChange={(event) =>
                setDraft({ ...draft, autoCheckpointMinutes: Number(event.target.value) })
              }
            >
              <option value={10}>10 minutes</option>
              <option value={15}>15 minutes</option>
              <option value={30}>30 minutes</option>
              <option value={60}>1 hour</option>
            </select>
          </label>
          <div className="setting-note">
            <Info size={14} />
            Changes are debounced. Automatic checkpoints never capture more frequently than this
            interval.
          </div>
        </section>
        <section className="settings-section">
          <div className="settings-heading">
            <EyeOff size={19} />
            <div>
              <h2>Exclusion patterns</h2>
              <p>One glob per line, applied in addition to built-in secret rules.</p>
            </div>
          </div>
          <label className="field">
            <span>Custom patterns</span>
            <textarea
              rows={5}
              value={patterns}
              onChange={(event) => setPatterns(event.target.value)}
              spellCheck={false}
            />
            <small>
              Examples: <code>fixtures/private/**</code>, <code>*.p12</code>
            </small>
          </label>
        </section>
        <section className="settings-section">
          <div className="settings-heading">
            <Keyboard size={19} />
            <div>
              <h2>Keyboard shortcuts</h2>
              <p>Fast paths for frequent actions.</p>
            </div>
          </div>
          <div className="shortcut-list">
            <Shortcut label="Create checkpoint" keys={['Ctrl/⌘', 'N']} />
            <Shortcut label="Search checkpoints" keys={['Ctrl/⌘', 'K']} />
            <Shortcut label="Jump to timeline" keys={['G', 'T']} />
            <Shortcut label="Close panel or dialog" keys={['Esc']} />
          </div>
        </section>
      </div>
    </div>
  )
}

function CheckpointComposer({
  repository,
  busy,
  onClose,
  onSubmit
}: {
  repository: Repository
  busy: boolean
  onClose: () => void
  onSubmit: (draft: CheckpointDraft) => void
}): React.JSX.Element {
  const [draft, setDraft] = useState(EMPTY_DRAFT)
  const [tagsValue, setTagsValue] = useState('')
  const [urlsValue, setUrlsValue] = useState('')
  const [commandsValue, setCommandsValue] = useState('')
  const [advanced, setAdvanced] = useState(false)
  const titleRef = useRef<HTMLInputElement>(null)
  useEffect(() => {
    titleRef.current?.focus()
  }, [])
  const submit = (event: FormEvent): void => {
    event.preventDefault()
    onSubmit({
      ...draft,
      tags: csv(tagsValue),
      urls: lines(urlsValue),
      commands: lines(commandsValue)
    })
  }
  return (
    <DialogShell
      title="Create checkpoint"
      description={`Capture ${repository.name} at ${repository.branch}`}
      onClose={onClose}
      size="large"
    >
      <form className="composer-form" onSubmit={submit}>
        <div className="capture-banner">
          <div>
            <GitCommitHorizontal size={17} />
            <span>
              <strong>{repository.branch}</strong>
              <code>{repository.shortCommit}</code>
            </span>
          </div>
          <span className={`working-state ${repository.isClean ? 'clean' : 'changed'}`}>
            <span />
            {repository.isClean ? 'Clean' : `${sumChanges(repository)} changes`}
          </span>
        </div>
        <label className="field">
          <span>
            Checkpoint title <b>Required</b>
          </span>
          <input
            ref={titleRef}
            required
            maxLength={100}
            value={draft.title}
            onChange={(event) => setDraft({ ...draft, title: event.target.value })}
            placeholder="What is true at this point?"
          />
        </label>
        <label className="field">
          <span>
            Current goal <b>Required</b>
          </span>
          <textarea
            required
            rows={2}
            value={draft.goal}
            onChange={(event) => setDraft({ ...draft, goal: event.target.value })}
            placeholder="The outcome you’re working toward"
          />
        </label>
        <div className="form-split">
          <label className="field">
            <span>Work completed</span>
            <textarea
              rows={3}
              value={draft.completed}
              onChange={(event) => setDraft({ ...draft, completed: event.target.value })}
              placeholder="Decisions, implementation, validation…"
            />
          </label>
          <label className="field next-field">
            <span>
              Next action <b>Required</b>
            </span>
            <textarea
              required
              rows={3}
              value={draft.nextAction}
              onChange={(event) => setDraft({ ...draft, nextAction: event.target.value })}
              placeholder="The first concrete thing to do next"
            />
          </label>
        </div>
        <label className="field">
          <span>Blockers</span>
          <input
            value={draft.blockers}
            onChange={(event) => setDraft({ ...draft, blockers: event.target.value })}
            placeholder="Unknowns, decisions, or dependencies — optional"
          />
        </label>
        <label className="field">
          <span>Tags</span>
          <div className="input-with-icon">
            <Tag size={15} />
            <input
              value={tagsValue}
              onChange={(event) => setTagsValue(event.target.value)}
              placeholder="offline, sync, needs-review"
            />
          </div>
        </label>
        <button
          type="button"
          className="advanced-toggle"
          onClick={() => setAdvanced((value) => !value)}
          aria-expanded={advanced}
        >
          <ChevronDown size={16} className={advanced ? 'rotated' : ''} /> Notes, commands & links
        </button>
        {advanced && (
          <div className="advanced-fields">
            <label className="field">
              <span>Notes</span>
              <textarea
                rows={3}
                value={draft.notes}
                onChange={(event) => setDraft({ ...draft, notes: event.target.value })}
                placeholder="Context that won’t be obvious from Git"
              />
            </label>
            <label className="field">
              <span>
                Useful commands <small>one per line</small>
              </span>
              <textarea
                className="mono-field"
                rows={2}
                value={commandsValue}
                onChange={(event) => setCommandsValue(event.target.value)}
                placeholder="npm run test -- sync"
                spellCheck={false}
              />
            </label>
            <label className="field">
              <span>
                Relevant links <small>one per line</small>
              </span>
              <textarea
                rows={2}
                value={urlsValue}
                onChange={(event) => setUrlsValue(event.target.value)}
                placeholder="https://github.com/…"
                spellCheck={false}
              />
            </label>
          </div>
        )}
        <div className="dialog-footer">
          <div className="privacy-inline">
            <LockKeyhole size={14} /> Metadata only · source contents excluded
          </div>
          <button type="button" className="button secondary" onClick={onClose}>
            Cancel
          </button>
          <button className="button primary" type="submit" disabled={busy}>
            {busy ? <LoaderCircle size={16} className="spin" /> : <Flag size={16} />} Save
            checkpoint
          </button>
        </div>
      </form>
    </DialogShell>
  )
}

function CheckpointDetail({
  checkpoint,
  repository,
  busy,
  api,
  onClose,
  onUpdate,
  onDelete,
  onResume,
  onToast
}: {
  checkpoint: Checkpoint
  repository?: Repository
  busy: boolean
  api: SavePointRendererApi
  onClose: () => void
  onUpdate: (draft: CheckpointDraft) => void
  onDelete: () => void
  onResume: () => void
  onToast: (message: string) => void
}): React.JSX.Element {
  useFocusRestoration()
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(checkpointToDraft(checkpoint))
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [exportOpen, setExportOpen] = useState(false)
  const closeButtonRef = useRef<HTMLButtonElement>(null)
  useEffect(() => closeButtonRef.current?.focus(), [])
  const exportCheckpoint = async (format: 'markdown' | 'json'): Promise<void> => {
    const result = await api.exportCheckpoint(checkpoint.id, format)
    setExportOpen(false)
    if (!result.canceled)
      onToast(
        `${format === 'markdown' ? 'Markdown' : 'JSON'} exported${result.path ? ` to ${result.path.split(/[/\\]/).at(-1)}` : ''}`
      )
  }
  return (
    <div
      className="detail-overlay"
      role="presentation"
      onMouseDown={(event) => {
        if (event.currentTarget === event.target) onClose()
      }}
    >
      <section
        className="detail-panel"
        role="dialog"
        aria-modal="true"
        aria-labelledby="detail-title"
        data-testid="checkpoint-detail"
        onKeyDown={(event) => handleModalKeyDown(event, onClose)}
      >
        <header className="detail-header">
          <div>
            <div className="detail-meta">
              <span className={`origin-badge ${checkpoint.origin}`}>
                {checkpoint.origin === 'automatic' && <RotateCcw size={11} />}
                {checkpoint.origin}
              </span>
              <span>{fullDate(checkpoint.createdAt)}</span>
            </div>
            {editing ? (
              <input
                className="title-edit"
                value={draft.title}
                onChange={(event) => setDraft({ ...draft, title: event.target.value })}
                aria-label="Checkpoint title"
              />
            ) : (
              <h1 id="detail-title">{checkpoint.title}</h1>
            )}
            <div className="detail-repo">
              <FolderGit2 size={14} /> {repository?.name}
              <span>·</span>
              <Branch size={13} /> {checkpoint.branch}
              <code>{checkpoint.shortCommitHash}</code>
            </div>
          </div>
          <button
            ref={closeButtonRef}
            className="icon-button"
            onClick={onClose}
            aria-label="Close checkpoint detail"
          >
            <X size={19} />
          </button>
        </header>
        <div className="detail-actions">
          <button className="button primary" onClick={onResume}>
            <BookOpen size={16} /> Resume this session
          </button>
          <button
            className="button secondary"
            onClick={() => {
              if (editing) onUpdate(draft)
              setEditing((value) => !value)
            }}
            disabled={busy}
          >
            {editing ? <Check size={15} /> : <Pencil size={15} />}
            {editing ? 'Save edits' : 'Edit context'}
          </button>
          <div className="menu-wrap">
            <button
              className="button secondary"
              onClick={() => setExportOpen((value) => !value)}
              aria-expanded={exportOpen}
            >
              <Download size={15} /> Export <ChevronDown size={13} />
            </button>
            {exportOpen && (
              <div className="popover-menu">
                <button onClick={() => void exportCheckpoint('markdown')}>
                  <FileText size={15} />
                  <span>
                    <strong>Markdown</strong>
                    <small>Readable session note</small>
                  </span>
                </button>
                <button onClick={() => void exportCheckpoint('json')}>
                  <FileJson size={15} />
                  <span>
                    <strong>JSON</strong>
                    <small>Structured checkpoint data</small>
                  </span>
                </button>
              </div>
            )}
          </div>
          <button
            className="icon-button outlined danger-hover"
            onClick={() => setConfirmDelete(true)}
            aria-label="Delete checkpoint"
          >
            <Trash2 size={16} />
          </button>
        </div>
        <div className="detail-scroll">
          <DetailSection icon={<CircleDot size={16} />} label="Current goal">
            {editing ? (
              <textarea
                rows={2}
                value={draft.goal}
                onChange={(event) => setDraft({ ...draft, goal: event.target.value })}
              />
            ) : (
              <p className="detail-lead">{checkpoint.goal}</p>
            )}
          </DetailSection>
          <div className="detail-context-grid">
            <DetailSection icon={<CheckCircle2 size={16} />} label="Completed">
              {editing ? (
                <textarea
                  rows={4}
                  value={draft.completed}
                  onChange={(event) => setDraft({ ...draft, completed: event.target.value })}
                />
              ) : (
                <p>{checkpoint.completed || 'Nothing recorded.'}</p>
              )}
            </DetailSection>
            <DetailSection icon={<ArrowRight size={16} />} label="Next action" accent>
              {editing ? (
                <textarea
                  rows={4}
                  value={draft.nextAction}
                  onChange={(event) => setDraft({ ...draft, nextAction: event.target.value })}
                />
              ) : (
                <p>{checkpoint.nextAction}</p>
              )}
            </DetailSection>
          </div>
          {(editing || checkpoint.blockers) && (
            <DetailSection icon={<AlertCircle size={16} />} label="Blockers" warning>
              {editing ? (
                <textarea
                  rows={2}
                  value={draft.blockers}
                  onChange={(event) => setDraft({ ...draft, blockers: event.target.value })}
                />
              ) : (
                <p>{checkpoint.blockers}</p>
              )}
            </DetailSection>
          )}
          {(editing || checkpoint.notes) && (
            <DetailSection icon={<FileText size={16} />} label="Notes">
              {editing ? (
                <textarea
                  rows={3}
                  value={draft.notes}
                  onChange={(event) => setDraft({ ...draft, notes: event.target.value })}
                />
              ) : (
                <p>{checkpoint.notes}</p>
              )}
            </DetailSection>
          )}
          {editing && (
            <div className="detail-context-grid">
              <DetailSection icon={<Tag size={16} />} label="Tags">
                <input
                  value={draft.tags.join(', ')}
                  onChange={(event) => setDraft({ ...draft, tags: csv(event.target.value) })}
                  aria-label="Checkpoint tags"
                  placeholder="offline, sync, needs-test"
                />
              </DetailSection>
              <DetailSection icon={<Link2 size={16} />} label="Links">
                <textarea
                  rows={3}
                  value={draft.urls.join('\n')}
                  onChange={(event) => setDraft({ ...draft, urls: lines(event.target.value) })}
                  aria-label="Checkpoint links"
                  placeholder="One HTTPS link per line"
                />
              </DetailSection>
              <DetailSection icon={<TerminalSquare size={16} />} label="Commands">
                <textarea
                  rows={3}
                  className="mono-field"
                  value={draft.commands.join('\n')}
                  onChange={(event) => setDraft({ ...draft, commands: lines(event.target.value) })}
                  aria-label="Checkpoint commands"
                  placeholder="One command per line"
                />
              </DetailSection>
            </div>
          )}
          <section className="detail-section">
            <div className="detail-section-heading">
              <span>
                <FileDiff size={16} /> Changed files
              </span>
              <div className="diff-total">
                <b>+{checkpoint.diffStats.insertions}</b>
                <b>−{checkpoint.diffStats.deletions}</b>
                <small>{checkpoint.diffStats.filesChanged} files</small>
              </div>
            </div>
            <div className="file-list">
              {checkpoint.files.length ? (
                checkpoint.files.map((file) => <FileRow key={file.path} file={file} />)
              ) : (
                <div className="clean-state">
                  <Check size={16} /> Working tree was clean
                </div>
              )}
            </div>
          </section>
          <section className="detail-section">
            <div className="detail-section-heading">
              <span>
                <GitCommitHorizontal size={16} /> Recent commits
              </span>
            </div>
            <div className="commit-list">
              {checkpoint.recentCommits.map((commit) => (
                <div key={commit.hash} className="commit-row">
                  <span className="commit-node" />
                  <code>{commit.shortHash}</code>
                  <div>
                    <strong>{commit.message}</strong>
                    <small>
                      {commit.author} · {relativeTime(commit.authoredAt)}
                    </small>
                  </div>
                </div>
              ))}
            </div>
          </section>
          <div className="detail-utility-grid">
            {checkpoint.commands.length > 0 && (
              <section className="detail-section">
                <div className="detail-section-heading">
                  <span>
                    <TerminalSquare size={16} /> Commands
                  </span>
                </div>
                {checkpoint.commands.map((command) => (
                  <button
                    className="command-row"
                    key={command}
                    onClick={() => void api.copyText(command).then(() => onToast('Command copied'))}
                  >
                    <code>{command}</code>
                    <Copy size={14} />
                  </button>
                ))}
              </section>
            )}
            {checkpoint.urls.length > 0 && (
              <section className="detail-section">
                <div className="detail-section-heading">
                  <span>
                    <Link2 size={16} /> Links
                  </span>
                </div>
                {checkpoint.urls.map((url) => (
                  <button
                    className="link-row"
                    key={url}
                    onClick={() => void safeOpenExternal(api, url, onToast)}
                  >
                    <span className="truncate">{url}</span>
                    <ExternalLink size={14} />
                  </button>
                ))}
              </section>
            )}
          </div>
        </div>
      </section>
      {confirmDelete && (
        <ConfirmDialog
          title="Delete this checkpoint?"
          body="This removes the saved context and captured Git metadata. Your repository files are never touched."
          confirmLabel="Delete checkpoint"
          onCancel={() => setConfirmDelete(false)}
          onConfirm={onDelete}
          busy={busy}
        />
      )}
    </div>
  )
}

function Onboarding({
  onSelect,
  busy,
  error,
  demoMode
}: {
  onSelect: () => void
  busy: boolean
  error: string | null
  demoMode: boolean
}): React.JSX.Element {
  const [step, setStep] = useState(0)
  return (
    <main className="onboarding" data-testid="onboarding">
      <aside className="onboarding-aside">
        <div className="brand-lockup large">
          <img src="/savepoint-mark.svg" width="36" height="36" alt="" />
          <span>SavePoint</span>
        </div>
        <div className="onboarding-quote">
          <Flag size={27} />
          <h2>Leave a trail back to your best thinking.</h2>
          <p>
            Capture the Git state and human context of a session, then return without rebuilding it
            from memory.
          </p>
        </div>
        <div className="privacy-seal">
          <ShieldCheck size={18} />
          <span>
            <strong>Local-first by design</strong>
            <small>No cloud. No telemetry. No source contents.</small>
          </span>
        </div>
      </aside>
      <section className="onboarding-main">
        <div className="onboarding-progress" aria-label={`Onboarding step ${step + 1} of 2`}>
          <span className="active" />
          <span className={step > 0 ? 'active' : ''} />
        </div>
        {step === 0 ? (
          <div className="onboarding-step page-enter">
            <p className="section-kicker">Welcome to SavePoint</p>
            <h1>
              Your context has a state.
              <br />
              Now it has a save button.
            </h1>
            <p className="onboarding-intro">
              SavePoint records the branch, commit, changed-file metadata, and notes that make a
              development session understandable later.
            </p>
            <div className="onboarding-features">
              <OnboardingFeature
                icon={<GitCommitHorizontal size={19} />}
                title="Git-aware by default"
                body="Branch, commit, status, files, and diff stats are captured together."
              />
              <OnboardingFeature
                icon={<FileText size={19} />}
                title="Manual checkpoints are always available"
                body="Save goals, decisions, blockers, commands, and the very next action whenever you choose."
              />
              <OnboardingFeature
                icon={<EyeOff size={19} />}
                title="Private where it matters"
                body="Secret-like paths are filtered; source contents and complete diffs are never stored."
              />
            </div>
            <div className="onboarding-auto-note">
              <RotateCcw size={16} />
              <span>
                <strong>Automatic checkpoints are off until you opt in.</strong>
                Enable them per repository from Settings when you are ready.
              </span>
            </div>
            <button className="button primary onboarding-next" onClick={() => setStep(1)}>
              Get started <ArrowRight size={17} />
            </button>
          </div>
        ) : (
          <div className="onboarding-step page-enter">
            <button className="back-link" onClick={() => setStep(0)}>
              <ArrowRight size={14} /> Back
            </button>
            <p className="section-kicker">Connect a workspace</p>
            <h1>
              Select your first
              <br />
              Git repository.
            </h1>
            <p className="onboarding-intro">
              Choose a local folder. SavePoint validates the repository and reads only the metadata
              needed for checkpoints.
            </p>
            <button className="repo-picker" onClick={onSelect} disabled={busy}>
              <span className="picker-icon">
                {busy ? <LoaderCircle className="spin" size={24} /> : <FolderGit2 size={24} />}
              </span>
              <span>
                <strong>{busy ? 'Reading repository…' : 'Choose Git repository'}</strong>
                <small>Uses your system folder picker</small>
              </span>
              <ArrowRight size={18} />
            </button>
            {error && (
              <div className="picker-error" role="alert">
                <AlertCircle size={16} />
                <span>{error}</span>
              </div>
            )}
            <div className="onboarding-checks">
              <span>
                <Check size={14} /> Validates <code>.git</code>
              </span>
              <span>
                <Check size={14} /> Honors ignored files
              </span>
              <span>
                <Check size={14} /> Never uploads
              </span>
            </div>
            {demoMode && (
              <p className="demo-note">
                <Info size={14} /> Browser demo: the picker returns a fictional repository.
              </p>
            )}
          </div>
        )}
        <footer className="onboarding-footer">
          <span>v0.1.0</span>
          <span>MIT licensed</span>
          <span>Built for interruption-prone work</span>
        </footer>
      </section>
    </main>
  )
}

function DialogShell({
  title,
  description,
  onClose,
  size = 'default',
  children
}: {
  title: string
  description: string
  onClose: () => void
  size?: 'default' | 'large'
  children: ReactNode
}): React.JSX.Element {
  useFocusRestoration()
  return (
    <div
      className="dialog-backdrop"
      role="presentation"
      onMouseDown={(event) => {
        if (event.currentTarget === event.target) onClose()
      }}
    >
      <section
        className={`dialog-card ${size}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby="dialog-title"
        onKeyDown={(event) => handleModalKeyDown(event, onClose)}
      >
        <header className="dialog-header">
          <div>
            <h2 id="dialog-title">{title}</h2>
            <p>{description}</p>
          </div>
          <button className="icon-button" onClick={onClose} aria-label={`Close ${title}`}>
            <X size={19} />
          </button>
        </header>
        {children}
      </section>
    </div>
  )
}

function ConfirmDialog({
  title,
  body,
  confirmLabel,
  onCancel,
  onConfirm,
  busy
}: {
  title: string
  body: string
  confirmLabel: string
  onCancel: () => void
  onConfirm: () => void
  busy: boolean
}): React.JSX.Element {
  useFocusRestoration()
  const cancelButtonRef = useRef<HTMLButtonElement>(null)
  useEffect(() => cancelButtonRef.current?.focus(), [])
  return (
    <div className="dialog-backdrop nested">
      <section
        className="confirm-card"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="confirm-title"
        aria-describedby="confirm-body"
        onKeyDown={(event) => handleModalKeyDown(event, onCancel)}
      >
        <div className="danger-icon">
          <Trash2 size={21} />
        </div>
        <h2 id="confirm-title">{title}</h2>
        <p id="confirm-body">{body}</p>
        <div>
          <button ref={cancelButtonRef} className="button secondary" onClick={onCancel}>
            Cancel
          </button>
          <button className="button danger" onClick={onConfirm} disabled={busy}>
            {busy && <LoaderCircle size={15} className="spin" />}
            {confirmLabel}
          </button>
        </div>
      </section>
    </div>
  )
}

function DetailSection({
  icon,
  label,
  accent,
  warning,
  children
}: {
  icon: ReactNode
  label: string
  accent?: boolean
  warning?: boolean
  children: ReactNode
}): React.JSX.Element {
  return (
    <section className={`detail-section ${accent ? 'accent' : ''} ${warning ? 'warning' : ''}`}>
      <div className="detail-section-heading">
        <span>
          {icon}
          {label}
        </span>
      </div>
      {children}
    </section>
  )
}

function FileRow({ file }: { file: ChangedFile }): React.JSX.Element {
  return (
    <div className="file-row">
      <span className={`file-status ${file.status}`}>
        {file.status === 'modified'
          ? 'M'
          : file.status === 'added'
            ? 'A'
            : file.status === 'deleted'
              ? 'D'
              : file.status === 'renamed'
                ? 'R'
                : '?'}
      </span>
      <FileCode2 size={14} />
      <span className="file-path">{file.path}</span>
      {file.staged && <span className="staged-label">staged</span>}
      <span className="file-numbers">
        <b>+{file.insertions ?? 0}</b>
        <b>−{file.deletions ?? 0}</b>
      </span>
      <span className="sr-only">{fileStatusLabel(file)}</span>
    </div>
  )
}

function SelectField({
  label,
  value,
  onChange,
  children
}: {
  label: string
  value: string
  onChange: (value: string) => void
  children: ReactNode
}): React.JSX.Element {
  return (
    <label className="select-field">
      <span>{label}</span>
      <div>
        <select value={value} onChange={(event) => onChange(event.target.value)}>
          {children}
        </select>
        <ChevronDown size={14} />
      </div>
    </label>
  )
}

function CheckpointSelect({
  label,
  value,
  checkpoints,
  onChange
}: {
  label: string
  value: string
  checkpoints: Checkpoint[]
  onChange: (value: string) => void
}): React.JSX.Element {
  const selected = checkpoints.find((item) => item.id === value)
  return (
    <label className="checkpoint-select">
      <span>{label}</span>
      <div className="checkpoint-select-box">
        <Flag size={17} />
        <select value={value} onChange={(event) => onChange(event.target.value)}>
          {checkpoints.map((item) => (
            <option key={item.id} value={item.id}>
              {item.title}
            </option>
          ))}
        </select>
        <ChevronDown size={15} />
      </div>
      {selected && (
        <small>
          {fullDate(selected.createdAt)} · {selected.shortCommitHash}
        </small>
      )}
    </label>
  )
}

function ContextDiff({
  label,
  before,
  after
}: {
  label: string
  before: string
  after: string
}): React.JSX.Element {
  const changed = before !== after
  return (
    <div className={`context-diff ${changed ? 'changed' : ''}`}>
      <div>
        <span>{label}</span>
        {changed && <small>Changed</small>}
      </div>
      <div className="diff-copy">
        <p className="before">{before || 'None recorded'}</p>
        <ArrowRight size={14} />
        <p className="after">{after || 'None recorded'}</p>
      </div>
    </div>
  )
}

function FileGroup({
  title,
  tone,
  files
}: {
  title: string
  tone: string
  files: ChangedFile[]
}): React.JSX.Element {
  if (!files.length)
    return (
      <div className="empty-file-group">
        <Check size={14} /> No files {title.toLowerCase()}
      </div>
    )
  return (
    <div className="file-group">
      <h3>
        <i className={tone} />
        {title}
        <span>{files.length}</span>
      </h3>
      {files.slice(0, 5).map((file) => (
        <div key={file.path}>
          <FileCode2 size={13} />
          <span>{file.path}</span>
        </div>
      ))}
    </div>
  )
}

function StatusTransitionGroup({
  changes
}: {
  changes: Array<{ before: ChangedFile; after: ChangedFile }>
}): React.JSX.Element {
  if (!changes.length) {
    return (
      <div className="empty-file-group">
        <Check size={14} /> No files changed status in both checkpoints
      </div>
    )
  }
  return (
    <div className="status-transition-group">
      <h3>
        <i /> Status transitions <span>{changes.length}</span>
      </h3>
      {changes.slice(0, 5).map(({ before, after }) => (
        <div className="status-transition-row" key={after.path}>
          <span className="transition-path">
            <FileCode2 size={13} />
            <code>{after.path}</code>
          </span>
          <span className="transition-values">
            <b className={before.status}>{fileStatusLabel(before)}</b>
            <small>{before.staged ? 'staged' : 'unstaged'}</small>
            <ArrowRight size={12} />
            <b className={after.status}>{fileStatusLabel(after)}</b>
            <small>{after.staged ? 'staged' : 'unstaged'}</small>
          </span>
        </div>
      ))}
    </div>
  )
}

function Shortcut({ label, keys }: { label: string; keys: string[] }): React.JSX.Element {
  return (
    <div>
      <span>{label}</span>
      <span>
        {keys.map((key) => (
          <kbd key={key}>{key}</kbd>
        ))}
      </span>
    </div>
  )
}

function OnboardingFeature({
  icon,
  title,
  body
}: {
  icon: ReactNode
  title: string
  body: string
}): React.JSX.Element {
  return (
    <div>
      <span>{icon}</span>
      <div>
        <strong>{title}</strong>
        <p>{body}</p>
      </div>
    </div>
  )
}

function EmptyState({
  icon,
  title,
  body,
  action
}: {
  icon: ReactNode
  title: string
  body: string
  action?: ReactNode
}): React.JSX.Element {
  return (
    <div className="empty-state">
      <span>{icon}</span>
      <h2>{title}</h2>
      <p>{body}</p>
      {action}
    </div>
  )
}

function compareCheckpoints(
  base: Checkpoint,
  target: Checkpoint
): {
  added: ChangedFile[]
  removed: ChangedFile[]
  changed: Array<{ before: ChangedFile; after: ChangedFile }>
  unchanged: ChangedFile[]
} {
  const baseMap = new Map(base.files.map((file) => [file.path, file]))
  const targetMap = new Map(target.files.map((file) => [file.path, file]))
  return {
    added: target.files.filter((file) => !baseMap.has(file.path)),
    removed: base.files.filter((file) => !targetMap.has(file.path)),
    changed: target.files.flatMap((file) => {
      const before = baseMap.get(file.path)
      return before &&
        (before.status !== file.status ||
          before.staged !== file.staged ||
          before.insertions !== file.insertions ||
          before.deletions !== file.deletions)
        ? [{ before, after: file }]
        : []
    }),
    unchanged: target.files.filter((file) => {
      const before = baseMap.get(file.path)
      return (
        before &&
        before.status === file.status &&
        before.staged === file.staged &&
        before.insertions === file.insertions &&
        before.deletions === file.deletions
      )
    })
  }
}

function sumChanges(repository: Repository): number {
  return (
    repository.counts.modified +
    repository.counts.added +
    repository.counts.deleted +
    repository.counts.renamed +
    repository.counts.untracked
  )
}

const FOCUSABLE_SELECTOR = [
  'button:not([disabled])',
  'a[href]',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])'
].join(',')

function useFocusRestoration(): void {
  const restoreTargetRef = useRef<HTMLElement | null | undefined>(undefined)
  if (restoreTargetRef.current === undefined) {
    restoreTargetRef.current =
      document.activeElement instanceof HTMLElement ? document.activeElement : null
  }
  useEffect(
    () => () => {
      const target = restoreTargetRef.current
      if (target?.isConnected) target.focus()
    },
    []
  )
}

function handleModalKeyDown(event: ReactKeyboardEvent<HTMLElement>, onEscape: () => void): void {
  if (event.key === 'Escape') {
    event.preventDefault()
    event.stopPropagation()
    onEscape()
    return
  }
  if (event.key !== 'Tab') return

  const focusable = [
    ...event.currentTarget.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)
  ].filter(
    (element) => element.offsetParent !== null && element.getAttribute('aria-hidden') !== 'true'
  )
  if (!focusable.length) {
    event.preventDefault()
    return
  }
  const first = focusable[0]
  const last = focusable.at(-1) as HTMLElement
  if (event.shiftKey && document.activeElement === first) {
    event.preventDefault()
    last.focus()
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault()
    first.focus()
  }
}

function normalizeError(error: unknown): string {
  return error instanceof Error ? error.message : 'Something went wrong. Please try again.'
}

function isFormControl(target: EventTarget | null): boolean {
  return (
    target instanceof HTMLInputElement ||
    target instanceof HTMLTextAreaElement ||
    target instanceof HTMLSelectElement
  )
}

function csv(value: string): string[] {
  return value
    .split(',')
    .map((item) => item.trim().replace(/^#/, ''))
    .filter(Boolean)
}
function lines(value: string): string[] {
  return value
    .split('\n')
    .map((item) => item.trim())
    .filter(Boolean)
}
function formatDuration(from: string, to: string): string {
  const hours = Math.abs(new Date(to).getTime() - new Date(from).getTime()) / 3_600_000
  return hours < 24
    ? `${hours.toFixed(hours < 10 ? 1 : 0)} hours`
    : `${Math.round(hours / 24)} days`
}
async function safeOpenExternal(
  api: SavePointRendererApi,
  url: string,
  onToast: (message: string) => void
): Promise<void> {
  if (!/^https:\/\//i.test(url)) {
    onToast('Only credential-free HTTPS links can be opened')
    return
  }
  await api.openExternal(url)
}

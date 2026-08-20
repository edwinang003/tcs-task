/**
 * The task editor, as a bottom sheet.
 *
 * Auto-saves: title and notes on blur and on a 500ms pause, due date and
 * priority the moment they are picked. "Done" only closes. SPEC §3 principle 1
 * — the UI never waits — and it is affordable because SPEC §9.1 coalesces the
 * outbox per row and dirty column set, so a debounced notes field is one entry
 * rather than thirty.
 *
 * It deliberately does not use `useLiveQuery`: a live value would fight the
 * cursor mid-word, and P0b has no second writer.
 */
import { useEffect, useRef, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import {
  getTask,
  renameTask,
  setTaskNotes,
  setTaskDue,
  setTaskPriority,
  deleteTask,
  listProjects,
  listSections,
  setTaskProject,
  setTaskSection,
} from '../lib/repo'
import { orderSections } from '../lib/grouping'
import { pushUndo, type UndoStep } from '../lib/undo'
import { Checklist } from './Checklist'

const PAUSE_MS = 500

/** The fields that commit on their own schedule, each with its own timer. */
type Field = 'title' | 'notes' | 'due' | 'priority' | 'project' | 'section'

const PRIORITIES: { value: 0 | 1 | 2 | 3; label: string }[] = [
  { value: 0, label: 'None' },
  { value: 1, label: 'Low' },
  { value: 2, label: 'High' },
  { value: 3, label: 'Urgent' },
]

interface Draft {
  title: string
  notes: string
  dueOn: string
  dueTime: string
  priority: 0 | 1 | 2 | 3
  projectId: string
  sectionId: string
}

export function TaskSheet({
  taskId,
  onClose,
}: {
  taskId: string
  onClose: () => void
}) {
  const [draft, setDraft] = useState<Draft | null>(null)
  // One timer per field, not one for the sheet. A single timer meant that
  // committing any field cancelled another field's pending edit — type into
  // Notes, tap a priority within the pause, and on a browser that does not
  // blur a textarea when a button is tapped (iOS Safari) the notes were
  // silently dropped while the sheet still displayed them.
  const timers = useRef(new Map<Field, ReturnType<typeof setTimeout>>())

  useEffect(() => {
    let live = true
    void getTask(taskId).then((task) => {
      if (!live || task === undefined) return
      setDraft({
        title: task.title,
        notes: task.notes ?? '',
        dueOn: task.due_on ?? '',
        dueTime: task.due_time ?? '',
        priority: task.priority,
        projectId: task.project_id,
        sectionId: task.section_id,
      })
    })
    return () => {
      live = false
    }
  }, [taskId])

  const projects = useLiveQuery(() => listProjects(), [])
  const sections = useLiveQuery(
    () => (draft === null ? Promise.resolve([]) : listSections(draft.projectId)),
    [draft?.projectId],
  )

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [onClose])

  /**
   * The timer is deliberately not cleared on unmount: an edit typed a moment
   * before closing the sheet still has to land. `write()` refuses a tombstone,
   * so one that lands after Delete is a no-op rather than a step over the
   * delete's own.
   */
  function commitLater(field: Field, run: () => Promise<UndoStep | null>) {
    clearTimeout(timers.current.get(field))
    timers.current.set(
      field,
      setTimeout(() => void run().then(pushUndo), PAUSE_MS),
    )
  }

  /** Only this field's pending edit is superseded; the others still land. */
  function commitNow(field: Field, run: () => Promise<UndoStep | null>) {
    clearTimeout(timers.current.get(field))
    timers.current.delete(field)
    void run().then(pushUndo)
  }

  function due(dueOn: string, dueTime: string) {
    // Mirrors `setTaskDue`: clearing the date clears the time with it. Without
    // this the row would hold no time while the sheet still displayed one.
    const time = dueOn === '' ? '' : dueTime
    setDraft((d) => (d === null ? d : { ...d, dueOn, dueTime: time }))
    commitNow('due', () => setTaskDue(taskId, dueOn || null, time || null))
  }

  return (
    <div className="fixed inset-0 z-30 flex flex-col justify-end">
      <button
        type="button"
        aria-label="Close"
        onClick={onClose}
        className="absolute inset-0 bg-black/30"
      />
      <div
        role="dialog"
        aria-label="Task"
        className="relative max-h-[85%] overflow-y-auto rounded-t-2xl bg-white px-4 pt-3 shadow-2xl dark:bg-ink sm:mx-auto sm:mb-8 sm:w-full sm:max-w-lg sm:rounded-2xl"
        style={{ paddingBottom: 'max(1rem, env(safe-area-inset-bottom))' }}
      >
        <div className="mx-auto mb-3 h-1 w-10 rounded-full bg-black/15 dark:bg-white/20" />

        {draft === null ? (
          <div className="min-h-64" />
        ) : (
          <>
            {/* Deliberately not autoFocused. At 390x844 the panel starts at
                y=434 and an Android keyboard's top edge lands near y=464, so
                focusing the title on open buries the whole sheet behind the
                keyboard — when the gesture was usually "open this to look at
                it". The title is one tap away. */}
            <input
              value={draft.title}
              onChange={(e) => {
                const title = e.target.value
                setDraft({ ...draft, title })
                commitLater('title', () => renameTask(taskId, title))
              }}
              onBlur={() => commitNow('title', () => renameTask(taskId, draft.title))}
              aria-label="Title"
              className="min-h-11 w-full bg-transparent text-lg font-medium text-neutral-900 outline-none dark:text-neutral-100"
            />

            <label className="mt-2 block text-xs font-medium text-neutral-500 dark:text-neutral-400">
              Notes
              <textarea
                value={draft.notes}
                rows={4}
                placeholder="Plain text — links become links"
                onChange={(e) => {
                  const notes = e.target.value
                  setDraft({ ...draft, notes })
                  commitLater('notes', () => setTaskNotes(taskId, notes))
                }}
                onBlur={() => commitNow('notes', () => setTaskNotes(taskId, draft.notes))}
                className="mt-1 w-full resize-y rounded-xl border border-black/10 bg-white p-3 text-[15px] font-normal text-neutral-900 outline-none focus:border-accent dark:border-white/15 dark:bg-white/5 dark:text-neutral-100"
              />
            </label>

            {/* Below Notes and above Due on purpose: notes and a checklist are
                both "what this task actually involves", while due date,
                priority, project and section are all "where and when it sits". */}
            <Checklist taskId={taskId} />

            <div className="mt-4 flex items-center gap-2">
              <span className="w-16 shrink-0 text-xs font-medium text-neutral-500 dark:text-neutral-400">
                Due
              </span>
              <input
                type="date"
                value={draft.dueOn}
                aria-label="Due date"
                onChange={(e) => due(e.target.value, draft.dueTime)}
                className="min-h-11 flex-1 rounded-xl border border-black/10 bg-white px-3 text-[15px] text-neutral-900 outline-none focus:border-accent dark:border-white/15 dark:bg-white/5 dark:text-neutral-100"
              />
              <input
                type="time"
                value={draft.dueTime}
                aria-label="Due time"
                disabled={draft.dueOn === ''}
                onChange={(e) => due(draft.dueOn, e.target.value)}
                className="min-h-11 w-28 rounded-xl border border-black/10 bg-white px-3 text-[15px] text-neutral-900 outline-none focus:border-accent disabled:opacity-40 dark:border-white/15 dark:bg-white/5 dark:text-neutral-100"
              />
            </div>

            <div className="mt-3 flex items-center gap-2">
              <span className="w-16 shrink-0 text-xs font-medium text-neutral-500 dark:text-neutral-400">
                Priority
              </span>
              {PRIORITIES.map((p) => (
                <button
                  key={p.value}
                  type="button"
                  aria-pressed={draft.priority === p.value}
                  onClick={() => {
                    setDraft({ ...draft, priority: p.value })
                    commitNow('priority', () => setTaskPriority(taskId, p.value))
                  }}
                  className={
                    'min-h-11 flex-1 rounded-xl border text-sm ' +
                    (draft.priority === p.value
                      ? 'border-accent bg-accent/10 font-medium text-neutral-900 dark:text-neutral-100'
                      : 'border-black/10 text-neutral-500 dark:border-white/15 dark:text-neutral-400')
                  }
                >
                  {p.label}
                </button>
              ))}
            </div>

            <div className="mt-3 flex items-center gap-2">
              <span className="w-16 shrink-0 text-xs font-medium text-neutral-500 dark:text-neutral-400">
                Project
              </span>
              <select
                value={draft.projectId}
                aria-label="Project"
                onChange={(e) => {
                  const projectId = e.target.value
                  // The section is not carried across: `setTaskProject` lands
                  // the task in the new project's own first open section, and
                  // the draft has to agree with the row it just wrote. Until
                  // that write resolves, `sectionId` is '' — a value no
                  // <option> has, because the Section select below renders a
                  // matching disabled placeholder rather than let the browser
                  // snap to some option that does not describe where the task
                  // actually is.
                  setDraft({ ...draft, projectId, sectionId: '' })
                  commitNow('project', async () => {
                    const step = await setTaskProject(taskId, projectId)
                    const moved = await getTask(taskId)
                    if (moved !== undefined) {
                      setDraft((d) =>
                        d === null ? d : { ...d, sectionId: moved.section_id },
                      )
                    }
                    return step
                  })
                }}
                className="min-h-11 flex-1 rounded-xl border border-black/10 bg-white px-3 text-[15px] text-neutral-900 outline-none focus:border-accent dark:border-white/15 dark:bg-white/5 dark:text-neutral-100"
              >
                {(projects ?? []).map((project) => (
                  <option key={project.id} value={project.id}>
                    {project.name}
                  </option>
                ))}
              </select>
            </div>

            <div className="mt-3 flex items-center gap-2">
              <span className="w-16 shrink-0 text-xs font-medium text-neutral-500 dark:text-neutral-400">
                Section
              </span>
              <select
                value={draft.sectionId}
                aria-label="Section"
                disabled={draft.sectionId === ''}
                onChange={(e) => {
                  const sectionId = e.target.value
                  setDraft({ ...draft, sectionId })
                  // SPEC §4's binding, reached without a drag: choosing Done
                  // here completes the task, exactly as dragging it there
                  // would.
                  commitNow('section', () => setTaskSection(taskId, sectionId))
                }}
                className="min-h-11 flex-1 rounded-xl border border-black/10 bg-white px-3 text-[15px] text-neutral-900 outline-none focus:border-accent disabled:opacity-40 dark:border-white/15 dark:bg-white/5 dark:text-neutral-100"
              >
                {draft.sectionId === '' ? (
                  // The project move is still in flight: no option describes
                  // this task's section yet, so offer only a placeholder that
                  // matches the draft's transient '' rather than let the
                  // browser fall back to selecting whatever option is first.
                  <option value="" />
                ) : (
                  orderSections(sections ?? []).map((section) => (
                    <option key={section.id} value={section.id}>
                      {section.name}
                    </option>
                  ))
                )}
              </select>
            </div>

            <div className="mt-6 flex items-center justify-between">
              <button
                type="button"
                onClick={() => {
                  void deleteTask(taskId).then(pushUndo)
                  onClose()
                }}
                className="min-h-11 rounded-xl px-3 text-sm text-red-600 dark:text-red-400"
              >
                Delete
              </button>
              <button
                type="button"
                onClick={onClose}
                className="min-h-11 rounded-xl bg-accent px-5 font-medium text-ink"
              >
                Done
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}

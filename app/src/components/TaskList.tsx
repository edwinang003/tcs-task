/**
 * A project, as a list or as a board.
 *
 * SPEC §5: "list ⇄ board is a rendering choice, not a data choice. In list
 * view, sections are collapsible headers with tasks beneath. In board view,
 * the same sections are columns and the same tasks are cards." One component
 * makes that structurally true rather than merely intended — there is one
 * `onDrop`, one `describe`, and one place the undo-toast rule lives.
 *
 * SPEC §4: completing a task moves it into the project's done section, so the
 * row genuinely leaves the group you were looking at. In the list that section
 * is collapsed by default and is the only one that collapses; on the board it
 * is an ordinary column, which is where the gesture reads best — dragging a
 * card into Done completes it.
 */
import { useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import {
  listTasks, listSections, addSection, dropTaskAt,
} from '../lib/repo'
import { groupBySection } from '../lib/grouping'
import { resolveDrop } from '../lib/drag'
import { pushUndo } from '../lib/undo'
import { SectionHeader } from './SectionHeader'
import { TaskRow } from './TaskRow'
import { DragArea, DragGroup, DragItem } from './DraggableList'
import type { ViewMode } from '../lib/view'
import { useProgress } from '../lib/useProgress'
import { useLabels } from '../lib/useLabels'

export function TaskList({
  projectId,
  view,
  onOpen,
}: {
  projectId: string
  view: ViewMode
  onOpen: (id: string) => void
}) {
  const tasks = useLiveQuery(() => listTasks(projectId), [projectId])
  const sections = useLiveQuery(() => listSections(projectId), [projectId])
  const progress = useProgress()
  const labels = useLabels().byTask
  const [doneOpen, setDoneOpen] = useState(false)
  const [adding, setAdding] = useState('')
  const [dragging, setDragging] = useState<string | null>(null)

  if (tasks === undefined || sections === undefined) {
    // First read from IndexedDB. Deliberately blank rather than a spinner —
    // it resolves in a frame or two and a flash of spinner reads as slow.
    return <div className="min-h-32" />
  }

  const groups = groupBySection(sections, tasks)
  const openSections = sections.filter((s) => !s.is_done_section).length

  const board = view === 'board'
  // Whether the done section is somewhere you can still see. On the board it
  // always is; in the list it is behind a collapsed header unless you opened
  // it. Two things follow from it, and both are the same rule `Toast.tsx`
  // already follows: an undo toast means the row left the screen.
  const showsDone = board || doneOpen

  /**
   * One column, wide enough to dominate a phone and to fit four on a laptop —
   * but not the full width. The sliver of the next column showing past the
   * right edge is what makes a card draggable into it without waiting on
   * autoscroll to reveal a target you cannot see.
   *
   * The tinted surface is what makes three columns read as a board rather than
   * three lists that happen to sit side by side.
   */
  const column =
    'w-[78vw] shrink-0 snap-start rounded-2xl bg-black/[0.03] px-1 pb-2 lg:w-72 dark:bg-white/[0.04]'

  const onDrop = (activeId: string, overId: string | null) => {
    setDragging(null)
    const target = resolveDrop(groups, activeId, overId)
    if (target === null) return

    // A toast only when the row left the screen — the rule `Toast.tsx`
    // already follows. Dropping into a collapsed Done both hides the task and
    // completes it; a reorder you can still see needs no offer, and on a board
    // the Done column is right there.
    const done = sections.find((s) => s.is_done_section)
    const vanished = target.sectionId === done?.id && !showsDone

    void dropTaskAt(activeId, target.sectionId, target.beforeId, {
      toast: vanished,
    }).then(pushUndo)
  }

  /** How a task or a section is named out loud during a drag. */
  const describe = (id: string): string => {
    const section = sections.find((s) => s.id === id)
    if (section !== undefined) {
      return section.is_done_section
        ? `${section.name}, which completes the task`
        : section.name
    }
    return tasks.find((t) => t.id === id)?.title ?? 'the task'
  }

  async function addNewSection(e: React.FormEvent) {
    e.preventDefault()
    const name = adding.trim()
    if (!name) return
    setAdding('')
    pushUndo((await addSection(projectId, name)).undo)
  }

  const draggedTask = tasks.find((t) => t.id === dragging)

  // Defined once and placed in one of two slots: below the list, or as the
  // last column of the board.
  const sectionForm = (
    <form onSubmit={addNewSection} className={board ? undefined : 'mt-4'}>
      <input
        value={adding}
        onChange={(e) => setAdding(e.target.value)}
        placeholder="+ Section"
        aria-label="New section"
        enterKeyHint="done"
        className="min-h-11 w-full rounded-xl bg-transparent px-2 text-sm text-neutral-900 outline-none placeholder:text-neutral-400 dark:text-neutral-100 dark:placeholder:text-neutral-500"
      />
    </form>
  )

  return (
    <div className={board ? 'px-3 py-2' : 'mx-auto max-w-2xl px-3 py-2'}>
      <DragArea
        onStart={setDragging}
        onDrop={onDrop}
        describe={describe}
        vertical={!board}
        overlay={
          draggedTask === undefined ? null : (
            <div className="rounded-xl bg-white px-3 py-2 shadow-lg dark:bg-neutral-800">
              <span className="text-neutral-900 dark:text-neutral-100">
                {draggedTask.title}
              </span>
            </div>
          )
        }
      >
      {/* One column fills a phone and you swipe between them; four fit a
          laptop. The snap is what stops a swipe leaving you between two. */}
      <div
        className={
          board
            ? 'flex items-start gap-3 overflow-x-auto ' +
              // Snap is a swiping affordance, and mid-drag it fights the drag:
              // a mandatory snap refuses the intermediate scroll positions
              // dnd-kit's autoscroll moves through, quantising a slow scroll
              // into a jump to the far end — so every drop landed in the last
              // column. It comes off while a card is in the air.
              (dragging === null ? 'snap-x snap-mandatory' : '')
            : undefined
        }
      >
      {groups.map((group) => {
        const isDone = group.section.is_done_section
        // Only the list collapses Done. A column costs no vertical space, and
        // a drop that completes a task has to have somewhere to land.
        const collapsed = board ? null : isDone ? !doneOpen : null
        return (
          <section key={group.section.id} className={board ? column : undefined}>
            <DragGroup
              id={group.section.id}
              itemIds={collapsed === true ? [] : group.tasks.map((t) => t.id)}
              minHeight={board}
            >
            <SectionHeader
              section={group.section}
              count={group.tasks.length}
              collapsed={collapsed}
              onToggle={() => setDoneOpen((open) => !open)}
              // SPEC §4.4: the done section is never deletable, and neither is
              // the last open one.
              deletable={!isDone && openSections > 1}
            />
            {collapsed !== true && (
              <ul>
                {group.tasks.map((task) => (
                  <DragItem key={task.id} id={task.id}>
                    {(handle) => (
                      <TaskRow
                        task={task}
                        onOpen={onOpen}
                        handle={handle}
                        hidesOnComplete={!showsDone}
                        progress={progress.get(task.id)}
                        labels={labels.get(task.id)}
                      />
                    )}
                  </DragItem>
                ))}
              </ul>
            )}
            </DragGroup>
          </section>
        )
      })}
      {board && <div className={column}>{sectionForm}</div>}
      </div>
      </DragArea>

      {!board && sectionForm}
    </div>
  )
}

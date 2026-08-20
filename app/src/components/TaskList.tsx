/**
 * The list, divided by section.
 *
 * SPEC §4: completing a task moves it into the project's done section, so the
 * row genuinely leaves the group you were looking at. The done section is
 * collapsed by default and is the only one that collapses — a project you have
 * used for a month is mostly history, and the completed log is P2's job.
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

export function TaskList({
  projectId,
  onOpen,
}: {
  projectId: string
  onOpen: (id: string) => void
}) {
  const tasks = useLiveQuery(() => listTasks(projectId), [projectId])
  const sections = useLiveQuery(() => listSections(projectId), [projectId])
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

  const onDrop = (activeId: string, overId: string | null) => {
    setDragging(null)
    const target = resolveDrop(groups, activeId, overId)
    if (target === null) return

    // A toast only when the row left the screen — the rule `Toast.tsx`
    // already follows. Dropping into a collapsed Done both hides the task and
    // completes it; a reorder you can still see needs no offer.
    const done = sections.find((s) => s.is_done_section)
    const vanished = target.sectionId === done?.id && !doneOpen

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

  return (
    <div className="mx-auto max-w-2xl px-3 py-2">
      <DragArea
        onStart={setDragging}
        onDrop={onDrop}
        describe={describe}
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
      {groups.map((group) => {
        const isDone = group.section.is_done_section
        const collapsed = isDone ? !doneOpen : null
        return (
          <section key={group.section.id}>
            <DragGroup
              id={group.section.id}
              itemIds={collapsed === true ? [] : group.tasks.map((t) => t.id)}
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
                      <TaskRow task={task} onOpen={onOpen} handle={handle} />
                    )}
                  </DragItem>
                ))}
              </ul>
            )}
            </DragGroup>
          </section>
        )
      })}
      </DragArea>

      <form onSubmit={addNewSection} className="mt-4">
        <input
          value={adding}
          onChange={(e) => setAdding(e.target.value)}
          placeholder="+ Section"
          aria-label="New section"
          enterKeyHint="done"
          className="min-h-11 w-full rounded-xl bg-transparent px-2 text-sm text-neutral-900 outline-none placeholder:text-neutral-400 dark:text-neutral-100 dark:placeholder:text-neutral-500"
        />
      </form>
    </div>
  )
}

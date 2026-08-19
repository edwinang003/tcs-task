/**
 * SPIKE (touch drag) — throwaway, and the only file that imports `dnd-kit`.
 *
 * SPEC §11.3 rule 1: a risky dependency is imported in exactly one file, and
 * this is `dnd-kit`'s. Rule 2 names it as something *not* to hand-roll: touch
 * drag is hard, not verbose. The seam is three components rather than one
 * `<DraggableList>` because the list is grouped — a task can be dropped into
 * another section, which is the interesting half of the question.
 *
 * What this spike exists to answer (SPEC §13, §14 item 5): is dragging a task
 * with a thumb on a narrow screen good enough to build the board view on?
 * The setting that decides it is `activationConstraint` below.
 */
import { type ReactNode } from 'react'
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  TouchSensor,
  useDroppable,
  useSensor,
  useSensors,
  closestCenter,
  type DragEndEvent,
  type DragStartEvent,
} from '@dnd-kit/core'
import { restrictToVerticalAxis } from '@dnd-kit/modifiers'
import {
  SortableContext,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'

export function DragArea({
  onStart,
  onDrop,
  overlay,
  children,
}: {
  onStart: (id: string) => void
  /** `over` is a task id or a section id — the caller knows which. */
  onDrop: (activeId: string, overId: string | null) => void
  overlay: ReactNode
  children: ReactNode
}) {
  const sensors = useSensors(
    // A phone has one pointer and it is already used for scrolling, so a drag
    // has to be distinguishable from a swipe: press and hold, then move. 200ms
    // is the number this spike is really testing — too short and the list
    // fights the thumb, too long and dragging feels stuck.
    useSensor(TouchSensor, {
      activationConstraint: { delay: 200, tolerance: 8 },
    }),
    // A mouse has no such ambiguity: a few pixels of travel is enough.
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
  )

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCenter}
      modifiers={[restrictToVerticalAxis]}
      onDragStart={(event: DragStartEvent) => onStart(String(event.active.id))}
      onDragCancel={() => onDrop('', null)}
      onDragEnd={(event: DragEndEvent) =>
        onDrop(String(event.active.id), event.over ? String(event.over.id) : null)
      }
    >
      {children}
      {/* The row follows the thumb rather than the list reflowing under it,
          which is what makes a drop on a small screen feel aimed. */}
      <DragOverlay>{overlay}</DragOverlay>
    </DndContext>
  )
}

/**
 * One section. Also a droppable in its own right, so an empty section — or a
 * collapsed Done header — is still a target you can hit.
 */
export function DragGroup({
  id,
  itemIds,
  children,
}: {
  id: string
  itemIds: string[]
  children: ReactNode
}) {
  const { setNodeRef, isOver } = useDroppable({ id })
  return (
    <SortableContext items={itemIds} strategy={verticalListSortingStrategy}>
      <div
        ref={setNodeRef}
        className={
          'rounded-xl transition-colors ' +
          (isOver ? 'bg-accent/10' : 'bg-transparent')
        }
      >
        {children}
      </div>
    </SortableContext>
  )
}

/**
 * One row. The whole row is the handle: a 44px grip on a phone costs more
 * screen than it earns, and the press-and-hold above already separates a drag
 * from a tap.
 */
export function DragItem({
  id,
  children,
}: {
  id: string
  children: ReactNode
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id })

  return (
    <li
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={isDragging ? 'opacity-30' : undefined}
      {...attributes}
      {...listeners}
    >
      {children}
    </li>
  )
}

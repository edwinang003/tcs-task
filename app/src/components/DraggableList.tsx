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
    // Press-and-hold was the first attempt and Android took it: the long press
    // raises the browser's own selection menu — Copy / Share / Select all —
    // before dnd-kit sees a gesture at all. The cure is `touch-action: none`,
    // which tells the browser to keep its hands off, but on a row it would also
    // kill scrolling, and here the rows *are* the list. So the constraint moves
    // to a handle (below) and the drag can start on movement instead of time.
    useSensor(TouchSensor, { activationConstraint: { distance: 5 } }),
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
 * One row, with the grip handed to the caller rather than the whole row being
 * draggable.
 *
 * The handle carries `touch-action: none`, so the browser gives that patch of
 * screen to us and stops trying to select text or scroll from it. Everything
 * else in the row keeps its ordinary behaviour: the list still scrolls under a
 * thumb, and the title is still a tap target that opens the sheet.
 */
export function DragItem({
  id,
  children,
}: {
  id: string
  children: (handle: Record<string, unknown>) => ReactNode
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id })

  const handle = {
    ...attributes,
    ...listeners,
    style: {
      touchAction: 'none' as const,
      userSelect: 'none' as const,
      WebkitUserSelect: 'none' as const,
      // Android raises the copy/share callout on a long press even when there
      // is no selection to make.
      WebkitTouchCallout: 'none' as const,
    },
    // A long press that survives the two rules above still gets a menu on some
    // builds; there is nothing on this row worth right-clicking anyway.
    onContextMenu: (event: { preventDefault: () => void }) => event.preventDefault(),
  }

  return (
    <li
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={isDragging ? 'opacity-30' : undefined}
    >
      {children(handle)}
    </li>
  )
}

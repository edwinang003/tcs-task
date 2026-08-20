/**
 * The drag seam — the only file in the app that imports `dnd-kit`.
 *
 * SPEC §11.3 rule 1: a dependency that could churn is imported in exactly one
 * file. Rule 2 names this one among the things not to hand-roll — touch drag
 * is hard, not verbose. Three components rather than one `<DraggableList>`,
 * because the list is grouped and dropping a task into another section is half
 * the point.
 *
 * The phone decided the shape of this file. Press-and-hold does not work:
 * Android raises its own selection menu — Copy / Share / Select all — before
 * dnd-kit sees the gesture. The cure is `touch-action: none`, which would stop
 * the list scrolling if it were on a row, and on a phone the rows *are* the
 * list. So the drag starts from a grip that owns its own patch of screen, and
 * everything else on the row behaves normally.
 *
 * `verticalListSortingStrategy` stays in both views: cards still sort up and
 * down *within* a column, and a move between columns goes through the group's
 * own droppable, exactly as a move between sections does in the list.
 */
import { type ReactNode } from 'react'
import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  PointerSensor,
  TouchSensor,
  closestCenter,
  pointerWithin,
  useDroppable,
  useSensor,
  useSensors,
  type Announcements,
  type CollisionDetection,
  type DragEndEvent,
  type DragStartEvent,
} from '@dnd-kit/core'
import { restrictToVerticalAxis } from '@dnd-kit/modifiers'
import {
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'

/**
 * Hoisted so the array identity does not change on every render. A list can
 * only move a row up and down; a board's columns are side by side, so the
 * board takes the restriction off.
 */
const VERTICAL_ONLY = [restrictToVerticalAxis]
const FREE: typeof VERTICAL_ONLY = []

/**
 * Where a drop lands: the thumb first, and only then the nearest centre.
 *
 * `closestCenter` alone resolves against the *dragged card's* centre. To reach
 * a section at the bottom of the list you drag to the bottom edge and hold
 * there while it scrolls, which leaves that centre below every section — and
 * the nearest one below is always the done section, so the drop completed the
 * task instead of landing where you were pointing. A new section is always the
 * last open one, sitting directly above Done, so it was the section this hit
 * every time.
 *
 * `pointerWithin` answers the question the gesture is actually asking: what is
 * under my thumb. `closestCenter` stays as the fallback for the case it is
 * good at — a thumb between two rows mid-list, where the nearest centre is a
 * better answer than nothing.
 */
const dropTarget: CollisionDetection = (args) => {
  const under = pointerWithin(args)
  return under.length > 0 ? under : closestCenter(args)
}

export function DragArea({
  onStart,
  onDrop,
  describe,
  vertical,
  overlay,
  children,
}: {
  onStart: (id: string) => void
  /** `overId` is a task id or a section id — the caller knows which. */
  onDrop: (activeId: string, overId: string | null) => void
  /** How to name a task or a section out loud, for screen readers. */
  describe: (id: string) => string
  /** True in the list, false on the board, where columns are side by side. */
  vertical: boolean
  overlay: ReactNode
  children: ReactNode
}) {
  const sensors = useSensors(
    // With a dedicated grip there is no ambiguity to wait out, so movement
    // starts the drag rather than time. A delay here was the first attempt and
    // Android took the gesture before dnd-kit saw it.
    useSensor(TouchSensor, { activationConstraint: { distance: 5 } }),
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  )

  // dnd-kit's defaults say "Picked up draggable item" and name nothing. A drop
  // into Done also completes the task, and someone who cannot see the checkbox
  // has to be told that.
  const announcements: Announcements = {
    onDragStart: ({ active }) => `Picked up ${describe(String(active.id))}.`,
    onDragOver: ({ active, over }) =>
      over === null
        ? undefined
        : `${describe(String(active.id))} is over ${describe(String(over.id))}.`,
    onDragEnd: ({ active, over }) =>
      over === null
        ? `${describe(String(active.id))} was dropped where it started.`
        : `Dropped ${describe(String(active.id))} at ${describe(String(over.id))}.`,
    onDragCancel: ({ active }) =>
      `Cancelled. ${describe(String(active.id))} is back where it started.`,
  }

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={dropTarget}
      modifiers={vertical ? VERTICAL_ONLY : FREE}
      accessibility={{ announcements }}
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
 * One section, and a drop target in its own right — which is what makes an
 * empty section, or a collapsed Done header, something a thumb can hit.
 */
export function DragGroup({
  id,
  itemIds,
  minHeight,
  children,
}: {
  id: string
  itemIds: string[]
  /**
   * A board column with no cards in it is still a place to drop one — and
   * with nothing inside, it has no height for a thumb to aim at.
   */
  minHeight?: boolean
  children: ReactNode
}) {
  const { setNodeRef, isOver } = useDroppable({ id })
  return (
    <SortableContext items={itemIds} strategy={verticalListSortingStrategy}>
      <div
        ref={setNodeRef}
        className={
          'rounded-xl transition-colors ' +
          (minHeight === true ? 'min-h-24 ' : '') +
          (isOver ? 'bg-accent/10' : 'bg-transparent')
        }
      >
        {children}
      </div>
    </SortableContext>
  )
}

/**
 * One row, handing the caller a grip rather than making the whole row
 * draggable.
 *
 * The grip carries `touch-action: none`, so the browser gives that patch of
 * screen to us and stops trying to select text or scroll from it. The rest of
 * the row keeps its ordinary behaviour: the list still scrolls under a thumb,
 * and the title still opens the sheet.
 *
 * `attributes` go on the grip, never on the row. Spread onto the `<li>` they
 * make every task announce as a button and swallow its own content.
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
      // Android raises the copy/share callout on a long press even with no
      // selection to make.
      WebkitTouchCallout: 'none' as const,
    },
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

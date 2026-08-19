# P0b slice 4 — drag to reorder, and the drag half of the binding

**Status:** approved, not yet implemented
**Date:** 2026-08-20
**Spec references:** SPEC §4, §4.2, §4.5, §8, §11.3, §13, §14 item 5

## Why this slice exists

SPEC §13 puts one instruction ahead of the board view:

> Do the **touch drag-and-drop spike early inside P0b**, before the board view is
> built out. It's the second-riskiest thing in the plan — dragging a card across a
> narrow phone screen may simply not be good enough — and if it isn't, board view
> becomes tablet-and-desktop-only and a chunk of P0b disappears.

That spike ran on 2026-08-19 on a real Android phone, deployed over HTTPS to a
throwaway Worker. **The answer is that touch drag is good enough** — with one
condition the desktop could never have revealed.

### What the phone taught us

| Finding | Consequence for this slice |
|---|---|
| Android's long press belongs to the browser: it raised Copy / Share / Select all, and dnd-kit never saw the gesture | Press-and-hold activation is unusable. `touch-action: none` is mandatory |
| `touch-action: none` on a row would stop the list scrolling, and on a phone the rows *are* the list | **A drag handle is not optional.** The row cannot be draggable |
| A grip on the left made the thumb reach across the screen | The grip lives at the **right edge**, outermost |
| With a dedicated grip, a time-based constraint bought nothing | Activate on 5px of movement, not on a delay |
| Dropping onto the collapsed Done header moved the task *and* ticked it | §4's binding survives the drag route through the existing `moveTaskTo` |
| `dnd-kit` behind one file cost ~52 KiB precached (347 → 399 KiB) | Acceptable; SPEC §11.3 rule 1 held |

The spike also contradicted a guess written into its own first commit — that a
44px grip "costs more screen than it earns". On a phone it is the only thing
that works.

The spike branch `spike-touch-drag` is the record. It is throwaway: no tests, no
keyboard support, and it reintroduces a race this repo has already fixed once.
This slice builds the same behaviour properly.

## What ships

Reordering a task within a section, moving it to another section, and dropping
it into Done — by touch, by mouse, and by keyboard. Nothing else.

> **On the numbering.** `nav.ts`, `Drawer.tsx` and `repo/tasks.ts` each carry a
> comment saying "slice 4" adds Inbox / Today / Upcoming. That was the plan
> before the spike moved drag forward, as SPEC §13 asks. Those views are now a
> later slice; the comments stay accurate about *what* comes, not *when*, and
> an implementer should not read them as a contradiction.

## Architecture

```
touch / mouse / keyboard
   ↓
dnd-kit                       ← imported in DraggableList.tsx and nowhere else
   ↓  onDrop(activeId, overId)   ids only, no logic
resolveDrop(groups, ...)      ← pure, in lib/, unit-tested
   ↓  { sectionId, beforeId } | null
dropTaskAt(...)               ← repo, one transaction
   ↓
moveTaskTo(...)               ← §4's binding, still the only writer of those columns
   ↓
useLiveQuery re-renders
```

### `lib/drag.ts` — new, pure

```ts
export interface DropTarget {
  sectionId: string
  /** The task to land above; null means the end of the section. */
  beforeId: string | null
}

export function resolveDrop(
  groups: SectionGroup[],
  activeId: string,
  overId: string | null,
): DropTarget | null
```

Takes the `SectionGroup[]` that `grouping.ts` has already computed, so it needs
no database read and stays a pure function of what is on the screen. Returns
`null` for the drops that mean nothing: onto itself, over empty space, a
cancelled drag, an id that is not in the list.

`overId` is either a task id or a section id, because a section is a drop
target in its own right — that is what makes an empty section, and the
collapsed Done header, something a thumb can hit.

The rule worth testing is the one that is easy to get wrong: **dropping onto a
task means above it, except when the dragged task came from higher up the same
section**, where the row under the thumb has already shifted up and the drop
belongs below it.

This file exists for the same reason `grouping.ts` does. The interesting rule
deserves a test, not a DOM.

### `components/DraggableList.tsx` — promoted from the spike

The only file that imports `dnd-kit` (SPEC §11.3 rule 1), and the seam a future
board view reuses. Three components rather than one, because the list is
grouped:

- `DragArea` — sensors, collision detection, the drag overlay, and the
  announcements. Reports `(activeId, overId)` and decides nothing.
- `DragGroup` — one section: a `SortableContext` plus a droppable, so an empty
  section or a collapsed header is still a target.
- `DragItem` — one row. Hands the caller a `handle` prop rather than making the
  row draggable, and the handle carries `touch-action: none`,
  `user-select: none` and `-webkit-touch-callout: none`.

Sensors: `TouchSensor` and `PointerSensor` on a 5px distance constraint, plus
`KeyboardSensor` with `sortableKeyboardCoordinates`.

### `repo/positions.ts` — one new function

The spike derived the new key *outside* the transaction that wrote it, which is
exactly the race PR #5 fixed for `addTask` and `moveTaskTo`: two quick drops read
the same neighbours and compute the same position, and `generateKeyBetween`
throws on equal neighbours the moment anything tries to insert between them.

```ts
export async function positionBeforeIn(
  sectionId: string,
  beforeId: string | null,
  excludeId: string,
): Promise<string>
```

Called inside the caller's transaction, like `appendPositionIn`, and counting
tombstones for the same reason it does.

### `repo/tasks.ts`

`moveTaskTo` takes an optional target slot rather than a precomputed key, and
derives the position inside its existing `batch(['tasks'])`. `completed_at`,
`section_id` and `position` are still written together in exactly one function,
so the checkbox, the sheet's picker and now the drag cannot disagree.

```ts
export function dropTaskAt(
  id: string,
  sectionId: string,
  beforeId: string | null,
  options?: { toast?: boolean },
): Promise<UndoStep | null>
```

### `components/TaskList.tsx`

Renders the grip at the right edge, outermost — past the delete `×`, which is
`opacity-0 group-hover:opacity-100` and therefore desktop-only, so that edge was
free. Calls `resolveDrop`, then `dropTaskAt`. It holds no drag logic beyond
knowing whether Done is collapsed.

## Undo

Every drop returns an `UndoStep` like any other write, and undo remains an
ordinary new mutation that never rewinds the outbox (SPEC §4.5).

The toast follows the rule already written in `Toast.tsx` — an offer appears
only when the action took its result off the screen:

| Drop | Toast |
|---|---|
| Reorder within a visible section | No — Ctrl+Z still works |
| Into another open section | No — the row is still on screen |
| Into a **collapsed** Done section | Yes — the row vanished, and it was also just completed |

Whether Done is collapsed is component state, so `TaskList` passes the flag
rather than the repo guessing at what is visible.

## Accessibility

The grip is a real `<button type="button">`, focusable and in tab order. Space
or Enter picks a task up, arrows move it, Space or Enter drops it, Escape
cancels, and focus returns to the grip.

This also settles a defect the spike exposed: dnd-kit's `attributes` were spread
onto the `<li>`, so every row announced as a button and swallowed its own
content. They belong on the grip, which is a button.

Announcements are written rather than left at dnd-kit's defaults, which say
"Picked up draggable item" and nothing useful. Ours name the task and the
destination — and a drop into Done must say the task was **completed**, because
the checkbox changed and a screen reader user cannot see it.

Accepted cost: one extra tab stop per row on the Mac. That is the price of the
grip being operable without a mouse, on the device SPEC §8 calls the organizing
device.

## Testing

The existing split holds: pure logic in `lib/` tested in node, components
verified in a real browser and on the phone. SPEC §11.3 rule 2 already rejected
jsdom and `@testing-library/react`, and slices 1–3 held that line.

**`lib/drag.test.ts`** — same-section upward; same-section downward, the case
that inverts; cross-section onto a task; onto a section id, both empty and
collapsed; onto itself → `null`; over nothing → `null`; unknown id → `null`.

**`repo/tasks.test.ts`** — the key written lands strictly between its
neighbours; a drop into the done section sets `completed_at`; a drop out of it
clears it; two concurrent drops into one section get distinct keys, the same
race PR #5 pinned for `addTask`; undo restores section, position and
`completed_at` together.

**By hand, on the phone**, as the spike was: grip drags, the list still scrolls
from the row, a drop onto collapsed Done moves and ticks, and the sheet's
Section picker still works as §8's non-drag fallback.

## Out of scope

Board view — its own slice, and no longer blocked · cross-project drag onto the
drawer · dragging sections or projects themselves · multi-select drag · a
row-level "Move to…" menu, since the sheet's Section picker already satisfies
SPEC §8's fallback · the hover-only delete `×`, since the sheet has a Delete
button.

## Risks

**A phone judgement can only be made on a phone.** Everything above was decided
against a real device over HTTPS; nothing here should be re-tuned on a desktop
alone.

**dnd-kit is a new dependency** — sanctioned by SPEC §11.3 rule 2 by name, kept
behind one file by rule 1, and pinned exactly by rule 3. If it ever has to go,
the cost is one file.

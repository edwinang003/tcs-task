# P0b polish — quiet menus, and the board by default

**Date:** 2026-08-20
**Status:** approved
**Slice:** P0b polish (not a numbered scope item — three changes that came
out of using the app on the phone, after P0b's scope line closed)

---

## Why this exists

P0b's stated end condition is a judgement call: it "ends when it's genuinely
pleasant to use on one device". Every scope item has shipped, and the first
day of real phone use produced three complaints. They are not bugs. They are
the phase's own gate reporting back.

1. Every section header shouts **Rename** and **Delete** at you, in grey and
   in red, forever. On a screen of four sections that is eight words of
   chrome around maybe a dozen tasks.
2. The phone opens projects in list view. The board is better and reaching
   it costs a tap on every project, every device, one project at a time.
3. A project's Rename and Archive sit in the header, where they compete for
   a 390px line with ☰, the title, the board toggle and Install.

The three share one shape — *actions that are rarely used are always on
screen* — so they ship together.

---

## Decision 1: one `Menu`, not three popovers

The app already has a popover: `LabelHeader`'s eight-swatch colour panel,
absolutely positioned at `z-30` with its own `picking` flag. A second and
third hand-rolled one would be the third and fourth copy of open-state,
dismissal and placement.

So: a `Menu` primitive, adopted by three call sites — a section header, a
drawer project row, a drawer label row. It owns exactly four things nobody
should write twice:

- the `…` trigger and its open state
- dismissal — Escape, a pointerdown anywhere outside, and choosing an item
- focus returning to the trigger when the panel closes
- placement (decision 2)

Its children are a render prop taking `close`, so a call site decides what
its own items are and closes the panel when one is chosen. It deliberately
does not own an item *list*: the label menu's colour choice is a panel of
eight swatches, not a row of text, and an `items: {label, onClick}[]` API
would have to grow a special case for it on day one.

`MenuItem` ships alongside it for the ordinary case — one full-width,
44px-high button, so the three menus agree on their type size and padding
without agreeing through copy-paste.

### What this is not

Not a menu *library*, and not ARIA's `menu`/`menuitem` pattern with roving
tabindex and arrow-key navigation. SPEC §11.3 rule 2 — "prefer ~40 lines you
own to a package" — and a panel of two or three buttons that Tab already
walks in order gains nothing from roving focus. The panel is a
`role="group"` with an `aria-label`, the same as the colour picker it is
modelled on, and the trigger carries `aria-expanded`.

---

## Decision 2: the panel is `fixed`, and flips at the halfway line

Both drawer lists scroll — projects on `flex-1 overflow-y-auto`, labels
capped at `max-h-48`. An absolutely-positioned panel inside a scrolling
box is clipped by it, and the label list is barely two rows tall, so the
last row's menu would open into nothing. This is not a corner case; it is
most of the label list.

So the panel is `position: fixed`, placed from the trigger's rect at open
time. That escapes every clipping ancestor.

Where it goes is pure arithmetic, so it lives in `lib/menu.ts` and is unit
tested without a DOM — the same split as `view.ts` / `useView.ts`:

```ts
export function placeMenu(
  trigger: { top: number; bottom: number; right: number },
  viewport: { width: number; height: number },
): Placement
```

Two rules, both deliberately dumb:

- **Right edges align.** `right: viewport.width - trigger.right`. The
  trigger is the rightmost thing in its row at all three call sites, so a
  panel hung from its right edge cannot run off the left.
- **It opens downward from the top half of the screen and upward from the
  bottom half**, tested on `trigger.bottom` against `height / 2`. The
  alternative — render, measure, reposition — is a layout effect, a second
  paint, and a visible jump, to be exactly right about a case where
  "roughly right" is indistinguishable. A menu near the bottom of a phone
  must not open off the bottom; nothing finer than that matters.

A menu open while an ancestor scrolls would drift, so scroll and resize
close it, alongside Escape and outside-pointerdown.

---

## Decision 3: the board is the default everywhere

SPEC §8 rule 6 predicted the phone would want the list. Two weeks of P0b
say otherwise: `dnd-kit`'s touch sensor made the board genuinely usable at
390px, one column at a time, and the columns are the sections you already
think in. Open question 5 asked for exactly this and asked for it to be
answered empirically. It has been.

`resolveView` loses the width rule and its `initial` argument:

```ts
export function resolveView(stored: ViewMode | undefined): ViewMode {
  return stored ?? 'board'
}
```

`useView` loses `subscribeWidth`, `isWide` and the `WIDE` media query with
it — three functions and a subscription that now answer a question nobody
asks.

### `projects.default_view` becomes unread, and stays in the schema

The obvious-looking version of this change is `stored ?? project.default_view`,
and it would do nothing at all: every project row in the database says
`'list'`, because the column has a default and no writer anywhere in the UI.
Honouring it would make "board by default" a no-op on precisely the projects
the complaint is about.

So the app-level default wins, and the column keeps its place in the schema
with no reader until P1 gives it one. That is the column's actual meaning —
a *project's* preference, set by someone, synced to everyone — and P0b has
never had a way to set it.

### What this does not do

**It does not switch projects you have already toggled.** A stored choice
still wins, always; that is the rule the toggle exists for. Projects opened
in list view before this ships keep opening in list view until you toggle
them back. This is correct and it will still look like nothing happened —
worth knowing before wondering whether the deploy landed.

---

## Decision 4: rename and archive move to the drawer row

`Drawer.tsx` currently documents the opposite: "Project rename and archive
live in the header rather than on these rows, so the drawer stays a place
you pass through rather than a control panel." That rule is being reversed
deliberately, and the reversal is written into the file it overturns.

The rule was aimed at a real failure mode — a sidebar where every row
carries visible buttons stops being navigation. A menu that is closed by
default is not that. The row still reads as one name and still takes one
tap; the `…` is a single quiet glyph at the right edge.

And the rule's cost is now concrete. On a 390px phone the project header
carried ☰, the title, the board toggle, Rename, Archive and Install —
enough that `App.tsx`'s own comment records the board toggle being renamed
to a glyph after five words of buttons truncated a project's name to "P…".
Removing two buttons gives the title back its line.

The drawer is also simply where you already are when you want this. You
open it to go to a project; renaming or archiving one is the same reach.

### What moves where

| | Before | After |
|---|---|---|
| Project rename | header button | drawer row `…` → Rename (inline, in the row) |
| Project archive | header button | drawer row `…` → Archive |
| Label rename | label route header | drawer row `…` → Rename (inline, in the row) |
| Label recolour | label route header swatch popover | drawer row `…` → Colour → eight swatches |
| Label delete | label route header | drawer row `…` → Delete |
| Section rename | always-visible header button | section `…` → Rename (inline) |
| Section delete | always-visible header button | section `…` → Delete |

The header keeps the title, the board toggle and Install. `LabelHeader.tsx`
is deleted: with all three of its buttons gone there is nothing left of it,
and a label route's header becomes a title like any other.

### Consequences worth naming before writing them

- **Each drawer row becomes a component.** Rename stays inline — the row
  turns into an input in place — and `useInlineRename` is a hook, so it
  cannot be called inside a `.map()`. `ProjectRow` and `LabelRow` each own
  their rename session and their menu.
- **A row stops being one button.** A `…` button nested inside the
  navigating button is invalid HTML. The row becomes a `relative` flex
  container holding the nav button and the menu trigger as siblings.
- **`App.tsx` loses `useInlineRename` entirely.** Nothing renames from the
  header any more, so the shared session, the `renameable` fallback, the
  input branch and the `onDoubleClick` on the `<h1>` all go. The double-click
  is not replaced: it was undiscoverable, it does not exist on a phone, and
  the drawer now has the discoverable version.
- **The colour panel is a second face of the same menu**, not a popover
  opened from a popover. Choosing "Colour" swaps the panel's contents for
  the eight swatches. That state lives in a small component rendered as the
  menu's children, so closing the menu unmounts it and the next open starts
  at the item list again — no reset logic.
- **Archiving from the drawer already navigates correctly.** `resolveProject`
  sends a route whose project is archived to Inbox, exactly as it did from
  the header. Nothing new is needed.

---

## Architecture

**Created**

- `app/src/lib/menu.ts` — `placeMenu`, `Placement`. Pure, DOM-free.
- `app/src/lib/menu.test.ts` — placement, both directions and both edges.
- `app/src/components/Menu.tsx` — `Menu`, `MenuItem`.
- `app/src/components/ProjectRow.tsx` — one drawer project row.
- `app/src/components/LabelRow.tsx` — one drawer label row, plus its
  non-exported `LabelMenu` holding the item-list/swatch state.

**Modified**

- `app/src/components/SectionHeader.tsx` — two buttons become one `…`.
- `app/src/components/Drawer.tsx` — maps to the two new row components;
  its header comment is rewritten to state the new rule.
- `app/src/App.tsx` — header actions and the rename session removed.
- `app/src/lib/view.ts` — `resolveView` loses `wide` and `initial`.
- `app/src/lib/useView.ts` — the width subscription removed.
- `app/src/lib/view.test.ts` — the two width tests replaced.
- `docs/SPEC.md` — §8 rule 6 amended; open question 5 struck as answered.
- `app/README.md` — the layout map and the test list.

**Deleted**

- `app/src/components/LabelHeader.tsx`.

### Data flow

Nothing changes about reads or writes. `Drawer` already subscribes to
`useRoute` for `projects` and `labels`; the rows are handed a row each and
call the same `renameProject` / `archiveProject` / `renameLabel` /
`setLabelColor` / `deleteLabel` / `renameSection` / `deleteSection` they
called from the header, each still pushing its undo step (SPEC §4.5).

Nothing here touches IndexedDB reads, the outbox, or search.

---

## Testing

**Unit (Vitest, `environment: 'node'`)**

- `menu.test.ts` — right-edge alignment; downward from the top half; upward
  from the bottom half; the exact halfway boundary; a trigger flush with the
  viewport's right edge.
- `view.test.ts` — the two width-rule tests are replaced by: nothing stored
  opens a board, and a stored choice still wins in both directions. The
  storage, notification and `parseViews` blocks are untouched.

**Browser (390×844 and 1280×900, zero console errors or warnings)**

Per SPEC §11.3 rule 2 there is no jsdom and no `@testing-library/react`, so
every component change is verified on a real page:

1. A section header shows one `…`; opening it shows Rename and Delete;
   Rename turns the header into an input; Delete removes the section with
   an undo toast.
2. The Done section's menu offers Rename only — it is not deletable.
3. A drawer project row's `…` opens over the drawer, not clipped by the
   scrolling list. Rename renames in place. Archive removes the project and
   lands on Inbox.
4. The **last** label row's menu opens *upward* and is fully visible — the
   case decision 2 exists for.
5. Colour swaps the panel for eight swatches; choosing one recolours the
   dot in the drawer, and reopening the menu shows the item list again.
6. Escape closes a menu and returns focus to its `…`; a tap outside closes
   it; scrolling the project list closes it.
7. A project with no stored choice opens as a board on both widths; a
   project toggled to list stays a list across a reload.
8. The project header carries only ☰, title, board toggle and Install, and
   a long project name is no longer truncated to make room.

---

## Out of scope

- Keyboard menu navigation (arrow keys, roving tabindex, typeahead).
- Animation on open or close.
- Any menu on a task row — `TaskRow`'s hover-revealed `×` is unchanged, and
  the task sheet remains where a task's actions live.
- Giving `projects.default_view` a writer. That is a P1 concern, and giving
  it one now would mean deciding whether it syncs before the sync engine
  exists.
- Reordering projects in the drawer, or any other new drawer action. The
  menu makes them cheap to add later; adding them now is scope this slice
  did not ask for.

# P0b polish — quiet menus and a board-first default: Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Hide rarely-used row actions behind a `…` menu, and open every
project as a board unless it has been told otherwise.

**Architecture:** One new pure module (`lib/menu.ts`, where the panel goes)
and one new primitive (`components/Menu.tsx`, the trigger and its dismissal),
adopted by three call sites. The drawer's project and label rows become
components so each can own an inline rename. `resolveView` loses the width
rule. `LabelHeader.tsx` is deleted.

**Tech Stack:** React 19.2.8, TypeScript 6.0.3, Tailwind 4.3.3, Vitest 4.1.10
(`environment: 'node'`), oxlint 1.78.0.

**Spec:** `docs/superpowers/specs/2026-08-20-p0b-polish-menus-design.md`

## Global Constraints

- **All work goes on a branch and lands through a PR.** Never commit to `main`.
- **Commit messages are prose explaining *why*.** Every one ends with
  `Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>`.
- **No jsdom, no `@testing-library/react`** (SPEC §11.3 rule 2). Pure modules
  get Vitest; components are verified in a real browser at **390×844** and
  **1280×900** with **zero console errors or warnings**.
- **`npm test` does not type-check.** Vitest transpiles. `npm run build`
  (`tsc -b && vite build`) is the only gate that proves types, and
  `noUnusedLocals` / `noUnusedParameters` are both on — a leftover import
  fails the build.
- **Every write pushes an undo step** (SPEC §4.5). Never drop a `pushUndo`.
- **Nothing writes to the database except `repo/`** (SPEC §13 P0b constraint).
- Docs and comments wrap at **79 characters**.
- Run from `app/`: `npm test`, `npm run lint`, `npm run build`.

---

### Task 1: `placeMenu` — where a menu panel goes

**Files:**
- Create: `app/src/lib/menu.ts`
- Test: `app/src/lib/menu.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `placeMenu(trigger: TriggerRect, viewport: Viewport): Placement`,
  plus the three exported interfaces. `TriggerRect` is
  `{ top: number; bottom: number; right: number }`, `Viewport` is
  `{ width: number; height: number }`, `Placement` is
  `{ top?: number; bottom?: number; right: number }`. Task 2 imports
  `placeMenu` and `Placement`.

- [ ] **Step 1: Write the failing test**

Create `app/src/lib/menu.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { placeMenu } from './menu'

/** A 390×844 phone — the screen every one of these rules exists for. */
const PHONE = { width: 390, height: 844 }

describe('placeMenu', () => {
  it('aligns the panel’s right edge with the trigger’s', () => {
    expect(placeMenu({ top: 100, bottom: 144, right: 350 }, PHONE).right)
      .toBe(40)
  })

  it('opens downward from the top half', () => {
    expect(placeMenu({ top: 100, bottom: 144, right: 350 }, PHONE))
      .toEqual({ top: 148, right: 40 })
  })

  it('opens upward from the bottom half', () => {
    // The case the module exists for: the last row of the drawer's label
    // list is near the bottom of the screen, and a panel hung below it
    // would open off the end of the phone.
    expect(placeMenu({ top: 700, bottom: 744, right: 350 }, PHONE))
      .toEqual({ bottom: 148, right: 40 })
  })

  it('opens downward from exactly the halfway line', () => {
    // A boundary has to fall one way. Down is the ordinary direction, so
    // the flip is the exception rather than the rule.
    const at = placeMenu({ top: 378, bottom: 422, right: 350 }, PHONE)
    expect(at.top).toBe(426)
    expect(at.bottom).toBeUndefined()
  })

  it('hangs flush against a trigger at the viewport’s right edge', () => {
    expect(placeMenu({ top: 10, bottom: 54, right: 390 }, PHONE).right).toBe(0)
  })
})
```

- [ ] **Step 2: Run the test and watch it fail**

Run: `npm test -- menu`
Expected: FAIL — `Failed to resolve import "./menu"`.

- [ ] **Step 3: Write the module**

Create `app/src/lib/menu.ts`:

```ts
/**
 * Where a menu panel goes — the arithmetic, without a DOM.
 *
 * `Menu.tsx` reads the trigger's rectangle and renders the answer; this
 * decides what the answer is. The same split as `view.ts` / `useView.ts`,
 * for the same reason: the part worth testing is the part with no browser
 * in it.
 *
 * The panel is fixed rather than absolute because both drawer lists scroll,
 * and an absolutely-positioned panel inside a scrolling box is clipped by
 * it. The label list is capped at two and a bit rows, so that would be most
 * of the list.
 */

/** Only the three edges placement reads, so a test can pass a literal. */
export interface TriggerRect {
  top: number
  bottom: number
  right: number
}

export interface Viewport {
  width: number
  height: number
}

/**
 * `position: fixed` offsets. Exactly one of `top` and `bottom` is ever set:
 * both together would pin a height the panel does not have.
 */
export interface Placement {
  top?: number
  bottom?: number
  right: number
}

/** The gap between the trigger and the panel, in px. */
const GAP = 4

export function placeMenu(
  trigger: TriggerRect,
  viewport: Viewport,
): Placement {
  // Right edges align. The trigger is the rightmost thing in its row at
  // every call site, so a panel hung from its right edge cannot run off the
  // left of the screen — which is why there is no clamp here.
  const right = viewport.width - trigger.right

  // Downward from the top half, upward from the bottom half. Rendering,
  // measuring and then repositioning would be exactly right about a case
  // where roughly right is indistinguishable, and would cost a visible jump
  // to be so.
  if (trigger.bottom <= viewport.height / 2) {
    return { top: trigger.bottom + GAP, right }
  }
  return { bottom: viewport.height - trigger.top + GAP, right }
}
```

- [ ] **Step 4: Run the test and watch it pass**

Run: `npm test -- menu`
Expected: PASS, 5 tests.

- [ ] **Step 5: Lint, type-check, commit**

```bash
npm run lint && npm run build
git add src/lib/menu.ts src/lib/menu.test.ts
git commit -m "$(cat <<'MSG'
feat: where a menu panel goes, as arithmetic

Fixed rather than absolute, because both drawer lists scroll and an
absolutely-positioned panel inside a scrolling box is clipped by it —
and the label list is capped at two and a bit rows, so that would be
most of the list.

Which direction it opens is a rule rather than a measurement: down from
the top half of the screen, up from the bottom half. Rendering,
measuring and repositioning would be exactly right about a case where
roughly right is indistinguishable, and would cost a visible jump.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
MSG
)"
```

---

### Task 2: `Menu`, and the section header that adopts it

**Files:**
- Create: `app/src/components/Menu.tsx`
- Modify: `app/src/components/SectionHeader.tsx`

**Interfaces:**
- Consumes: `placeMenu`, `Placement` from Task 1.
- Produces: `Menu({ label: string, children: (close: () => void) =>
  React.ReactNode })` and `MenuItem({ onClick: () => void, danger?: boolean,
  children: React.ReactNode })`. Tasks 3 and 4 import both from `./Menu`.

The primitive and its first adopter ship together: a component with no call
site cannot be verified in a browser, and browser verification is the only
gate components get here.

- [ ] **Step 1: Write the primitive**

Create `app/src/components/Menu.tsx`:

```tsx
/**
 * The … a row hides its rarely-used actions behind.
 *
 * Three call sites — a section header, and the drawer's project and label
 * rows — and four things none of them should own twice: the trigger's open
 * state, dismissal, focus returning to the trigger, and placement.
 *
 * Not ARIA's menu/menuitem pattern, and not a library. SPEC §11.3 rule 2 —
 * "prefer ~40 lines you own to a package" — and a panel of two or three
 * buttons that Tab already walks in order gains nothing from roving focus.
 * A labelled group, and `aria-expanded` on the trigger, is the whole
 * contract: the same as the colour picker this is modelled on.
 *
 * The children are a render prop rather than an item list, because the
 * label menu's second face is eight colour swatches rather than a row of
 * text. An `items` array would have needed a special case on day one.
 */
import { useEffect, useRef, useState } from 'react'
import { placeMenu } from '../lib/menu'
import type { Placement } from '../lib/menu'

export function Menu({
  label,
  children,
}: {
  /** Names both the trigger and the panel — "Actions for Groceries". */
  label: string
  children: (close: () => void) => React.ReactNode
}) {
  // One piece of state for two facts: the panel is open, and it goes here.
  // Placement is measured as it opens, so the two are never separately true.
  const [at, setAt] = useState<Placement | null>(null)
  const trigger = useRef<HTMLButtonElement>(null)
  const panel = useRef<HTMLDivElement>(null)

  function close() {
    setAt(null)
    // So Tab picks up where it left off rather than at the top of the page.
    trigger.current?.focus()
  }

  useEffect(() => {
    if (at === null) return

    function onPointerDown(e: PointerEvent) {
      const target = e.target as Node
      if (panel.current?.contains(target)) return
      // The trigger closes itself on click; letting this fire as well would
      // close and reopen the panel within one gesture.
      if (trigger.current?.contains(target)) return
      // No focus call: focus is going wherever the user just pressed.
      setAt(null)
    }
    // A fixed panel does not follow a scrolling ancestor, so it leaves
    // rather than drifting away from the row it belongs to.
    function onLeave() {
      setAt(null)
    }
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') close()
    }

    document.addEventListener('pointerdown', onPointerDown)
    document.addEventListener('keydown', onKeyDown)
    // Captured, because the scroll happens on the drawer's list rather than
    // on the window, and a scroll event does not bubble.
    window.addEventListener('scroll', onLeave, true)
    window.addEventListener('resize', onLeave)
    return () => {
      document.removeEventListener('pointerdown', onPointerDown)
      document.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('scroll', onLeave, true)
      window.removeEventListener('resize', onLeave)
    }
  }, [at])

  return (
    <>
      <button
        ref={trigger}
        type="button"
        aria-label={label}
        aria-expanded={at !== null}
        onClick={() => {
          if (at !== null) {
            close()
            return
          }
          const rect = trigger.current?.getBoundingClientRect()
          if (rect === undefined) return
          setAt(
            placeMenu(rect, {
              width: window.innerWidth,
              height: window.innerHeight,
            }),
          )
        }}
        className="min-h-11 shrink-0 px-2 text-neutral-400 dark:text-neutral-500"
      >
        &hellip;
      </button>
      {at !== null && (
        <div
          ref={panel}
          role="group"
          aria-label={label}
          style={{ position: 'fixed', ...at }}
          className="z-30 flex min-w-36 flex-col rounded-xl border border-black/10 bg-white p-1 shadow-lg dark:border-white/15 dark:bg-ink"
        >
          {children(close)}
        </div>
      )}
    </>
  )
}

/**
 * One ordinary action. Exists so the three menus agree on their type size
 * and their touch target without agreeing through copy-paste.
 */
export function MenuItem({
  onClick,
  danger = false,
  children,
}: {
  onClick: () => void
  /** Delete, and nothing else. Archive is reversible and reads as ordinary. */
  danger?: boolean
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={
        'min-h-11 w-full rounded-lg px-3 text-left text-sm ' +
        (danger
          ? 'text-red-600 dark:text-red-400'
          : 'text-neutral-700 dark:text-neutral-200')
      }
    >
      {children}
    </button>
  )
}
```

- [ ] **Step 2: Adopt it in the section header**

In `app/src/components/SectionHeader.tsx`, replace the file's opening
comment with:

```tsx
/**
 * A section's name, and the two things you can do to it.
 *
 * Both live behind a … rather than beside the name. Rename and Delete were
 * on screen on every section of every project, in grey and in red, around
 * maybe a dozen tasks — eight words of chrome you use about twice a month.
 * `TaskRow` hides its × on hover, which is the same instinct, but hover
 * does not exist on a phone and these two have to stay reachable there.
 *
 * Only the done section collapses: one affordance and one piece of state,
 * and an open section has no reason to hide. The count sits next to the
 * name for the same reason a collapsed Done needs one — it is the only way
 * to see how much is behind it.
 */
```

Change the import line to add the menu:

```tsx
import { Menu, MenuItem } from './Menu'
```

Replace the two trailing `<button>` blocks (Rename, and the `deletable &&`
Delete) with:

```tsx
      <Menu label={`Actions for ${section.name}`}>
        {(close) => (
          <>
            <MenuItem
              onClick={() => {
                close()
                rename.start()
              }}
            >
              Rename
            </MenuItem>
            {deletable && (
              <MenuItem
                danger
                onClick={async () => {
                  close()
                  try {
                    pushUndo(await deleteSection(section.id))
                  } catch {
                    // The row is already gone — a second tap before the
                    // live query caught up. The user asked for it deleted
                    // and it is deleted; there is nothing to say.
                  }
                }}
              >
                Delete
              </MenuItem>
            )}
          </>
        )}
      </Menu>
```

- [ ] **Step 3: Type-check and lint**

Run: `npm run build && npm run lint`
Expected: both clean. A failure here is almost always an import that is no
longer used — `noUnusedLocals` is on.

- [ ] **Step 4: Verify in the browser**

Run `npm run dev`, open the app at **390×844**, and check, with the console
open throughout:

1. Each section header shows one `…` and no other buttons.
2. Tapping it opens a panel with **Rename** and **Delete**; the Done
   section's panel has **Rename** only.
3. Rename turns the header into a focused input; typing and pressing Enter
   renames the section.
4. Delete removes the section and offers an undo toast.
5. Escape closes the panel and focus returns to the `…`
   (`document.activeElement.getAttribute('aria-label')` names the section).
6. A tap anywhere else closes it.
7. Repeat at **1280×900**.

Expected: zero console errors and zero warnings.

React batches renders, so if you drive any of this from
`browser_evaluate`, `await` a tick (~60ms) between a click and reading the
DOM — otherwise every reading is of the state before the click.

- [ ] **Step 5: Commit**

```bash
git add src/components/Menu.tsx src/components/SectionHeader.tsx
git commit -m "$(cat <<'MSG'
feat: a section's actions move behind a …

Rename and Delete were on screen on every section of every project, in
grey and in red, around maybe a dozen tasks — eight words of chrome for
two actions you use about twice a month. TaskRow hides its × on hover,
which is the same instinct, but hover does not exist on a phone and
these two have to stay reachable there, so the trigger stays and the
actions are what hides.

The primitive ships with its first adopter because a component with no
call site cannot be verified in a browser, and that is the only gate a
component gets here. Its children are a render prop rather than an item
list: the label menu's second face is eight colour swatches.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
MSG
)"
```

---

### Task 3: labels move to the drawer

**Files:**
- Create: `app/src/components/LabelRow.tsx`
- Modify: `app/src/components/Drawer.tsx`
- Modify: `app/src/App.tsx`
- Delete: `app/src/components/LabelHeader.tsx`

**Interfaces:**
- Consumes: `Menu`, `MenuItem` from Task 2.
- Produces: `LabelRow({ label: Label, current: boolean, onNavigate: () =>
  void })`, rendering its own `<li>`. Task 4 mirrors its shape.

Labels move before projects deliberately. `App.tsx` currently runs **one**
`useInlineRename` for both, and taking labels out of it leaves a session
that is strictly simpler than it is now; taking projects out first would
leave a stranger one. Task 4 then deletes what remains.

- [ ] **Step 1: Write the row**

Create `app/src/components/LabelRow.tsx`:

```tsx
/**
 * One label in the drawer: where it goes, and what you can do to it.
 *
 * A component rather than a `<li>` inside a `.map()` because renaming
 * happens in place and `useInlineRename` is a hook. Each row owning its own
 * session is also the fix for a whole class of bug: two rows cannot both
 * think they are the one being renamed.
 *
 * Delete navigates nowhere. `resolveLabel` sends a route whose label is
 * gone to Inbox, so tombstoning the row moves the app on its own — and
 * undoing the delete brings the label and the route back together.
 */
import { useState } from 'react'
import { renameLabel, setLabelColor, deleteLabel } from '../lib/repo'
import { openLabel } from '../lib/nav'
import { PALETTE, dotClasses } from '../lib/labelling'
import { useInlineRename } from '../lib/useInlineRename'
import { pushUndo } from '../lib/undo'
import { Menu, MenuItem } from './Menu'
import type { Label } from '../lib/schema'
import type { InlineRename } from '../lib/useInlineRename'

export function LabelRow({
  label,
  current,
  onNavigate,
}: {
  label: Label
  /** Whether the open route is this label's. */
  current: boolean
  onNavigate: () => void
}) {
  const rename = useInlineRename(label.name, async (name) => {
    pushUndo(await renameLabel(label.id, name))
  })

  if (rename.renaming) {
    return (
      <li>
        <input
          {...rename.inputProps}
          aria-label="Label name"
          className="min-h-11 w-full rounded-xl bg-transparent px-3 text-neutral-900 outline-none dark:text-neutral-100"
        />
      </li>
    )
  }

  return (
    <li className="flex items-center">
      <button
        type="button"
        aria-current={current ? 'page' : undefined}
        onClick={() => {
          openLabel(label.id)
          onNavigate()
        }}
        // `min-w-0` so the name truncates rather than pushing the … off the
        // row: a flex item defaults to `min-width: auto`.
        className={
          'flex min-h-11 min-w-0 flex-1 items-center gap-2 rounded-xl px-3 text-left ' +
          (current
            ? 'bg-accent/10 font-medium text-neutral-900 dark:text-neutral-100'
            : 'text-neutral-600 dark:text-neutral-300')
        }
      >
        <span
          aria-hidden="true"
          className={'size-2 shrink-0 rounded-full ' + dotClasses(label.color)}
        />
        <span className="truncate">{label.name}</span>
      </button>
      <Menu label={`Actions for ${label.name}`}>
        {(close) => <LabelMenu label={label} rename={rename} close={close} />}
      </Menu>
    </li>
  )
}

/**
 * The menu's two faces.
 *
 * `picking` lives here rather than on the row so that closing the menu
 * unmounts it: the next open starts at the item list again without anything
 * having to remember to reset it.
 */
function LabelMenu({
  label,
  rename,
  close,
}: {
  label: Label
  rename: InlineRename
  close: () => void
}) {
  const [picking, setPicking] = useState(false)

  if (picking) {
    return (
      // A row of eight, not a colour picker: the palette is a fixed set, so
      // every choice is one tap. Cycling on tap would be smaller and would
      // cost seven taps to reach one colour.
      <div role="group" aria-label="Label colour" className="flex gap-1 p-1">
        {PALETTE.map((key) => (
          <button
            key={key}
            type="button"
            onClick={() => {
              close()
              void setLabelColor(label.id, key).then(pushUndo)
            }}
            aria-label={key}
            aria-pressed={key === label.color}
            className={
              'size-6 rounded-full ' +
              dotClasses(key) +
              (key === label.color ? ' ring-2 ring-accent ring-offset-2' : '')
            }
          />
        ))}
      </div>
    )
  }

  return (
    <>
      <MenuItem
        onClick={() => {
          close()
          rename.start()
        }}
      >
        Rename
      </MenuItem>
      <MenuItem onClick={() => setPicking(true)}>Colour</MenuItem>
      <MenuItem
        danger
        onClick={() => {
          close()
          void deleteLabel(label.id).then(pushUndo)
        }}
      >
        Delete
      </MenuItem>
    </>
  )
}
```

- [ ] **Step 2: Use it in the drawer**

In `app/src/components/Drawer.tsx`, add the import:

```tsx
import { LabelRow } from './LabelRow'
```

and replace the whole `labels.map(...)` body — the `<li key={label.id}>`
through its closing `</li>` — with:

```tsx
              {labels.map((label) => (
                <LabelRow
                  key={label.id}
                  label={label}
                  current={label.id === openLabelId}
                  onNavigate={onClose}
                />
              ))}
```

`dotClasses` and `openLabel` are now unused in `Drawer.tsx` — leave them
until Task 4 tells you which are still needed, or run `npm run build` and
let `noUnusedLocals` say. (`openLabel` goes; `dotClasses` goes.)

- [ ] **Step 3: Take labels out of `App.tsx`**

Delete the `LabelHeader` import and the `renameLabel` import. Narrow the
shared rename session to projects only — replace the `renameable` block:

```tsx
  const rename = useInlineRename(project?.name ?? '', async (name) => {
    if (project === undefined) return
    pushUndo(await renameProject(project.id, name))
  })
```

Replace `renameable !== undefined` with `project !== undefined` in both the
input branch and the `onDoubleClick`, and replace the input's `aria-label`
expression with the literal `"Project name"`.

Delete the whole `{route.kind === 'label' && label !== undefined && (
<LabelHeader ... /> )}` block.

- [ ] **Step 4: Delete the old header**

```bash
git rm src/components/LabelHeader.tsx
```

- [ ] **Step 5: Type-check, lint, test**

Run: `npm run build && npm run lint && npm test`
Expected: all clean, 296 tests + Task 1's 5 = 301.

- [ ] **Step 6: Verify in the browser**

At **390×844**, console open:

1. Open the drawer. Each label row shows its dot, its name and a `…`.
2. The **last** label row's menu opens **upward** and is fully on screen —
   the case Task 1 exists for. Seed enough labels that the list scrolls.
3. Rename turns the row into a focused input; Enter renames it, and the
   name updates in the drawer and in the label route's title.
4. **Colour** swaps the panel for eight swatches; choosing one changes the
   row's dot. Reopen the menu — it shows the item list again, not swatches.
5. Delete removes the label, offers undo, and the app lands on Inbox if you
   were looking at that label.
6. A label route's header now shows only the title and Install.
7. Repeat at **1280×900**.

Expected: zero console errors and zero warnings.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "$(cat <<'MSG'
feat: a label's actions live on its drawer row

Drawer.tsx documented the opposite rule — rename and archive stay out of
the sidebar so it "stays a place you pass through rather than a control
panel" — and that rule was aimed at a real failure mode: a sidebar where
every row carries visible buttons stops being navigation. A menu that is
closed by default is not that. The row still reads as one name and still
takes one tap.

LabelHeader had nothing left once its three buttons moved, so it is
gone, and a label route's header is now a title like any other. The
colour swatches become the menu's second face rather than a popover
opened from a popover; that state lives in a component the menu
unmounts, so the next open starts at the item list with nothing having
to reset it.

Labels move before projects because App runs one rename session for
both, and taking labels out of it leaves something simpler than what
was there.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
MSG
)"
```

---

### Task 4: projects move to the drawer

**Files:**
- Create: `app/src/components/ProjectRow.tsx`
- Modify: `app/src/components/Drawer.tsx`
- Modify: `app/src/App.tsx`

**Interfaces:**
- Consumes: `Menu`, `MenuItem` from Task 2; the shape of `LabelRow` from
  Task 3.
- Produces: `ProjectRow({ project: Project, current: boolean, onNavigate:
  () => void })`, rendering its own `<li>`.

- [ ] **Step 1: Write the row**

Create `app/src/components/ProjectRow.tsx`:

```tsx
/**
 * One project in the drawer: where it goes, and what you can do to it.
 *
 * A component rather than a `<li>` inside a `.map()` because renaming
 * happens in place and `useInlineRename` is a hook. `LabelRow` is the same
 * shape for the same reason.
 *
 * Archive navigates nowhere. `resolveProject` sends a route whose project
 * is archived to Inbox, exactly as it did when this button was in the
 * header — so there is nothing to do here but write the row and push the
 * undo step.
 */
import { renameProject, archiveProject } from '../lib/repo'
import { openProject } from '../lib/nav'
import { useInlineRename } from '../lib/useInlineRename'
import { pushUndo } from '../lib/undo'
import { Menu, MenuItem } from './Menu'
import type { Project } from '../lib/schema'

export function ProjectRow({
  project,
  current,
  onNavigate,
}: {
  project: Project
  /** Whether the open route is this project's. */
  current: boolean
  onNavigate: () => void
}) {
  const rename = useInlineRename(project.name, async (name) => {
    pushUndo(await renameProject(project.id, name))
  })

  if (rename.renaming) {
    return (
      <li>
        <input
          {...rename.inputProps}
          aria-label="Project name"
          className="min-h-11 w-full rounded-xl bg-transparent px-3 text-neutral-900 outline-none dark:text-neutral-100"
        />
      </li>
    )
  }

  return (
    <li className="flex items-center">
      <button
        type="button"
        aria-current={current ? 'page' : undefined}
        onClick={() => {
          openProject(project.id)
          onNavigate()
        }}
        // `min-w-0` so the name truncates rather than pushing the … off the
        // row: a flex item defaults to `min-width: auto`.
        className={
          'min-h-11 min-w-0 flex-1 truncate rounded-xl px-3 text-left ' +
          (current
            ? 'bg-accent/10 font-medium text-neutral-900 dark:text-neutral-100'
            : 'text-neutral-600 dark:text-neutral-300')
        }
      >
        {project.name}
      </button>
      <Menu label={`Actions for ${project.name}`}>
        {(close) => (
          <>
            <MenuItem
              onClick={() => {
                close()
                rename.start()
              }}
            >
              Rename
            </MenuItem>
            <MenuItem
              onClick={async () => {
                close()
                pushUndo(await archiveProject(project.id))
              }}
            >
              Archive
            </MenuItem>
          </>
        )}
      </Menu>
    </li>
  )
}
```

- [ ] **Step 2: Use it in the drawer, and rewrite the rule it overturns**

In `app/src/components/Drawer.tsx`, add:

```tsx
import { ProjectRow } from './ProjectRow'
```

Replace the whole `projects.map(...)` body — the `<li key={project.id}>`
through its closing `</li>` — with:

```tsx
          {projects.map((project) => (
            <ProjectRow
              key={project.id}
              project={project}
              current={project.id === openId}
              onNavigate={onClose}
            />
          ))}
```

Replace the file's opening comment with:

```tsx
/**
 * Where you are, and where else you could be.
 *
 * An overlay on a phone; pinned open at `lg` and wider, where there is room
 * for it to be a sidebar. Search, Today and Upcoming sit above the project
 * list. Inbox is not among them: it is a project, and making it a second
 * kind of thing would give the app two spellings of one concept.
 *
 * Every project and label row carries a … holding rename and the rest. This
 * file used to say the opposite — that they belonged in the header, so the
 * drawer would stay "a place you pass through rather than a control panel"
 * — and that rule was aimed at something real: a sidebar where every row
 * carries visible buttons stops being navigation. A menu closed by default
 * is not that, and the header it protected had grown to ☰, the title, a
 * board toggle, Rename, Archive and Install across 390px, which truncated
 * the project's own name to make room.
 */
```

Then let `npm run build` name any import that has gone unused —
`addProject` and `openProject` are still needed by the new-project form,
`openView` by the three views above.

- [ ] **Step 3: Empty the header out of `App.tsx`**

Delete the imports of `renameProject`, `archiveProject`, `useInlineRename`
and `pushUndo`; delete the `rename` session and the `archive` function;
delete the Rename and Archive buttons and the `rename.renaming` branch,
leaving the `<h1>` alone with no `onDoubleClick`.

The double-click is not replaced. It was undiscoverable, it does not exist
on a phone, and the drawer now has the version you can find.

The header's `<h1>` and the `route.kind === 'project'` board toggle stay
exactly as they are. Replace the file's opening comment with:

```tsx
/**
 * P0b — the shell (SPEC §4, §13).
 *
 * The drawer is an overlay on a phone and a pinned sidebar from `lg` up,
 * which is why the layout is a flex row rather than the single column P0a
 * had.
 *
 * The header holds the title, the board toggle and Install, and nothing
 * else. Renaming and archiving a project, and everything you can do to a
 * label, moved onto their drawer rows: they were four buttons competing
 * with a project's own name for a 390px line, in aid of two actions used
 * about as often as a project is created.
 */
```

- [ ] **Step 4: Type-check, lint, test**

Run: `npm run build && npm run lint && npm test`
Expected: all clean, 301 tests.

- [ ] **Step 5: Verify in the browser**

At **390×844**, console open:

1. The project header shows ☰, the title, the board toggle and Install —
   and a long project name is no longer truncated to "P…".
2. Each drawer project row shows its name and a `…`.
3. A row's menu is **not clipped** by the scrolling project list. Seed
   enough projects that the list scrolls, and check a row at the bottom.
4. Rename renames in place; the header title follows.
5. Archive removes the project from the drawer and lands you on Inbox, with
   an undo toast that brings it back.
6. Scrolling the project list with a menu open closes the menu.
7. Repeat at **1280×900**.

Expected: zero console errors and zero warnings.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "$(cat <<'MSG'
feat: a project's rename and archive live on its drawer row

The header had grown to ☰, the title, a board toggle, Rename, Archive
and Install across 390px — enough that the board toggle was already
renamed to a glyph after five words of buttons truncated a project's own
name to "P…". Two of those buttons were for actions used about as often
as a project is created.

The drawer is also where you already are when you want them: you open it
to go to a project, and renaming one is the same reach.

The header's double-click-to-rename is not replaced. It was
undiscoverable, it does not exist on a phone, and the drawer now has the
version you can find.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
MSG
)"
```

---

### Task 5: the board, by default

**Files:**
- Modify: `app/src/lib/view.ts`
- Modify: `app/src/lib/useView.ts`
- Modify: `app/src/lib/view.test.ts`
- Modify: `docs/SPEC.md:451` and `docs/SPEC.md:1057`

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces: `resolveView(stored: ViewMode | undefined): ViewMode` — two
  parameters fewer than before. `useView`'s own signature is unchanged.

- [ ] **Step 1: Rewrite the failing tests**

In `app/src/lib/view.test.ts`, replace the entire `describe('resolveView')`
block with:

```ts
describe('resolveView', () => {
  it('honours a stored list', () => {
    expect(resolveView('list')).toBe('list')
  })

  it('honours a stored board', () => {
    expect(resolveView('board')).toBe('board')
  })

  it('opens a board when nothing is stored', () => {
    // SPEC §8 rule 6, as amended: the board is the default everywhere, the
    // phone included. Open question 5 asked for that to be settled by use
    // rather than by argument, and P0b settled it.
    expect(resolveView(undefined)).toBe('board')
  })
})
```

Further down, in the `parseViews` block, the "drops modes it does not
recognise" test says "Falling through to the width rule is right". Change
that phrase to "Falling through to the default is right".

- [ ] **Step 2: Run the tests and watch them fail**

Run: `npm test -- view`
Expected: FAIL — `resolveView(undefined)` returns `'list'`, since the second
argument is now `undefined` and the width rule reads it as a narrow screen.

- [ ] **Step 3: Narrow `resolveView`**

In `app/src/lib/view.ts`, replace the `resolveView` function and its doc
comment with:

```ts
/**
 * Which view a project opens in.
 *
 * A stored choice always wins; the default is only ever a first answer. And
 * the default is the board — SPEC §8 rule 6 predicted the phone would want
 * the list, and P0b's touch-drag work settled it the other way: `dnd-kit`'s
 * touch sensor makes the board usable at 390px, one column at a time, and
 * the columns are the sections you already think in.
 *
 * `projects.default_view` is deliberately not consulted. Every row in the
 * database says 'list', because the column has a default and nothing in the
 * UI writes it — so honouring it here would make this default a no-op on
 * exactly the projects it is for. The column keeps its place and waits for
 * P1 to give it a writer.
 */
export function resolveView(stored: ViewMode | undefined): ViewMode {
  return stored ?? 'board'
}
```

In the same file, `parseViews`'s doc comment ends "falling through to the
width rule is a good answer" — change that to "falling through to the
default is a good answer".

- [ ] **Step 4: Drop the width subscription**

Replace `app/src/lib/useView.ts` entirely with:

```ts
/**
 * List or board — the React seam.
 *
 * `view.ts` stores the choice and `resolveView` interprets its absence;
 * this is the hook between them. It lives here rather than in `view.ts` so
 * `view.ts` stays framework-free and its tests keep running without a DOM,
 * which is the same split as `nav.ts` / `useRoute.ts`.
 *
 * It used to subscribe to a `(min-width: 1024px)` media query as well, to
 * resolve a project with no stored choice differently on a phone. The board
 * is now the default at every width, so there is no second question to ask.
 */
import { useSyncExternalStore } from 'react'
import { subscribe, getViews, setView, resolveView } from './view'
import type { ViewMode } from './view'
import type { Project } from './schema'

export function useView(project: Project | undefined): {
  view: ViewMode
  setView: (mode: ViewMode) => void
} {
  const views = useSyncExternalStore(subscribe, getViews, getViews)

  const id = project?.id
  return {
    view: resolveView(id === undefined ? undefined : views[id]),
    // Before `listProjects` answers there is no project to remember a
    // choice against, and the toggle is not on screen either.
    setView: (mode: ViewMode) => {
      if (id !== undefined) setView(id, mode)
    },
  }
}
```

- [ ] **Step 5: Run the tests and watch them pass**

Run: `npm test -- view && npm run build && npm run lint`
Expected: PASS, and both gates clean.

- [ ] **Step 6: Amend the SPEC**

In `docs/SPEC.md`, replace rule 6 of §8 (currently line 451) with:

```markdown
6. **Drag on a phone is awkward regardless of platform.** Use `dnd-kit` for real touch support and always offer a non-drag "Move to…" fallback. This rule also predicted that the phone would want list view by default; P0b settled it the other way. `dnd-kit`'s touch sensor makes the board genuinely usable at 390px, one column at a time, and the columns are the sections you already think in. **The board is the default everywhere**, phone included; the list is one tap away and the choice is remembered per device (§4.1).
```

Replace open question 5 (currently line 1057) with:

```markdown
5. ~~**How much does the board view matter on the phone?**~~ **Answered 2026-08-20, by use.** A lot. The P0b touch-drag work made the board usable at 390px, and after a day on the phone the list was no longer worth defaulting to. §8 rule 6 is amended: the board is the default at every width.
```

And extend §14's "Resolved:" line to end:

```markdown
~~offline editing~~ (hard requirement, §9), ~~board on the phone~~ (yes, §8
rule 6).
```

- [ ] **Step 7: Commit**

```bash
cd .. && git add docs/SPEC.md app/src/lib/view.ts app/src/lib/useView.ts app/src/lib/view.test.ts && cd app
git commit -m "$(cat <<'MSG'
feat: the board is what a project opens in

SPEC §8 rule 6 predicted the phone would want the list, and open
question 5 asked for that to be settled empirically rather than by
argument. A day of using P0b on the phone settled it the other way:
dnd-kit's touch sensor makes the board usable at 390px, one column at a
time, and the columns are the sections you already think in.

A stored choice still wins, so projects already toggled to list keep
opening as lists. That is the rule the toggle exists for, and it does
mean this will look like nothing happened on the projects you have been
using.

projects.default_view is deliberately not consulted: every row says
'list' because the column has a default and no writer, so honouring it
would have made this a no-op on exactly the projects it is for. The
column waits for P1.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
MSG
)"
```

---

### Task 6: the README, and the whole thing at once

**Files:**
- Modify: `app/README.md`

**Interfaces:**
- Consumes: everything above. Produces nothing.

- [ ] **Step 1: Rewrite the opening**

Replace the "Currently at **P0b slice 9b — search filters**" heading line
with:

```markdown
Currently at **P0b polish — quiet menus, and the board by default**
(SPEC §13). Rename, delete, archive and recolour moved off the screen and
behind a `…` on the row they belong to: a section header's, a drawer
project's, a drawer label's. They were on screen permanently in aid of
actions used about as often as a project is created, and the project
header had grown to six controls across 390px. A project now opens as a
board unless you have told it otherwise — SPEC §8 rule 6 predicted the
phone would want the list, and a day of using it said otherwise.

Before that, **slice 9b — search filters** (SPEC §13). A field finds a task
by any
```

(The rest of that paragraph, from "words you remember", is unchanged.)

- [ ] **Step 2: Update the test list**

In the `npm test` comment, add `menu` to the list of tested modules:

```
npm test         # vitest — lib unit tests (ids, order keys, db, migration, outbox,
                 #   repo, grouping, nav, undo, dates, progress, labelling,
                 #   search, filters, menu)
```

- [ ] **Step 3: Update the layout map**

In `lib/`, change the `view.ts` line and add `menu.ts` after it:

```
    view.ts                 list or board, per project, per device (SPEC §4.1)
    menu.ts                 where a … panel goes (pure)
```

In `components/`, replace the `Drawer.tsx`, `SectionHeader.tsx` and
`LabelHeader.tsx` lines so the block reads:

```
    Drawer.tsx              the three views, then the projects, then labels
    ProjectRow.tsx          one drawer project, and its …
    LabelRow.tsx            one drawer label, its … and its colours
    Menu.tsx                the … every row hides its actions behind
    SectionHeader.tsx       collapse, and a … holding rename and delete
```

`LabelHeader.tsx` is deleted from the map; `ProjectRow.tsx`, `LabelRow.tsx`
and `Menu.tsx` are added.

- [ ] **Step 4: Run everything**

```bash
npm test && npm run lint && npm run build
```

Expected: 301 tests green across 26 files, lint clean, build clean.

- [ ] **Step 5: Commit**

```bash
git add README.md
git commit -m "$(cat <<'MSG'
docs: menus and a board-first default, in the README

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
MSG
)"
```

- [ ] **Step 6: Finish the branch**

Use superpowers:finishing-a-development-branch. The base branch is `main`,
and the repo's standing rule is that everything lands through a PR — so
option 2, and report the URL.

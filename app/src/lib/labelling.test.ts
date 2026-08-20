import { describe, it, expect } from 'vitest'
import { PALETTE, nextColor, dotClasses, labelsByTask } from './labelling'
import type { Label, TaskLabel } from './schema'

function label(id: string, name: string, color: string): Label {
  return {
    id,
    name,
    color,
    workspace_id: 'w',
    updated_at: '2026-08-20T00:00:00.000Z',
    deleted_at: null,
    client_id: 'test',
  }
}

function link(
  taskId: string,
  labelId: string,
  deleted: string | null = null,
): TaskLabel {
  return {
    id: `${taskId}.${labelId}`,
    task_id: taskId,
    label_id: labelId,
    workspace_id: 'w',
    updated_at: '2026-08-20T00:00:00.000Z',
    deleted_at: deleted,
    client_id: 'test',
  }
}

describe('nextColor', () => {
  it('takes the first palette colour when nothing exists yet', () => {
    expect(nextColor([])).toBe(PALETTE[0])
  })

  it('spreads across the palette before repeating any colour', () => {
    const existing = PALETTE.slice(0, 3).map((c, i) =>
      label(`l${i}`, `n${i}`, c),
    )
    expect(nextColor(existing)).toBe(PALETTE[3])
  })

  it('wraps to the least-used colour once the palette is full', () => {
    // Every colour used once, then one used twice. The next label must not
    // take the doubled one.
    const existing = PALETTE.map((c, i) => label(`l${i}`, `n${i}`, c))
    existing.push(label('extra', 'extra', PALETTE[0]))
    expect(nextColor(existing)).toBe(PALETTE[1])
  })

  it('breaks ties by palette order, so it is deterministic', () => {
    const existing = [label('l0', 'n0', PALETTE[0])]
    // Every other colour is unused; the tie goes to the earliest.
    expect(nextColor(existing)).toBe(PALETTE[1])
  })

  it('ignores a colour that is not in the palette', () => {
    const existing = [label('l0', 'n0', 'chartreuse')]
    expect(nextColor(existing)).toBe(PALETTE[0])
  })
})

describe('dotClasses', () => {
  it('maps every palette key to a literal class pair', () => {
    for (const key of PALETTE) {
      const classes = dotClasses(key)
      expect(classes).toContain(`bg-${key}-500`)
      expect(classes).toContain(`dark:bg-${key}-400`)
    }
  })

  it('falls back to neutral for an unknown key', () => {
    // A row from a future build, or a hand-edited database. A label that
    // renders plainly is a much better failure than a list that will not
    // render at all.
    expect(dotClasses('chartreuse')).toBe(dotClasses('__missing__'))
    expect(dotClasses('chartreuse')).toContain('bg-neutral-400')
  })
})

describe('labelsByTask', () => {
  it('groups labels under the tasks that carry them', () => {
    const labels = [
      label('a', 'errand', PALETTE[0]),
      label('b', 'waiting', PALETTE[1]),
    ]
    const links = [link('t1', 'a'), link('t1', 'b'), link('t2', 'b')]

    const map = labelsByTask(links, labels)

    expect(map.get('t1')?.map((l) => l.name)).toEqual(['errand', 'waiting'])
    expect(map.get('t2')?.map((l) => l.name)).toEqual(['waiting'])
  })

  it('leaves an untagged task out of the map rather than present and empty', () => {
    // The same rule `progressByTask` follows: absent means `TaskRow` renders
    // nothing from an undefined prop, with no length check at every caller.
    const map = labelsByTask([], [label('a', 'errand', PALETTE[0])])
    expect(map.has('t1')).toBe(false)
  })

  it('ignores a tombstoned link', () => {
    // SPEC §9: deletions are soft, so a tombstone is still a row. Handed rows
    // directly, this function is honest about them on its own.
    const labels = [label('a', 'errand', PALETTE[0])]
    const map = labelsByTask(
      [link('t1', 'a', '2026-08-20T00:00:00.000Z')],
      labels,
    )
    expect(map.has('t1')).toBe(false)
  })

  it('ignores a link whose label is gone', () => {
    // A label deleted on another device. The link survives as a tombstone
    // candidate for P1, but it must not draw a blank dot.
    const map = labelsByTask([link('t1', 'missing')], [])
    expect(map.has('t1')).toBe(false)
  })

  it("orders a task's labels by palette, not by name or link order", () => {
    // So the dots on a row do not reshuffle when an unrelated label is
    // renamed or a link is rewritten.
    //
    // The names run opposite to the palette on purpose: 'alpha' sorts first
    // alphabetically but carries the later colour, so a name-based sort — the
    // obvious wrong implementation — fails this case instead of passing it by
    // accident.
    const labels = [
      label('a', 'alpha', PALETTE[2]),
      label('b', 'zulu', PALETTE[0]),
    ]
    const map = labelsByTask([link('t1', 'a'), link('t1', 'b')], labels)
    expect(map.get('t1')?.map((l) => l.name)).toEqual(['zulu', 'alpha'])
  })
})

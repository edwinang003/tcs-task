import { describe, it, expect, beforeEach } from 'vitest'
import { db } from '../db'
import { activeWorkspace } from '../workspace'
import {
  listSections, getSection, addSection, renameSection, deleteSection,
  doneSectionOf, firstOpenSectionOf, addTask, getTask,
} from './index'

const inbox = activeWorkspace().projectId

describe('sections', () => {
  beforeEach(async () => {
    if (db.isOpen()) db.close()
    await db.delete()
    await db.open()
    await db.outbox.clear()
  })

  it('lists a project\'s live sections in position order', async () => {
    await addSection(inbox, 'This weekend')
    const names = (await listSections(inbox)).map((s) => s.name)
    expect(names).toEqual(['Tasks', 'Done', 'This weekend'])
  })

  it('finds the done section and the first open section', async () => {
    expect((await doneSectionOf(inbox)).is_done_section).toBe(true)
    expect((await firstOpenSectionOf(inbox)).name).toBe('Tasks')
  })

  it('appends a new section and undoes it by tombstoning', async () => {
    const { id, undo } = await addSection(inbox, 'This weekend')
    expect((await getSection(id))?.name).toBe('This weekend')

    await undo.apply()
    expect((await getSection(id))?.deleted_at).not.toBeNull()
    expect((await listSections(inbox)).map((s) => s.id)).not.toContain(id)
  })

  it('ignores an empty rename', async () => {
    const { id } = await addSection(inbox, 'Weekend')
    expect(await renameSection(id, '   ')).toBeNull()
    expect((await getSection(id))?.name).toBe('Weekend')
  })

  // SPEC §4.4: "its tasks move to the project's first remaining section, they
  // are *not* deleted. A section is a status label, and losing a status should
  // never lose the work."
  it('moves a deleted section\'s tasks into the first remaining section', async () => {
    const { id: weekend } = await addSection(inbox, 'This weekend')
    const { id: task } = await addTask('clear the shed', inbox)
    await db.tasks.update(task, { section_id: weekend })

    await deleteSection(weekend)

    const moved = await getTask(task)
    expect(moved?.deleted_at).toBeNull()
    expect(moved?.section_id).toBe((await firstOpenSectionOf(inbox)).id)
    expect((await getSection(weekend))?.deleted_at).not.toBeNull()
  })

  it('undoes a section delete by restoring the section and the tasks', async () => {
    const { id: weekend } = await addSection(inbox, 'This weekend')
    const { id: task } = await addTask('clear the shed', inbox)
    await db.tasks.update(task, { section_id: weekend })

    const undo = await deleteSection(weekend)
    await undo.apply()

    expect((await getSection(weekend))?.deleted_at).toBeNull()
    expect((await getTask(task))?.section_id).toBe(weekend)
  })

  it('offers to undo a section delete with a toast', async () => {
    const { id } = await addSection(inbox, 'This weekend')
    expect((await deleteSection(id)).toast).toBe(true)
  })

  // SPEC §4: exactly one done section per project.
  it('refuses to delete the done section', async () => {
    const done = await doneSectionOf(inbox)
    await expect(deleteSection(done.id)).rejects.toThrow(/done section/)
  })

  // SPEC §4.4: "deleting the last one is refused".
  it('refuses to delete the last open section', async () => {
    const open = await firstOpenSectionOf(inbox)
    await expect(deleteSection(open.id)).rejects.toThrow(/at least one/)
  })

  it('refuses to delete a section that is not there', async () => {
    await expect(deleteSection('no-such-section')).rejects.toThrow()
  })
})

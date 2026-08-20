import { describe, it, expect, beforeEach } from 'vitest'
import { db } from '../db'
import {
  listProjects, getProject, addProject, renameProject, archiveProject,
} from './index'

describe('projects', () => {
  beforeEach(async () => {
    if (db.isOpen()) db.close()
    await db.delete()
    await db.open()
    // The v2 migration seeds the Inbox project and its two sections.
    await db.outbox.clear()
  })

  it('creates a project with its two sections', async () => {
    const { id } = await addProject('Work')

    const sections = await db.sections
      .filter((s) => s.project_id === id)
      .toArray()
    // SPEC §4: "each project has exactly one section flagged is_done_section".
    expect(sections).toHaveLength(2)
    expect(sections.filter((s) => s.is_done_section)).toHaveLength(1)
  })

  it('creates a project with the full sync column set, default_view included', async () => {
    // SPEC §15: every row is created with its full sync column set, so that P1
    // implements a transport rather than a migration.
    const { id } = await addProject('Work')

    expect(await db.projects.get(id)).toMatchObject({ default_view: 'list' })
  })

  it('enqueues the project before the sections that reference it', async () => {
    const { id } = await addProject('Work')
    const entries = await db.outbox.toArray()

    // SPEC §9.2: seq is the push order, and a section cannot arrive first.
    const project = entries.find((e) => e.row_id === id)
    const sections = entries.filter((e) => e.table === 'sections')
    expect(entries).toHaveLength(3)
    expect(project).toBeDefined()
    for (const section of sections) {
      expect(section.seq).toBeGreaterThan(project!.seq)
    }
  })

  it('undoes a creation by tombstoning all three rows', async () => {
    const { id, undo } = await addProject('Work')

    await undo.apply()

    expect((await db.projects.get(id))?.deleted_at).not.toBeNull()
    const sections = await db.sections
      .filter((s) => s.project_id === id)
      .toArray()
    expect(sections.every((s) => s.deleted_at !== null)).toBe(true)
  })

  it('refuses a project with no name', async () => {
    await expect(addProject('   ')).rejects.toThrow()
  })

  it('renames a project, and ignores an empty rename', async () => {
    const { id } = await addProject('Wrok')

    await renameProject(id, 'Work')
    expect((await getProject(id))?.name).toBe('Work')

    expect(await renameProject(id, '  ')).toBeNull()
    expect((await getProject(id))?.name).toBe('Work')
  })

  it('archives a project out of the list, and undo brings it back', async () => {
    const { id } = await addProject('Work')
    expect((await listProjects()).map((p) => p.id)).toContain(id)

    const undo = await archiveProject(id)
    expect((await listProjects()).map((p) => p.id)).not.toContain(id)

    await undo!.apply()
    expect((await listProjects()).map((p) => p.id)).toContain(id)
  })

  it('offers to undo an archive with a toast, since it leaves the drawer', async () => {
    const { id } = await addProject('Work')
    const undo = await archiveProject(id)
    expect(undo?.toast).toBe(true)
  })

  it('lists projects in position order and hides tombstones', async () => {
    const { id: first } = await addProject('Aaa')
    const { id: second } = await addProject('Bbb')
    await db.projects.update(first, { deleted_at: new Date().toISOString() })

    const ids = (await listProjects()).map((p) => p.id)
    expect(ids).not.toContain(first)
    expect(ids.at(-1)).toBe(second)
  })
})

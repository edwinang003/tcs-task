import { describe, it, expect } from 'vitest'
import { createDb } from './db'
import { activeWorkspace } from './workspace'

const { workspaceId, projectId, sectionId, doneSectionId } = activeWorkspace()

/**
 * Node's `process`, reached through `globalThis`: `src/` is typed for the
 * browser, and SPEC §11.3 rule 2 does not spend a dependency on `@types/node`
 * for two method calls.
 */
const nodeProcess = (globalThis as unknown as {
  process: {
    on(event: 'unhandledRejection', listener: (reason: unknown) => void): void
    off(event: 'unhandledRejection', listener: (reason: unknown) => void): void
  }
}).process

/** A database as P0a left it: version 1, tasks only, no outbox. */
async function seedV1(name: string, titles: string[]) {
  const v1 = createDb(name, 1)
  await v1.open()
  for (const [i, title] of titles.entries()) {
    await v1.tasks.add({
      id: `task-${i}`,
      workspace_id: workspaceId,
      project_id: projectId,
      section_id: sectionId,
      title,
      notes: null,
      due_on: null,
      due_time: null,
      reminder_at: null,
      reminder_sent_at: null,
      priority: 0,
      completed_at: null,
      recurrence_rule: null,
      recurrence_parent_id: null,
      position: `a${i}`,
      created_by: null,
      assignee_id: null,
      updated_at: '2026-08-01T00:00:00.000Z',
      deleted_at: null,
      client_id: 'p0a-device',
    })
  }
  v1.close()
}

describe('v1 → v2 migration', () => {
  it('materializes the Inbox project and its two sections', async () => {
    const name = 'lane-migration-rows'
    await seedV1(name, [])
    const db = createDb(name)
    await db.open()

    expect(await db.projects.get(projectId)).toMatchObject({
      name: 'Inbox',
      workspace_id: workspaceId,
      archived_at: null,
      deleted_at: null,
    })
    expect(await db.sections.get(sectionId)).toMatchObject({
      project_id: projectId,
      is_done_section: false,
    })
    expect(await db.sections.get(doneSectionId)).toMatchObject({
      project_id: projectId,
      is_done_section: true,
    })
    db.close()
  })

  it('backfills an outbox entry for every task created during P0a', async () => {
    // Without this, P1's first push sends the Inbox project and none of the
    // tasks in it, and the omission is invisible until a second device shows
    // an empty list.
    const name = 'lane-migration-backfill'
    await seedV1(name, ['buy milk', 'call the dentist'])
    const db = createDb(name)
    await db.open()

    const taskEntries = await db.outbox.where('table').equals('tasks').toArray()
    expect(taskEntries.map((e) => e.row_id).sort()).toEqual(['task-0', 'task-1'])
    expect(taskEntries[0].columns).toContain('title')
    expect(taskEntries[0].columns).not.toContain('updated_at')
    db.close()
  })

  it('pushes the project before the sections before the tasks', async () => {
    // SPEC §9.2: if tasks arrive before their project, the foreign key fails.
    const name = 'lane-migration-order'
    await seedV1(name, ['buy milk'])
    const db = createDb(name)
    await db.open()

    const tables = (await db.outbox.orderBy('seq').toArray()).map((e) => e.table)
    expect(tables).toEqual(['projects', 'sections', 'sections', 'tasks'])
    db.close()
  })

  it('leaves existing tasks untouched', async () => {
    const name = 'lane-migration-untouched'
    await seedV1(name, ['buy milk'])
    const db = createDb(name)
    await db.open()

    expect(await db.tasks.get('task-0')).toMatchObject({
      title: 'buy milk',
      project_id: projectId,
      section_id: sectionId,
      updated_at: '2026-08-01T00:00:00.000Z',
      client_id: 'p0a-device',
    })
    db.close()
  })

  it('seeds a brand-new database, which never runs an upgrade at all', async () => {
    // Dexie runs upgrade() only for a database that already existed. A first
    // install creates v2 directly, and must still get its Inbox project.
    const db = createDb('lane-fresh-install')
    await db.open()

    expect(await db.projects.get(projectId)).toMatchObject({ name: 'Inbox' })
    expect(await db.sections.count()).toBe(2)
    expect((await db.outbox.orderBy('seq').toArray()).map((e) => e.table)).toEqual([
      'projects',
      'sections',
      'sections',
    ])
    db.close()
  })

  it('upgrades an empty database with no task entries', async () => {
    const name = 'lane-migration-empty'
    await seedV1(name, [])
    const db = createDb(name)
    await db.open()

    expect(await db.outbox.where('table').equals('tasks').count()).toBe(0)
    expect(await db.projects.count()).toBe(1)
    db.close()
  })

  it('leaves a version 1 database alone — the seed belongs to version 2', async () => {
    // `populate` fires for any database created from nothing, including the
    // version 1 one this test file builds. Seeding a workspace there reaches
    // for tables the v1 schema does not have, and Dexie reports that as an
    // unhandled rejection rather than a failed open — a failure that passes
    // the suite while telling us the seed ran where it should not.
    const rejections: unknown[] = []
    const onRejection = (reason: unknown) => rejections.push(reason)
    nodeProcess.on('unhandledRejection', onRejection)

    await seedV1('lane-migration-v1-only', [])
    await new Promise((resolve) => setTimeout(resolve, 0))

    nodeProcess.off('unhandledRejection', onRejection)
    expect(rejections).toEqual([])
  })
})

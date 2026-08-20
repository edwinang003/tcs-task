import { describe, it, expect } from 'vitest'
import { createDb } from './db'
import { activeWorkspace } from './workspace'
import type { Project } from './schema'

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

/**
 * A project row as the previous build wrote it: everything except the column
 * this slice adds. Cast because the type now requires the field — which is the
 * point: rows on a phone that installed last week do not have it.
 */
async function seedV2Project(name: string, id: string) {
  const v2 = createDb(name, 2)
  await v2.open()
  await v2.projects.add({
    id,
    workspace_id: workspaceId,
    name: 'Work',
    color: null,
    icon: null,
    position: 'a5',
    archived_at: null,
    updated_at: '2026-08-10T00:00:00.000Z',
    deleted_at: null,
    client_id: 'older-build',
  } as unknown as Project)
  const outboxLength = await v2.outbox.count()
  v2.close()
  return outboxLength
}

describe('v2 → v3 migration', () => {
  it('backfills default_view onto a project written by the previous build', async () => {
    const name = 'lane-migration-default-view'
    await seedV2Project(name, 'older-project')
    const db = createDb(name)
    await db.open()

    expect(await db.projects.get('older-project')).toMatchObject({
      name: 'Work',
      default_view: 'list',
    })
    db.close()
  })

  it('backfills without enqueuing anything to push', async () => {
    // Deliberately unlike the v2 upgrade, which enqueued tasks because those
    // rows had never been enqueued at all (SPEC §9.1: never drop an entry).
    // Here the value written is the column's own default on the server, so
    // there is nothing for a server to learn from being told it.
    const name = 'lane-migration-default-view-outbox'
    const before = await seedV2Project(name, 'quiet-project')
    const db = createDb(name)
    await db.open()

    expect(await db.outbox.count()).toBe(before)
    db.close()
  })
})

import { describe, it, expect } from 'vitest'
import { db } from '../lib/db'

describe('test harness', () => {
  it('opens the Dexie database', async () => {
    await db.open()
    expect(db.isOpen()).toBe(true)
    expect(db.tasks).toBeDefined()
  })

  it('provides localStorage for device.ts', async () => {
    const { clientId } = await import('../lib/device')
    expect(clientId()).toMatch(/^[0-9a-f]{8}-/)
    expect(clientId()).toBe(clientId())
  })
})

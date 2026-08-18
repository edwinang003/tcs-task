import { describe, it, expect } from 'vitest'
import { todayLocal, isOverdue, formatDue } from './dates'

// A Tuesday, mid-afternoon, in local time. Built from parts rather than parsed
// from a string, because `new Date('2026-08-18')` is UTC midnight — the day
// before, anywhere west of Greenwich.
const at = new Date(2026, 7, 18, 14, 30)

describe('todayLocal', () => {
  it('formats the local date, not the UTC one', () => {
    // 23:30 local on the 18th is the 19th in UTC east of Greenwich. The task
    // is still due today.
    expect(todayLocal(new Date(2026, 7, 18, 23, 30))).toBe('2026-08-18')
  })

  it('pads month and day', () => {
    expect(todayLocal(new Date(2026, 0, 5))).toBe('2026-01-05')
  })
})

describe('isOverdue', () => {
  it('is false with no due date', () => {
    expect(isOverdue(null, null, at)).toBe(false)
  })

  it('is true for a date in the past', () => {
    expect(isOverdue('2026-08-17', null, at)).toBe(true)
  })

  it('is false for a date in the future', () => {
    expect(isOverdue('2026-08-19', null, at)).toBe(false)
  })

  it('is false for today with no time — the day is not over yet', () => {
    expect(isOverdue('2026-08-18', null, at)).toBe(false)
  })

  it('is true for today at a time already past', () => {
    expect(isOverdue('2026-08-18', '09:00', at)).toBe(true)
  })

  it('is false for today at a time still to come', () => {
    expect(isOverdue('2026-08-18', '17:00', at)).toBe(false)
  })

  it('ignores the time on a future date', () => {
    expect(isOverdue('2026-08-19', '09:00', at)).toBe(false)
  })
})

describe('formatDue', () => {
  it('is null with no due date', () => {
    expect(formatDue(null, null, at)).toBeNull()
  })

  it('names today and tomorrow rather than dating them', () => {
    expect(formatDue('2026-08-18', null, at)).toBe('Today')
    expect(formatDue('2026-08-19', null, at)).toBe('Tomorrow')
  })

  it('rolls over the month end', () => {
    const eve = new Date(2026, 7, 31, 9, 0)
    expect(formatDue('2026-09-01', null, eve)).toBe('Tomorrow')
  })

  it('gives weekday, day and month for anything else this year', () => {
    expect(formatDue('2026-08-21', null, at)).toBe('Fri 21 Aug')
  })

  it('adds the year when it is not this one', () => {
    expect(formatDue('2027-01-04', null, at)).toBe('Mon 4 Jan 2027')
  })

  it('appends a 12-hour time, dropping a zero minute', () => {
    expect(formatDue('2026-08-18', '17:00', at)).toBe('Today, 5pm')
    expect(formatDue('2026-08-18', '17:30', at)).toBe('Today, 5:30pm')
  })

  it('handles both ends of the clock', () => {
    expect(formatDue('2026-08-18', '00:15', at)).toBe('Today, 12:15am')
    expect(formatDue('2026-08-18', '12:00', at)).toBe('Today, 12pm')
  })
})

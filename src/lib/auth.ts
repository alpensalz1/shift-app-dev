'use client'

import { Staff } from 'A/types/database'

const STORAGE_KEY = 'shift_app_staff'

export function getStoredStaff(): Staff | null {
  if (typeof window === 'undefined') return null
  const stored = localStorage.getItem(STORAGE_KEY)
  if (!stored) return null
  try {
    return JSON.parse(stored) as Staff
  } catch {
    return null
  }
}

export function storeStaff(staff: Staff): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(staff))
}

export function clearStaff(): void {
  localStorage.removeItem(STORAGE_KEY)
}

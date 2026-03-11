import { type ClassValue, clsx } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

/**
 * 時刻文字列 "HH:MM:SS" を "HH:MM" に変換
 */
export function formatTime(time: string | null): string {
    if (!time) return '—'
  return time.slice(0, 5)
}

/**
 * 2つの時刻間の勤務時間（時間単位）を計算
 * 24:00が上限（月またがなし）
 */
export function calcHours(start: string, end: string | null): number {
    if (!end) return 0
  const [sh, sm] = start.split(':').map(Number)
  const [eh, em] = end.split(':').map(Number)
  const startMin = sh * 60 + sm
  const endMin = eh * 60 + em
  if (endMin <= startMin) return 0
  return (endMin - startMin) / 60
}

/**
 * 深夜手当を含めた給与計算
 * 22:00〜24:00は1.25間（24:00ば上限なので翌日は考慮しない）
 */
export function calcWage(start: string, end: string | null, hourlyWage: number): number {
    if (!end) return 0
  const [sh, sm] = start.split(':').map(Number)
  const [eh, em] = end.split(':').map(Number)
  const startMin = sh * 60 + sm
  const endMin = eh * 60 + em
  if (endMin <= startMin) return 0

  let total = 0
  const NIGHT_START = 22 * 60  // 22:00

  for (let m = startMin; m < endMin; m++) {
    const isNight = m >= NIGHT_START
    const rate = isNight ? 1.25 : 1.0
    total += (hourlyWage / 60) * rate
  }

  return Math.round(total)
}

/**
 * シフト提出対豣期間を取得
 * 1-1日 → 当月16日〜末日
 * 16-末日 → 翌月1日〜15日
 */
export function getSubmissionPeriod(today: Date): { start: Date; end: Date } {
  const year = today.getFullYear()
  const month = today.getMonth()
  const day = today.getDate()

  if (day <= 15) {
    // 当月16日〜末日
    const start = new Date(year, month, 16)
    const end = new Date(year, month + 1, 0) // 末日
    return { start, end }
  } else {
    // 翌月1日〜15日
    const start = new Date(year, month + 1, 1)
    const end = new Date(year, month + 1, 15)
    return { start, end }
  }
}

/**
 * 15分刻みの時刻リストを生成（24:00が上限）
 * 例: 9:00, 9:15, 9:30, 9:45, 10:00, ... , 23:45, 24:00
 */
export function generateTimeSlots(startHour = 9, endHour = 24): string[] {
  const slots: string[] = []
  for (let h = startHour; h <= endHour; h++) {
    for (let m = 0; m < 60; m += 15) {
      if (h === endHour && m > 0) break
      const label = `${h}:${m.toString().padStart(2, '0')}`
      slots.push(label)
    }
  }
  return slots
}

/**
 * 時刻文字列が15分刻みかどうかを検証
 */
export function isValid15MinTime(time: string): boolean {
  const [h, m] = time.split(':').map(Number)
  if (isNaN(h) || isNaN(m)) return false
  if (h < 0 || h > 24) return false
  if (h === 24 && m !== 0) return false
  return m % 15 === 0
}

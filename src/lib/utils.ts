import { type ClassValue, clsx } from "clsx"
import { twMerge } from "tailwind-merge"
import * as HolidayJP from '@holiday-jp/holiday_jp'

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

/**
 * 時刻文字列 "HH:MM:SS" を "HH:MM" に変換
 */
export function formatTime(time: string | null): string {
  if (!time || time.length < 5) return '—'
  return time.slice(0, 5)
}

/**
 * 2つの時刻間の勤務時間（時間単位）を計算
 * 24:00が上限（月またがなし）
 */
export function calcHours(start: string, end: string | null): number {
  const effectiveEnd = end ?? '24:00'
  const [sh, sm] = start.split(':').map(Number)
  const [eh, em] = effectiveEnd.split(':').map(Number)
  const startMin = sh * 60 + sm
  const endMin = eh * 60 + em
  if (endMin <= startMin) return 0
  return (endMin - startMin) / 60
}

/**
 * 深夜手当を含めた給与計算
 * 22:00〜24:00は1.25倍（24:00が上限なので翌日は考慮しない）
 */
export function calcWage(start: string, end: string | null, hourlyWage: number): number {
  const effectiveEnd = end ?? '24:00'
  const [sh, sm] = start.split(':').map(Number)
  const [eh, em] = effectiveEnd.split(':').map(Number)
  const startMin = sh * 60 + sm
  const endMin = eh * 60 + em
  if (endMin <= startMin) return 0

  const NIGHT_START = 22 * 60  // 22:00
  const dayMins = Math.max(0, Math.min(endMin, NIGHT_START) - startMin)
  const nightMins = Math.max(0, endMin - Math.max(startMin, NIGHT_START))
  const total = (hourlyWage / 60) * (dayMins + nightMins * 1.25)

  return Math.round(total)
}

/**
 * 「次の提出締め切りに対応する」シフト対象期間を取得
 * ※ 「日付を含む期間」ではなく、その日時点での「次の締め切り対象期間」を返す
 *
 * 1〜5日   → 当月16日〜末日    （締め切り：当月5日）
 * 6〜20日  → 翌月1日〜15日     （締め切り：当月20日）
 * 21〜末日 → 翌月16日〜末日    （締め切り：翌月5日）
 */
/**
 * 指定した日付が日本の祝日かどうかを判定
 */
export function isJapaneseHoliday(date: Date): boolean {
  return HolidayJP.isHoliday(date)
}

/**
 * 指定した日付が土曜・日曜・日本の祝日のいずれかかどうかを判定
 */
export function isWeekendOrHoliday(date: Date): boolean {
  const dow = date.getDay()
  return dow === 0 || dow === 6 || isJapaneseHoliday(date)
}

export function getSubmissionPeriod(today: Date): { start: Date; end: Date; deadline: Date } {
  const year = today.getFullYear()
  const month = today.getMonth()
  const day = today.getDate()

  if (day <= 5) {
    // 当月16日〜末日（締め切り：当月5日）
    return {
      start: new Date(year, month, 16),
      end: new Date(year, month + 1, 0),
      deadline: new Date(year, month, 5),
    }
  } else if (day <= 20) {
    // 翌月1日〜15日（締め切り：当月20日）
    return {
      start: new Date(year, month + 1, 1),
      end: new Date(year, month + 1, 15),
      deadline: new Date(year, month, 20),
    }
  } else {
    // 翌月16日〜末日（締め切り：翌月5日）
    return {
      start: new Date(year, month + 1, 16),
      end: new Date(year, month + 2, 0),
      deadline: new Date(year, month + 1, 5),
    }
  }
}


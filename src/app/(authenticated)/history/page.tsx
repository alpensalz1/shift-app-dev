'use client'

import { useEffect, useState, useMemo } from 'react'
import { supabase } from '@/lib/supabase'
import { getStoredStaff } from '@/lib/auth'
import { ShiftFixed, Staff } from '@/types/database'
import { calcHours, formatTime } from '@/lib/utils'
import {
  format,
  startOfMonth,
  endOfMonth,
  eachDayOfInterval,
  getDay,
} from 'date-fns'
import { ja } from 'date-fns/locale'
import {
  History,
  ChevronLeft,
  ChevronRight,
  Loader2,
  CalendarDays,
} from 'lucide-react'

const DOW_LABELS = ['日', '月', '火', '水', '木', '金', '土']

const SHOPS: Record<number, string> = { 1: '三軒茶屋', 2: '下北沢' }

function fmtKey(d: Date) {
  return format(d, 'yyyy-MM-dd')
}

export default function HistoryPage() {
  const [staff, setStaff] = useState<Staff | null>(null)
  const [shifts, setShifts] = useState<ShiftFixed[]>([])
  const [loading, setLoading] = useState(true)
  const [selectedMonth, setSelectedMonth] = useState(() =>
    format(new Date(), 'yyyy-MM')
  )

  useEffect(() => {
    setStaff(getStoredStaff())
  }, [])

  useEffect(() => {
    if (!staff) return
    setLoading(true)
    const base = new Date(selectedMonth + '-01')
    const monthStart = fmtKey(startOfMonth(base))
    const monthEnd = fmtKey(endOfMonth(base))
    supabase
      .from('shifts_fixed')
      .select('*')
      .eq('staff_id', staff.id)
      .gte('date', monthStart)
      .lte('date', monthEnd)
      .order('date', { ascending: true })
      .then(({ data }) => {
        setShifts(data ?? [])
        setLoading(false)
      })
  }, [staff?.id, selectedMonth])

  const monthDate = new Date(selectedMonth + '-01')
  const monthLabel = format(monthDate, 'yyyy年M月', { locale: ja })
  const daysInMonth = eachDayOfInterval({
    start: startOfMonth(monthDate),
    end: endOfMonth(monthDate),
  })
  const firstDow = getDay(daysInMonth[0])

  // Group shifts by date
  const shiftsByDate = useMemo(() => {
    const map: Record<string, ShiftFixed[]> = {}
    shifts.forEach((s) => {
      const dk = s.date.substring(0, 10)
      if (!map[dk]) map[dk] = []
      map[dk].push(s)
    })
    return map
  }, [shifts])

  const totalDays = Object.keys(shiftsByDate).length
  const totalHours =
    Math.round(
      shifts.reduce((sum, s) => sum + calcHours(s.start_time, s.end_time), 0) *
        10
    ) / 10

  const handleMonthChange = (delta: number) => {
    const d = new Date(selectedMonth + '-01')
    d.setMonth(d.getMonth() + delta)
    setSelectedMonth(format(d, 'yyyy-MM'))
  }

  return (
    <div className="px-4 pt-3 pb-24 space-y-4 animate-fade-in">
      {/* ヘッダー */}
      <div className="flex items-center gap-3">
        <div className="w-10 h-10 rounded-2xl bg-gradient-to-br from-violet-500 to-purple-600 flex items-center justify-center shadow-sm">
          <History className="h-5 w-5 text-white" />
        </div>
        <div>
          <h1 className="text-lg font-bold text-foreground">出勤履歴</h1>
          <p className="text-xs text-muted-foreground">確定済みシフトの記録</p>
        </div>
      </div>

      {/* 月ナビ */}
      <div className="flex items-center gap-2 bg-muted/40 rounded-2xl px-3 py-2">
        <button
          onClick={() => handleMonthChange(-1)}
          className="p-1.5 hover:bg-white rounded-xl transition-colors"
        >
          <ChevronLeft className="h-4 w-4" />
        </button>
        <div className="flex-1 text-center">
          <p className="text-sm font-bold text-foreground">{monthLabel}</p>
        </div>
        <button
          onClick={() => handleMonthChange(1)}
          className="p-1.5 hover:bg-white rounded-xl transition-colors"
        >
          <ChevronRight className="h-4 w-4" />
        </button>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-16">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      ) : (
        <>
          {/* サマリー */}
          <div className="grid grid-cols-2 gap-2">
            <div className="rounded-xl bg-gradient-to-br from-violet-50 to-purple-50/50 p-3 ring-1 ring-violet-100/50 animate-slide-up">
              <p className="text-[10px] text-violet-700/70 font-medium mb-1">
                出勤日数
              </p>
              <p className="text-xl font-extrabold text-violet-900 tabular-nums leading-none">
                {totalDays}
                <span className="text-xs font-bold ml-0.5">日</span>
              </p>
            </div>
            <div className="rounded-xl bg-gradient-to-br from-blue-50 to-indigo-50/50 p-3 ring-1 ring-blue-100/50 animate-slide-up" style={{ animationDelay: '60ms' }}>
              <p className="text-[10px] text-blue-700/70 font-medium mb-1">
                合計時間
              </p>
              <p className="text-xl font-extrabold text-blue-900 tabular-nums leading-none">
                {totalHours}
                <span className="text-xs font-bold ml-0.5">h</span>
              </p>
            </div>
          </div>

          {/* カレンダー */}
          <div className="bg-white rounded-2xl ring-1 ring-border/40 shadow-sm overflow-hidden">
            {/* 曜日ヘッダー */}
            <div className="grid grid-cols-7 border-b border-border/30">
              {DOW_LABELS.map((d, i) => (
                <div
                  key={d}
                  className={`text-center text-xs font-medium py-2 ${
                    i === 0
                      ? 'text-red-500'
                      : i === 6
                      ? 'text-blue-500'
                      : 'text-muted-foreground'
                  }`}
                >
                  {d}
                </div>
              ))}
            </div>
            {/* カレンダーセル */}
            <div className="p-2">
              <div className="grid grid-cols-7 gap-1">
                {Array.from({ length: firstDow }).map((_, i) => (
                  <div key={`e${i}`} />
                ))}
                {daysInMonth.map((d) => {
                  const dk = fmtKey(d)
                  const dayShifts = shiftsByDate[dk]
                  const hasShift = !!dayShifts && dayShifts.length > 0
                  const dow = getDay(d)
                  const hasPrep = dayShifts?.some((s) => s.type === '仕込み')
                  const hasService = dayShifts?.some((s) => s.type === '営業')
                  const bgColor = hasShift
                    ? hasPrep && hasService
                      ? 'bg-indigo-500'
                      : hasPrep
                      ? 'bg-amber-500'
                      : 'bg-blue-500'
                    : ''
                  return (
                    <div key={dk} className="flex flex-col items-center">
                      <div
                        className={`h-9 w-full rounded-xl flex flex-col items-center justify-center ${
                          hasShift ? `${bgColor} text-white shadow-sm` : ''
                        }`}
                      >
                        <span
                          className={`text-sm font-medium leading-none ${
                            !hasShift
                              ? dow === 0
                                ? 'text-red-500'
                                : dow === 6
                                ? 'text-blue-500'
                                : 'text-foreground'
                              : ''
                          }`}
                        >
                          {format(d, 'd')}
                        </span>
                        {hasShift && dayShifts.length === 1 && (
                          <span className="text-[7px] leading-none opacity-90 mt-0.5">
                            {formatTime(dayShifts[0].start_time)}
                          </span>
                        )}
                        {hasShift && dayShifts.length > 1 && (
                          <span className="text-[7px] leading-none opacity-90 mt-0.5">
                            ×{dayShifts.length}
                          </span>
                        )}
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>
          </div>

          {/* 凡例 */}
          <div className="flex items-center gap-4 px-1 text-xs text-muted-foreground">
            <span className="flex items-center gap-1.5">
              <span className="w-3 h-3 rounded bg-amber-500 inline-block" />
              仕込み
            </span>
            <span className="flex items-center gap-1.5">
              <span className="w-3 h-3 rounded bg-blue-500 inline-block" />
              営業
            </span>
            <span className="flex items-center gap-1.5">
              <span className="w-3 h-3 rounded bg-indigo-500 inline-block" />
              両方
            </span>
          </div>

          {/* シフト詳細リスト */}
          <div className="space-y-2">
            <h3 className="text-xs font-bold text-muted-foreground uppercase tracking-wider">
              シフト詳細
            </h3>
            {shifts.length === 0 ? (
              <div className="flex flex-col items-center py-10 text-center animate-fade-in">
                <CalendarDays className="h-8 w-8 text-muted-foreground/30 mb-2" />
                <p className="text-xs text-muted-foreground">
                  この月の出勤記録はありません
                </p>
              </div>
            ) : (
              <div className="space-y-1.5">
                {Object.entries(shiftsByDate)
                  .sort(([a], [b]) => a.localeCompare(b))
                  .map(([dk, dayShifts]) => {
                    const d = new Date(dk + 'T00:00:00')
                    const dow = getDay(d)
                    const isSunday = dow === 0
                    const isSaturday = dow === 6
                    const totalDayHours =
                      Math.round(
                        dayShifts.reduce(
                          (sum, s) => sum + calcHours(s.start_time, s.end_time),
                          0
                        ) * 10
                      ) / 10
                    return (
                      <div
                        key={dk}
                        className="rounded-2xl px-4 py-3 bg-white ring-1 ring-border/40 animate-slide-up"
                      >
                        <div className="flex items-start gap-3">
                          {/* 日付バッジ */}
                          <div
                            className={`w-10 h-10 rounded-xl flex flex-col items-center justify-center text-center shrink-0 ${
                              isSunday
                                ? 'bg-red-50 text-red-500'
                                : isSaturday
                                ? 'bg-blue-50 text-blue-500'
                                : 'bg-muted/50 text-muted-foreground'
                            }`}
                          >
                            <span className="text-[11px] font-bold leading-none">
                              {format(d, 'd')}
                            </span>
                            <span className="text-[9px] font-medium leading-none mt-0.5">
                              {format(d, 'E', { locale: ja })}
                            </span>
                          </div>

                          {/* シフト一覧（同日複数対応） */}
                          <div className="flex-1 min-w-0 space-y-1">
                            {dayShifts.map((s) => (
                              <div
                                key={s.id}
                                className="flex items-center gap-2 flex-wrap"
                              >
                                {/* 店舗バッジ */}
                                {s.shop_id && SHOPS[s.shop_id] && (
                                  <span className="text-[10px] px-1.5 py-0.5 rounded font-semibold shrink-0 bg-zinc-100 text-zinc-600">
                                    {SHOPS[s.shop_id]}
                                  </span>
                                )}
                                {/* シフト種別バッジ */}
                                <span
                                  className={`text-[10px] px-1.5 py-0.5 rounded font-semibold shrink-0 ${
                                    s.type === '仕込み'
                                      ? 'bg-amber-100 text-amber-700'
                                      : 'bg-blue-100 text-blue-700'
                                  }`}
                                >
                                  {s.type}
                                </span>
                                <span className="text-sm font-medium text-foreground tabular-nums">
                                  {formatTime(s.start_time)} – {formatTime(s.end_time)}
                                </span>
                                <span className="text-xs text-muted-foreground tabular-nums">
                                  {calcHours(s.start_time, s.end_time)}h
                                </span>
                              </div>
                            ))}
                          </div>

                          {/* 合計時間（右端） */}
                          {dayShifts.length > 1 && (
                            <div className="text-right shrink-0">
                              <p className="text-sm font-bold text-foreground tabular-nums">
                                {totalDayHours}h
                              </p>
                              <p className="text-[10px] text-muted-foreground">計</p>
                            </div>
                          )}
                        </div>
                      </div>
                    )
                  })}
              </div>
            )}
          </div>
        </>
      )}
    </div>
  )
}

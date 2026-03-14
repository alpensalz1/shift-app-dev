'use client'

import { useEffect, useState, useMemo } from 'react'
import { supabase } from '@/lib/supabase'
import { getStoredStaff } from '@/lib/auth'
import { ShiftFixed, Staff, WageHistory } from '@/types/database'
import { calcWage, calcHours, formatTime } from '@/lib/utils'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { format, startOfMonth, endOfMonth, getDay } from 'date-fns'
import { ja } from 'date-fns/locale'
import { Wallet, Clock, CalendarDays, ChevronLeft, ChevronRight, TrendingUp } from 'lucide-react'

/** シフト日付に対応した時給を取得（wage_history 参照） */
function getWageForDate(wageHistories: WageHistory[], staffId: number, date: string): number | null {
  const records = wageHistories
    .filter((w) => w.staff_id === staffId)
    .sort((a, b) => b.effective_from.localeCompare(a.effective_from))
  for (const r of records) {
    if (date >= r.effective_from && (!r.effective_to || date <= r.effective_to)) {
      return r.wage
    }
  }
  return records.length > 0 ? records[records.length - 1].wage : null
}

export default function SalaryPage() {
  const [staff, setStaff] = useState<Staff | null>(null)

  useEffect(() => {
    setStaff(getStoredStaff())
  }, [])
  const [shifts, setShifts] = useState<ShiftFixed[]>([])
  const [wageHistories, setWageHistories] = useState<WageHistory[]>([])
  const [loading, setLoading] = useState(true)
  const [fetchError, setFetchError] = useState('')
  const [selectedMonth, setSelectedMonth] = useState(() => format(new Date(), 'yyyy-MM'))

  useEffect(() => {
    if (!staff) return
    let cancelled = false

    const monthStart = format(startOfMonth(new Date(selectedMonth + '-01')), 'yyyy-MM-dd')
    const monthEnd = format(endOfMonth(new Date(selectedMonth + '-01')), 'yyyy-MM-dd')

    const fetchShifts = async () => {
      setLoading(true)
      setFetchError('')
      const [shiftRes, wageRes] = await Promise.all([
        supabase
          .from('shifts_fixed')
          .select('*')
          .eq('staff_id', staff.id)
          .gte('date', monthStart)
          .lte('date', monthEnd)
          .order('date', { ascending: true }),
        supabase
          .from('wage_history')
          .select('*')
          .eq('staff_id', staff.id),
      ])
      if (cancelled) return
      if (shiftRes.error) {
        setFetchError('シフトデータの取得に失敗しました: ' + shiftRes.error.message)
      } else {
        setShifts(shiftRes.data ?? [])
      }
      if (wageRes.error) {
        setFetchError(prev => prev ? prev + ' / ' + wageRes.error!.message : '時給履歴の取得に失敗しました: ' + wageRes.error!.message)
      } else {
        setWageHistories(wageRes.data ?? [])
      }
      setLoading(false)
    }

    fetchShifts()
    return () => { cancelled = true }
  }, [staff?.id, selectedMonth])

  const stats = useMemo(() => {
    if (!staff) return { totalWage: 0, totalHours: 0, shiftCount: 0 }

    let totalWage = 0
    let totalHours = 0

    shifts.forEach((s) => {
      // 過去の時給変更を考慮して該当日の時給を使用
      const wageAtDate = getWageForDate(wageHistories, staff.id, s.date) ?? staff.wage
      totalWage += calcWage(s.start_time, s.end_time, wageAtDate)
      totalHours += calcHours(s.start_time, s.end_time)
    })

    return {
      totalWage,
      totalHours: Math.round(totalHours * 10) / 10,
      shiftCount: new Set(shifts.map(s => s.date)).size,
    }
  }, [shifts, staff?.id, staff?.wage, wageHistories])

  const groupedByDate = useMemo(() => {
    const map: Record<string, ShiftFixed[]> = {}
    shifts.forEach((sh) => {
      const dk = sh.date.substring(0, 10)
      if (!map[dk]) map[dk] = []
      map[dk].push(sh)
    })
    return Object.entries(map).sort(([a], [b]) => a.localeCompare(b))
  }, [shifts])

  const monthLabel = format(new Date(selectedMonth + '-01'), 'yyyy年M月', { locale: ja })

  const handleMonthChange = (delta: number) => {
    const d = new Date(selectedMonth + '-01')
    d.setMonth(d.getMonth() + delta)
    setSelectedMonth(format(d, 'yyyy-MM'))
  }

  // staff未ロード中はスピナーを表示（null時にアルバイト専用メッセージが一瞬表示されるバグ防止）
  if (!staff) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="h-6 w-6 border-2 border-muted-foreground/20 border-t-muted-foreground rounded-full animate-spin" />
      </div>
    )
  }

  if (staff.employment_type !== 'アルバイト') {
    return (
      <div className="flex flex-col items-center justify-center py-20 text-center gap-4 animate-fade-in">
        <div className="w-16 h-16 rounded-2xl bg-muted/60 flex items-center justify-center">
          <Wallet className="h-7 w-7 text-muted-foreground/30" />
        </div>
        <div>
          <p className="text-sm font-semibold text-muted-foreground">アルバイト専用の機能です</p>
          <p className="text-xs text-muted-foreground/60 mt-1">社員の給与は別途ご確認ください</p>
        </div>
      </div>
    )
  }

  return (
    <div className="px-4 pt-3 pb-24 space-y-4">
      {/* Header */}
      <div>
        <h2 className="text-lg font-bold flex items-center gap-2 tracking-tight">
          <Wallet className="h-5 w-5" />
          給与概算
        </h2>
        <p className="text-xs text-muted-foreground mt-0.5">
          時給 <span className="font-bold tabular-nums">¥{staff?.wage?.toLocaleString()}</span>
          <span className="mx-1.5 text-muted-foreground/30">|</span>
          22時以降 1.25倍
        </p>
      </div>

      {/* Month selector - improved */}
      <div className="flex items-center justify-between bg-muted/40 rounded-2xl px-2 py-1.5">
        <button
          onClick={() => handleMonthChange(-1)}
          className="p-2 hover:bg-white rounded-xl transition-colors press-effect"
        >
          <ChevronLeft className="h-4 w-4 text-muted-foreground" />
        </button>
        <span className="text-sm font-bold">{monthLabel}</span>
        <button
          onClick={() => handleMonthChange(1)}
          className="p-2 hover:bg-white rounded-xl transition-colors press-effect"
        >
          <ChevronRight className="h-4 w-4 text-muted-foreground" />
        </button>
      </div>

      {fetchError && (
        <div className="rounded-xl bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700">
          {fetchError}
        </div>
      )}

      {loading ? (
        <div className="space-y-3">
          <div className="grid grid-cols-3 gap-2">
            <div className="skeleton h-20" />
            <div className="skeleton h-20" />
            <div className="skeleton h-20" />
          </div>
          <div className="skeleton h-40" />
        </div>
      ) : (
        <>
          {/* Stats cards - glassmorphism style */}
          <div className="grid grid-cols-3 gap-2">
            <div className="rounded-xl bg-gradient-to-br from-emerald-50 to-teal-50/50 p-3 ring-1 ring-emerald-100/50 animate-slide-up">
              <div className="flex items-center gap-1 mb-2">
                <div className="w-5 h-5 rounded-md bg-emerald-500/10 flex items-center justify-center">
                  <Wallet className="h-3 w-3 text-emerald-600" />
                </div>
                <span className="text-[9px] text-emerald-700/70 font-medium">合計給与</span>
              </div>
              <p className="text-base font-extrabold text-emerald-900 tabular-nums leading-none">
                ¥{Math.floor(stats.totalWage).toLocaleString()}
              </p>
            </div>

            <div className="rounded-xl bg-gradient-to-br from-blue-50 to-indigo-50/50 p-3 ring-1 ring-blue-100/50 animate-slide-up" style={{ animationDelay: '60ms' }}>
              <div className="flex items-center gap-1 mb-2">
                <div className="w-5 h-5 rounded-md bg-blue-500/10 flex items-center justify-center">
                  <Clock className="h-3 w-3 text-blue-600" />
                </div>
                <span className="text-[9px] text-blue-700/70 font-medium">合計時間</span>
              </div>
              <p className="text-base font-extrabold text-blue-900 tabular-nums leading-none">
                {stats.totalHours}<span className="text-xs font-bold ml-0.5">h</span>
              </p>
            </div>

            <div className="rounded-xl bg-gradient-to-br from-purple-50 to-fuchsia-50/50 p-3 ring-1 ring-purple-100/50 animate-slide-up" style={{ animationDelay: '120ms' }}>
              <div className="flex items-center gap-1 mb-2">
                <div className="w-5 h-5 rounded-md bg-purple-500/10 flex items-center justify-center">
                  <CalendarDays className="h-3 w-3 text-purple-600" />
                </div>
                <span className="text-[9px] text-purple-700/70 font-medium">勤務日数</span>
              </div>
              <p className="text-base font-extrabold text-purple-900 tabular-nums leading-none">
                {stats.shiftCount}<span className="text-xs font-bold ml-0.5">日</span>
              </p>
            </div>
          </div>

          {/* Shift list */}
          <div className="space-y-2">
            <h3 className="text-xs font-bold text-muted-foreground uppercase tracking-wider">シフト詳細</h3>
            {shifts.length === 0 ? (
              <div className="flex flex-col items-center py-12 animate-fade-in">
                <div className="w-12 h-12 rounded-2xl bg-muted/60 flex items-center justify-center mb-3">
                  <CalendarDays className="h-5 w-5 text-muted-foreground/30" />
                </div>
                <p className="text-xs text-muted-foreground">この月のシフトはありません</p>
              </div>
            ) : (
              <div className="space-y-1.5">
                {groupedByDate.map(([dk, dayShifts], i) => {
                  const d = new Date(dk + 'T00:00:00')
                  const dow = getDay(d)
                  const isSunday = dow === 0
                  const isSaturday = dow === 6
                  const totalWage = Math.floor(
                    dayShifts.reduce((sum, sh) => {
                      const wageAtDate = getWageForDate(wageHistories, staff.id, dk) ?? staff.wage
                      return sum + calcWage(sh.start_time, sh.end_time, wageAtDate)
                    }, 0)
                  )
                  const totalHours = Math.round(
                    dayShifts.reduce((sum, sh) => sum + calcHours(sh.start_time, sh.end_time), 0) * 10
                  ) / 10

                  return (
                    <div
                      key={dk}
                      className="flex items-center justify-between text-xs p-3 rounded-xl bg-white ring-1 ring-border/40 animate-slide-up"
                      style={{ animationDelay: `${i * 30}ms` }}
                    >
                      <div className="flex items-center gap-3">
                        <div className={`w-9 h-9 rounded-lg flex flex-col items-center justify-center text-center ${
                          isSunday ? 'bg-red-50 text-red-500' :
                          isSaturday ? 'bg-blue-50 text-blue-500' :
                          'bg-muted/50 text-muted-foreground'
                        }`}>
                          <span className="text-[11px] font-bold leading-none">{format(d, 'd')}</span>
                          <span className="text-[9px] font-medium leading-none mt-0.5">{format(d, 'E', { locale: ja })}</span>
                        </div>
                        <div className="space-y-0.5">
                          {dayShifts.map((sh) => (
                            <div key={sh.id} className="flex items-center gap-1.5">
                              <span className={`text-[9px] px-1 py-0.5 rounded font-semibold ${sh.type === '仕込み' ? 'bg-amber-100 text-amber-700' : 'bg-blue-100 text-blue-700'}`}>
                                {sh.type}
                              </span>
                              <span>{formatTime(sh.start_time)} - {formatTime(sh.end_time)}</span>
                              <span className="text-muted-foreground">{calcHours(sh.start_time, sh.end_time)}h</span>
                            </div>
                          ))}
                        </div>
                      </div>
                      <div className="text-right">
                        <p className="font-bold text-sm tabular-nums text-emerald-700">¥{totalWage.toLocaleString()}</p>
                        <p className="text-muted-foreground text-[10px]">{totalHours}h</p>
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

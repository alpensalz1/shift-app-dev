'use client'

import { useEffect, useState, useMemo } from 'react'
import { supabase } from '@/lib/supabase'
import { getStoredStaff } from '@/lib/auth'
import { ShiftFixed , Staff} from '@/types/database'
import { calcWage, calcHours, formatTime } from '@/lib/utils'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { format, startOfMonth, endOfMonth } from 'date-fns'
import { ja } from 'date-fns/locale'
import { Wallet, Clock, CalendarDays } from 'lucide-react'

export default function SalaryPage() {
  const [staff, setStaff] = useState<Staff | null>(null)

  useEffect(() => {
    setStaff(getStoredStaff())
  }, [])
  const [shifts, setShifts] = useState<ShiftFixed[]>([])
  const [loading, setLoading] = useState(true)
  const [selectedMonth, setSelectedMonth] = useState(() => format(new Date(), 'yyyy-MM'))

  useEffect(() => {
    if (!staff) return

    const monthStart = format(startOfMonth(new Date(selectedMonth + '-01')), 'yyyy-MM-dd')
    const monthEnd = format(endOfMonth(new Date(selectedMonth + '-01')), 'yyyy-MM-dd')

    const fetchShifts = async () => {
      setLoading(true)
      const { data } = await supabase
        .from('shifts_fixed')
        .select('*')
        .eq('staff_id', staff.id)
        .gte('date', monthStart)
        .lte('date', monthEnd)
        .order('date', { ascending: true })

      if (data) setShifts(data)
      setLoading(false)
    }

    fetchShifts()
  }, [staff?.id, selectedMonth])

  const stats = useMemo(() => {
    if (!staff) return { totalWage: 0, totalHours: 0, shiftCount: 0, nightHours: 0 }

    let totalWage = 0
    let totalHours = 0

    shifts.forEach((s) => {
      totalWage += calcWage(s.start_time, s.end_time, staff.wage)
      totalHours += calcHours(s.start_time, s.end_time)
    })

    return {
      totalWage,
      totalHours: Math.round(totalHours * 10) / 10,
      shiftCount: new Set(shifts.map(s => s.date)).size,
    }
  }, [shifts, staff?.wage])

  const monthLabel = format(new Date(selectedMonth + '-01'), 'yyyy年M月', { locale: ja })

  // 前月/次月
  const handleMonthChange = (delta: number) => {
    const d = new Date(selectedMonth + '-01')
    d.setMonth(d.getMonth() + delta)
    setSelectedMonth(format(d, 'yyyy-MM'))
  }

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-lg font-bold flex items-center gap-2">
          <Wallet className="h-5 w-5" />
          給与概算
        </h2>
        <p className="text-sm text-muted-foreground">
          時給 ¥{staff?.wage?.toLocaleString()} / 22時以降 1.25倍
        </p>
      </div>

      {/* 月選択 */}
      <div className="flex items-center justify-center gap-4">
        <button
          onClick={() => handleMonthChange(-1)}
          className="p-2 rounded-lg hover:bg-accent transition-colors"
        >
          ‹
        </button>
        <span className="text-base font-semibold min-w-[120px] text-center">{monthLabel}</span>
        <button
          onClick={() => handleMonthChange(1)}
          className="p-2 rounded-lg hover:bg-accent transition-colors"
        >
          ›
        </button>
      </div>

      {/* メイン金額 */}
      <Card className="bg-zinc-900 text-white border-0">
        <CardContent className="pt-6 pb-6 text-center">
          <p className="text-sm text-zinc-400 mb-1">概算給与（税引前）</p>
          {loading ? (
            <div className="h-10 animate-pulse bg-zinc-800 rounded w-40 mx-auto" />
          ) : (
            <p className="text-4xl font-bold tabular-nums tracking-tight">
              ¥{stats.totalWage.toLocaleString()}
            </p>
          )}
        </CardContent>
      </Card>

      {/* 統計 */}
      <div className="grid grid-cols-2 gap-3">
        <Card>
          <CardContent className="pt-4 pb-4 text-center">
            <Clock className="h-4 w-4 mx-auto mb-1 text-muted-foreground" />
            <p className="text-2xl font-bold tabular-nums">{stats.totalHours}h</p>
            <p className="text-xs text-muted-foreground">{monthLabel}の勤務</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4 pb-4 text-center">
            <CalendarDays className="h-4 w-4 mx-auto mb-1 text-muted-foreground" />
            <p className="text-2xl font-bold tabular-nums">{stats.shiftCount}日</p>
            <p className="text-xs text-muted-foreground">出勤日数</p>
          </CardContent>
        </Card>
      </div>

      {/* シフト明細 */}
      {shifts.length > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">シフト明細</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
                          {Object.entries(
              shifts.reduce((acc, s) => {
                const key = s.date
                if (!acc[key]) acc[key] = []
                acc[key].push(s)
                return acc
              }, {} as Record<string, typeof shifts>)
            )
              .sort(([a], [b]) => a.localeCompare(b))
              .map(([date, dayShifts]) => {
                const totalWage = staff
                  ? Math.round(dayShifts.reduce((sum, s) => sum + calcWage(s.start_time, s.end_time, staff.wage), 0))
                  : 0
                const totalHours = Math.round(dayShifts.reduce((sum, s) => sum + calcHours(s.start_time, s.end_time), 0) * 10) / 10
                return (
                  <div key={date} className="py-2 border-b last:border-0">
                    <div className="flex items-center justify-between">
                      <div>
                        <span className="text-sm font-medium">
                          {format(new Date(date + 'T00:00:00'), 'M/d (E)', { locale: ja })}
                        </span>
                        <span className="text-xs text-muted-foreground ml-2">{totalHours}h</span>
                      </div>
                      <p className="text-sm font-medium tabular-nums">¥{totalWage.toLocaleString()}</p>
                    </div>
                    <div className="flex flex-wrap gap-x-3 mt-0.5">
                      {dayShifts.map((s, idx) => (
                        <span key={idx} className="text-xs text-muted-foreground">
                          {s.type} {formatTime(s.start_time)}–{formatTime(s.end_time)}
                        </span>
                      ))}
                    </div>
                  </div>
                )
              })
                          }
            </div>
          </CardContent>
        </Card>
      )}

      {!loading && shifts.length === 0 && (
        <p className="text-center text-sm text-muted-foreground py-8">
          この月の確定シフトはまだありません
        </p>
      )}
    </div>
  )
}

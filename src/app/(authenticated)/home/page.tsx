'use client'

import { useEffect, useState, useMemo, useCallback } from 'react'
import { supabase } from '@/lib/supabase'
import { ShiftFixedWithStaff } from '@/types/database'
import { formatTime } from '@/lib/utils'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { AlertCircle, MapPin, Users, ChevronLeft, ChevronRight } from 'lucide-react'
import { format, addDays, startOfWeek, isSameDay, getDay } from 'date-fns'
import { ja } from 'date-fns/locale'

const SHOPS = [
  { id: 1, name: '三軒茶屋' },
  { id: 2, name: '下北沢' },
]

const SHOP_STYLES: Record<number, { card: string; icon: string; badge: string }> = {
  1: { card: 'border-l-4 border-l-amber-400 bg-amber-50/30', icon: 'text-amber-600', badge: 'bg-amber-100 text-amber-800' },
  2: { card: 'border-l-4 border-l-violet-400 bg-violet-50/30', icon: 'text-violet-600', badge: 'bg-violet-100 text-violet-800' },
}

// Sort: 社員 first, then アルバイト by latest start DESC, then earliest end ASC
function sortShifts(shifts: ShiftFixedWithStaff[]): ShiftFixedWithStaff[] {
  const byStaff = new Map<number, ShiftFixedWithStaff[]>()
  for (const s of shifts) {
    if (!byStaff.has(s.staff_id)) byStaff.set(s.staff_id, [])
    byStaff.get(s.staff_id)!.push(s)
  }
  const entries = Array.from(byStaff.values()).map(ss => {
    const sorted = [...ss].sort((a, b) => a.start_time.localeCompare(b.start_time))
    const latestStart = sorted.reduce((m, s) => s.start_time > m ? s.start_time : m, '00:00:00')
    const earliestEnd = sorted.reduce((m, s) => {
      const t = s.end_time ?? '24:00:00'
      return t < m ? t : m
    }, '99:00:00')
    return { shifts: sorted, latestStart, earliestEnd, empType: sorted[0].staff?.employment_type }
  })
  entries.sort((a, b) => {
    const aShanin = a.empType === '社員'
    const bShanin = b.empType === '社員'
    if (aShanin !== bShanin) return aShanin ? -1 : 1
    if (a.latestStart !== b.latestStart) return b.latestStart.localeCompare(a.latestStart)
    return a.earliestEnd.localeCompare(b.earliestEnd)
  })
  return entries.flatMap(e => e.shifts)
}

function ShopCard({ shopName, shifts, style }: {
  shopName: string
  shifts: ShiftFixedWithStaff[]
  style: { card: string; icon: string; badge: string }
}) {
  const sorted = useMemo(() => sortShifts(shifts), [shifts])
  const staffCount = useMemo(() => new Set(shifts.map(s => s.staff_id)).size, [shifts])
  const byStaff = useMemo(() => {
    const map = new Map<number, ShiftFixedWithStaff[]>()
    for (const s of sorted) {
      if (!map.has(s.staff_id)) map.set(s.staff_id, [])
      map.get(s.staff_id)!.push(s)
    }
    return Array.from(map.values())
  }, [sorted])

  return (
    <Card className={style.card}>
      <CardHeader className="pb-2 pt-3 px-3">
        <CardTitle className="text-sm flex items-center gap-1.5">
          <MapPin className={`h-3.5 w-3.5 ${style.icon}`} />
          {shopName}
          <span className={`ml-auto text-[10px] px-2 py-0.5 rounded-full font-normal ${style.badge}`}>
            <Users className="inline h-3 w-3 mr-0.5" />{staffCount}名
          </span>
        </CardTitle>
      </CardHeader>
      <CardContent className="px-3 pb-3 space-y-0">
        {byStaff.map((staffShifts) => {
          const staff = staffShifts[0].staff
          const isShanin = staff?.employment_type === '社員'
          return (
            <div key={staffShifts[0].staff_id} className="flex items-start justify-between py-1.5 border-b border-border/30 last:border-0">
              <div className="flex items-center gap-1.5">
                <span className="text-sm font-medium">{staff?.name}</span>
                {isShanin && (
                  <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-zinc-100 text-zinc-500">社員</span>
                )}
              </div>
              <div className="flex flex-col items-end gap-0.5">
                {staffShifts.map(s => (
                  <span key={s.id} className="text-xs text-muted-foreground tabular-nums">
                    {formatTime(s.start_time)}–{formatTime(s.end_time)}
                  </span>
                ))}
              </div>
            </div>
          )
        })}
      </CardContent>
    </Card>
  )
}

export default function HomePage() {
  const todayStr = format(new Date(), 'yyyy-MM-dd')
  const [selectedDate, setSelectedDate] = useState(new Date())
  const [weekOffset, setWeekOffset] = useState(0)
  const [shifts, setShifts] = useState<ShiftFixedWithStaff[]>([])
  const [loading, setLoading] = useState(false)
  const [rejectedCount, setRejectedCount] = useState(0)

  const selectedDateStr = format(selectedDate, 'yyyy-MM-dd')
  const isToday = selectedDateStr === todayStr

  const weekStart = useMemo(
    () => addDays(startOfWeek(new Date(), { weekStartsOn: 1 }), weekOffset * 7),
    [weekOffset]
  )
  const weekDays = useMemo(
    () => Array.from({ length: 7 }, (_, i) => addDays(weekStart, i)),
    [weekStart]
  )

  const fetchShifts = useCallback(async (dateStr: string) => {
    setLoading(true)
    const { data } = await supabase
      .from('shifts_fixed')
      .select('*, staff:staffs(*)')
      .eq('date', dateStr)
      .order('start_time', { ascending: true })
    if (data) setShifts(data as ShiftFixedWithStaff[])
    setLoading(false)
  }, [])

  const fetchRejectedCount = useCallback(async () => {
    const { count } = await supabase
      .from('shift_requests')
      .select('*', { count: 'exact', head: true })
      .eq('status', 'rejected')
    if (count != null) setRejectedCount(count)
  }, [])

  useEffect(() => {
    fetchShifts(selectedDateStr)
    fetchRejectedCount()
    const channel = supabase
      .channel(`home-${selectedDateStr}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'shifts_fixed', filter: `date=eq.${selectedDateStr}` }, () => fetchShifts(selectedDateStr))
      .subscribe()
    return () => { supabase.removeChannel(channel) }
  }, [selectedDateStr, fetchShifts, fetchRejectedCount])

  const dateLabel = isToday
    ? `今日（${format(selectedDate, 'M月d日(E)', { locale: ja })}）`
    : format(selectedDate, 'M月d日(E)', { locale: ja })

  return (
    <div className="space-y-3 p-4">
      {rejectedCount > 0 && (
        <div className="bg-red-50 border border-red-200 rounded-lg p-3 flex items-start gap-2">
          <AlertCircle className="h-4 w-4 text-red-600 mt-0.5 flex-shrink-0" />
          <div>
            <p className="text-sm font-medium text-red-800">{rejectedCount}件のシフト申請が却下されました</p>
            <p className="text-xs text-red-600 mt-0.5">シフト申請ページから確認・修正してください</p>
          </div>
        </div>
      )}

      <Card>
        <CardContent className="p-2">
          <div className="flex items-center gap-0.5">
            <button
              onClick={() => setWeekOffset(w => w - 1)}
              className="p-1.5 rounded-lg hover:bg-accent transition-colors flex-shrink-0"
            >
              <ChevronLeft className="h-4 w-4" />
            </button>
            <div className="flex gap-0.5 flex-1">
              {weekDays.map((date, i) => {
                const isSelected = isSameDay(date, selectedDate)
                const isTodayDate = isSameDay(date, new Date())
                const dow = getDay(date)
                return (
                  <button
                    key={i}
                    onClick={() => setSelectedDate(date)}
                    className={`flex flex-col items-center rounded-lg py-1.5 flex-1 transition-colors
                      ${isSelected ? 'bg-zinc-900 text-white' : 'hover:bg-accent'}
                      ${!isSelected && isTodayDate ? 'ring-1 ring-zinc-400' : ''}
                    `}
                  >
                    <span className={`text-[9px] leading-tight
                      ${isSelected ? 'text-zinc-300' : dow === 0 ? 'text-red-400' : dow === 6 ? 'text-blue-400' : 'text-muted-foreground'}
                    `}>
                      {format(date, 'E', { locale: ja })}
                    </span>
                    <span className={`text-sm font-semibold leading-snug
                      ${isSelected ? 'text-white' : ''}
                      ${!isSelected && isTodayDate ? 'underline' : ''}
                    `}>
                      {format(date, 'd')}
                    </span>
                  </button>
                )
              })}
            </div>
            <button
              onClick={() => setWeekOffset(w => w + 1)}
              className="p-1.5 rounded-lg hover:bg-accent transition-colors flex-shrink-0"
            >
              <ChevronRight className="h-4 w-4" />
            </button>
          </div>
        </CardContent>
      </Card>

      <p className="text-sm font-medium text-muted-foreground px-0.5">
        {dateLabel}のシフト
      </p>

      {loading ? (
        <div className="text-center text-sm text-muted-foreground py-8 animate-pulse">読み込み中...</div>
      ) : shifts.length === 0 ? (
        <div className="text-center text-sm text-muted-foreground py-8">
          この日のシフトはまだ確定していません
        </div>
      ) : (
        <div className="space-y-3">
          {SHOPS.map(shop => {
            const shopShifts = shifts.filter(s => s.shop_id === shop.id)
            if (shopShifts.length === 0) return null
            return (
              <ShopCard
                key={shop.id}
                shopName={shop.name}
                shifts={shopShifts}
                style={SHOP_STYLES[shop.id]}
              />
            )
          })}
        </div>
      )}
    </div>
  )
}

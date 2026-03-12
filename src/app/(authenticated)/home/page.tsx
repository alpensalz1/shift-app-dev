'use client'

import { useEffect, useState, useMemo, useCallback } from 'react'
import { supabase } from '@/lib/supabase'
import { getStoredStaff } from '@/lib/auth'
import { ShiftFixedWithStaff } from '@/types/database'
import { formatTime } from '@/lib/utils'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { AlertCircle, MapPin, Users, ChevronLeft, ChevronRight, Star } from 'lucide-react'
import { format, addDays, startOfWeek, isSameDay, getDay } from 'date-fns'
import { ja } from 'date-fns/locale'

const SHOPS = [
  { id: 1, name: '三軒茶屋' },
  { id: 2, name: '下北沢' },
]

const COLORS: Record<number, { card: string; icon: string; badge: string }> = {
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

function ShopCard({ shopName, shifts, style, currentStaffId }: {
  shopName: string
  shifts: ShiftFixedWithStaff[]
  style: { card: string; icon: string; badge: string }
  currentStaffId: number | null
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
          const isMe = currentStaffId != null && staffShifts[0].staff_id === currentStaffId
          return (
            <div
              key={staffShifts[0].staff_id}
              className={`flex items-start justify-between py-1.5 border-b border-border/30 last:border-0 -mx-1 px-1 rounded-md transition-colors ${
                isMe ? 'bg-blue-50/80 ring-1 ring-blue-200/60' : ''
              }`}
            >
              <div className="flex items-center gap-1.5">
                {isMe && (
                  <span className="relative flex h-2 w-2">
                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-blue-400 opacity-75" />
                    <span className="relative inline-flex rounded-full h-2 w-2 bg-blue-500" />
                  </span>
                )}
                <span className={`text-sm font-medium ${isMe ? 'text-blue-700' : ''}`}>{staff?.name}</span>
                {isMe && (
                  <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-blue-100 text-blue-600 font-semibold">
                    あなた
                  </span>
                )}
                {isShanin && (
                  <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-zinc-100 text-zinc-500">社員</span>
                )}
              </div>
              <div className="flex flex-col items-end gap-0.5">
                {staffShifts.map(s => (
                  <span key={s.id} className={`text-xs tabular-nums ${isMe ? 'text-blue-600 font-medium' : 'text-muted-foreground'}`}>
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
  const [selectedDate, setSelectedDate] = useState(() => new Date())
  const [shifts, setShifts] = useState<ShiftFixedWithStaff[]>([])
  const [loading, setLoading] = useState(true)
  const [currentStaffId, setCurrentStaffId] = useState<number | null>(null)

  useEffect(() => {
    const staff = getStoredStaff()
    if (staff) setCurrentStaffId(staff.id)
  }, [])

  useEffect(() => {
    const fetchShifts = async () => {
      setLoading(true)
      try {
        const dateStr = format(selectedDate, 'yyyy-MM-dd')
        const weekStart = startOfWeek(selectedDate, { weekStartsOn: 0 })
        const weekEnd = addDays(weekStart, 6)

        const { data, error } = await supabase
          .from('shifts_fixed')
          .select('*, staff:staffs(*)')
          .gte('date', format(weekStart, 'yyyy-MM-dd'))
          .lte('date', format(weekEnd, 'yyyy-MM-dd'))

        if (error) throw error
        setShifts(data || [])
      } catch (err) {
        console.error(err)
      } finally {
        setLoading(false)
      }
    }

    fetchShifts()
  }, [selectedDate])

  const shiftsByShop = useMemo(() => {
    const shops: Record<number, ShiftFixedWithStaff[]> = {}
    for (const shop of SHOPS) {
      shops[shop.id] = shifts.filter(s => s.shop_id === shop.id)
    }
    return shops
  }, [shifts])

  const handlePrevWeek = useCallback(() => {
    setSelectedDate(prev => addDays(prev, -7))
  }, [])

  const handleNextWeek = useCallback(() => {
    setSelectedDate(prev => addDays(prev, 7))
  }, [])

  return (
    <div className="px-4 pt-4 pb-24 max-w-lg mx-auto space-y-4">
      <div className="flex items-center justify-between">
        <button
          onClick={handlePrevWeek}
          className="p-1.5 hover:bg-secondary rounded-lg transition-colors"
        >
          <ChevronLeft className="h-5 w-5" />
        </button>
        <div className="text-center">
          <p className="text-xs text-muted-foreground">週</p>
          <p className="text-sm font-semibold">
            {format(startOfWeek(selectedDate, { weekStartsOn: 0 }), 'M/d', { locale: ja })} 〜 {format(addDays(startOfWeek(selectedDate, { weekStartsOn: 0 }), 6), 'M/d', { locale: ja })}
          </p>
        </div>
        <button
          onClick={handleNextWeek}
          className="p-1.5 hover:bg-secondary rounded-lg transition-colors"
        >
          <ChevronRight className="h-5 w-5" />
        </button>
      </div>

      {loading ? (
        <div className="text-center py-8">
          <p className="text-sm text-muted-foreground">読み込み中...</p>
        </div>
      ) : shifts.length === 0 ? (
        <div className="text-center py-8">
          <AlertCircle className="h-8 w-8 mx-auto text-muted-foreground mb-2" />
          <p className="text-sm text-muted-foreground">シフトがありません</p>
        </div>
      ) : (
        <div className="space-y-3">
          {SHOPS.map(shop => (
            shiftsByShop[shop.id].length > 0 && (
              <ShopCard
                key={shop.id}
                shopName={shop.name}
                shifts={shiftsByShop[shop.id]}
                style={COLORS[shop.id]}
                currentStaffId={currentStaffId}
              />
            )
          ))}
        </div>
      )}
    </div>
  )
}

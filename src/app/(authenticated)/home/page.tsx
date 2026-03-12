'use client'

import { useEffect, useState, useMemo, useCallback } from 'react'
import { supabase } from '@/lib/supabase'
import { getStoredStaff } from '@/lib/auth'
import { ShiftFixedWithStaff } from '@/types/database'
import { formatTime } from '@/lib/utils'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { AlertCircle, MapPin, Users, ChevronLeft, ChevronRight } from 'lucide-react'
import { format, addDays, startOfWeek, isSameDay } from 'date-fns'
import { ja } from 'date-fns/locale'

const SHOPS = [
  { id: 1, name: '三㻒茶屋' },
  { id: 2, name: '下北沢' },
]

const DAY_LABELS = ['日', '月', '火', '水', '木', '金', '土']

const COLORS: Record<number, { card: string; icon: string; badge: string }> = {
  1: { card: 'border-l-4 border-l-amber-400 bg-amber-50/30', icon: 'text-amber-600', badge: 'bg-amber-100 text-amber-800' },
  2: { card: 'border-l-4 border-l-violet-400 bg-violet-50/30', icon: 'text-violet-600', badge: 'bg-violet-100 text-violet-800' },
}

const TYPE_STYLES: Record<string, string> = {
  '仕込み': 'bg-orange-100 text-orange-700',
  '営業': 'bg-emerald-100 text-emerald-700',
}

function ShopCard({ shopName, shifts, style, currentStaffId }: {
  shopName: string
  shifts: ShiftFixedWithStaff[]
  style: { card: string; icon: string; badge: string }
  currentStaffId: number | null
}) {
  const staffCount = useMemo(() => new Set(shifts.map(s => s.staff_id)).size, [shifts])

  // Group by staff, sort: 社員 first, then by start_time
  const byStaff = useMemo(() => {
    const map = new Map<number, ShiftFixedWithStaff[]>()
    for (const s of shifts) {
      if (!map.has(s.staff_id)) map.set(s.staff_id, [])
      map.get(s.staff_id)!.push(s)
    }
    const entries = Array.from(map.values())
    entries.sort((a, b) => {
      const aEmp = a[0].staff?.employment_type === '社員'
      const bEmp = b[0].staff?.employment_type === '社員'
      if (aEmp !== bEmp) return aEmp ? -1 : 1
      return a[0].start_time.localeCompare(b[0].start_time)
    })
    return entries
  }, [shifts])

  if (shifts.length === 0) return null

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
          const isYakuin = staff?.employment_type === '役員'
          const isMe = currentStaffId != null && staffShifts[0].staff_id === currentStaffId
          return (
            <div
              key={staffShifts[0].staff_id}
              className={`flex items-center justify-between py-2 border-b border-border/30 last:border-0 -mx-1 px-2 rounded-md transition-colors ${
                isMe ? 'bg-blue-50/80 ring-1 ring-blue-200/60' : ''
              }`}
            >
              <div className="flex items-center gap-1.5 min-w-0">
                {isMe && (
                  <span className="relative flex h-2 w-2 shrink-0">
                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-blue-400 opacity-75" />
                    <span className="relative inline-flex rounded-full h-2 w-2 bg-blue-500" />
                  </span>
                )}
                <span className={`text-sm font-medium truncate ${isMe ? 'text-blue-700' : ''}`}>{staff?.name}</span>
                {isMe && (
                  <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-blue-100 text-blue-600 font-semibold shrink-0">
                    あなた
                  </span>
                )}
                {isShanin && (
                  <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-zinc-100 text-zinc-500 shrink-0">社員</span>
                )}
                {isYakuin && (
                  <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-amber-100 text-amber-700 shrink-0">役員</span>
                )}
              </div>
              <div className="flex items-center gap-1.5 shrink-0 ml-2">
                {staffShifts.map(s => (
                  <div key={s.id} className="flex items-center gap-1">
                    {s.type && (
                      <span className={`text-[9px] px-1 py-0.5 rounded ${TYPE_STYLES[s.type] || 'bg-gray-100 text-gray-600'}`}>
                        {s.type}
                      </span>
                    )}
                    <span className={`text-xs tabular-nums ${isMe ? 'text-blue-600 font-medium' : 'text-muted-foreground'}`}>
                      {formatTime(s.start_time)}–{formatTime(s.end_time)}
                    </span>
                  </div>
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
  const today = useMemo(() => new Date(), [])
  const [selectedDate, setSelectedDate] = useState(() => new Date())
  const [shifts, setShifts] = useState<ShiftFixedWithStaff[]>([])
  const [loading, setLoading] = useState(true)
  const [currentStaffId, setCurrentStaffId] = useState<number | null>(null)

  const weekStart = useMemo(() => startOfWeek(selectedDate, { weekStartsOn: 0 }), [selectedDate])
  const weekDays = useMemo(() => Array.from({ length: 7 }, (_, i) => addDays(weekStart, i)), [weekStart])

  useEffect(() => {
    const staff = getStoredStaff()
    if (staff) setCurrentStaffId(staff.id)
  }, [])

  useEffect(() => {
    const fetchShifts = async () => {
      setLoading(true)
      try {
        const ws = startOfWeek(selectedDate, { weekStartsOn: 0 })
        const we = addDays(ws, 6)
        const { data, error } = await supabase
          .from('shifts_fixed')
          .select('*, staff:staffs(*)')
          .gte('date', format(ws, 'yyyy-MM-dd'))
          .lte('date', format(we, 'yyyy-MM-dd'))
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

  // Filter shifts for selected day only
  const dayShifts = useMemo(() => {
    const dateStr = format(selectedDate, 'yyyy-MM-dd')
    return shifts.filter(s => s.date === dateStr)
  }, [shifts, selectedDate])

  const shiftsByShop = useMemo(() => {
    const shops: Record<number, ShiftFixedWithStaff[]> = {}
    for (const shop of SHOPS) {
      shops[shop.id] = dayShifts.filter(s => s.shop_id === shop.id)
    }
    return shops
  }, [dayShifts])

  const handlePrevWeek = useCallback(() => {
    setSelectedDate(prev => addDays(prev, -7))
  }, [])

  const handleNextWeek = useCallback(() => {
    setSelectedDate(prev => addDays(prev, 7))
  }, [])

  const isToday = isSameDay(selectedDate, today)

  return (
    <div className="px-4 pt-3 pb-24 max-w-lg mx-auto space-y-3">
      {/* Week navigation */}
      <div className="flex items-center justify-between">
        <button onClick={handlePrevWeek} className="p-1.5 hover:bg-secondary rounded-lg transition-colors">
          <ChevronLeft className="h-4 w-4" />
        </button>
        <p className="text-xs font-medium text-muted-foreground">
          {format(weekStart, 'M月d日', { locale: ja })} 〜 {format(addDays(weekStart, 6), 'M月d日', { locale: ja })}
        </p>
        <button onClick={handleNextWeek} className="p-1.5 hover:bg-secondary rounded-lg transition-colors">
          <ChevronRight className="h-4 w-4" />
        </button>
      </div>

      {/* Day selector tabs */}
      <div className="grid grid-cols-7 gap-1 bg-muted/50 rounded-xl p-1">
        {weekDays.map((day, i) => {
          const isSelected = isSameDay(day, selectedDate)
          const isDayToday = isSameDay(day, today)
          const dayHasShifts = shifts.some(s => s.date === format(day, 'yyyy-MM-dd'))
          return (
            <button
              key={i}
              onClick={() => setSelectedDate(day)}
              className={`flex flex-col items-center py-1.5 rounded-lg transition-all text-center ${
                isSelected
                  ? isDayToday
                    ? 'bg-blue-500 text-white shadow-sm'
                    : 'bg-white text-foreground shadow-sm'
                  : isDayToday
                    ? 'text-blue-600 font-semibold'
                    : 'text-muted-foreground hover:bg-white/60'
              }`}
            >
              <span className={`text-[10px] leading-none ${i === 0 ? 'text-red-400' : i === 6 ? 'text-blue-400' : ''} ${isSelected ? 'text-inherit' : ''}`}>
                {DAY_LABELS[i]}
              </span>
              <span className={`text-sm font-semibold leading-tight mt-0.5 ${isSelected ? '' : ''}`}>
                {format(day, 'd')}
              </span>
              {dayHasShifts && !isSelected && (
                <span className="w-1 h-1 rounded-full bg-current opacity-40 mt-0.5" />
              )}
            </button>
          )
        })}
      </div>

      {/* Selected date header */}
      <div className="flex items-center gap-2">
        <h2 className="text-base font-bold">
          {format(selectedDate, 'M月d日（E）', { locale: ja })}
        </h2>
        {isToday && (
          <span className="text-[10px] px-2 py-0.5 rounded-full bg-blue-500 text-white font-semibold">
            今日
          </span>
        )}
        <span className="ml-auto text-xs text-muted-foreground">
          {dayShifts.length > 0 ? `${new Set(dayShifts.map(s => s.staff_id)).size}名出勤` : ''}
        </span>
      </div>

      {/* Shift cards */}
      {loading ? (
        <div className="text-center py-8">
          <p className="text-sm text-muted-foreground">読み込み中...</p>
        </div>
      ) : dayShifts.length === 0 ? (
        <div className="text-center py-12">
          <AlertCircle className="h-8 w-8 mx-auto text-muted-foreground/50 mb-2" />
          <p className="text-sm text-muted-foreground">この日のシフトはありません</p>
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

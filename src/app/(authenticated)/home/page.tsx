'use client'

import { useEffect, useState, useMemo, useCallback } from 'react'
import { supabase } from '@/lib/supabase'
import { getStoredStaff } from '@/lib/auth'
import { ShiftFixedWithStaff, ShiftRequest } from '@/types/database'
import { formatTime } from '@/lib/utils'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { AlertCircle, MapPin, Users, ChevronLeft, ChevronRight, Clock } from 'lucide-react'
import { format, addDays, startOfWeek, isSameDay } from 'date-fns'
import { ja } from 'date-fns/locale'

const SHOPS = [
  { id: 1, name: '三軒茶屋' },
  { id: 2, name: '下北沢' },
]

const DAY_LABELS = ['日', '月', '火', '水', '木', '金', '土']

const COLORS: Record<number, { card: string; border: string; icon: string; badge: string; highlight: string }> = {
  1: {
    card: 'bg-gradient-to-br from-amber-50/80 to-orange-50/40',
    border: 'border-l-[3px] border-l-amber-400',
    icon: 'text-amber-600',
    badge: 'bg-amber-100/80 text-amber-700',
    highlight: 'bg-amber-500',
  },
  2: {
    card: 'bg-gradient-to-br from-violet-50/80 to-purple-50/40',
    border: 'border-l-[3px] border-l-violet-400',
    icon: 'text-violet-600',
    badge: 'bg-violet-100/80 text-violet-700',
    highlight: 'bg-violet-500',
  },
}

const TYPE_STYLES: Record<string, string> = {
  '仕込み': 'bg-orange-100/80 text-orange-700 ring-1 ring-orange-200/50',
  '営業': 'bg-emerald-100/80 text-emerald-700 ring-1 ring-emerald-200/50',
}

function ShopCard({ shopName, shifts, style, currentStaffId, index }: {
  shopName: string
  shifts: ShiftFixedWithStaff[]
  style: typeof COLORS[1]
  currentStaffId: number | null
  index: number
}) {
  const staffCount = useMemo(() => new Set(shifts.map(s => s.staff_id)).size, [shifts])

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
    <div
      className={`rounded-xl overflow-hidden ${style.border} ${style.card} animate-slide-up`}
      style={{ animationDelay: `${index * 80}ms` }}
    >
      {/* Shop header */}
      <div className="flex items-center justify-between px-3 pt-3 pb-2">
        <div className="flex items-center gap-1.5">
          <MapPin className={`h-3.5 w-3.5 ${style.icon}`} />
          <span className="text-sm font-bold">{shopName}</span>
        </div>
        <span className={`text-[10px] px-2 py-0.5 rounded-full font-medium ${style.badge}`}>
          {staffCount}名
        </span>
      </div>

      {/* Staff list */}
      <div className="px-3 pb-2">
        {byStaff.map((staffShifts, i) => {
          const staff = staffShifts[0].staff
          const isShanin = staff?.employment_type === '社員'
          const isYakuin = staff?.employment_type === '役員'
          const isSystemAdmin = staff?.employment_type === 'システム管理者'
          const isMe = currentStaffId != null && staffShifts[0].staff_id === currentStaffId
          return (
            <div
              key={staffShifts[0].staff_id}
              className={`flex items-center justify-between py-2 ${
                i < byStaff.length - 1 ? 'border-b border-black/[0.04]' : ''
              } ${isMe ? '-mx-2 px-2 rounded-lg bg-blue-50/80 ring-1 ring-blue-200/40' : ''}`}
            >
              <div className="flex items-center gap-1.5 min-w-0">
                {isMe && (
                  <span className="relative flex h-1.5 w-1.5 shrink-0">
                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-blue-400 opacity-75" />
                    <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-blue-500" />
                  </span>
                )}
                <span className={`text-[13px] font-medium truncate ${isMe ? 'text-blue-700' : ''}`}>
                  {staff?.name}
                </span>
                {isMe && (
                  <span className="text-[8px] px-1 py-0.5 rounded bg-blue-500 text-white font-bold shrink-0 uppercase tracking-wider">
                    You
                  </span>
                )}
                {isShanin && (
                  <span className="text-[8px] px-1 py-0.5 rounded bg-zinc-200/60 text-zinc-500 shrink-0">社員</span>
                )}
                {isYakuin && (
                  <span className="text-[8px] px-1 py-0.5 rounded bg-amber-200/60 text-amber-700 shrink-0">役員</span>
                )}
                {isSystemAdmin && (
                  <span className="text-[8px] px-1 py-0.5 rounded bg-blue-200/60 text-blue-700 shrink-0">管理</span>
                )}
              </div>
              <div className="flex items-center gap-1.5 shrink-0 ml-2">
                {staffShifts.map(s => (
                  <div key={s.id} className="flex items-center gap-1">
                    {s.type && (
                      <span className={`text-[9px] px-1.5 py-0.5 rounded-md font-medium ${TYPE_STYLES[s.type] || 'bg-gray-100 text-gray-600'}`}>
                        {s.type}
                      </span>
                    )}
                    <span className={`text-[11px] tabular-nums ${isMe ? 'text-blue-600 font-semibold' : 'text-muted-foreground'}`}>
                      {formatTime(s.start_time)}-{formatTime(s.end_time)}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

export default function HomePage() {
  const today = useMemo(() => new Date(), [])
  const [selectedDate, setSelectedDate] = useState(() => new Date())
  const [shifts, setShifts] = useState<ShiftFixedWithStaff[]>([])
  const [loading, setLoading] = useState(true)
  const [currentStaffId, setCurrentStaffId] = useState<number | null>(null)
  const [pendingRequests, setPendingRequests] = useState<ShiftRequest[]>([])
  const [isPartTimer, setIsPartTimer] = useState(false)

  const weekStart = useMemo(() => startOfWeek(selectedDate, { weekStartsOn: 0 }), [selectedDate])
  const weekDays = useMemo(() => Array.from({ length: 7 }, (_, i) => addDays(weekStart, i)), [weekStart])

  useEffect(() => {
    const staff = getStoredStaff()
    if (staff) {
      setCurrentStaffId(staff.id)
      const partTimer = staff.employment_type === 'アルバイト'
      setIsPartTimer(partTimer)
      if (partTimer) {
        const todayStr = format(new Date(), 'yyyy-MM-dd')
        supabase
          .from('shift_requests')
          .select('*')
          .eq('staff_id', staff.id)
          .eq('status', 'pending')
          .gte('date', todayStr)
          .order('date', { ascending: true })
          .then(({ data }) => { if (data) setPendingRequests(data as ShiftRequest[]) })
      }
    }
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
  const totalStaff = new Set(dayShifts.map(s => s.staff_id)).size

  return (
    <div className="px-4 pt-3 pb-24 space-y-3">
      {/* Week navigation */}
      <div className="flex items-center justify-between">
        <button onClick={handlePrevWeek} className="p-2 -ml-2 hover:bg-muted rounded-xl transition-colors press-effect">
          <ChevronLeft className="h-4 w-4 text-muted-foreground" />
        </button>
        <p className="text-xs font-semibold text-muted-foreground tracking-wide">
          {format(weekStart, 'M月d日', { locale: ja })} - {format(addDays(weekStart, 6), 'M月d日', { locale: ja })}
        </p>
        <button onClick={handleNextWeek} className="p-2 -mr-2 hover:bg-muted rounded-xl transition-colors press-effect">
          <ChevronRight className="h-4 w-4 text-muted-foreground" />
        </button>
      </div>

      {/* 承認待ちシフト希望バナー (アルバイトのみ) */}
      {isPartTimer && pendingRequests.length > 0 && (
        <div className="flex items-start gap-3 rounded-xl bg-amber-50 border border-amber-200 px-4 py-3 animate-fade-in">
          <Clock className="h-4 w-4 text-amber-600 shrink-0 mt-0.5" />
          <div>
            <p className="text-sm font-semibold text-amber-900">
              {pendingRequests.length}日分のシフト希望が承認待ちです
            </p>
            <p className="text-xs text-amber-700 mt-0.5">
              担当者がシフトを確定するまでお待ちください
            </p>
            <div className="mt-2 flex flex-wrap gap-1.5">
              {pendingRequests.slice(0, 5).map(r => (
                <span key={r.date} className="inline-flex items-center rounded-full bg-amber-100 text-amber-800 text-[10px] px-2 py-0.5 font-medium">
                  {format(new Date(r.date + 'T00:00:00'), 'M/d(E)', { locale: ja })}
                </span>
              ))}
              {pendingRequests.length > 5 && (
                <span className="text-[10px] text-amber-700">他{pendingRequests.length - 5}日</span>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Day selector - improved */}
      <div className="grid grid-cols-7 gap-1 bg-muted/40 rounded-2xl p-1.5">
        {weekDays.map((day, i) => {
          const isSelected = isSameDay(day, selectedDate)
          const isDayToday = isSameDay(day, today)
          const dayHasShifts = shifts.some(s => s.date === format(day, 'yyyy-MM-dd'))
          const isSunday = i === 0
          const isSaturday = i === 6
          return (
            <button
              key={i}
              onClick={() => setSelectedDate(day)}
              className={`flex flex-col items-center py-2 rounded-xl transition-all press-effect relative ${
                isSelected
                  ? isDayToday
                    ? 'bg-blue-500 text-white shadow-md shadow-blue-500/25'
                    : 'bg-white text-foreground shadow-sm'
                  : isDayToday
                    ? 'text-blue-600'
                    : 'text-muted-foreground hover:bg-white/60'
              }`}
            >
              <span className={`text-[9px] leading-none font-medium ${
                isSelected ? 'text-current opacity-70' :
                isSunday ? 'text-red-400' : isSaturday ? 'text-blue-400' : ''
              }`}>
                {DAY_LABELS[i]}
              </span>
              <span className={`text-[15px] font-bold leading-tight mt-0.5 ${
                isDayToday && !isSelected ? 'text-blue-600' : ''
              }`}>
                {format(day, 'd')}
              </span>
              {dayHasShifts && !isSelected && (
                <span className="absolute bottom-1 w-1 h-1 rounded-full bg-current opacity-30" />
              )}
              {isSelected && dayHasShifts && (
                <span className="absolute bottom-1 w-1 h-1 rounded-full bg-current opacity-60" />
              )}
            </button>
          )
        })}
      </div>

      {/* Date header */}
      <div className="flex items-baseline gap-2 pt-1">
        <h2 className="text-lg font-bold tracking-tight">
          {format(selectedDate, 'M月d日', { locale: ja })}
          <span className="text-muted-foreground font-medium ml-0.5">
            {format(selectedDate, '(E)', { locale: ja })}
          </span>
        </h2>
        {isToday && (
          <span className="text-[9px] px-1.5 py-0.5 rounded-md bg-blue-500 text-white font-bold tracking-wide">
            TODAY
          </span>
        )}
        {totalStaff > 0 && (
          <span className="ml-auto text-[11px] text-muted-foreground font-medium tabular-nums">
            {totalStaff}名出勤
          </span>
        )}
      </div>

      {/* Content */}
      {loading ? (
        <div className="space-y-3 pt-2">
          <div className="skeleton h-32 w-full" />
          <div className="skeleton h-28 w-full" />
        </div>
      ) : dayShifts.length === 0 ? (
        <div className="flex flex-col items-center py-16 animate-fade-in">
          <div className="w-14 h-14 rounded-2xl bg-muted/60 flex items-center justify-center mb-3">
            <AlertCircle className="h-6 w-6 text-muted-foreground/40" />
          </div>
          <p className="text-sm text-muted-foreground font-medium">シフトなし</p>
          <p className="text-xs text-muted-foreground/60 mt-1">この日のシフトは登録されていません</p>
        </div>
      ) : (
        <div className="space-y-3">
          {SHOPS.map((shop, i) => (
            shiftsByShop[shop.id].length > 0 && (
              <ShopCard
                key={shop.id}
                shopName={shop.name}
                shifts={shiftsByShop[shop.id]}
                style={COLORS[shop.id]}
                currentStaffId={currentStaffId}
                index={i}
              />
            )
          ))}
        </div>
      )}
    </div>
  )
}

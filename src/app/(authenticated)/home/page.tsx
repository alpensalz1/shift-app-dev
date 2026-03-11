'use client'

import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { ShiftFixedWithStaff } from '@/types/database'
import { formatTime } from '@/lib/utils'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { MapPin, Users } from 'lucide-react'
import { format } from 'date-fns'
import { ja } from 'date-fns/locale'

const SHOPS = [
  { id: 1, name: '三軒茶屋' },
  { id: 2, name: '下北沢' },
]

const SHOP_STYLES: Record<number, { card: string; icon: string; badge: string }> = {
  1: { card: 'border-l-4 border-l-amber-400 bg-amber-50/30', icon: 'text-amber-600', badge: 'bg-amber-500' },
  2: { card: 'border-l-4 border-l-blue-400 bg-blue-50/30', icon: 'text-blue-600', badge: 'bg-blue-500' },
}

export default function HomePage() {
  const [shifts, setShifts] = useState<ShiftFixedWithStaff[]>([])
  const [loading, setLoading] = useState(true)
  const [today, setToday] = useState('')
  const [todayLabel, setTodayLabel] = useState('')

  useEffect(() => {
    const now = new Date()
    setToday(format(now, 'yyyy-MM-dd'))
    setTodayLabel(format(now, 'M月d日（E）', { locale: ja }))
  }, [])

  const fetchTodayShifts = async () => {
    if (!today) return
    const { data } = await supabase
      .from('shifts_fixed')
      .select('*, staffs(name), shops(name)')
      .eq('date', today)
      .order('start_time', { ascending: true })

    if (data) setShifts(data as ShiftFixedWithStaff[])
    setLoading(false)
  }

  useEffect(() => {
    fetchTodayShifts()

    // リアルタイム購読
    const channel = supabase
      .channel('shifts_fixed_realtime')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'shifts_fixed', filter: `date=eq.${today}` },
        () => {
          fetchTodayShifts()
        }
      )
      .subscribe()

    return () => {
      supabase.removeChannel(channel)
    }
  }, [today])

  const getShiftsForShop = (shopId: number, type: string) =>
    shifts.filter((s) => s.shop_id === shopId && s.type === type)

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-lg font-bold">本日のみんな</h2>
        <p className="text-sm text-muted-foreground">{todayLabel}</p>
      </div>

      {loading ? (
        <div className="space-y-3">
          {[1, 2].map((i) => (
            <Card key={i} className="animate-pulse">
              <CardHeader className="pb-3">
                <div className="h-5 bg-muted rounded w-24" />
              </CardHeader>
              <CardContent>
                <div className="space-y-2">
                  <div className="h-4 bg-muted rounded w-full" />
                  <div className="h-4 bg-muted rounded w-3/4" />
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      ) : (
        <div className="space-y-3">
          {SHOPS.map((shop) => {
            const shikomShifts = getShiftsForShop(shop.id, '仕込み')
            const eigyoShifts = getShiftsForShop(shop.id, '営業')
            const hasShifts = shikomShifts.length > 0 || eigyoShifts.length > 0

            return (
              <Card key={shop.id} className={SHOP_STYLES[shop.id]?.card}>
                <CardHeader className="pb-3">
                  <CardTitle className="text-base flex items-center gap-2">
                    <MapPin className={`h-4 w-4 ${SHOP_STYLES[shop.id]?.icon ?? ''}`} />
                    {shop.name}店
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  {!hasShifts ? (
                    <p className="text-sm text-muted-foreground">本日のシフトはありません</p>
                  ) : (
                    <div className="space-y-3">
                      {shikomShifts.length > 0 && (
                        <div>
                          <div className="flex items-center gap-1.5 mb-1.5">
                            <span className="text-xs font-medium px-2 py-0.5 rounded-full bg-amber-100 text-amber-800">
                              仕込み
                            </span>
                            <span className="text-xs text-muted-foreground">
                              <Users className="inline h-3 w-3 mr-0.5" />
                              {shikomShifts.length}名
                            </span>
                          </div>
                          <div className="space-y-1">
                            {shikomShifts.map((s) => (
                              <div key={s.id} className="flex items-center justify-between text-sm pl-2">
                                <span className="font-medium">{s.staffs.name}</span>
                                <span className="text-muted-foreground tabular-nums">
                                  {formatTime(s.start_time)}–{s.end_time && s.end_time > s.start_time ? formatTime(s.end_time) : '24:00'}
                                </span>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}
                      {eigyoShifts.length > 0 && (
                        <div>
                          <div className="flex items-center gap-1.5 mb-1.5">
                            <span className="text-xs font-medium px-2 py-0.5 rounded-full bg-blue-100 text-blue-800">
                              営業
                            </span>
                            <span className="text-xs text-muted-foreground">
                              <Users className="inline h-3 w-3 mr-0.5" />
                              {eigyoShifts.length}名
                            </span>
                          </div>
                          <div className="space-y-1">
                            {eigyoShifts.map((s) => (
                              <div key={s.id} className="flex items-center justify-between text-sm pl-2">
                                <span className="font-medium">{s.staffs.name}</span>
                                <span className="text-muted-foreground tabular-nums">
                                  {formatTime(s.start_time)}–{s.end_time && s.end_time > s.start_time ? formatTime(s.end_time) : '24:00'}
                                </span>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                  )}
                </CardContent>
              </Card>
            )
          })}
        </div>
      )}
    </div>
  )
}

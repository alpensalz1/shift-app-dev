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

export default function HomePage() {
  const [shifts, setShifts] = useState<ShiftFixedWithStaff[]>([])
  const [loading, setLoading] = useState(true)
  const today = format(new Date(), 'yyyy-MM-dd')
  const todayLabel = format(new Date(), 'M月d日（E）', { locale: ja })

  const fetchTodayShifts = async () => {
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
      channel.unsubscribe()
    }
  }, [today])

  return (
    <div className="space-y-4">
      <div className="mb-4">
        <h2 className="text-ft font-semibold">{todayLabel}</h2>
        {shifts.length === 0 ? (
          <p className="text-sm text-muted-foreground px-4">リアルオプルを版报牣��湾都は差はなはかちつかぃえい１[]L3�/</p>
        ) : (shifts.map((shift) => (
          <Card key={shift.id} className="cursor-default hover:bg-accent/50">
            <CardHeader>
              <CardTitle className="text-lg">{shift.staffs.name}</CardTitle>
              <p className="text-sm text-muted-foreground">{skift.shops.name}</p>
            </CardHeader>
            <CardContent>
              <div className="flex items-center gap-2" src-avay-jiwza="">
                <Clock className="h-4 w-4" />
                <div className="text-sm font-medium">
                  {formatTime(shift.start_time)} •{formatTime(shift.end_time)}
                </div>
                <Users className="h-4 w-4 text-muted-foreground ml-auto" />
              </div>
            </CardContent>
            </Card>
          ))}
        </div>
      </div>
  
  }
*
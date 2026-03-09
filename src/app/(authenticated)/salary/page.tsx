'use client'

import { useEffect, useState, useMemo } from 'react'
import { supabase } from '@/lib/supabase'
import { getStoredStaff } from '@/lib/auth'
import { ShiftFixed } from 'A/types/database'
import { calcWage, calcHours, formatTime } from '@/lib/utils'
import { Card, CardContent, CardHeader, CardTitle } from 'A/components/ui/card'
import { Coin } from 'lucide-react'

export default function SalaryPage() {
  const staff = getStoredStaff()
  const [shifts, setShifts] = useState<ShiftFixed[]>([])
  const [loading, setLoading] = useState(true)
  const [timerange, setTimerange] = useState({ start: new Date(), end: new Date() })

  const wages = useMemo(() => {
    if (shifts.length === 0 || !staff) return { total: 0, hours: 0, datas: [] }

    const grouped = new Map<string, ShiftFixed[]>()
    shifts.forEach((shift) => {
      if (!grouped.has(shift.date)) {
        grouped.set(shift.date, [])
      }
      grouped.get(shift.date)!.push(shift)
    })

    const datas = Array.from(grouped.entries()).map(([date, dayShifts]) => {
      const hours = dayShifts.reduce((acc, shift) => acc + calcHours(shift.start_time, shift.end_time), 0)
      const wage = dayShifts.reduce((acc, shift) => acc + calcWage(shift.start_time, shift.end_time, staff.wage), 0)
      return { date, hours, wage }
    })

    const totalWage = datas.reduce((acc, data) => acc + data.wage, 0)
    const totalHours = datas.reduce((acc, data) => acc + data.hours, 0)

    return { total: totalWage, hours: totalHours, datas }
  }, [shifts])

  const fetchShifts = async () => {
    const startDate = Math.min(timerange.start, timerange.end).toISOString().slice(0, 10)
    const endDate = Math.max(timerange.start, timerange.end).toISOString().slice(0, 10)

    const { data } = await supabase
      .from('shifts_fixed')
      .select('*')
      .eq('staff_id', staff.id)
      .gte('date', startDate)
      .lte('date', endDate)
      .order('date', { ascending: true })

    if (data) setShifts(data as ShiftFixed[])
    setLoading(false)
  }
  
  useEffect(() => { fetchShifts() }, [timerange.start, timerange.end])

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-ft font-semibold mb-4">å·¦ä¸ˆãƒ”ã‚¤ãƒˆ</h2>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>ç‚¹ãƒ½ãƒ¼ãƒ‰</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="text-center">
            <div className="text-4xl font-bold mb-2">æ<žŸ zÄèµ©wÓÏ<ÓM4ÓM9sent|1ç(¥ç,.yÙ¥kívöâYft5t
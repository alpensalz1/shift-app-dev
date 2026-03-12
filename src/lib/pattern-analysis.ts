import { supabase } from '@/lib/supabase'
import { format, addDays, getDay } from 'date-fns'

// éå»ãã¼ã¿ããã¹ã¿ããã®å¾åãåæ
export interface StaffPattern {
  staffId: number
  preferredShopId: number
  preferredStartTime: string
  preferredEndTime: string
  preferredType: 'ä»è¾¼ã¿' | 'å¶æ¥­'
  shopDistribution: Record<number, number>
  startTimeDistribution: Record<string, number>
  weekdayPattern: Record<number, boolean> // ææ¥ãã¨ã®åºå¤ãã¿ã¼ã³
  totalShifts: number
}

export async function analyzeStaffPattern(staffId: number): Promise<StaffPattern | null> {
  // éå»8é±éã®ç¢ºå®ã·ãããåå¾
  const eightWeeksAgo = format(addDays(new Date(), -56), 'yyyy-MM-dd')
  const { data: pastShifts } = await supabase
    .from('shifts_fixed')
    .select('*')
    .eq('staff_id', staffId)
    .gte('date', eightWeeksAgo)
    .order('date', { ascending: false })

  if (!pastShifts || pastShifts.length === 0) return null

  // åºèãã¨ã®åºç¾åæ°
  const shopCounts: Record<number, number> = {}
  const startTimeCounts: Record<string, number> = {}
  const typeCounts: Record<string, number> = {}
  const endTimeCounts: Record<string, number> = {}

  for (const s of pastShifts) {
    shopCounts[s.shop_id] = (shopCounts[s.shop_id] || 0) + 1
    const st = s.start_time.substring(0, 5)
    startTimeCounts[st] = (startTimeCounts[st] || 0) + 1
    typeCounts[s.type] = (typeCounts[s.type] || 0) + 1
    const et = s.end_time ? s.end_time.substring(0, 5) : '24:00'
    endTimeCounts[et] = (endTimeCounts[et] || 0) + 1
  }

  const topShop = Object.entries(shopCounts).sort((a, b) => b[1] - a[1])[0]
  const topStart = Object.entries(startTimeCounts).sort((a, b) => b[1] - a[1])[0]
  const topEnd = Object.entries(endTimeCounts).sort((a, b) => b[1] - a[1])[0]
  const topType = Object.entries(typeCounts).sort((a, b) => b[1] - a[1])[0]

  // æ¬æ¥ãã¨ã®åºå¤ãã¿ã¼ã³åæ
  const dayCount: Record<number, number> = { 0: 0, 1: 0, 2: 0, 3: 0, 4: 0, 5: 0, 6: 0 }
  const uniqueDates = new Set(pastShifts.map(s => s.date))
  for (const d of uniqueDates) {
    const day = getDay(new Date(d + 'T00:00:00'))
    dayCount[day]++
  }

  // 40%ä»¥ä¸ã®é±ã§åºå¤ãã¦ããææ¥ããåºå¤ããææ¥ãã¨å¤å®
  const totalWeeks = 8
  const weekdayPattern: Record<number, boolean> = {}
  for (let i = 0; i < 7; i++) {
    weekdayPattern[i] = dayCount[i] >= totalWeeks * 0.4
  }

  return {
    staffId,
    preferredShopId: Number(topShop?.[0] || 1),
    preferredStartTime: topStart?.[0] || '14:00',
    preferredEndTime: topEnd?.[0] || '24:00',
    preferredType: (topType?.[0] as 'ä»è¾¼ã¿' | 'å¶æ¥­') || 'å¶æ¥­',
    shopDistribution: shopCounts,
    startTimeDistribution: startTimeCounts,
    weekdayPattern,
    totalShifts: pastShifts.length,
  }
}

// è¤æ°ã¹ã¿ããã®ãã¿ã¼ã³ãä¸æ¬åæ
export async function analyzeAllStaffPatterns(staffIds: number[]): Promise<Map<number, StaffPattern>> {
  const results = new Map<number, StaffPattern>()
  const promises = staffIds.map(async (id) => {
    const pattern = await analyzeStaffPattern(id)
    if (pattern) results.set(id, pattern)
  })
  await Promise.all(promises)
  return results
}

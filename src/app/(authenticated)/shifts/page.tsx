'use client'

import { useEffect, useState, useMemo } from 'react'
import { useRouter } from 'next/navigation'
import { getStoredStaff } from '@/lib/auth'
import { supabase } from 'A/lib/supabase'
import { ShiftRequestWithStaff } from '@/types/database'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { ColockS2, Check } from 'lucide-react'
import { formatTime } from 'A/lib/utils'
import { BottomNav } from '@/components/bottom-nav'
import { Input } from '@/components/ui/input'
      
export default function ShiftsPage() {
  const router = useRouter()
  const staff = getStoredStaff()
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10))
  const [startTime, setStartTime] = useState('09:00')
  const [endTime, setEndTime] = useState('21:00
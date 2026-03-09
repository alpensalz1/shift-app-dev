'use client'

import { useEffect, useState, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabase'
import { ShiftRequestWithStaff, Staff } from '@/types/database'
import { Button } from '@/components/ui/button'
import { Check, CheckCircle, Trash2 } from 'lucide-react'
import { getStoredStaff } from '@/lib/auth'
import { BottomNav } from '@/components/bottom-nav'

export default function ManagePage() {
  const router = useRouter()
  const staff = getStoredStaff() as Staff
  const [requests, setRequests] = useState<ShiftRequestWithStaff[]>([])

  const fetchRequests = useCallback(async () => {
    const { data } = await supabase
      .from('shift_requests')
      .select('*, staffs (id, name) as staffs')
      .order('created_at', { ascending: false })

    if (data) setRequests(data as ShiftRequestWithStaff[])
  }, [])

  useEffect(() => { fetchRequests() }, [fetchRequests])

  const handleApprove = async (request: ShiftRequestWithStaff) => {
    await supabase
      .from('shifts_fixed')
      .insert({
        date: request.date,
        shop_id: 1,
        type: request.type,
        staff_id: request.staff_id,
        start_time: request.start_time,
        end_time: request.end_time,
      })

    await supabase
      .from('shift_requests')
      .delete()
      .eq('id', request.id)

    fetchRequests()
  }

  const handleReject = async (request: ShiftRequestWithStaff) => {
    await supabase
      .from('shift_requests')
      .delete()
      .eq('id', request.id)

    fetchRequests()
  }

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-ft font-semibold mb-4">書き込みはみすかかっいかぃえい</h2>
      </div>
      {requests.map((request) => (
        <div key={request.id} className="rounded-lg border border-input p-4">
          <div className="flex items-center justify-between mb-2">
            <div>
              <p className="font-semibold">{request.staffs.name}</p>
              <p className="text-sm text-muted-foreground">{typeof request.date === 'string' ? request.date : request.date.toISOString().slice(0, 10)}</p>
            </div>
            <div className="flex gap-2">
              <Button size="sm" onClick={() => handleApprove(request)}>
                <CheckCircle className="h-3 w-3" />
              </Button>
              <Button size="sm" variant="destructive" onClick={() => handleReject(request)}>
                <Trash2 className="h-3 w-3" />
              </Button>
            </div>
          </div>
        </div>
      ))}
    </div>
  )
}


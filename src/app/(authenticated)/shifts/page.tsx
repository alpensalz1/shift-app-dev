'use client'

import { useState, useEffect, useMemo } from 'react'
import { supabase } from '@/lib/supabase'
import { getStoredStaff } from '@/lib/auth'
import { Staff, ShiftRequest, ShiftConfig } from '@/types/database'
import { formatTime } from '@/lib/utils'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import {
  format, addDays, startOfWeek, addWeeks, eachDayOfInterval, getDay
} from 'date-fns'
import { ja } from 'date-fns/locale'
import {
  CheckCircle2, XCircle, ChevronLeft, ChevronRight,
  Send, Users, CalendarDays, Loader2
} from 'lucide-react'

const SHOPS = [
  { id: 1, name: 'ä¸è»è¶å±' },
  { id: 2, name: 'ä¸åæ²¢' },
]

// =============================================
// æåºç¶æ³ãµããªã¼ã³ã³ãã¼ãã³ãï¼ç¤¾å¡ã»å½¹å¡ç¨ï¼
// =============================================
function SubmissionOverview({ targetWeekStart, allStaffs }: {
  targetWeekStart: Date
  allStaffs: Staff[]
}) {
  const [requestsByStaff, setRequestsByStaff] = useState<Record<number, ShiftRequest[]>>({})
  const [loading, setLoading] = useState(true)

  const weekEnd = addDays(targetWeekStart, 6)
  const startStr = format(targetWeekStart, 'yyyy-MM-dd')
  const endStr = format(weekEnd, 'yyyy-MM-dd')

  useEffect(() => {
    const fetch = async () => {
      setLoading(true)
      const { data } = await supabase
        .from('shift_requests')
        .select('*')
        .gte('date', startStr)
        .lte('date', endStr)

      const grouped: Record<number, ShiftRequest[]> = {}
      for (const r of (data || [])) {
        if (!grouped[r.staff_id]) grouped[r.staff_id] = []
        grouped[r.staff_id].push(r)
      }
      setRequestsByStaff(grouped)
      setLoading(false)
    }
    fetch()
  }, [startStr, endStr])

  const activeStaffs = allStaffs.filter(s => s.is_active && !s.deleted_at)
  const submitted = activeStaffs.filter(s => (requestsByStaff[s.id]?.length || 0) > 0)
  const notSubmitted = activeStaffs.filter(s => !requestsByStaff[s.id] || requestsByStaff[s.id].length === 0)

  if (loading) return <div className="text-center py-4 text-sm text-muted-foreground">èª­ã¿è¾¼ã¿ä¸­...</div>

  return (
    <div className="space-y-3">
      {/* ãµããªã¼ãã¼ */}
      <div className="flex items-center gap-3">
        <div className="flex-1 bg-muted/50 rounded-full h-3 overflow-hidden">
          <div
            className="h-full bg-emerald-500 rounded-full transition-all"
            style={{ width: `${activeStaffs.length > 0 ? (submitted.length / activeStaffs.length * 100) : 0}%` }}
          />
        </div>
        <span className="text-sm font-medium tabular-nums">
          {submitted.length}/{activeStaffs.length}
        </span>
      </div>

      {/* æªæåºè */}
      {notSubmitted.length > 0 && (
        <Card className="border-red-200 bg-red-50/30">
          <CardHeader className="pb-1 pt-2 px-3">
            <CardTitle className="text-xs flex items-center gap-1 text-red-600">
              <XCircle className="h-3.5 w-3.5" />
              æªæåºï¼{notSubmitted.length}åï¼
            </CardTitle>
          </CardHeader>
          <CardContent className="px-3 pb-2">
            <div className="flex flex-wrap gap-1.5">
              {notSubmitted.map(s => (
                <span key={s.id} className="text-xs px-2 py-1 rounded-full bg-red-100 text-red-700">
                  {s.name}
                  <span className="ml-1 text-[9px] opacity-60">
                    {s.employment_type === 'ã¢ã«ãã¤ã' ? 'ãã¤ã' : s.employment_type}
                  </span>
                </span>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* æåºæ¸ã¿ */}
      {submitted.length > 0 && (
        <Card className="border-emerald-200 bg-emerald-50/30">
          <CardHeader className="pb-1 pt-2 px-3">
            <CardTitle className="text-xs flex items-center gap-1 text-emerald-600">
              <CheckCircle2 className="h-3.5 w-3.5" />
              æåºæ¸ã¿ï¼{submitted.length}åï¼
            </CardTitle>
          </CardHeader>
          <CardContent className="px-3 pb-2">
            <div className="flex flex-wrap gap-1.5">
              {submitted.map(s => {
                const reqs = requestsByStaff[s.id] || []
                return (
                  <span key={s.id} className="text-xs px-2 py-1 rounded-full bg-emerald-100 text-emerald-700">
                    {s.name}
                    <span className="ml-1 text-[9px] opacity-60">{reqs.length}æ¥</span>
                  </span>
                )
              })}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  )
}

// =============================================
// èªåã®ã·ããç³è«ãã©ã¼ã 
// =============================================
function MyShiftForm({ staff, targetWeekStart, onSubmitted }: {
  staff: Staff
  targetWeekStart: Date
  onSubmitted: () => void
}) {
  const [myRequests, setMyRequests] = useState<ShiftRequest[]>([])
  const [loading, setLoading] = useState(true)
  const [submitting, setSubmitting] = useState(false)
  const [entries, setEntries] = useState<Record<string, { type: string; startTime: string; endTime: string } | null>>({})

  const weekEnd = addDays(targetWeekStart, 6)
  const days = useMemo(() => eachDayOfInterval({ start: targetWeekStart, end: weekEnd }), [targetWeekStart, weekEnd])
  const startStr = format(targetWeekStart, 'yyyy-MM-dd')
  const endStr = format(weekEnd, 'yyyy-MM-dd')

  // æ¢å­ã®ç³è«ãåå¾
  useEffect(() => {
    const fetch = async () => {
      setLoading(true)
      const { data } = await supabase
        .from('shift_requests')
        .select('*')
        .eq('staff_id', staff.id)
        .gte('date', startStr)
        .lte('date', endStr)
      setMyRequests(data || [])
      setLoading(false)
    }
    fetch()
  }, [staff.id, startStr, endStr])

  const hasSubmitted = myRequests.length > 0

  // å¨æ¥ãåæå¥åã§åããï¼æåã§éå§ï¼
  const handleStartEntry = () => {
    const newEntries: typeof entries = {}
    for (const day of days) {
      const dateStr = format(day, 'yyyy-MM-dd')
      newEntries[dateStr] = { type: 'ä»è¾¼ã¿ã»å¶æ¥­', startTime: '14:00', endTime: '' }
    }
    setEntries(newEntries)
  }

  // æ¥ããªã³/ãªãåãæ¿ã
  const toggleDay = (dateStr: string) => {
    setEntries(prev => {
      if (prev[dateStr]) {
        return { ...prev, [dateStr]: null }
      } else {
        return {
          ...prev,
          [dateStr]: { type: 'ä»è¾¼ã¿ã»å¶æ¥­', startTime: '14:00', endTime: '' },
        }
      }
    })
  }

  const updateEntry = (dateStr: string, field: string, value: string) => {
    setEntries(prev => ({
      ...prev,
      [dateStr]: prev[dateStr] ? { ...prev[dateStr]!, [field]: value } : null,
    }))
  }

  // æåº
  const handleSubmit = async () => {
    const toSubmit = Object.entries(entries)
      .filter(([_, e]) => e !== null)
      .map(([dateStr, e]) => ({
        staff_id: staff.id,
        date: dateStr,
        type: e!.type,
        start_time: e!.startTime + ':00',
        end_time: e!.endTime ? e!.endTime + ':00' : null,
        note: '',
        status: 'pending',
      }))

    if (toSubmit.length === 0) return

    setSubmitting(true)
    try {
      // æ¢å­ã®ç³è«ãåé¤ãã¦æ°è¦ä½æ
      await supabase
        .from('shift_requests')
        .delete()
        .eq('staff_id', staff.id)
        .gte('date', startStr)
        .lte('date', endStr)

      const { error } = await supabase
        .from('shift_requests')
        .insert(toSubmit)

      if (error) throw error
      onSubmitted()
      // ååå¾
      const { data } = await supabase
        .from('shift_requests')
        .select('*')
        .eq('staff_id', staff.id)
        .gte('date', startStr)
        .lte('date', endStr)
      setMyRequests(data || [])
      setEntries({})
    } catch (err) {
      console.error(err)
    } finally {
      setSubmitting(false)
    }
  }

  if (loading) return <div className="text-center py-4 text-sm text-muted-foreground">èª­ã¿è¾¼ã¿ä¸­...</div>

  // æåºæ¸ã¿ãã¥ã¼
  if (hasSubmitted && Object.keys(entries).length === 0) {
    return (
      <div className="space-y-2">
        <div className="flex items-center gap-2 px-1">
          <CheckCircle2 className="h-4 w-4 text-emerald-500" />
          <span className="text-sm font-medium text-emerald-700">æåºæ¸ã¿ï¼{myRequests.length}æ¥åï¼</span>
        </div>
        <div className="space-y-1">
          {myRequests
            .sort((a, b) => a.date.localeCompare(b.date))
            .map(r => (
              <div key={r.id} className="flex items-center justify-between px-3 py-1.5 bg-emerald-50/50 rounded-lg text-sm">
                <span>{format(new Date(r.date + 'T00:00:00'), 'M/dï¼Eï¼', { locale: ja })}</span>
                <span className="text-muted-foreground text-xs">
                  {r.type} {formatTime(r.start_time)}â{formatTime(r.end_time)}
                </span>
              </div>
            ))}
        </div>
        <Button
          variant="outline"
          size="sm"
          className="w-full text-xs"
          onClick={() => {
            const newEntries: typeof entries = {}
            for (const day of days) {
              const dateStr = format(day, 'yyyy-MM-dd')
              const existing = myRequests.find(r => r.date === dateStr)
              if (existing) {
                newEntries[dateStr] = {
                  type: existing.type,
                  startTime: formatTime(existing.start_time),
                  endTime: existing.end_time ? formatTime(existing.end_time) : '',
                }
              } else {
                newEntries[dateStr] = null
              }
            }
            setEntries(newEntries)
          }}
        >
          ä¿®æ­£ãã
        </Button>
      </div>
    )
  }

  // ç·¨éã¢ã¼ã
  const activeDays = Object.entries(entries).filter(([_, e]) => e !== null).length

  return (
    <div className="space-y-3">
      {/* å¥åéå§ãã¿ã³ */}
      {Object.keys(entries).length === 0 && (
        <Button
          onClick={handleStartEntry}
          className="w-full"
          variant="outline"
        >
          <CalendarDays className="h-4 w-4 mr-2" />
          ã·ãããå¥åãã
        </Button>
      )}

      {/* æ¥å¥ã¨ã³ããª */}
      {Object.keys(entries).length > 0 && (
        <>
          <div className="space-y-1.5">
            {days.map(day => {
              const dateStr = format(day, 'yyyy-MM-dd')
              const entry = entries[dateStr]
              const dow = getDay(day)
              const isWeekend = dow === 0 || dow === 6
              return (
                <div key={dateStr} className={`rounded-lg border transition-all ${entry ? 'border-blue-200 bg-blue-50/30' : 'border-border/50 bg-muted/20 opacity-60'}`}>
                  <div
                    className="flex items-center gap-2 px-3 py-2 cursor-pointer"
                    onClick={() => toggleDay(dateStr)}
                  >
                    <div className={`w-5 h-5 rounded-md border-2 flex items-center justify-center transition-colors ${entry ? 'bg-blue-500 border-blue-500' : 'border-gray-300'}`}>
                      {entry && <span className="text-white text-xs">â</span>}
                    </div>
                    <span className={`text-sm font-medium ${isWeekend ? (dow === 0 ? 'text-red-500' : 'text-blue-500') : ''}`}>
                      {format(day, 'M/dï¼Eï¼', { locale: ja })}
                    </span>
                    {entry && (
                      <span className="ml-auto text-xs text-muted-foreground">
                        {entry.type} {entry.startTime}ã
                      </span>
                    )}
                  </div>
                  {entry && (
                    <div className="px-3 pb-2 flex gap-2">
                      <select
                        className="text-xs border rounded px-1.5 py-1 bg-white"
                        value={entry.type}
                        onChange={e => updateEntry(dateStr, 'type', e.target.value)}
                      >
                        <option value="ä»è¾¼ã¿ã»å¶æ¥­">ä»è¾¼ã¿ã»å¶æ¥­</option>
                        <option value="ä»è¾¼ã¿">ä»è¾¼ã¿ã®ã¿</option>
                        <option value="å¶æ¥­">å¶æ¥­ã®ã¿</option>
                      </select>
                      <input
                        type="time"
                        className="text-xs border rounded px-1.5 py-1 bg-white"
                        value={entry.startTime}
                        onChange={e => updateEntry(dateStr, 'startTime', e.target.value)}
                      />
                      <span className="text-xs self-center">ã</span>
                      <input
                        type="time"
                        className="text-xs border rounded px-1.5 py-1 bg-white"
                        value={entry.endTime}
                        placeholder="ã©ã¹ã"
                        onChange={e => updateEntry(dateStr, 'endTime', e.target.value)}
                      />
                    </div>
                  )}
                </div>
              )
            })}
          </div>

          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              className="flex-1"
              onClick={() => setEntries({})}
            >
              ã¯ãªã¢
            </Button>
            <Button
              size="sm"
              className="flex-1"
              disabled={activeDays === 0 || submitting}
              onClick={handleSubmit}
            >
              {submitting ? (
                <><Loader2 className="h-4 w-4 mr-1 animate-spin" />éä¿¡ä¸­</>
              ) : (
                <><Send className="h-4 w-4 mr-1" />{activeDays}æ¥åãæåº</>
              )}
            </Button>
          </div>
        </>
      )}
    </div>
  )
}

// =============================================
// ã¡ã¤ã³ãã¼ã¸
// =============================================
export default function ShiftsPage() {
  const [staff, setStaff] = useState<Staff | null>(null)
  const [allStaffs, setAllStaffs] = useState<Staff[]>([])
  const [loading, setLoading] = useState(true)
  const [targetWeekOffset, setTargetWeekOffset] = useState(1) // ããã©ã«ã: æ¥é±
  const [refreshKey, setRefreshKey] = useState(0)

  const today = useMemo(() => new Date(), [])
  const targetWeekStart = useMemo(
    () => startOfWeek(addWeeks(today, targetWeekOffset), { weekStartsOn: 0 }),
    [today, targetWeekOffset]
  )

  const isManager = staff?.employment_type === 'ç¤¾å¡' || staff?.employment_type === 'å½¹å¡'

  useEffect(() => {
    const init = async () => {
      const s = getStoredStaff()
      setStaff(s)

      const { data: staffData } = await supabase
        .from('staffs')
        .select('*')
        .eq('is_active', true)
        .is('deleted_at', null)
      setAllStaffs(staffData || [])
      setLoading(false)
    }
    init()
  }, [])

  if (loading || !staff) {
    return <div className="flex items-center justify-center min-h-[50vh] text-sm text-muted-foreground">èª­ã¿è¾¼ã¿ä¸­...</div>
  }

  return (
    <div className="px-4 pt-3 pb-24 max-w-lg mx-auto space-y-4">
      {/* ãããã¼ */}
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-bold flex items-center gap-2">
          <CalendarDays className="h-5 w-5" />
          ã·ããç³è«
        </h1>
      </div>

      {/* å¯¾è±¡é±ã»ã¬ã¯ã¿ã¼ */}
      <div className="flex items-center justify-between bg-muted/50 rounded-xl px-3 py-2">
        <button
          onClick={() => setTargetWeekOffset(prev => prev - 1)}
          className="p-1 hover:bg-white rounded-lg transition-colors"
        >
          <ChevronLeft className="h-4 w-4" />
        </button>
        <div className="text-center">
          <p className="text-[10px] text-muted-foreground">
            {targetWeekOffset === 0 ? 'ä»é±' : targetWeekOffset === 1 ? 'æ¥é±' : `${targetWeekOffset}é±å¾`}
          </p>
          <p className="text-sm font-semibold">
            {format(targetWeekStart, 'Mædæ¥', { locale: ja })} ã {format(addDays(targetWeekStart, 6), 'Mædæ¥', { locale: ja })}
          </p>
        </div>
        <button
          onClick={() => setTargetWeekOffset(prev => prev + 1)}
          className="p-1 hover:bg-white rounded-lg transition-colors"
        >
          <ChevronRight className="h-4 w-4" />
        </button>
      </div>

      {/* ç¤¾å¡ã»å½¹å¡: å¨å¡ã®æåºç¶æ³ */}
      {isManager && (
        <Card>
          <CardHeader className="pb-2 pt-3 px-3">
            <CardTitle className="text-sm flex items-center gap-1.5">
              <Users className="h-4 w-4" />
              ã¡ã³ãã¼æåºç¶æ³
            </CardTitle>
          </CardHeader>
          <CardContent className="px-3 pb-3">
            <SubmissionOverview
              key={refreshKey + '-' + format(targetWeekStart, 'yyyy-MM-dd')}
              targetWeekStart={targetWeekStart}
              allStaffs={allStaffs}
            />
          </CardContent>
        </Card>
      )}

      {/* èªåã®ã·ããç³è« */}
      <Card>
        <CardHeader className="pb-2 pt-3 px-3">
          <CardTitle className="text-sm flex items-center gap-1.5">
            <Send className="h-4 w-4" />
            {staff.name}ã®ã·ããç³è«
          </CardTitle>
        </CardHeader>
        <CardContent className="px-3 pb-3">
          <MyShiftForm
            key={refreshKey + '-form-' + format(targetWeekStart, 'yyyy-MM-dd')}
            staff={staff}
            targetWeekStart={targetWeekStart}
            onSubmitted={() => setRefreshKey(prev => prev + 1)}
          />
        </CardContent>
      </Card>
    </div>
  )
}

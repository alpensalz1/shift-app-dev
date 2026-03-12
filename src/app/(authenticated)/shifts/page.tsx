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
  { id: 1, name: '三軒茶屋' },
  { id: 2, name: '下北沢' },
]

// =============================================
// 提出状況サマリーコンポーネント（社員・役員用）
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

  if (loading) return <div className="text-center py-4 text-sm text-muted-foreground">読み込み中...</div>

  return (
    <div className="space-y-3">
      {/* サマリーバー */}
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

      {/* 未提出者 */}
      {notSubmitted.length > 0 && (
        <Card className="border-red-200 bg-red-50/30">
          <CardHeader className="pb-1 pt-2 px-3">
            <CardTitle className="text-xs flex items-center gap-1 text-red-600">
              <XCircle className="h-3.5 w-3.5" />
              未提出（{notSubmitted.length}名）
            </CardTitle>
          </CardHeader>
          <CardContent className="px-3 pb-2">
            <div className="flex flex-wrap gap-1.5">
              {notSubmitted.map(s => (
                <span key={s.id} className="text-xs px-2 py-1 rounded-full bg-red-100 text-red-700">
                  {s.name}
                  <span className="ml-1 text-[9px] opacity-60">
                    {s.employment_type === 'アルバイト' ? 'バイト' : s.employment_type}
                  </span>
                </span>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* 提出済み */}
      {submitted.length > 0 && (
        <Card className="border-emerald-200 bg-emerald-50/30">
          <CardHeader className="pb-1 pt-2 px-3">
            <CardTitle className="text-xs flex items-center gap-1 text-emerald-600">
              <CheckCircle2 className="h-3.5 w-3.5" />
              提出済み（{submitted.length}名）
            </CardTitle>
          </CardHeader>
          <CardContent className="px-3 pb-2">
            <div className="flex flex-wrap gap-1.5">
              {submitted.map(s => {
                const reqs = requestsByStaff[s.id] || []
                return (
                  <span key={s.id} className="text-xs px-2 py-1 rounded-full bg-emerald-100 text-emerald-700">
                    {s.name}
                    <span className="ml-1 text-[9px] opacity-60">{reqs.length}日</span>
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
// 自分のシフト申請フォーム
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

  // 既存の申請を取得
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

  // 全日を初期入力で埋める（手動で開始）
  const handleStartEntry = () => {
    const newEntries: typeof entries = {}
    for (const day of days) {
      const dateStr = format(day, 'yyyy-MM-dd')
      newEntries[dateStr] = { type: '仕込み・営業', startTime: '14:00', endTime: '' }
    }
    setEntries(newEntries)
  }

  // 日をオン/オフ切り替え
  const toggleDay = (dateStr: string) => {
    setEntries(prev => {
      if (prev[dateStr]) {
        return { ...prev, [dateStr]: null }
      } else {
        return {
          ...prev,
          [dateStr]: { type: '仕込み・営業', startTime: '14:00', endTime: '' },
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

  // 提出
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
      // 既存の申請を削除して新規作成
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
      // 再取得
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

  if (loading) return <div className="text-center py-4 text-sm text-muted-foreground">読み込み中...</div>

  // 提出済みビュー
  if (hasSubmitted && Object.keys(entries).length === 0) {
    return (
      <div className="space-y-2">
        <div className="flex items-center gap-2 px-1">
          <CheckCircle2 className="h-4 w-4 text-emerald-500" />
          <span className="text-sm font-medium text-emerald-700">提出済み（{myRequests.length}日分）</span>
        </div>
        <div className="space-y-1">
          {myRequests
            .sort((a, b) => a.date.localeCompare(b.date))
            .map(r => (
              <div key={r.id} className="flex items-center justify-between px-3 py-1.5 bg-emerald-50/50 rounded-lg text-sm">
                <span>{format(new Date(r.date + 'T00:00:00'), 'M/d（E）', { locale: ja })}</span>
                <span className="text-muted-foreground text-xs">
                  {r.type} {formatTime(r.start_time)}–{formatTime(r.end_time)}
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
          修正する
        </Button>
      </div>
    )
  }

  // 編集モード
  const activeDays = Object.entries(entries).filter(([_, e]) => e !== null).length

  return (
    <div className="space-y-3">
      {/* 入力開始ボタン */}
      {Object.keys(entries).length === 0 && (
        <Button
          onClick={handleStartEntry}
          className="w-full"
          variant="outline"
        >
          <CalendarDays className="h-4 w-4 mr-2" />
          シフトを入力する
        </Button>
      )}

      {/* 日別エントリ */}
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
                      {entry && <span className="text-white text-xs">✓</span>}
                    </div>
                    <span className={`text-sm font-medium ${isWeekend ? (dow === 0 ? 'text-red-500' : 'text-blue-500') : ''}`}>
                      {format(day, 'M/d（E）', { locale: ja })}
                    </span>
                    {entry && (
                      <span className="ml-auto text-xs text-muted-foreground">
                        {entry.type} {entry.startTime}〜
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
                        <option value="仕込み・営業">仕込み・営業</option>
                        <option value="仕込み">仕込みのみ</option>
                        <option value="営業">営業のみ</option>
                      </select>
                      <input
                        type="time"
                        className="text-xs border rounded px-1.5 py-1 bg-white"
                        value={entry.startTime}
                        onChange={e => updateEntry(dateStr, 'startTime', e.target.value)}
                      />
                      <span className="text-xs self-center">〜</span>
                      <input
                        type="time"
                        className="text-xs border rounded px-1.5 py-1 bg-white"
                        value={entry.endTime}
                        placeholder="ラスト"
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
              クリア
            </Button>
            <Button
              size="sm"
              className="flex-1"
              disabled={activeDays === 0 || submitting}
              onClick={handleSubmit}
            >
              {submitting ? (
                <><Loader2 className="h-4 w-4 mr-1 animate-spin" />送信中</>
              ) : (
                <><Send className="h-4 w-4 mr-1" />{activeDays}日分を提出</>
              )}
            </Button>
          </div>
        </>
      )}
    </div>
  )
}

// =============================================
// メインページ
// =============================================
export default function ShiftsPage() {
  const [staff, setStaff] = useState<Staff | null>(null)
  const [allStaffs, setAllStaffs] = useState<Staff[]>([])
  const [loading, setLoading] = useState(true)
  const [targetWeekOffset, setTargetWeekOffset] = useState(1) // デフォルト: 来週
  const [refreshKey, setRefreshKey] = useState(0)

  const today = useMemo(() => new Date(), [])
  const targetWeekStart = useMemo(
    () => startOfWeek(addWeeks(today, targetWeekOffset), { weekStartsOn: 0 }),
    [today, targetWeekOffset]
  )

  const isManager = staff?.employment_type === '社員' || staff?.employment_type === '役員'

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
    return <div className="flex items-center justify-center min-h-[50vh] text-sm text-muted-foreground">読み込み中...</div>
  }

  return (
    <div className="px-4 pt-3 pb-24 max-w-lg mx-auto space-y-4">
      {/* ヘッダー */}
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-bold flex items-center gap-2">
          <CalendarDays className="h-5 w-5" />
          シフト申請
        </h1>
      </div>

      {/* 対象週セレクター */}
      <div className="flex items-center justify-between bg-muted/50 rounded-xl px-3 py-2">
        <button
          onClick={() => setTargetWeekOffset(prev => prev - 1)}
          className="p-1 hover:bg-white rounded-lg transition-colors"
        >
          <ChevronLeft className="h-4 w-4" />
        </button>
        <div className="text-center">
          <p className="text-[10px] text-muted-foreground">
            {targetWeekOffset === 0 ? '今週' : targetWeekOffset === 1 ? '来週' : `${targetWeekOffset}週後`}
          </p>
          <p className="text-sm font-semibold">
            {format(targetWeekStart, 'M月d日', { locale: ja })} 〜 {format(addDays(targetWeekStart, 6), 'M月d日', { locale: ja })}
          </p>
        </div>
        <button
          onClick={() => setTargetWeekOffset(prev => prev + 1)}
          className="p-1 hover:bg-white rounded-lg transition-colors"
        >
          <ChevronRight className="h-4 w-4" />
        </button>
      </div>

      {/* 社員・役員: 全員の提出状況 */}
      {isManager && (
        <Card>
          <CardHeader className="pb-2 pt-3 px-3">
            <CardTitle className="text-sm flex items-center gap-1.5">
              <Users className="h-4 w-4" />
              メンバー提出状況
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

      {/* 自分のシフト申請 */}
      <Card>
        <CardHeader className="pb-2 pt-3 px-3">
          <CardTitle className="text-sm flex items-center gap-1.5">
            <Send className="h-4 w-4" />
            {staff.name}のシフト申請
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


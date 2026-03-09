'use client'

import { useEffect, useState, useMemo, useCallback } from 'react'
import { supabase } from '@/lib/supabase'
import { getStoredStaff } from '@/lib/auth'
import { ShiftRequest, ShiftFixed } from '@/types/database'
import { getSubmissionPeriod, generateTimeSlots, formatTime, isValid15MinTime } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import {
  format,
  eachDayOfInterval,
  isSameDay,
  isWithinInterval,
  startOfMonth,
  endOfMonth,
  getDay,
  addMonths,
  subMonths,
} from 'date-fns'
import { ja } from 'date-fns/locale'
import { CalendarPlus, Check, ChevronLeft, ChevronRight, Loader2, Trash2, History } from 'lucide-react'

const TIME_SLOTS = generateTimeSlots(9, 24)
const DAY_NAMES = ['日', '月', '火', '水', '木', '金', '土']

type ViewMode = 'submit' | 'history'

export default function ShiftsPage() {
  const staff = getStoredStaff()
  const [viewMode, setViewMode] = useState<ViewMode>('submit')

  // === 提出モード ===
  const [selectedDates, setSelectedDates] = useState<Date[]>([])
  const [shiftType, setShiftType] = useState<'仕込み・営業' | '仕込み' | '営業'>('仕込み・営業')
  const [startTime, setStartTime] = useState('17:00')
  const [endTime, setEndTime] = useState('24:00')
  const [note, setNote] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [existing, setExisting] = useState<ShiftRequest[]>([])
  const [message, setMessage] = useState('')

  const today = new Date()
  const period = getSubmissionPeriod(today)

  // === 履歴モード ===
  const [historyMonth, setHistoryMonth] = useState(() => new Date())
  const [historyShifts, setHistoryShifts] = useState<ShiftFixed[]>([])
  const [historyLoading, setHistoryLoading] = useState(false)

  // ========== 提出モードのカレンダー ==========
  const calendarMonth = startOfMonth(period.start)
  const calendarDays = useMemo(() => {
    const monthStart = startOfMonth(period.start)
    const monthEnd = endOfMonth(period.start)
    return eachDayOfInterval({ start: monthStart, end: monthEnd })
  }, [period.start.toISOString()])

  const firstDayOfWeek = getDay(calendarMonth)

  const isInPeriod = useCallback(
    (date: Date) => isWithinInterval(date, { start: period.start, end: period.end }),
    [period.start.toISOString(), period.end.toISOString()]
  )

  const fetchExisting = useCallback(async () => {
    if (!staff) return
    const { data } = await supabase
      .from('shift_requests')
      .select('*')
      .eq('staff_id', staff.id)
      .gte('date', format(period.start, 'yyyy-MM-dd'))
      .lte('date', format(period.end, 'yyyy-MM-dd'))
      .order('date', { ascending: true })
    if (data) setExisting(data)
  }, [staff?.id, period.start.toISOString(), period.end.toISOString()])

  useEffect(() => {
    fetchExisting()
  }, [fetchExisting])

  // ========== 履歴モードのデータ取得 ==========
  const fetchHistory = useCallback(async () => {
    if (!staff) return
    setHistoryLoading(true)
    const ms = format(startOfMonth(historyMonth), 'yyyy-MM-dd')
    const me = format(endOfMonth(historyMonth), 'yyyy-MM-dd')
    const { data } = await supabase
      .from('shifts_fixed')
      .select('*')
      .eq('staff_id', staff.id)
      .gte('date', ms)
      .lte('date', me)
      .order('date', { ascending: true })
    if (data) setHistoryShifts(data)
    setHistoryLoading(false)
  }, [staff?.id, historyMonth.toISOString()])

  useEffect(() => {
    if (viewMode === 'history') fetchHistory()
  }, [viewMode, fetchHistory])

  const historyDays = useMemo(() => {
    return eachDayOfInterval({ start: startOfMonth(historyMonth), end: endOfMonth(historyMonth) })
  }, [historyMonth.toISOString()])

  const historyFirstDow = getDay(startOfMonth(historyMonth))

  const getHistoryForDate = (date: Date) =>
    historyShifts.filter((s) => s.date === format(date, 'yyyy-MM-dd'))

  // ========== 提出ロジック ==========
  const toggleDate = (date: Date) => {
    if (!isInPeriod(date)) return
    setSelectedDates((prev) => {
      const found = prev.find((d) => isSameDay(d, date))
      if (found) return prev.filter((d) => !isSameDay(d, date))
      return [...prev, date]
    })
  }

  const isSelected = (date: Date) => selectedDates.some((d) => isSameDay(d, date))

  const getExistingForDate = (date: Date) =>
    existing.find((r) => r.date === format(date, 'yyyy-MM-dd'))

  const handleSubmit = async () => {
    if (!staff || selectedDates.length === 0) return
    if (!isValid15MinTime(startTime) || !isValid15MinTime(endTime)) {
      setMessage('時間は15分刻みで指定してください')
      return
    }
    const [sh] = startTime.split(':').map(Number)
    const [eh] = endTime.split(':').map(Number)
    if (eh * 60 + parseInt(endTime.split(':')[1]) <= sh * 60 + parseInt(startTime.split(':')[1])) {
      setMessage('終了時間は開始時間より後にしてください')
      return
    }
    setSubmitting(true)
    setMessage('')
    const rows = selectedDates.map((date) => ({
      staff_id: staff.id,
      date: format(date, 'yyyy-MM-dd'),
      type: shiftType,
      start_time: startTime.padStart(5, '0') + ':00',
      end_time: endTime.padStart(5, '0') + ':00',
      note,
    }))
    const { error } = await supabase.from('shift_requests').upsert(rows, {
      onConflict: 'staff_id,date',
    })
    if (error) {
      setMessage('提出に失敗しました: ' + error.message)
    } else {
      setMessage(`${selectedDates.length}日分のシフト希望を提出しました`)
      setSelectedDates([])
      setNote('')
      fetchExisting()
    }
    setSubmitting(false)
  }

  const handleDelete = async (id: number) => {
    await supabase.from('shift_requests').delete().eq('id', id)
    fetchExisting()
  }

  const periodLabel = `${format(period.start, 'M/d')}〜${format(period.end, 'M/d')}`

  return (
    <div className="space-y-4">
      {/* タブ切替 */}
      <div className="flex gap-2">
        <button
          onClick={() => setViewMode('submit')}
          className={`flex items-center gap-1.5 px-4 py-2 rounded-full text-sm font-medium transition-colors ${
            viewMode === 'submit'
              ? 'bg-zinc-900 text-white'
              : 'bg-secondary text-secondary-foreground hover:bg-secondary/80'
          }`}
        >
          <CalendarPlus className="h-4 w-4" />
          シフト提出
        </button>
        <button
          onClick={() => setViewMode('history')}
          className={`flex items-center gap-1.5 px-4 py-2 rounded-full text-sm font-medium transition-colors ${
            viewMode === 'history'
              ? 'bg-zinc-900 text-white'
              : 'bg-secondary text-secondary-foreground hover:bg-secondary/80'
          }`}
        >
          <History className="h-4 w-4" />
          出勤履歴
        </button>
      </div>

      {/* ========== 提出モード ========== */}
      {viewMode === 'submit' && (
        <>
          <div>
            <p className="text-sm text-muted-foreground">
              提出期間: <span className="font-medium text-foreground">{periodLabel}</span>
            </p>
          </div>

          {/* カレンダー */}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm text-center">
                {format(calendarMonth, 'yyyy年M月', { locale: ja })}
              </CardTitle>
            </CardHeader>
            <CardContent className="px-2">
              <div className="grid grid-cols-7 mb-1">
                {DAY_NAMES.map((d, i) => (
                  <div key={d} className={`text-center text-xs font-medium py-1 ${
                    i === 0 ? 'text-red-500' : i === 6 ? 'text-blue-500' : 'text-muted-foreground'
                  }`}>{d}</div>
                ))}
              </div>
              <div className="grid grid-cols-7 gap-0.5">
                {Array.from({ length: firstDayOfWeek }).map((_, i) => (
                  <div key={`empty-${i}`} />
                ))}
                {calendarDays.map((date) => {
                  const inPeriod = isInPeriod(date)
                  const selected = isSelected(date)
                  const existingReq = getExistingForDate(date)
                  const dayOfWeek = getDay(date)
                  return (
                    <button
                      key={date.toISOString()}
                      onClick={() => toggleDate(date)}
                      disabled={!inPeriod}
                      className={`
                        relative flex flex-col items-center justify-center rounded-lg py-1.5 min-h-[52px] text-sm transition-all
                        ${!inPeriod ? 'text-muted-foreground/40 cursor-not-allowed' : 'cursor-pointer hover:bg-accent'}
                        ${selected ? 'bg-zinc-900 text-white hover:bg-zinc-800' : ''}
                        ${existingReq && !selected ? 'bg-emerald-50 ring-1 ring-emerald-200' : ''}
                        ${dayOfWeek === 0 && inPeriod && !selected ? 'text-red-500' : ''}
                        ${dayOfWeek === 6 && inPeriod && !selected ? 'text-blue-500' : ''}
                      `}
                    >
                      <span className="font-medium">{format(date, 'd')}</span>
                      {existingReq && (
                        <span className="text-[8px] leading-tight mt-0.5 text-emerald-600">
                          {formatTime(existingReq.start_time)}
                        </span>
                      )}
                      {selected && <Check className="absolute top-0.5 right-0.5 h-3 w-3" />}
                    </button>
                  )
                })}
              </div>
            </CardContent>
          </Card>

          {/* 入力フォーム */}
          {selectedDates.length > 0 && (
            <Card>
              <CardContent className="pt-4 space-y-4">
                <p className="text-sm font-medium">{selectedDates.length}日選択中</p>
                <div className="space-y-2">
                  <label className="text-sm font-medium">種別</label>
                  <div className="flex gap-2">
                    {(['仕込み・営業', '仕込み', '営業'] as const).map((t) => (
                      <button key={t} onClick={() => setShiftType(t)}
                        className={`px-3 py-1.5 rounded-full text-sm transition-colors ${
                          shiftType === t ? 'bg-zinc-900 text-white' : 'bg-secondary text-secondary-foreground hover:bg-secondary/80'
                        }`}>{t}</button>
                    ))}
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1">
                    <label className="text-sm font-medium">開始</label>
                    <select value={startTime} onChange={(e) => setStartTime(e.target.value)}
                      className="w-full h-10 rounded-md border border-input bg-background px-3 text-sm">
                      {TIME_SLOTS.map((t) => <option key={t} value={t}>{t}</option>)}
                    </select>
                  </div>
                  <div className="space-y-1">
                    <label className="text-sm font-medium">終了</label>
                    <select value={endTime} onChange={(e) => setEndTime(e.target.value)}
                      className="w-full h-10 rounded-md border border-input bg-background px-3 text-sm">
                      {TIME_SLOTS.map((t) => <option key={t} value={t}>{t}</option>)}
                    </select>
                  </div>
                </div>
                <div className="space-y-1">
                  <label className="text-sm font-medium">備考（任意）</label>
                  <input type="text" value={note} onChange={(e) => setNote(e.target.value)}
                    placeholder="遅れる場合などメモ"
                    className="w-full h-10 rounded-md border border-input bg-background px-3 text-sm" />
                </div>
                <Button onClick={handleSubmit} className="w-full h-11" disabled={submitting}>
                  {submitting ? (
                    <><Loader2 className="mr-2 h-4 w-4 animate-spin" />提出中...</>
                  ) : (
                    `${selectedDates.length}日分を提出する`
                  )}
                </Button>
                {message && (
                  <p className={`text-sm text-center ${message.includes('失敗') ? 'text-destructive' : 'text-emerald-600'}`}>{message}</p>
                )}
              </CardContent>
            </Card>
          )}

          {/* 提出済み一覧 */}
          {existing.length > 0 && (
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm">提出済みシフト</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-2">
                  {existing.map((req) => (
                    <div key={req.id} className="flex items-center justify-between py-2 border-b last:border-0">
                      <div>
                        <span className="text-sm font-medium">
                          {format(new Date(req.date + 'T00:00:00'), 'M/d（E）', { locale: ja })}
                        </span>
                        <span className="text-xs text-muted-foreground ml-2">
                          {formatTime(req.start_time)}–{formatTime(req.end_time)}
                        </span>
                        <span className="text-xs ml-1.5 px-1.5 py-0.5 rounded-full bg-secondary">{req.type}</span>
                      </div>
                      <button onClick={() => handleDelete(req.id)}
                        className="p-1.5 text-muted-foreground hover:text-destructive transition-colors">
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}
        </>
      )}

      {/* ========== 出勤履歴モード ========== */}
      {viewMode === 'history' && (
        <>
          {/* 月選択 */}
          <div className="flex items-center justify-center gap-4">
            <button onClick={() => setHistoryMonth((m) => subMonths(m, 1))}
              className="p-2 rounded-lg hover:bg-accent transition-colors">
              <ChevronLeft className="h-5 w-5" />
            </button>
            <span className="text-base font-semibold min-w-[120px] text-center">
              {format(historyMonth, 'yyyy年M月', { locale: ja })}
            </span>
            <button onClick={() => setHistoryMonth((m) => addMonths(m, 1))}
              className="p-2 rounded-lg hover:bg-accent transition-colors">
              <ChevronRight className="h-5 w-5" />
            </button>
          </div>

          {/* 履歴カレンダー */}
          <Card>
            <CardContent className="px-2 pt-4">
              <div className="grid grid-cols-7 mb-1">
                {DAY_NAMES.map((d, i) => (
                  <div key={d} className={`text-center text-xs font-medium py-1 ${
                    i === 0 ? 'text-red-500' : i === 6 ? 'text-blue-500' : 'text-muted-foreground'
                  }`}>{d}</div>
                ))}
              </div>
              <div className="grid grid-cols-7 gap-0.5">
                {Array.from({ length: historyFirstDow }).map((_, i) => (
                  <div key={`he-${i}`} />
                ))}
                {historyDays.map((date) => {
                  const shifts = getHistoryForDate(date)
                  const hasShift = shifts.length > 0
                  const dayOfWeek = getDay(date)
                  const isToday = isSameDay(date, today)
                  return (
                    <div
                      key={date.toISOString()}
                      className={`
                        flex flex-col items-center justify-center rounded-lg py-1.5 min-h-[52px] text-sm
                        ${hasShift ? 'bg-blue-50 ring-1 ring-blue-200' : ''}
                        ${isToday ? 'ring-2 ring-zinc-900' : ''}
                        ${dayOfWeek === 0 ? 'text-red-500' : ''}
                        ${dayOfWeek === 6 ? 'text-blue-500' : ''}
                      `}
                    >
                      <span className={`font-medium ${hasShift ? 'text-blue-900' : ''}`}>
                        {format(date, 'd')}
                      </span>
                      {shifts.map((s) => (
                        <span key={s.id} className="text-[7px] leading-tight text-blue-600">
                          {formatTime(s.start_time)}–{formatTime(s.end_time)}
                        </span>
                      ))}
                    </div>
                  )
                })}
              </div>
            </CardContent>
          </Card>

          {/* 履歴リスト */}
          {historyLoading ? (
            <div className="text-center text-sm text-muted-foreground py-4 animate-pulse">読み込み中...</div>
          ) : historyShifts.length > 0 ? (
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm">
                  出勤一覧（{historyShifts.length}日）
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-2">
                  {historyShifts.map((s) => (
                    <div key={s.id} className="flex items-center justify-between py-2 border-b last:border-0">
                      <div>
                        <span className="text-sm font-medium">
                          {format(new Date(s.date + 'T00:00:00'), 'M/d（E）', { locale: ja })}
                        </span>
                        <span className="text-xs text-muted-foreground ml-2">
                          {formatTime(s.start_time)}–{formatTime(s.end_time)}
                        </span>
                        <span className={`text-xs ml-1.5 px-1.5 py-0.5 rounded-full ${
                          s.type === '仕込み' ? 'bg-amber-100 text-amber-800' : 'bg-blue-100 text-blue-800'
                        }`}>{s.type}</span>
                      </div>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          ) : (
            <p className="text-center text-sm text-muted-foreground py-8">
              この月の出勤記録はありません
            </p>
          )}
        </>
      )}
    </div>
  )
}

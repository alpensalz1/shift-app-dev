'use client'

import { useEffect, useState, useMemo, useCallback } from 'react'
import { supabase } from '@/lib/supabase'
import { getStoredStaff } from '@/lib/auth'
import { ShiftRequest, ShiftFixed, OffRequest, Staff } from '@/types/database'
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
import { CalendarPlus, Check, ChevronLeft, ChevronRight, Loader2, Trash2, History, XCircle } from 'lucide-react'

const TIME_SLOTS = generateTimeSlots(9, 24)
const DAY_NAMES = ['日', '月', '火', '水', '木', '金', '土']

type ViewMode = 'submit' | 'history'
type OffType = '出勤' | '休み' | '仕込みのみ' | '営業のみ'

// =============================================
// 社員向け: 休み希望UI
// =============================================
function EmployeeSubmitView() {
  const staff = getStoredStaff()
  const today = new Date()
  const period = getSubmissionPeriod(today)

  // dateStr -> OffType のマップ
  const [offMap, setOffMap] = useState<Record<string, OffType>>({})
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState('')

  const calendarMonth = startOfMonth(period.start)
  const calendarDays = useMemo(
    () => eachDayOfInterval({ start: startOfMonth(period.start), end: endOfMonth(period.start) }),
    [period.start.toISOString()]
  )
  const firstDayOfWeek = getDay(calendarMonth)

  const isInPeriod = useCallback(
    (date: Date) => isWithinInterval(date, { start: period.start, end: period.end }),
    [period.start.toISOString(), period.end.toISOString()]
  )

  // 既存の休み希望を取得
  const fetchExisting = useCallback(async () => {
    if (!staff) return
    const { data } = await supabase
      .from('off_requests')
      .select('*')
      .eq('staff_id', staff.id)
      .gte('date', format(period.start, 'yyyy-MM-dd'))
      .lte('date', format(period.end, 'yyyy-MM-dd'))
    if (data) {
      const map: Record<string, OffType> = {}
      ;(data as OffRequest[]).forEach((r) => {
        map[r.date] = r.type as OffType
      })
      setOffMap(map)
    }
  }, [staff?.id, period.start.toISOString(), period.end.toISOString()])

  useEffect(() => {
    fetchExisting()
  }, [fetchExisting])

  // 日付タップ: 出勤 → 休み → 仕込みのみ → 営業のみ → 出勤
  const toggleDate = (date: Date) => {
    if (!isInPeriod(date)) return
    const key = format(date, 'yyyy-MM-dd')
    setOffMap((prev) => {
      const cur = prev[key] ?? '出勤'
      const next: OffType = cur === '出勤' ? '休み' : cur === '休み' ? '仕込みのみ' : cur === '仕込みのみ' ? '営業のみ' : '出勤'
      const updated = { ...prev }
      if (next === '出勤') {
        delete updated[key]
      } else {
        updated[key] = next
      }
      return updated
    })
  }

  const offCount = Object.values(offMap).filter((v) => v === '休み').length
  const prepOnlyCount = Object.values(offMap).filter((v) => v === '仕込みのみ').length
  const salesOnlyCount = Object.values(offMap).filter((v) => v === '営業のみ').length
  const totalCount = offCount + prepOnlyCount + salesOnlyCount

  const handleSave = async () => {
    if (!staff) return
    setSaving(true)
    setMessage('')

    // 期間内の全日付を列挙
    const allDates = eachDayOfInterval({ start: period.start, end: period.end })

    // off_requests upsert (休み or 仕込みのみ のもの)
    const upsertRows = allDates
      .filter((d) => {
        const key = format(d, 'yyyy-MM-dd')
        return offMap[key] && offMap[key] !== '出勤'
      })
      .map((d) => {
        const key = format(d, 'yyyy-MM-dd')
        return {
          staff_id: staff.id,
          date: key,
          type: offMap[key],
          updated_at: new Date().toISOString(),
        }
      })

    // 出勤に戻した日は削除
    const deleteDates = allDates
      .filter((d) => {
        const key = format(d, 'yyyy-MM-dd')
        return !offMap[key] || offMap[key] === '出勤'
      })
      .map((d) => format(d, 'yyyy-MM-dd'))

    let hasError = false

    if (upsertRows.length > 0) {
      const { error } = await supabase
        .from('off_requests')
        .upsert(upsertRows, { onConflict: 'staff_id,date' })
      if (error) hasError = true
    }

    if (deleteDates.length > 0 && !hasError) {
      const { error } = await supabase
        .from('off_requests')
        .delete()
        .eq('staff_id', staff.id)
        .in('date', deleteDates)
      if (error) hasError = true
    }

    // shift_requests upsert: 出勤・仕込みのみ・営業のみ の日はシフト希望として登録
    const shiftRows = allDates
      .filter((d) => {
        const key = format(d, 'yyyy-MM-dd')
        const t = offMap[key] ?? '出勤'
        return t !== '休み'
      })
      .map((d) => {
        const key = format(d, 'yyyy-MM-dd')
        const t = offMap[key] ?? '出勤'
        const type = t === '仕込みのみ' ? '仕込み' : t === '営業のみ' ? '営業' : '仕込み・営業'
        const st = t === '営業のみ' ? '17:00:00' : '14:00:00'
        const et = t === '仕込みのみ' ? '17:00:00' : '24:00:00'
        return { staff_id: staff!.id, date: key, type, start_time: st, end_time: et }
      })

    if (shiftRows.length > 0) {
      const { error: srErr } = await supabase
        .from('shift_requests')
        .upsert(shiftRows, { onConflict: 'staff_id,date' })
      if (srErr) { setSaving(false); setMessage('保存に失敗しました'); return }
    }

    // shift_requests delete: 休みの日は削除
    const offDates = allDates
      .filter((d) => (offMap[format(d, 'yyyy-MM-dd')] ?? '出勤') === '休み')
      .map((d) => format(d, 'yyyy-MM-dd'))

    if (offDates.length > 0) {
      const { error: sdErr } = await supabase
        .from('shift_requests')
        .delete()
        .eq('staff_id', staff!.id)
        .in('date', offDates)
      if (sdErr) { setSaving(false); setMessage('保存に失敗しました'); return }
    }

    setSaving(false)
    if (hasError) {
      setMessage('保存に失敗しました')
    } else {
      setMessage('保存しました')
      fetchExisting()
    }
  }

  const periodLabel = `${format(period.start, 'M/d')}〜${format(period.end, 'M/d')}`

  return (
    <>
      <div>
        <p className="text-sm text-muted-foreground">
          対象期間: <span className="font-medium text-foreground">{periodLabel}</span>
        </p>
        <p className="text-xs text-muted-foreground mt-0.5">
          締め切り: <span className="font-medium text-foreground">{format(period.deadline, 'M/d')}</span>
        </p>
        <p className="text-xs text-muted-foreground mt-0.5">
          タップで 出勤 → 休み → 仕込みのみ → 営業のみ と切り替わります
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
              const key = format(date, 'yyyy-MM-dd')
              const offType = offMap[key] ?? '出勤'
              const dayOfWeek = getDay(date)

              let bgClass = ''
              let textClass = ''
              let label = ''

              if (offType === '休み') {
                bgClass = 'bg-red-100 ring-1 ring-red-300'
                textClass = 'text-red-700'
                label = '休み'
              } else if (offType === '仕込みのみ') {
                bgClass = 'bg-amber-100 ring-1 ring-amber-300'
                textClass = 'text-amber-700'
                label = '仕込'
              } else if (offType === '営業のみ') {
                bgClass = 'bg-blue-100 ring-1 ring-blue-300'
                textClass = 'text-blue-700'
                label = '営業'
              }

              return (
                <button
                  key={date.toISOString()}
                  onClick={() => toggleDate(date)}
                  disabled={!inPeriod}
                  className={`
                    relative flex flex-col items-center justify-center rounded-lg py-1.5 min-h-[52px] text-sm transition-all
                    ${!inPeriod ? 'text-muted-foreground/40 cursor-not-allowed' : 'cursor-pointer hover:bg-accent'}
                    ${bgClass}
                    ${!bgClass && dayOfWeek === 0 && inPeriod ? 'text-red-500' : ''}
                    ${!bgClass && dayOfWeek === 6 && inPeriod ? 'text-blue-500' : ''}
                  `}
                >
                  <span className={`font-medium ${textClass}`}>{format(date, 'd')}</span>
                  {label && (
                    <span className={`text-[9px] leading-tight mt-0.5 font-medium ${textClass}`}>{label}</span>
                  )}
                </button>
              )
            })}
          </div>
        </CardContent>
      </Card>

      {/* 集計と保存 */}
      <Card>
        <CardContent className="pt-4 space-y-3">
          <div className="flex items-center justify-between text-sm">
            <span className="text-muted-foreground">休み</span>
            <span className="font-medium">{offCount}日</span>
          </div>
          <div className="flex items-center justify-between text-sm">
            <span className="text-muted-foreground">仕込みのみ</span>
            <span className="font-medium">{prepOnlyCount}日</span>
          </div>
          <div className="flex items-center justify-between text-sm">
            <span className="text-muted-foreground">営業のみ</span>
            <span className="font-medium">{salesOnlyCount}日</span>
          </div>
          <div className="flex items-center justify-between text-sm border-t pt-2">
            <span className="font-medium">合計オフ</span>
            <span className={`font-bold text-base ${totalCount >= 5 && totalCount <= 6 ? 'text-emerald-600' : 'text-foreground'}`}>
              {totalCount}日
              <span className="text-xs font-normal text-muted-foreground ml-1">（目安 5〜6日）</span>
            </span>
          </div>
          <Button onClick={handleSave} className="w-full h-11" disabled={saving}>
            {saving ? (
              <><Loader2 className="mr-2 h-4 w-4 animate-spin" />保存中...</>
            ) : (
              '休み希望を保存する'
            )}
          </Button>
          {message && (
            <p className={`text-sm text-center ${message.includes('失敗') ? 'text-destructive' : 'text-emerald-600'}`}>
              {message}
            </p>
          )}
        </CardContent>
      </Card>
    </>
  )
}

// =============================================
// アルバイト向け: シフト希望提出UI（既存ロジック）
// =============================================
function PartTimeSubmitView() {
  const staff = getStoredStaff()
  const today = new Date()
  const period = getSubmissionPeriod(today)

  const [selectedDates, setSelectedDates] = useState<Date[]>([])
  const [shiftType, setShiftType] = useState<'仕込み・営業' | '仕込み' | '営業'>('仕込み・営業')
  const [startTime, setStartTime] = useState('14:00')
  const [endTime, setEndTime] = useState('24:00')
  const [note, setNote] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [existing, setExisting] = useState<ShiftRequest[]>([])
  const [message, setMessage] = useState('')

  const calendarMonth = startOfMonth(period.start)
  const calendarDays = useMemo(
    () => eachDayOfInterval({ start: startOfMonth(period.start), end: endOfMonth(period.start) }),
    [period.start.toISOString()]
  )
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

  useEffect(() => { fetchExisting() }, [fetchExisting])

  const toggleDate = (date: Date) => {
    if (!isInPeriod(date)) return
    setSelectedDates((prev) => {
      const found = prev.find((d) => isSameDay(d, date))
      if (found) return prev.filter((d) => !isSameDay(d, date))
      return [...prev, date]
    })
  }

  const isSelected = (date: Date) => selectedDates.some((d) => isSameDay(d, date))
  const getExistingForDate = (date: Date) => existing.find((r) => r.date === format(date, 'yyyy-MM-dd'))

  const handleSubmit = async () => {
    if (!staff || selectedDates.length === 0) return
    if (!isValid15MinTime(startTime) || !isValid15MinTime(endTime)) {
      setMessage('時間は15分刻みで指定してください')
      return
    }
    const [sh, sm] = startTime.split(':').map(Number)
    const [eh, em] = endTime.split(':').map(Number)
    if (eh * 60 + em <= sh * 60 + sm) {
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
    const { error } = await supabase.from('shift_requests').upsert(rows, { onConflict: 'staff_id,date' })
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
    <>
      <div>
        <p className="text-sm text-muted-foreground">
          期間: <span className="font-medium text-foreground">{periodLabel}</span>
        </p>
        <p className="text-xs text-muted-foreground mt-0.5">
          締め切り: <span className="font-medium text-foreground">{format(period.deadline, 'M/d')}</span>
        </p>
      </div>

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

      {selectedDates.length > 0 && (
        <Card>
          <CardContent className="pt-4 space-y-4">
            <p className="text-sm font-medium">{selectedDates.length}日選択中</p>
            <div className="space-y-2">
              <label className="text-sm font-medium">種別</label>
              <div className="flex gap-2">
                {(['仕込み・営業', '仕込み', '営業'] as const).map((t) => (
                  <button key={t} onClick={() => { setShiftType(t); if (t === '仕込み・営業') { setStartTime('14:00'); setEndTime('24:00'); } else if (t === '仕込み') { setStartTime('14:00'); setEndTime('17:00'); } else { setStartTime('17:00'); setEndTime('24:00'); } }}
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

      {existing.length > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">提出済みシフト</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {existing.map((req) => (
                <div key={req.id} className={`flex items-center justify-between py-2 border-b last:border-0 ${req.status === 'rejected' ? 'opacity-70 bg-red-50 px-2 rounded' : ''}`}>
                  <div>
                    <span className="text-sm font-medium">
                      {format(new Date(req.date + 'T00:00:00'), 'M/d（E）', { locale: ja })}
                    </span>
                    <span className="text-xs text-muted-foreground ml-2">
                      {formatTime(req.start_time)}–{formatTime(req.end_time)}
                    </span>
                    <span className="text-xs ml-1.5 px-1.5 py-0.5 rounded-full bg-secondary">{req.type}</span>
                            {req.status === 'rejected' && (
                              <span className="text-xs px-1.5 py-0.5 rounded-full bg-red-100 text-red-700 font-medium flex items-center gap-0.5">
                                <XCircle className="h-3 w-3" /> 却下
                              </span>
                            )}
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
  )
}

// =============================================
// 出勤履歴ビュー（共通）
// =============================================
function HistoryView() {
  const staff = getStoredStaff()
  const today = new Date()
  const [historyMonth, setHistoryMonth] = useState(() => new Date())
  const [historyShifts, setHistoryShifts] = useState<ShiftFixed[]>([])
  const [historyLoading, setHistoryLoading] = useState(false)

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

  useEffect(() => { fetchHistory() }, [fetchHistory])

  const historyDays = useMemo(
    () => eachDayOfInterval({ start: startOfMonth(historyMonth), end: endOfMonth(historyMonth) }),
    [historyMonth.toISOString()]
  )
  const historyFirstDow = getDay(startOfMonth(historyMonth))
  const getHistoryForDate = (date: Date) => historyShifts.filter((s) => s.date === format(date, 'yyyy-MM-dd'))

  return (
    <>
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
                <div key={date.toISOString()}
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

      {historyLoading ? (
        <div className="text-center text-sm text-muted-foreground py-4 animate-pulse">読み込み中...</div>
      ) : historyShifts.length > 0 ? (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">出勤一覧（{new Set(historyShifts.map(s => s.date)).size}日）</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {Object.entries(
                historyShifts.reduce((acc, s) => {
                  if (!acc[s.date]) acc[s.date] = []
                  acc[s.date].push(s)
                  return acc
                }, {} as Record<string, typeof historyShifts>)
              )
                .sort(([a], [b]) => a.localeCompare(b))
                .map(([date, dayShifts]) => (
                  <div key={date} className="py-2 border-b last:border-0">
                    <span className="text-sm font-medium">
                      {format(new Date(date + 'T00:00:00'), 'M/d（E）', { locale: ja })}
                    </span>
                    <div className="flex flex-wrap gap-2 mt-0.5">
                      {dayShifts.map((s) => (
                        <span key={s.id} className="text-xs text-muted-foreground">
                          <span className={`px-1.5 py-0.5 rounded-full ${
                            s.type === '仕込み' ? 'bg-amber-100 text-amber-800' : 'bg-blue-100 text-blue-800'
                          }`}>{s.type}</span>
                          {' '}{formatTime(s.start_time)}–{formatTime(s.end_time)}
                        </span>
                      ))}
                    </div>
                  </div>
                ))
              }
            </div>
          </CardContent>
        </Card>
      ) : (
        <p className="text-center text-sm text-muted-foreground py-8">
          この月の出勤記録はありません
        </p>
      )}
    </>
  )
}

// =============================================
// メインページ
// =============================================
export default function ShiftsPage() {
  const [staff, setStaff] = useState<Staff | null>(null)
  const [staffLoaded, setStaffLoaded] = useState(false)
  const [viewMode, setViewMode] = useState<ViewMode>('submit')

  useEffect(() => {
    setStaff(getStoredStaff())
    setStaffLoaded(true)
  }, [])

  const isEmployee = staff?.employment_type === '社員' || staff?.employment_type === '役員'

  if (!staffLoaded) return null

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
          {isEmployee ? '休み希望' : 'シフト提出'}
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

      {viewMode === 'submit' && (
        isEmployee ? <EmployeeSubmitView /> : <PartTimeSubmitView />
      )}

      {viewMode === 'history' && <HistoryView />}
    </div>
  )
}

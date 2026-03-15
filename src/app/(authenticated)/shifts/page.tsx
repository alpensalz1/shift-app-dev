'use client'

import { useState, useEffect, useMemo } from 'react'
import { supabase } from '@/lib/supabase'
import { getStoredStaff } from '@/lib/auth'
import { Staff, ShiftRequest, ShiftFixed, OffRequest } from '@/types/database'
import { getSubmissionPeriod } from '@/lib/utils'
import {
  format,
  eachDayOfInterval,
  getDay,
  addDays,
  endOfMonth,
} from 'date-fns'
import { ja } from 'date-fns/locale'
import {
  CalendarDays,
  Loader2,
  Send,
  Clock,
  CheckCircle2,
  AlertCircle,
  ChevronLeft,
  ChevronRight,
} from 'lucide-react'
import { Button } from '@/components/ui/button'

// ============================================================
// 仕様メモ（SPEC.md も参照すること）
//
// アルバイト: 「出勤できる日」を選ぶ → shift_requests に保存
//   - 開始・終了時刻の入力が必須
//   - 15分刻み、14:00〜24:00の範囲
//   - 終了時刻 > 開始時刻 の検証あり
//
// 社員・役員: カレンダーで日付ごとに3択 → off_requests に保存
//   - 未選択（デフォルト）= フル出勤（仕込み＋営業）→ 記録不要
//   - 3択: 休む / 仕込みのみ / 営業のみ
//   - タップするたびに選択肢が循環する
// ============================================================

// =============================================
// 型定義・定数
// =============================================

type DayChoice = '休み' | '仕込みのみ' | '営業のみ'
type DayChoiceMap = Record<string, DayChoice>

const DOW_LABELS = ['日', '月', '火', '水', '木', '金', '土']

function fmtKey(d: Date): string {
  return format(d, 'yyyy-MM-dd')
}

// 時刻ピッカー用: HH / MM 独立選択（縦長 select を排除）
// 開始: 14〜23時, 終了: 14〜24時
const START_HOURS = Array.from({ length: 10 }, (_, i) => String(i + 14).padStart(2, '0')) // "14"〜"23"
const END_HOURS   = Array.from({ length: 11 }, (_, i) => String(i + 14).padStart(2, '0')) // "14"〜"24"
const TIME_MINUTES = ['00', '15', '30', '45']

const CHOICE_CYCLE: (DayChoice | undefined)[] = [
  undefined,
  '休み',
  '仕込みのみ',
  '営業のみ',
]

const CHOICE_STYLES: Record<
  DayChoice,
  { bg: string; text: string; badge: string }
> = {
  休み: { bg: 'bg-red-400', text: 'text-white', badge: '休' },
  仕込みのみ: { bg: 'bg-amber-400', text: 'text-white', badge: '仕' },
  営業のみ: { bg: 'bg-indigo-500', text: 'text-white', badge: '営' },
}

// =============================================
// 期間計算（オフセット対応）
// =============================================

interface Period {
  start: Date
  end: Date
  deadline: Date
  label: string
}

function getPeriod(offset: number): Period {
  const base = getSubmissionPeriod(new Date())
  let start = new Date(base.start)
  let end = new Date(base.end)

  for (let i = 0; i < Math.abs(offset); i++) {
    if (offset > 0) {
      const nextStart = addDays(end, 1)
      start = nextStart
      end =
        nextStart.getDate() === 1
          ? new Date(nextStart.getFullYear(), nextStart.getMonth(), 15)
          : endOfMonth(nextStart)
    } else {
      const prevEnd = addDays(start, -1)
      end = prevEnd
      start =
        prevEnd.getDate() > 15
          ? new Date(prevEnd.getFullYear(), prevEnd.getMonth(), 16)
          : new Date(prevEnd.getFullYear(), prevEnd.getMonth(), 1)
    }
  }

  const isFirstHalf = start.getDate() <= 15
  const m = start.getMonth() + 1
  const deadline = isFirstHalf
    ? new Date(start.getFullYear(), start.getMonth() - 1, 20) // 前半: 前月20日
    : new Date(start.getFullYear(), start.getMonth(), 5)       // 後半: 当月5日
  return {
    start,
    end,
    deadline,
    label: `${m}月${isFirstHalf ? '前半' : '後半'}`,
  }
}

// =============================================
// メインページ
// =============================================

export default function ShiftsPage() {
  const [staff, setStaff] = useState<Staff | null>(null)
  const [loading, setLoading] = useState(true)
  const [periodOffset, setPeriodOffset] = useState(0)

  useEffect(() => {
    const stored = getStoredStaff()
    setStaff(stored)
    setLoading(false)
  }, [])

  const period = useMemo(() => getPeriod(periodOffset), [periodOffset])

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    )
  }

  if (!staff) {
    return (
      <div className="px-4 pt-12 text-center">
        <AlertCircle className="h-10 w-10 text-red-400 mx-auto mb-3" />
        <p className="text-muted-foreground">スタッフ情報が見つかりません</p>
      </div>
    )
  }

  const isPartTimer =
    staff.employment_type === 'アルバイト' ||
    staff.employment_type === 'システム管理者'
  const isFullTime =
    staff.employment_type === '社員' || staff.employment_type === '役員'

  return (
    <div className="px-4 pt-3 pb-24 space-y-4 animate-fade-in">
      {/* ヘッダー */}
      <div className="flex items-center gap-3">
        <div className="w-10 h-10 rounded-2xl bg-gradient-to-br from-blue-500 to-indigo-600 flex items-center justify-center shadow-sm">
          <CalendarDays className="h-5 w-5 text-white" />
        </div>
        <div>
          <h1 className="text-lg font-bold text-foreground">シフト希望提出</h1>
          <p className="text-xs text-muted-foreground">
            {isPartTimer ? '出勤できる日と時間を選択' : '日ごとの勤務形態を選択'}
          </p>
        </div>
      </div>

      {/* 期間ナビゲーション */}
      <div className="flex items-center gap-2 bg-muted/40 rounded-2xl px-3 py-2">
        <button
          onClick={() => setPeriodOffset((p) => p - 1)}
          className="p-1.5 hover:bg-white rounded-xl transition-colors"
        >
          <ChevronLeft className="h-4 w-4" />
        </button>
        <div className="flex-1 text-center">
          <p className="text-sm font-bold text-foreground">{period.label}</p>
          <p className="text-xs text-muted-foreground">
            {format(period.start, 'M/d（E）', { locale: ja })} 〜{' '}
            {format(period.end, 'M/d（E）', { locale: ja })}
          </p>
        </div>
        <button
          onClick={() => setPeriodOffset((p) => p + 1)}
          className="p-1.5 hover:bg-white rounded-xl transition-colors"
        >
          <ChevronRight className="h-4 w-4" />
        </button>
      </div>

      {/* 締切バナー */}
      <DeadlineBanner period={period} />

      {/* フォーム本体 */}
      {isPartTimer ? (
        <PartTimerForm
          key={period.label}
          staff={staff}
          periodStart={period.start}
          periodEnd={period.end}
        />
      ) : isFullTime ? (
        <FullTimeForm
          key={period.label}
          staff={staff}
          periodStart={period.start}
          periodEnd={period.end}
        />
      ) : (
        <div className="text-center py-8 text-sm text-muted-foreground">
          シフト希望の提出ができない役職です
        </div>
      )}
    </div>
  )
}

// =============================================
// アルバイト用フォーム
// 「先に時間を選択し、その時間帯で働きたい日をタップ」
// 複数の時間帯対応 / 15分刻み / デフォルト14:00〜24:00
// =============================================

type DayTimeEntry = { start: string; end: string }

function PartTimerForm({
  staff,
  periodStart,
  periodEnd,
}: {
  staff: Staff
  periodStart: Date
  periodEnd: Date
}) {
  const [currentStart, setCurrentStart] = useState('14:00')
  const [currentEnd, setCurrentEnd] = useState('24:00')
  const [dayTimeMap, setDayTimeMap] = useState<Record<string, DayTimeEntry>>({})
  const [submitting, setSubmitting] = useState(false)
  const [submitError, setSubmitError] = useState('')
  const [loadingExisting, setLoadingExisting] = useState(true)
  const [existingRequests, setExistingRequests] = useState<ShiftRequest[]>([])
  const [fixedShifts, setFixedShifts] = useState<ShiftFixed[]>([])
  const [viewMode, setViewMode] = useState<'form' | 'status'>('form')

  const days = useMemo(
    () => eachDayOfInterval({ start: periodStart, end: periodEnd }),
    [periodStart, periodEnd]
  )

  // 既存の申請と確定シフトを読み込む
  useEffect(() => {
    let cancelled = false
    // 期間切替時に古いデータが一瞬表示されないよう即座にリセット
    setLoadingExisting(true)
    setViewMode('form')
    setDayTimeMap({})
    setExistingRequests([])
    setFixedShifts([])
    setSubmitError('')
    async function load() {
      const startKey = fmtKey(periodStart)
      const endKey = fmtKey(periodEnd)
      const [reqRes, fixedRes] = await Promise.all([
        supabase.from('shift_requests').select('*')
          .eq('staff_id', staff.id).gte('date', startKey).lte('date', endKey),
        supabase.from('shifts_fixed').select('*')
          .eq('staff_id', staff.id).gte('date', startKey).lte('date', endKey),
      ])
      if (cancelled) return
      if (reqRes.error) {
        setSubmitError('データ読み込みに失敗しました: ' + reqRes.error.message)
      } else if (reqRes.data && reqRes.data.length > 0) {
        const map: Record<string, DayTimeEntry> = {}
        reqRes.data.forEach((r: ShiftRequest) => {
          map[r.date.substring(0, 10)] = {
            start: r.start_time.substring(0, 5),
            end: r.end_time.substring(0, 5),
          }
        })
        setDayTimeMap(map)
        setExistingRequests(reqRes.data)
        setViewMode('status')
      }
      if (!fixedRes.error && fixedRes.data) setFixedShifts(fixedRes.data)
      setLoadingExisting(false)
    }
    load()
    return () => { cancelled = true }
  }, [staff.id, periodStart, periodEnd])

  function toggleDay(dk: string) {
    if (currentStart >= currentEnd) return
    // 過去日は選択不可
    if (dk < format(new Date(), 'yyyy-MM-dd')) return
    setDayTimeMap((prev) => {
      const next = { ...prev }
      if (next[dk]) {
        delete next[dk]
      } else {
        next[dk] = { start: currentStart, end: currentEnd }
      }
      return next
    })
  }

  async function handleSubmit() {
    const entries = Object.entries(dayTimeMap)
    if (entries.length === 0) return
    setSubmitting(true)
    setSubmitError('')
    const startKey = fmtKey(periodStart)
    const endKey = fmtKey(periodEnd)
    let deleteDone = false
    try {
      const { error: delErr } = await supabase
        .from('shift_requests').delete()
        .eq('staff_id', staff.id).gte('date', startKey).lte('date', endKey)
      if (delErr) throw new Error('削除エラー: ' + delErr.message)
      deleteDone = true
      const rows = entries.map(([dk, times]) => ({
        staff_id: staff.id,
        date: dk,
        start_time: times.start,
        end_time: times.end,
        type: '仕込み・営業' as const,
        status: 'pending' as const,
      }))
      const { error: insErr } = await supabase.from('shift_requests').insert(rows)
      if (insErr) throw new Error('送信エラー: ' + insErr.message)
      // INSERT成功後に最新データを再取得（再取得失敗でもINSERT自体は成功しているため、エラーにしない）
      const [reqRes2, fixedRes2] = await Promise.all([
        supabase.from('shift_requests').select('*')
          .eq('staff_id', staff.id).gte('date', startKey).lte('date', endKey),
        supabase.from('shifts_fixed').select('*')
          .eq('staff_id', staff.id).gte('date', startKey).lte('date', endKey),
      ])
      if (!reqRes2.error) setExistingRequests(reqRes2.data || [])
      if (!fixedRes2.error) setFixedShifts(fixedRes2.data || [])
      setViewMode('status')
    } catch (e: any) {
      setSubmitError(e.message || '送信に失敗しました。もう一度お試しください。')
      // DELETE成功後にINSERTが失敗した場合、DBの実態に合わせてUIを更新する
      if (deleteDone) {
        const [rr, fr] = await Promise.all([
          supabase.from('shift_requests').select('*').eq('staff_id', staff.id).gte('date', startKey).lte('date', endKey),
          supabase.from('shifts_fixed').select('*').eq('staff_id', staff.id).gte('date', startKey).lte('date', endKey),
        ])
        if (!rr.error) setExistingRequests(rr.data || [])
        if (!fr.error) setFixedShifts(fr.data || [])
      }
    } finally {
      setSubmitting(false)
    }
  }

  if (loadingExisting) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    )
  }

  async function handleWithdraw() {
    if (!window.confirm('提出済みのシフト希望を全て取り消しますか？\nこの操作は取り消せません。')) return
    setSubmitting(true)
    setSubmitError('')
    const startKey = fmtKey(periodStart)
    const endKey = fmtKey(periodEnd)
    try {
      const { error: delErr } = await supabase
        .from('shift_requests').delete()
        .eq('staff_id', staff.id).gte('date', startKey).lte('date', endKey)
      if (delErr) throw new Error('取り消しエラー: ' + delErr.message)
      setExistingRequests([])
      setDayTimeMap({})
      setViewMode('form')
    } catch (e: any) {
      setSubmitError(e.message || '取り消しに失敗しました。もう一度お試しください。')
    } finally {
      setSubmitting(false)
    }
  }

  if (viewMode === 'status') {
    return (
      <StatusView
        existingRequests={existingRequests}
        fixedShifts={fixedShifts}
        periodStart={periodStart}
        periodEnd={periodEnd}
        onResubmit={() => setViewMode('form')}
        onWithdraw={handleWithdraw}
        withdrawing={submitting}
      />
    )
  }

  const firstDow = getDay(days[0])
  const selectedCount = Object.keys(dayTimeMap).length
  const timeError = currentStart && currentEnd && currentStart >= currentEnd
    ? '終了は開始より後にしてください' : ''
  const canSubmit = selectedCount > 0 && currentStart < currentEnd

  // 時間帯ごとに日付をグループ化
  const timeGroups = Object.entries(dayTimeMap).reduce<Record<string, string[]>>((acc, [dk, t]) => {
    const key = `${t.start}〜${t.end}`
    if (!acc[key]) acc[key] = []
    acc[key].push(dk)
    return acc
  }, {})

  return (
    <div className="space-y-3 animate-slide-up">
      {/* ① 時間帯選択 */}
      <div className="bg-white rounded-2xl ring-1 ring-border/40 shadow-sm px-4 py-3 space-y-2">
        <p className="text-sm font-semibold text-foreground flex items-center gap-1.5">
          <Clock className="h-4 w-4 text-blue-500" />
          ① 働く時間帯を選択
        </p>
        <p className="text-xs text-muted-foreground">この時間帯で下のカレンダーから日付をタップ。時間を変えて複数の時間帯も設定できます</p>
        <div className="flex items-center gap-2">
          {/* 開始 */}
          <div>
            <p className="text-[10px] text-muted-foreground mb-1 text-center">開始</p>
            <div className="flex items-center gap-1">
              <select
                className="text-sm border border-border/60 rounded-xl px-2 py-1.5 bg-background w-[3.8rem] text-center"
                value={currentStart.split(':')[0]}
                onChange={(e) => setCurrentStart(`${e.target.value}:${currentStart.split(':')[1]}`)}
              >
                {START_HOURS.map((h) => <option key={h} value={h}>{h}</option>)}
              </select>
              <span className="text-muted-foreground font-semibold">:</span>
              <select
                className="text-sm border border-border/60 rounded-xl px-2 py-1.5 bg-background w-[3.8rem] text-center"
                value={currentStart.split(':')[1]}
                onChange={(e) => setCurrentStart(`${currentStart.split(':')[0]}:${e.target.value}`)}
              >
                {TIME_MINUTES.map((m) => <option key={m} value={m}>{m}</option>)}
              </select>
            </div>
          </div>
          <span className="text-muted-foreground text-sm mt-4">〜</span>
          {/* 終了 */}
          <div>
            <p className="text-[10px] text-muted-foreground mb-1 text-center">終了</p>
            <div className="flex items-center gap-1">
              <select
                className="text-sm border border-border/60 rounded-xl px-2 py-1.5 bg-background w-[3.8rem] text-center"
                value={currentEnd.split(':')[0]}
                onChange={(e) => {
                  const h = e.target.value
                  // 24時は00分固定
                  const m = h === '24' ? '00' : currentEnd.split(':')[1]
                  setCurrentEnd(`${h}:${m}`)
                }}
              >
                {END_HOURS.map((h) => <option key={h} value={h}>{h}</option>)}
              </select>
              <span className="text-muted-foreground font-semibold">:</span>
              <select
                className="text-sm border border-border/60 rounded-xl px-2 py-1.5 bg-background w-[3.8rem] text-center"
                value={currentEnd.split(':')[1]}
                onChange={(e) => setCurrentEnd(`${currentEnd.split(':')[0]}:${e.target.value}`)}
                disabled={currentEnd.split(':')[0] === '24'}
              >
                {TIME_MINUTES.map((m) => <option key={m} value={m}>{m}</option>)}
              </select>
            </div>
          </div>
        </div>
        {timeError && <p className="text-xs text-red-500">{timeError}</p>}
      </div>

      {/* ② 日付タップ */}
      <div className="flex items-center justify-between px-1">
        <p className="text-sm text-muted-foreground">
          <span className="font-semibold text-foreground">②</span> 出勤希望日をタップ
        </p>
        <span className="text-2xl font-bold text-blue-600 tabular-nums">
          {selectedCount}
          <span className="text-sm font-normal text-muted-foreground ml-1">日</span>
        </span>
      </div>

      {/* カレンダー */}
      <div className="bg-white rounded-2xl ring-1 ring-border/40 shadow-sm overflow-hidden">
        <DowHeader />
        <div className="p-2">
          <div className="grid grid-cols-7 gap-1">
            {Array.from({ length: firstDow }).map((_, i) => (
              <div key={`e${i}`} />
            ))}
            {days.map((d) => {
              const dk = fmtKey(d)
              const timeSel = dayTimeMap[dk]
              const isSel = !!timeSel
              // 現在の時間帯と一致するセル = 青、別の時間帯 = インディゴ
              const isCurrentTime = timeSel?.start === currentStart && timeSel?.end === currentEnd
              const dow = getDay(d)
              const isPast = dk < format(new Date(), 'yyyy-MM-dd')
              const shortLabel = timeSel
                ? `${timeSel.start.substring(0, 2)}-${timeSel.end.substring(0, 2)}`
                : null
              return (
                <button
                  key={dk}
                  onClick={() => toggleDay(dk)}
                  disabled={isPast}
                  className={`h-11 w-full rounded-xl flex flex-col items-center justify-center gap-0 text-sm font-medium transition-all active:scale-95 ${
                    isPast
                      ? 'text-muted-foreground/30 cursor-not-allowed'
                      : isSel
                      ? isCurrentTime
                        ? 'bg-blue-500 text-white shadow-sm'
                        : 'bg-indigo-600 text-white shadow-sm'
                      : dow === 0
                      ? 'text-red-500 hover:bg-red-50'
                      : dow === 6
                      ? 'text-blue-500 hover:bg-blue-50'
                      : 'text-foreground hover:bg-muted/50'
                  }`}
                >
                  <span className="text-sm leading-none">{format(d, 'd')}</span>
                  {shortLabel && (
                    <span className="text-[7px] leading-none opacity-90 mt-0.5">{shortLabel}</span>
                  )}
                </button>
              )
            })}
          </div>
        </div>
      </div>

      {/* 選択内訳（時間帯ごとのグループ） */}
      {selectedCount > 0 && (
        <div className="bg-muted/30 rounded-xl px-3 py-2 space-y-1.5">
          <p className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide">選択中の日程</p>
          {Object.entries(timeGroups).map(([timeRange, dates]) => (
            <div key={timeRange} className="flex items-start gap-2">
              <span className="text-xs font-semibold text-blue-600 shrink-0 mt-0.5">{timeRange}</span>
              <span className="text-xs text-muted-foreground leading-relaxed">
                {dates.sort().map((dk) => {
                  const d = new Date(dk + 'T00:00:00')
                  return format(d, 'M/d', { locale: ja })
                }).join('・')}
              </span>
            </div>
          ))}
        </div>
      )}

      {/* エラーメッセージ */}
      {submitError && (
        <div className="rounded-xl bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700">
          {submitError}
        </div>
      )}

      {/* 提出ボタン */}
      <Button
        className="w-full h-12 rounded-2xl bg-gradient-to-r from-blue-500 to-indigo-600 text-white font-semibold shadow-sm disabled:opacity-40"
        onClick={handleSubmit}
        disabled={submitting || !canSubmit}
      >
        {submitting ? (
          <Loader2 className="h-4 w-4 animate-spin" />
        ) : selectedCount === 0 ? (
          '出勤希望日を選択してください'
        ) : timeError ? (
          '時間帯を正しく設定してください'
        ) : (
          <>
            <Send className="h-4 w-4 mr-2" />
            {selectedCount}日分の希望を提出する
          </>
        )}
      </Button>
    </div>
  )
}

// =============================================
// 社員・役員用フォーム
// カレンダーで日付ごとに3択
// 未選択 = フル出勤（デフォルト）
// タップするたびに循環: フル → 休み → 仕込みのみ → 営業のみ → フル
// =============================================

function FullTimeForm({
  staff,
  periodStart,
  periodEnd,
}: {
  staff: Staff
  periodStart: Date
  periodEnd: Date
}) {
  const [choices, setChoices] = useState<DayChoiceMap>({})
  const [submitting, setSubmitting] = useState(false)
  const [done, setDone] = useState(false)
  const [submitError, setSubmitError] = useState('')
  const [loadingExisting, setLoadingExisting] = useState(true)

  const days = useMemo(
    () => eachDayOfInterval({ start: periodStart, end: periodEnd }),
    [periodStart, periodEnd]
  )

  // 既存の off_requests を読み込む
  useEffect(() => {
    let cancelled = false
    // 期間切替時に古いデータが一瞬表示されないよう即座にリセット
    setLoadingExisting(true)
    setChoices({})
    setDone(false)
    setSubmitError('')
    async function load() {
      const { data, error } = await supabase
        .from('off_requests')
        .select('*')
        .eq('staff_id', staff.id)
        .gte('date', fmtKey(periodStart))
        .lte('date', fmtKey(periodEnd))
      if (cancelled) return
      if (error) {
        setSubmitError('データ読み込みに失敗しました: ' + error.message)
      } else if (data && data.length > 0) {
        const c: DayChoiceMap = {}
        data.forEach((r: OffRequest) => {
          c[r.date.substring(0, 10)] = r.type as DayChoice
        })
        setChoices(c)
      }
      setLoadingExisting(false)
    }
    load()
    return () => { cancelled = true }
  }, [staff.id, periodStart, periodEnd])

  function cycleChoice(dk: string) {
    // 過去日は変更不可
    if (dk < format(new Date(), 'yyyy-MM-dd')) return
    setChoices((prev) => {
      const current = prev[dk]
      const idx = CHOICE_CYCLE.indexOf(current)
      const next = CHOICE_CYCLE[(idx + 1) % CHOICE_CYCLE.length]
      const updated = { ...prev }
      if (next === undefined) {
        delete updated[dk]
      } else {
        updated[dk] = next
      }
      return updated
    })
  }

  async function handleSubmit() {
    setSubmitting(true)
    setSubmitError('')
    let deleteDone = false
    try {
      const startKey = fmtKey(periodStart)
      const endKey = fmtKey(periodEnd)
      const { error: delErr } = await supabase
        .from('off_requests')
        .delete()
        .eq('staff_id', staff.id)
        .gte('date', startKey)
        .lte('date', endKey)
      if (delErr) throw new Error('削除エラー: ' + delErr.message)
      deleteDone = true
      const rows = Object.entries(choices).map(([dk, type]) => ({
        staff_id: staff.id,
        date: dk,
        type,
      }))
      if (rows.length > 0) {
        const { error: insErr } = await supabase.from('off_requests').insert(rows)
        if (insErr) throw new Error('送信エラー: ' + insErr.message)
      }
      setDone(true)
    } catch (e: any) {
      setSubmitError(e.message || '送信に失敗しました。もう一度お試しください。')
      // DELETE成功後にINSERTが失敗した場合、DBの実態に合わせてUIを更新する
      if (deleteDone) {
        const { data, error } = await supabase
          .from('off_requests')
          .select('*')
          .eq('staff_id', staff.id)
          .gte('date', fmtKey(periodStart))
          .lte('date', fmtKey(periodEnd))
        if (!error && data) {
          const c: DayChoiceMap = {}
          data.forEach((r: OffRequest) => {
            c[r.date.substring(0, 10)] = r.type as DayChoice
          })
          setChoices(c)
        }
      }
    } finally {
      setSubmitting(false)
    }
  }

  if (done) return <SuccessCard message="シフト希望を提出しました！" />

  if (loadingExisting) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    )
  }

  const firstDow = getDay(days[0])
  const totalDays = days.length
  const restCount = Object.values(choices).filter((v) => v === '休み').length
  const prepCount = Object.values(choices).filter(
    (v) => v === '仕込みのみ'
  ).length
  const serviceCount = Object.values(choices).filter(
    (v) => v === '営業のみ'
  ).length
  const fullCount = totalDays - restCount - prepCount - serviceCount

  return (
    <div className="space-y-3 animate-slide-up">
      {/* 案内 + 凡例 */}
      <div className="bg-indigo-50 border border-indigo-100 rounded-2xl px-4 py-3 space-y-2">
        <p className="text-sm font-semibold text-indigo-700">
          日付をタップして勤務形態を切り替え
        </p>
        <div className="flex flex-wrap gap-x-3 gap-y-1.5 text-xs text-muted-foreground">
          <span className="flex items-center gap-1">
            <span className="w-5 h-5 rounded-lg bg-white border border-border/50 inline-flex items-center justify-center text-[10px] text-foreground">
              日
            </span>
            フル出勤
          </span>
          <span className="flex items-center gap-1">
            <span className="w-5 h-5 rounded-lg bg-red-400 inline-flex items-center justify-center text-white text-[10px]">
              休
            </span>
            休む
          </span>
          <span className="flex items-center gap-1">
            <span className="w-5 h-5 rounded-lg bg-amber-400 inline-flex items-center justify-center text-white text-[10px]">
              仕
            </span>
            仕込みのみ
          </span>
          <span className="flex items-center gap-1">
            <span className="w-5 h-5 rounded-lg bg-indigo-500 inline-flex items-center justify-center text-white text-[10px]">
              営
            </span>
            営業のみ
          </span>
        </div>
      </div>

      {/* カレンダー */}
      <div className="bg-white rounded-2xl ring-1 ring-border/40 shadow-sm overflow-hidden">
        <DowHeader />
        <div className="p-2">
          <div className="grid grid-cols-7 gap-1">
            {Array.from({ length: firstDow }).map((_, i) => (
              <div key={`e${i}`} />
            ))}
            {days.map((d) => {
              const dk = fmtKey(d)
              const choice = choices[dk]
              const style = choice ? CHOICE_STYLES[choice] : null
              const dow = getDay(d)
              const isPast = dk < format(new Date(), 'yyyy-MM-dd')
              return (
                <button
                  key={dk}
                  onClick={() => cycleChoice(dk)}
                  disabled={isPast}
                  className={`h-10 w-full rounded-xl flex flex-col items-center justify-center gap-0 text-sm font-medium transition-all active:scale-95 ${
                    isPast
                      ? 'text-muted-foreground/30 cursor-not-allowed'
                      : style
                      ? `${style.bg} ${style.text} shadow-sm`
                      : dow === 0
                      ? 'text-red-500 hover:bg-red-50'
                      : dow === 6
                      ? 'text-blue-500 hover:bg-blue-50'
                      : 'text-foreground hover:bg-muted/50'
                  }`}
                >
                  <span className="text-sm leading-none">{format(d, 'd')}</span>
                  {style && !isPast && (
                    <span className="text-[8px] leading-none opacity-90">
                      {style.badge}
                    </span>
                  )}
                </button>
              )
            })}
          </div>
        </div>
      </div>

      {/* サマリー */}
      <div className="grid grid-cols-4 gap-1.5">
        {[
          { label: 'フル', value: fullCount, color: 'text-foreground' },
          { label: '休み', value: restCount, color: 'text-red-500' },
          { label: '仕込み', value: prepCount, color: 'text-amber-600' },
          { label: '営業', value: serviceCount, color: 'text-indigo-600' },
        ].map(({ label, value, color }) => (
          <div
            key={label}
            className="bg-muted/30 rounded-xl px-2 py-2 text-center"
          >
            <p className={`text-xl font-bold tabular-nums ${color}`}>
              {value}
            </p>
            <p className="text-[10px] text-muted-foreground">{label}</p>
          </div>
        ))}
      </div>

      {/* エラーメッセージ */}
      {submitError && (
        <div className="rounded-xl bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700">
          {submitError}
        </div>
      )}

      {/* 提出ボタン */}
      <Button
        className="w-full h-12 rounded-2xl bg-gradient-to-r from-indigo-500 to-purple-600 text-white font-semibold shadow-sm active:scale-[0.98]"
        onClick={handleSubmit}
        disabled={submitting}
      >
        {submitting ? (
          <Loader2 className="h-4 w-4 animate-spin" />
        ) : (
          <>
            <Send className="h-4 w-4 mr-2" />
            シフト希望を提出する
          </>
        )}
      </Button>
    </div>
  )
}

// =============================================
// 共通: 曜日ヘッダー
// =============================================

function DowHeader() {
  const colors = [
    'text-red-500',
    'text-foreground',
    'text-foreground',
    'text-foreground',
    'text-foreground',
    'text-foreground',
    'text-blue-500',
  ]
  return (
    <div className="grid grid-cols-7 border-b border-border/30">
      {DOW_LABELS.map((d, i) => (
        <div
          key={d}
          className={`text-center text-xs font-medium py-2 ${colors[i]}`}
        >
          {d}
        </div>
      ))}
    </div>
  )
}

// =============================================
// 共通: 締切バナー
// =============================================

function DeadlineBanner({ period }: { period: Period }) {
  const now = new Date()
  now.setHours(0, 0, 0, 0)
  const dl = new Date(period.deadline)
  dl.setHours(0, 0, 0, 0)
  const daysLeft = Math.ceil(
    (dl.getTime() - now.getTime()) / (1000 * 60 * 60 * 24)
  )
  const isPast = daysLeft < 0
  const isUrgent = !isPast && daysLeft <= 2

  return (
    <div
      className={`rounded-2xl px-4 py-3 flex items-center gap-3 ${
        isPast
          ? 'bg-red-50 border border-red-100'
          : isUrgent
          ? 'bg-amber-50 border border-amber-100'
          : 'bg-muted/40 border border-border/30'
      }`}
    >
      <Clock
        className={`h-4 w-4 shrink-0 ${
          isPast
            ? 'text-red-400'
            : isUrgent
            ? 'text-amber-500'
            : 'text-muted-foreground'
        }`}
      />
      <div>
        <p className="text-xs text-muted-foreground">
          締切:{' '}
          <span className="font-medium">
            {format(period.deadline, 'M/d（E）', { locale: ja })}
          </span>
        </p>
        <p
          className={`text-sm font-semibold ${
            isPast
              ? 'text-red-600'
              : isUrgent
              ? 'text-amber-600'
              : 'text-foreground'
          }`}
        >
          {isPast
            ? '⚠️ 締切済みです'
            : daysLeft === 0
            ? '⏰ 今日が締切です！'
            : `あと ${daysLeft} 日`}
        </p>
      </div>
    </div>
  )
}

// =============================================
// アルバイト用: ステータス表示
// 確定(緑) / 承認待ち(黄) / 却下(赤) をカレンダーで確認
// =============================================

function StatusView({
  existingRequests,
  fixedShifts,
  periodStart,
  periodEnd,
  onResubmit,
  onWithdraw,
  withdrawing,
}: {
  existingRequests: ShiftRequest[]
  fixedShifts: ShiftFixed[]
  periodStart: Date
  periodEnd: Date
  onResubmit: () => void
  onWithdraw: () => void
  withdrawing?: boolean
}) {
  const days = useMemo(
    () => eachDayOfInterval({ start: periodStart, end: periodEnd }),
    [periodStart, periodEnd]
  )

  // 確定済み日付セット
  const fixedDates = useMemo(
    () => new Set(fixedShifts.map((f) => f.date.substring(0, 10))),
    [fixedShifts]
  )

  // 日付ごとのステータスを計算（partial = 一部確定）
  const statusMap = useMemo(() => {
    const map: Record<string, 'confirmed' | 'partial' | 'pending' | 'rejected'> = {}
    // 日付ごとの確定シフト数を事前集計（partial判定に使用）
    const fixedCountByDate: Record<string, number> = {}
    fixedShifts.forEach((f) => {
      const dk = f.date.substring(0, 10)
      fixedCountByDate[dk] = (fixedCountByDate[dk] ?? 0) + 1
    })
    existingRequests.forEach((r) => {
      const dk = r.date.substring(0, 10)
      if (fixedDates.has(dk)) {
        // 仕込み・営業申請で確定シフトが1件のみ = 一部確定
        if (r.type === '仕込み・営業' && (fixedCountByDate[dk] ?? 0) < 2) {
          map[dk] = 'partial'
        } else {
          map[dk] = 'confirmed'
        }
      } else if (r.status === 'rejected') {
        map[dk] = 'rejected'
      } else {
        map[dk] = 'pending'
      }
    })
    return map
  }, [existingRequests, fixedDates, fixedShifts])

  // 日付ごとの確定シフト
  const fixedByDate = useMemo(() => {
    const map: Record<string, ShiftFixed[]> = {}
    fixedShifts.forEach((f) => {
      const dk = f.date.substring(0, 10)
      if (!map[dk]) map[dk] = []
      map[dk].push(f)
    })
    return map
  }, [fixedShifts])

  const confirmedCount = Object.values(statusMap).filter((s) => s === 'confirmed' || s === 'partial').length
  const pendingCount = Object.values(statusMap).filter((s) => s === 'pending').length
  const rejectedCount = Object.values(statusMap).filter((s) => s === 'rejected').length

  const firstDow = getDay(days[0])

  return (
    <div className="space-y-3 animate-fade-in">
      {/* サマリーカード */}
      {existingRequests.length > 0 && (
        <div className="grid grid-cols-3 gap-2">
          <div className="bg-emerald-50 border border-emerald-200 rounded-xl px-3 py-2.5 text-center">
            <p className="text-xl font-bold tabular-nums text-emerald-700">{confirmedCount}</p>
            <p className="text-[10px] text-emerald-600 font-medium">確定</p>
          </div>
          <div className="bg-amber-50 border border-amber-200 rounded-xl px-3 py-2.5 text-center">
            <p className="text-xl font-bold tabular-nums text-amber-700">{pendingCount}</p>
            <p className="text-[10px] text-amber-600 font-medium">承認待ち</p>
          </div>
          <div className="bg-red-50 border border-red-200 rounded-xl px-3 py-2.5 text-center">
            <p className="text-xl font-bold tabular-nums text-red-700">{rejectedCount}</p>
            <p className="text-[10px] text-red-500 font-medium">却下</p>
          </div>
        </div>
      )}

      {/* ステータスメッセージ */}
      {confirmedCount > 0 && (
        <div className="flex items-center gap-2 rounded-xl bg-emerald-50 border border-emerald-200 px-4 py-3">
          <CheckCircle2 className="h-4 w-4 text-emerald-600 shrink-0" />
          <span className="text-sm text-emerald-800 font-medium">
            {confirmedCount}日分のシフトが確定しました！
            {pendingCount > 0 && `（${pendingCount}日は承認待ち）`}
          </span>
        </div>
      )}
      {confirmedCount === 0 && pendingCount > 0 && rejectedCount === 0 && (
        <div className="flex items-center gap-2 rounded-xl bg-amber-50 border border-amber-200 px-4 py-3">
          <span className="inline-flex items-center rounded-full bg-amber-400 px-2.5 py-1 text-xs font-bold text-white">承認待ち</span>
          <span className="text-sm text-amber-900 font-medium">社員・役員がシフトを確定するまでお待ちください。</span>
        </div>
      )}

      {/* ステータスカレンダー */}
      <div className="bg-white rounded-2xl ring-1 ring-border/40 shadow-sm overflow-hidden">
        <div className="px-4 py-2 border-b border-border/30 flex items-center gap-3 flex-wrap text-[10px] text-muted-foreground">
          <span className="flex items-center gap-1">
            <span className="w-2.5 h-2.5 rounded-full bg-emerald-400 inline-block" /> 確定
          </span>
          <span className="flex items-center gap-1">
            <span className="w-2.5 h-2.5 rounded-full bg-emerald-300 inline-block" /> 一部確定
          </span>
          <span className="flex items-center gap-1">
            <span className="w-2.5 h-2.5 rounded-full bg-amber-400 inline-block" /> 承認待ち
          </span>
          <span className="flex items-center gap-1">
            <span className="w-2.5 h-2.5 rounded-full bg-red-400 inline-block" /> 却下
          </span>
        </div>
        <DowHeader />
        <div className="p-2">
          <div className="grid grid-cols-7 gap-1">
            {Array.from({ length: firstDow }).map((_, i) => (
              <div key={`e${i}`} />
            ))}
            {days.map((d) => {
              const dk = fmtKey(d)
              const status = statusMap[dk]
              const req = existingRequests.find((r) => r.date.substring(0, 10) === dk)
              const dow = getDay(d)
              const shortLabel = req
                ? `${req.start_time.substring(0, 2)}-${req.end_time.substring(0, 2)}`
                : null
              const bgClass =
                status === 'confirmed' ? 'bg-emerald-400 text-white shadow-sm'
                : status === 'partial'  ? 'bg-emerald-300 text-white shadow-sm'
                : status === 'pending'  ? 'bg-amber-400 text-white shadow-sm'
                : status === 'rejected' ? 'bg-red-400 text-white shadow-sm'
                : dow === 0 ? 'text-red-300'
                : dow === 6 ? 'text-blue-300'
                : 'text-muted-foreground/30'
              return (
                <div
                  key={dk}
                  className={`h-11 w-full rounded-xl flex flex-col items-center justify-center gap-0 text-sm font-medium ${bgClass}`}
                >
                  <span className="text-sm leading-none">{format(d, 'd')}</span>
                  {shortLabel && (
                    <span className="text-[7px] leading-none opacity-90 mt-0.5">{shortLabel}</span>
                  )}
                </div>
              )
            })}
          </div>
        </div>
      </div>

      {/* 日程リスト */}
      {existingRequests.length > 0 && (
        <div className="rounded-2xl bg-white ring-1 ring-border/40 p-4 space-y-1">
          <h3 className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider mb-3">
            提出したシフト希望
          </h3>
          {existingRequests
            .slice()
            .sort((a, b) => a.date.localeCompare(b.date))
            .map((row) => {
              const dk = row.date.substring(0, 10)
              const status = statusMap[dk] ?? 'pending'
              const d = new Date(dk + 'T00:00:00')
              const label = format(d, 'M月d日(E)', { locale: ja })
              const dayFixed = fixedByDate[dk] || []
              const reqTime = `${row.start_time.substring(0, 5)}–${row.end_time.substring(0, 5)}`
              // 確定シフトが申請時間と異なるか判定
              const isPartial = dayFixed.length > 0 && dayFixed.length < 2 && row.type === '仕込み・営業'
              return (
                <div
                  key={row.id}
                  className="py-2.5 border-b border-border/30 last:border-0"
                >
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-medium text-foreground">{label}</span>
                    <div className="flex items-center gap-2">
                      {(status === 'confirmed' || status === 'partial') && !isPartial && (
                        <span className="inline-flex items-center rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-semibold text-emerald-800">確定</span>
                      )}
                      {isPartial && (
                        <span className="inline-flex items-center rounded-full bg-emerald-50 border border-emerald-300 px-2 py-0.5 text-xs font-semibold text-emerald-700">一部確定</span>
                      )}
                      {status === 'pending' && (
                        <span className="inline-flex items-center rounded-full bg-amber-100 px-2 py-0.5 text-xs font-semibold text-amber-800">承認待ち</span>
                      )}
                      {status === 'rejected' && (
                        <span className="inline-flex items-center rounded-full bg-red-100 px-2 py-0.5 text-xs font-semibold text-red-800">却下</span>
                      )}
                    </div>
                  </div>
                  <div className="mt-0.5 space-y-0.5">
                    <p className="text-xs text-muted-foreground">
                      申請: {reqTime}
                    </p>
                    {dayFixed.length > 0 && dayFixed.map(f => (
                      <p key={f.id} className="text-xs text-emerald-700 flex items-center gap-1">
                        <CheckCircle2 className="h-3 w-3 shrink-0" />
                        確定: {f.start_time.substring(0,5)}–{(f.end_time ?? '24:00:00').substring(0,5)}
                        <span className={`px-1 rounded text-[9px] ${f.type === '仕込み' ? 'bg-amber-100 text-amber-700' : 'bg-blue-100 text-blue-700'}`}>{f.type}</span>
                      </p>
                    ))}
                  </div>
                </div>
              )
            })}
        </div>
      )}

      {/* 修正・再提出 / 全取り消しボタン */}
      <div className="space-y-2">
        <button
          onClick={onResubmit}
          className="w-full h-11 rounded-xl border border-border text-sm font-medium text-muted-foreground hover:bg-muted/50 transition-colors"
        >
          シフト希望を修正・再提出する
        </button>
        <button
          onClick={onWithdraw}
          disabled={withdrawing}
          className="w-full h-11 rounded-xl border border-red-200 text-sm font-medium text-red-500 hover:bg-red-50 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {withdrawing ? '取り消し中…' : '申請を全取り消しする'}
        </button>
      </div>
    </div>
  )
}

function SuccessCard({ message }: { message: string }) {
  return (
    <div className="flex flex-col items-center justify-center gap-4 py-16 animate-fade-in">
      <div className="w-16 h-16 rounded-full bg-emerald-100 flex items-center justify-center">
        <CheckCircle2 className="h-8 w-8 text-emerald-600" />
      </div>
      <p className="text-lg font-bold text-foreground">{message}</p>
      <p className="text-sm text-muted-foreground">ありがとうございました</p>
    </div>
  )
}

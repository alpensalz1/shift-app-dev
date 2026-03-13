'use client'

import { useState, useEffect, useMemo } from 'react'
import { supabase } from '@/lib/supabase'
import { getStoredStaff } from '@/lib/auth'
import { Staff, ShiftRequest, OffRequest } from '@/types/database'
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

// 時刻選択肢を生成（15分刻み）
function generateTimeOptions(
  fromH: number,
  fromM: number,
  toH: number,
  toM: number
): string[] {
  const options: string[] = []
  let h = fromH
  let m = fromM
  while (h < toH || (h === toH && m <= toM)) {
    options.push(
      `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}`
    )
    m += 15
    if (m >= 60) {
      m -= 60
      h++
    }
  }
  return options
}

// 開始時刻: 14:00 〜 23:45
const START_TIME_OPTIONS = generateTimeOptions(14, 0, 23, 45)
// 終了時刻: 14:15 〜 24:00
const END_TIME_OPTIONS = generateTimeOptions(14, 15, 24, 0)

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
// 「出勤できる日」を選ぶ
// 開始・終了時刻必須 / 15分刻み / 14:00〜24:00
// =============================================

function PartTimerForm({
  staff,
  periodStart,
  periodEnd,
}: {
  staff: Staff
  periodStart: Date
  periodEnd: Date
}) {
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [globalStart, setGlobalStart] = useState('')
  const [globalEnd, setGlobalEnd] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [done, setDone] = useState(false)
  const [loadingExisting, setLoadingExisting] = useState(true)
  const [timeError, setTimeError] = useState('')
  const [submitError, setSubmitError] = useState('')
  const [submittedRows, setSubmittedRows] = useState<Array<{date: string; start_time: string; end_time: string}>>([])
  const [existingPending, setExistingPending] = useState(false)

  const days = useMemo(
    () => eachDayOfInterval({ start: periodStart, end: periodEnd }),
    [periodStart, periodEnd]
  )

  // 既存の申請を読み込む
  useEffect(() => {
    async function load() {
      const { data } = await supabase
        .from('shift_requests')
        .select('*')
        .eq('staff_id', staff.id)
        .gte('date', fmtKey(periodStart))
        .lte('date', fmtKey(periodEnd))
      if (data && data.length > 0) {
        const sel = new Set<string>()
        data.forEach((r: ShiftRequest) => {
          sel.add(r.date.substring(0, 10))
        })
        setSelected(sel)
        // 最初のレコードから共通時刻をセット
        const first = data[0] as any
        if (first.start_time) setGlobalStart(first.start_time)
        if (first.end_time) setGlobalEnd(first.end_time)
        setExistingPending(true)
      }
      setLoadingExisting(false)
    }
    load()
  }, [staff.id, periodStart, periodEnd])

  function toggleDay(dk: string) {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(dk)) next.delete(dk)
      else next.add(dk)
      return next
    })
  }

  function handleStartChange(val: string) {
    setGlobalStart(val)
    setTimeError('')
    if (globalEnd && val >= globalEnd) setGlobalEnd('')
  }

  function validate(): boolean {
    if (!globalStart || !globalEnd) {
      setTimeError('開始・終了時刻を選択してください')
      return false
    }
    if (globalStart >= globalEnd) {
      setTimeError('終了は開始より後にしてください')
      return false
    }
    setTimeError('')
    return true
  }

  async function handleSubmit() {
    if (!validate()) return
    if (selected.size === 0) return
    setSubmitting(true)
    setSubmitError('')
    try {
      const startKey = fmtKey(periodStart)
      const endKey = fmtKey(periodEnd)
      const { error: delErr } = await supabase
        .from('shift_requests')
        .delete()
        .eq('staff_id', staff.id)
        .gte('date', startKey)
        .lte('date', endKey)
      if (delErr) throw new Error('削除エラー: ' + delErr.message)
      const rows = [...selected].map((dk) => ({
        staff_id: staff.id,
        date: dk,
        start_time: globalStart,
        end_time: globalEnd,
        type: '仕込み・営業' as const,
        status: 'pending' as const,
      }))
      if (rows.length > 0) {
        const { error: insErr } = await supabase.from('shift_requests').insert(rows)
        if (insErr) throw new Error('送信エラー: ' + insErr.message)
      }
      setSubmittedRows(rows.map((r) => ({ date: r.date, start_time: r.start_time, end_time: r.end_time })))
      setExistingPending(false)
      setDone(true)
    } catch (e: any) {
      setSubmitError(e.message || '送信に失敗しました。もう一度お試しください。')
    } finally {
      setSubmitting(false)
    }
  }

  if (done) return (
    <SubmittedView
      submittedRows={submittedRows}
      onResubmit={() => {
        setDone(false)
        setSubmittedRows([])
        setSelected(new Set())
        setGlobalStart('')
        setGlobalEnd('')
      }}
    />
  )

  if (loadingExisting) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    )
  }

  const firstDow = getDay(days[0])
  const isPending = existingPending
  const canSubmit = !!globalStart && !!globalEnd && globalStart < globalEnd && selected.size > 0

  return (
    <div className="space-y-3 animate-slide-up">
      {/* 勤務時間選択 */}
      <div className="bg-white rounded-2xl ring-1 ring-border/40 shadow-sm px-4 py-3 space-y-2">
        <p className="text-sm font-semibold text-foreground flex items-center gap-1.5">
          <Clock className="h-4 w-4 text-blue-500" />
          勤務時間を選択
        </p>
        <div className="flex items-center gap-3">
          <div className="flex-1">
            <p className="text-[10px] text-muted-foreground mb-1">開始</p>
            <select
              className="w-full text-sm border border-border/60 rounded-xl px-2 py-1.5 bg-background"
              value={globalStart}
              onChange={(e) => handleStartChange(e.target.value)}
            >
              <option value="">--:--</option>
              {START_TIME_OPTIONS.map((t) => (
                <option key={t} value={t}>{t}</option>
              ))}
            </select>
          </div>
          <span className="text-muted-foreground mt-4">〜</span>
          <div className="flex-1">
            <p className="text-[10px] text-muted-foreground mb-1">終了</p>
            <select
              className="w-full text-sm border border-border/60 rounded-xl px-2 py-1.5 bg-background"
              value={globalEnd}
              onChange={(e) => { setGlobalEnd(e.target.value); setTimeError('') }}
            >
              <option value="">--:--</option>
              {END_TIME_OPTIONS.filter((t) => !globalStart || t > globalStart).map((t) => (
                <option key={t} value={t}>{t}</option>
              ))}
            </select>
          </div>
        </div>
        {timeError && (
          <p className="text-xs text-red-500">{timeError}</p>
        )}
      </div>

      {/* 出勤日選択 */}
      <div className="flex items-center justify-between px-1">
        <p className="text-sm text-muted-foreground">出勤希望日をタップ</p>
        <span className="text-2xl font-bold text-blue-600 tabular-nums">
          {selected.size}
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
              const isSel = selected.has(dk)
              const dow = getDay(d)
              return (
                <button
                  key={dk}
                  onClick={() => toggleDay(dk)}
                  className={`h-9 w-full rounded-xl flex items-center justify-center text-sm font-medium transition-all active:scale-95 ${
                    isSel
                      ? 'bg-blue-500 text-white shadow-sm'
                      : dow === 0
                      ? 'text-red-500 hover:bg-red-50'
                      : dow === 6
                      ? 'text-blue-500 hover:bg-blue-50'
                      : 'text-foreground hover:bg-muted/50'
                  }`}
                >
                  {format(d, 'd')}
                </button>
              )
            })}
          </div>
        </div>
      </div>

      {/* 承認待ちバナー */}
      {isPending && (
        <div className="flex items-center gap-2 rounded-xl bg-amber-50 border border-amber-200 px-4 py-3 text-sm text-amber-800">
          <span className="inline-flex items-center rounded-full bg-amber-200 px-2 py-0.5 text-xs font-semibold text-amber-900">承認待ち</span>
          <span>現在シフト希望が提出済みです。変更する場合は再提出してください。</span>
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
        ) : selected.size === 0 ? (
          '出勤希望日を選択してください'
        ) : !globalStart || !globalEnd ? (
          '勤務時間を選択してください'
        ) : (
          <>
            <Send className="h-4 w-4 mr-2" />
            {selected.size}日分の希望を提出する
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
  const [loadingExisting, setLoadingExisting] = useState(true)

  const days = useMemo(
    () => eachDayOfInterval({ start: periodStart, end: periodEnd }),
    [periodStart, periodEnd]
  )

  // 既存の off_requests を読み込む
  useEffect(() => {
    async function load() {
      const { data } = await supabase
        .from('off_requests')
        .select('*')
        .eq('staff_id', staff.id)
        .gte('date', fmtKey(periodStart))
        .lte('date', fmtKey(periodEnd))
      if (data && data.length > 0) {
        const c: DayChoiceMap = {}
        data.forEach((r: OffRequest) => {
          c[r.date.substring(0, 10)] = r.type as DayChoice
        })
        setChoices(c)
      }
      setLoadingExisting(false)
    }
    load()
  }, [staff.id, periodStart, periodEnd])

  function cycleChoice(dk: string) {
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
    try {
      const startKey = fmtKey(periodStart)
      const endKey = fmtKey(periodEnd)
      await supabase
        .from('off_requests')
        .delete()
        .eq('staff_id', staff.id)
        .gte('date', startKey)
        .lte('date', endKey)
      const rows = Object.entries(choices).map(([dk, type]) => ({
        staff_id: staff.id,
        date: dk,
        type,
      }))
      if (rows.length > 0) await supabase.from('off_requests').insert(rows)
      setDone(true)
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
              return (
                <button
                  key={dk}
                  onClick={() => cycleChoice(dk)}
                  className={`h-10 w-full rounded-xl flex flex-col items-center justify-center gap-0 text-sm font-medium transition-all active:scale-95 ${
                    style
                      ? `${style.bg} ${style.text} shadow-sm`
                      : dow === 0
                      ? 'text-red-500 hover:bg-red-50'
                      : dow === 6
                      ? 'text-blue-500 hover:bg-blue-50'
                      : 'text-foreground hover:bg-muted/50'
                  }`}
                >
                  <span className="text-sm leading-none">{format(d, 'd')}</span>
                  {style && (
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
// 共通: 完了カード
// =============================================

function SubmittedView({
  submittedRows,
  onResubmit,
}: {
  submittedRows: Array<{ date: string; start_time: string; end_time: string }>
  onResubmit: () => void
}) {
  return (
    <div className="flex flex-col gap-4 animate-fade-in">
      {/* 成功ヘッダー */}
      <div className="flex flex-col items-center gap-3 py-8">
        <div className="w-16 h-16 rounded-full bg-emerald-100 flex items-center justify-center">
          <CheckCircle2 className="h-8 w-8 text-emerald-600" />
        </div>
        <p className="text-lg font-bold text-foreground">シフト希望を提出しました！</p>
        <p className="text-sm text-muted-foreground text-center">
          担当者がシフトを確定するまでお待ちください
        </p>
      </div>

      {/* 承認待ちバナー */}
      <div className="flex items-center gap-2 rounded-xl bg-amber-50 border border-amber-200 px-4 py-3">
        <span className="inline-flex items-center rounded-full bg-amber-400 px-2.5 py-1 text-xs font-bold text-white">
          承認待ち
        </span>
        <span className="text-sm text-amber-900 font-medium">
          一旦承認待ちです。社員・役員がシフトを確定するまでお待ちください。
        </span>
      </div>

      {/* 提出した日程リスト */}
      {submittedRows.length > 0 && (
        <div className="rounded-2xl bg-white ring-1 ring-border/40 p-4 space-y-2">
          <h3 className="text-xs font-bold text-muted-foreground uppercase tracking-wider mb-3">
            提出したシフト希望
          </h3>
          {submittedRows.map((row) => {
            const d = new Date(row.date + 'T00:00:00')
            const label = format(d, 'M月d日(E)', { locale: ja })
            return (
              <div
                key={row.date}
                className="flex items-center justify-between py-2 border-b border-border/30 last:border-0"
              >
                <span className="text-sm font-medium text-foreground">{label}</span>
                <div className="flex items-center gap-2">
                  <span className="text-sm text-muted-foreground">
                    {row.start_time} – {row.end_time}
                  </span>
                  <span className="inline-flex items-center rounded-full bg-amber-100 px-2 py-0.5 text-xs font-semibold text-amber-800">
                    承認待ち
                  </span>
                </div>
              </div>
            )
          })}
        </div>
      )}

      {/* 再提出ボタン */}
      <button
        onClick={onResubmit}
        className="w-full h-11 rounded-xl border border-border text-sm font-medium text-muted-foreground hover:bg-muted/50 transition-colors"
      >
        シフト希望を修正・再提出する
      </button>
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

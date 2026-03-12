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
  Moon,
} from 'lucide-react'
import { Button } from '@/components/ui/button'

// ============================================================
// 仕様メモ（SPEC.md も参照すること）
//
// アルバイト: 「出勤できる日」を選ぶ → shift_requests に保存
//   - デフォルトは何も選択されていない
//   - タップで出勤希望日を追加
//
// 社員・役員: 「休む日」を選ぶ → off_requests に保存
//   - デフォルトは何も選択されていない
//   - 以下のパターンからまず1つ選ぶ:
//     1. 5日休み        → 5日選択, type='休み'
//     2. 6日休み        → 6日選択, type='休み'
//     3. 5日休み+仕込みのみ → 5日選択, type='仕込みのみ'
//     4. 5日休み+営業のみ  → 5日選択, type='営業のみ'
// ============================================================

// =============================================
// 型定義・定数
// =============================================

type RestMode = '5days' | '6days' | '5days_prep' | '5days_service'

interface RestModeConfig {
  value: RestMode
  label: string
  description: string
  count: number
  offType: '休み' | '仕込みのみ' | '営業のみ'
  activeClass: string
  iconLabel: string
}

const REST_MODES: RestModeConfig[] = [
  {
    value: '5days',
    label: '5日休み',
    description: '半月のうち5日を休日に',
    count: 5,
    offType: '休み',
    activeClass: 'border-indigo-400 bg-indigo-50',
    iconLabel: '5',
  },
  {
    value: '6days',
    label: '6日休み',
    description: '半月のうち6日を休日に',
    count: 6,
    offType: '休み',
    activeClass: 'border-purple-400 bg-purple-50',
    iconLabel: '6',
  },
  {
    value: '5days_prep',
    label: '5日休み ＋ 仕込みのみ',
    description: '5日休み・出勤日は仕込みシフト',
    count: 5,
    offType: '仕込みのみ',
    activeClass: 'border-amber-400 bg-amber-50',
    iconLabel: '🍳',
  },
  {
    value: '5days_service',
    label: '5日休み ＋ 営業のみ',
    description: '5日休み・出勤日は営業シフト',
    count: 5,
    offType: '営業のみ',
    activeClass: 'border-rose-400 bg-rose-50',
    iconLabel: '🍽',
  },
]

const DOW_LABELS = ['日', '月', '火', '水', '木', '金', '土']

function fmtKey(d: Date): string {
  return format(d, 'yyyy-MM-dd')
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
  const deadline = addDays(start, -5)
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

  const isPartTimer = staff.employment_type === 'アルバイト'
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
            {isPartTimer ? '出勤できる日を選択' : '休む日を選択'}
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
// 「出勤できる日」を選ぶ（デフォルト: 何も選択なし）
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
  const [times, setTimes] = useState<Record<string, { start: string; end: string }>>({})
  const [submitting, setSubmitting] = useState(false)
  const [done, setDone] = useState(false)
  const [loadingExisting, setLoadingExisting] = useState(true)

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
        .lte('date', fmtKey(periodEnd) + 'T23:59:59')
      if (data && data.length > 0) {
        const sel = new Set<string>()
        const tm: Record<string, { start: string; end: string }> = {}
        data.forEach((r: ShiftRequest) => {
          const dk = r.date.substring(0, 10)
          sel.add(dk)
          tm[dk] = {
            start: (r as any).start_time ?? '',
            end: (r as any).end_time ?? '',
          }
        })
        setSelected(sel)
        setTimes(tm)
      }
      setLoadingExisting(false)
    }
    load()
  }, [staff.id, periodStart, periodEnd])

  function toggleDay(dk: string) {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(dk)) {
        next.delete(dk)
        setTimes((t) => {
          const n = { ...t }
          delete n[dk]
          return n
        })
      } else {
        next.add(dk)
        setTimes((t) => ({ ...t, [dk]: { start: '', end: '' } }))
      }
      return next
    })
  }

  function setTime(dk: string, field: 'start' | 'end', val: string) {
    setTimes((prev) => ({
      ...prev,
      [dk]: { ...(prev[dk] ?? { start: '', end: '' }), [field]: val },
    }))
  }

  async function handleSubmit() {
    setSubmitting(true)
    try {
      const startKey = fmtKey(periodStart)
      const endKey = fmtKey(periodEnd)
      // 既存削除
      await supabase
        .from('shift_requests')
        .delete()
        .eq('staff_id', staff.id)
        .gte('date', startKey)
        .lte('date', endKey + 'T23:59:59')
      // 新規挿入
      const rows = [...selected].map((dk) => ({
        staff_id: staff.id,
        date: dk + 'T00:00:00',
        start_time: times[dk]?.start || null,
        end_time: times[dk]?.end || null,
      }))
      if (rows.length > 0) await supabase.from('shift_requests').insert(rows)
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

  return (
    <div className="space-y-3 animate-slide-up">
      {/* 案内 */}
      <div className="bg-blue-50 border border-blue-100 rounded-2xl px-4 py-3">
        <p className="text-sm font-semibold text-blue-700">
          出勤できる日をタップして選択
        </p>
        <p className="text-xs text-blue-500 mt-0.5">
          タップで追加・もう一度タップで解除。時間の入力は任意です。
        </p>
      </div>

      {/* 選択カウント */}
      <div className="flex items-center justify-between px-1">
        <span className="text-sm text-muted-foreground">出勤希望日数</span>
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
                <div key={dk} className="flex flex-col">
                  <button
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
                  {isSel && (
                    <div
                      className="flex gap-0.5 mt-1"
                      onClick={(e) => e.stopPropagation()}
                    >
                      <input
                        type="time"
                        className="flex-1 w-0 text-[9px] border border-blue-200 rounded-md px-0.5 py-0.5 bg-blue-50 text-center"
                        value={times[dk]?.start ?? ''}
                        onChange={(e) => setTime(dk, 'start', e.target.value)}
                      />
                      <input
                        type="time"
                        className="flex-1 w-0 text-[9px] border border-blue-200 rounded-md px-0.5 py-0.5 bg-blue-50 text-center"
                        value={times[dk]?.end ?? ''}
                        onChange={(e) => setTime(dk, 'end', e.target.value)}
                      />
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        </div>
      </div>

      {/* 提出ボタン */}
      <Button
        className="w-full h-12 rounded-2xl bg-gradient-to-r from-blue-500 to-indigo-600 text-white font-semibold shadow-sm disabled:opacity-40"
        onClick={handleSubmit}
        disabled={submitting || selected.size === 0}
      >
        {submitting ? (
          <Loader2 className="h-4 w-4 animate-spin" />
        ) : selected.size === 0 ? (
          '出勤希望日を選択してください'
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
// 「休む日」を選ぶ（デフォルト: 何も選択なし）
// パターン選択 → 休日選択 → 提出
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
  const [restMode, setRestMode] = useState<RestMode | null>(null)
  const [restDays, setRestDays] = useState<Set<string>>(new Set())
  const [submitting, setSubmitting] = useState(false)
  const [done, setDone] = useState(false)
  const [loadingExisting, setLoadingExisting] = useState(true)

  const days = useMemo(
    () => eachDayOfInterval({ start: periodStart, end: periodEnd }),
    [periodStart, periodEnd]
  )

  const modeConfig = REST_MODES.find((m) => m.value === restMode)
  const required = modeConfig?.count ?? 0
  const picked = restDays.size
  const isReady = restMode !== null && picked === required
  const progress = required > 0 ? Math.min((picked / required) * 100, 100) : 0

  // 既存の休み希望を読み込む
  useEffect(() => {
    async function load() {
      const { data } = await supabase
        .from('off_requests')
        .select('*')
        .eq('staff_id', staff.id)
        .gte('date', fmtKey(periodStart))
        .lte('date', fmtKey(periodEnd))
      if (data && data.length > 0) {
        const sel = new Set<string>()
        data.forEach((r: OffRequest) => sel.add(r.date.substring(0, 10)))
        setRestDays(sel)
        // typeとcount��8�8(�898+�8;�8;>8).[�XX0�6��7Bf�'7EG�R�FF���G�R27G&��p��b�f�'7EG�R���~K�^���8�8�8�r�6WE&W7D��FR�sVF�5�&Wr��V�6R�b�f�'7EG�R���~YknjZ�8�8�r�6WE&W7D��FR�sVF�5�6W'f�6Rr��V�6R�b�FF��V�wF���b�6WE&W7D��FR�sfF�2r��V�6R6WE&W7D��FR�sVF�2r��Т6WD��F��tW��7F��r�f�6R��Т��B������7Ffb�B�W&��E7F'B�W&��DV�EҐ��gV�7F���F�vv�U&W7DF��F��7G&��r����b�&W7D��FR�&WGW&�6WE&W7DF�2��&Wb�����6��7B�W�B��Wr6WB�&Wb���b��W�B�2�F������W�B�FV�WFR�F����V�6R�b��W�B�6��R�&WV�&VB����W�B�FB�F���Т&WGW&��W�@�Ґ�Р�7��2gV�7F�����F�U7V&֗B�����b���FT6��f�r�&WGW&�6WE7V&֗GF��r�G'VR��G'���6��7B7F'D�W��f�D�W��W&��E7F'B��6��7BV�D�W��f�D�W��W&��DV�B����iz.ZَX����@�v�B7W&6P��g&�҂v�fe�&WVW7G2r���FV�WFR����W�w7Ffe��Br�7Ffb�B���wFR�vFFRr�7F'D�W�����FR�vFFRr�V�D�W�����ik�h�o入
      const rows = [...restDays].map((dk) => ({
        staff_id: staff.id,
        date: dk,
        type: modeConfig.offType,
      }))
      if (rows.length > 0) await supabase.from('off_requests').insert(rows)
      setDone(true)
    } finally {
      setSubmitting(false)
    }
  }

  if (done) return <SuccessCard message="休み希望を提出しました！" />

  if (loadingExisting) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    )
  }

  const firstDow = getDay(days[0])

  return (
    <div className="space-y-4 animate-slide-up">
      {/* STEP 1: パターン選択 */}
      <div className="space-y-2">
        <div className="flex items-center gap-2 px-1">
          <span className="w-5 h-5 rounded-full bg-indigo-600 text-white text-xs font-bold flex items-center justify-center">
            1
          </span>
          <p className="text-sm font-bold text-foreground">休みパターンを選択</p>
        </div>
        <div className="space-y-2">
          {REST_MODES.map((mode) => {
            const isActive = restMode === mode.value
            return (
              <button
                key={mode.value}
                onClick={() => {
                  setRestMode(mode.value)
                  setRestDays(new Set())
                }}
                className={`w-full flex items-center gap-3 px-4 py-3 rounded-2xl border-2 text-left transition-all active:scale-[0.99] ${
                  isActive
                    ? mode.activeClass
                    : 'bg-white border-border/50 hover:border-border'
                }`}
              >
                <span className="text-base w-6 text-center shrink-0">
                  {mode.iconLabel}
                </span>
                <div className="flex-1 min-w-0">
                  <p
                    className={`text-sm font-semibold ${
                      isActive ? 'text-foreground' : 'text-foreground'
                    }`}
                  >
                    {mode.label}
                  </p>
                  <p className="text-xs text-muted-foreground">{mode.description}</p>
                </div>
                {isActive && (
                  <CheckCircle2 className="h-5 w-5 text-indigo-500 shrink-0" />
                )}
              </button>
            )
          })}
        </div>
      </div>

      {/* STEP 2: 休日を選択 */}
      {restMode && (
        <div className="space-y-3">
          <div className="flex items-center gap-2 px-1">
            <span className="w-5 h-5 rounded-full bg-indigo-600 text-white text-xs font-bold flex items-center justify-center shrink-0">
              2
            </span>
            <p className="text-sm font-bold text-foreground flex-1">
              休む日を選択
            </p>
            <span
              className={`text-lg font-bold tabular-nums ${
                picked === required ? 'text-emerald-600' : 'text-indigo-600'
              }`}
            >
              {picked}
              <span className="text-sm font-normal text-muted-foreground">
                /{required}日
              </span>
            </span>
          </div>

          {/* 進捗バー */}
          <div className="mx-1 h-2 bg-muted rounded-full overflow-hidden">
            <div
              className={`h-full rounded-full transition-all duration-300 ${
                picked === required
                  ? 'bg-gradient-to-r from-emerald-400 to-emerald-500'
                  : 'bg-gradient-to-r from-indigo-400 to-purple-500'
              }`}
              style={{ width: `${progress}%` }}
            />
          </div>

          <p className="text-xs text-muted-foreground px-1">
            {picked < required
              ? `あと ${required - picked} 日を選んでください`
              : '✅ 選択完了！提出できます'}
          </p>

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
                  const isSel = restDays.has(dk)
                  const isDisabled = !isSel && picked >= required
                  const dow = getDay(d)
                  return (
                    <button
                      key={dk}
                      onClick={() => !isDisabled && toggleRestDay(dk)}
                      disabled={isDisabled}
                      className={`h-10 w-full rounded-xl flex flex-col items-center justify-center gap-0.5 text-sm font-medium transition-all active:scale-95 ${
                        isSel
                          ? 'bg-indigo-500 text-white shadow-sm ring-2 ring-indigo-300 ring-offset-1'
                          : isDisabled
                          ? 'opacity-20 cursor-not-allowed'
                          : dow === 0
                          ? 'text-red-500 hover:bg-red-50'
                          : dow === 6
                          ? 'text-blue-500 hover:bg-blue-50'
                          : 'text-foreground hover:bg-muted/50'
                      }`}
                    >
                      <span className="leading-none">{format(d, 'd')}</span>
                      {isSel && <Moon className="h-2 w-2" />}
                    </button>
                  )
                })}
              </div>
            </div>
          </div>

          {/* 出勤日サマリー */}
          {picked > 0 && (
            <div className="bg-emerald-50 border border-emerald-100 rounded-2xl px-4 py-3">
              <div className="flex items-center justify-between">
                <p className="text-sm font-semibold text-emerald-700">出勤予定日</p>
                <span className="text-xl font-bold text-emerald-700 tabular-nums">
                  {days.length - picked}
                  <span className="text-sm font-normal ml-1">日</span>
                </span>
              </div>
              <p className="text-xs text-emerald-600 mt-1">
                {restMode === '5days_prep'
                  ? '🍳 出勤日はすべて仕込みシフトとして申請されます'
                  : restMode === '5days_service'
                  ? '🍽 出勤日はすべて営業シフトとして申請されます'
                  : '📋 出勤日は通常シフトとして扱われます'}
              </p>
            </div>
          )}
        </div>
      )}

      {/* 提出ボタン */}
      <Button
        className={`w-full h-12 rounded-2xl font-semibold shadow-sm transition-all ${
          isReady
            ? 'bg-gradient-to-r from-indigo-500 to-purple-600 text-white active:scale-[0.98]'
            : 'bg-muted text-muted-foreground cursor-not-allowed'
        }`}
        onClick={handleSubmit}
        disabled={submitting || !isReady}
      >
        {submitting ? (
          <Loader2 className="h-4 w-4 animate-spin" />
        ) : !restMode ? (
          'まず①のパターンを選んでください'
        ) : picked < required ? (
          `②あと ${required - picked} 日を選んでください`
        ) : (
          <>
            <Send className="h-4 w-4 mr-2" />
            休み希望を提出する
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
        <div key={d} className={`text-center text-xs font-medium py-2 ${colors[i]}`}>
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
  const daysLeft = Math.ceil((dl.getTime() - now.getTime()) / (1000 * 60 * 60 * 24))
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

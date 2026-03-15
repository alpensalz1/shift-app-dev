'use client'

import { useEffect, useState, useCallback, useMemo, useRef } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabase'
import { getStoredStaff } from '@/lib/auth'
import { ShiftRequest, ShiftFixed, Staff, ShiftConfig, ShiftRule, OffRequest } from '@/types/database'
import { formatTime, getSubmissionPeriod } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import {
  format,
  eachDayOfInterval,
  startOfMonth,
  endOfMonth,
  addMonths,
  subMonths,
  addDays,
  getDay,
} from 'date-fns'
import { ja } from 'date-fns/locale'
import {
  ClipboardCheck,
  ChevronLeft,
  ChevronRight,
  Check,
  X,
  Loader2,
  Users,
  Settings,
  Wand2,
  ChevronUp,
  ChevronDown,
} from 'lucide-react'

interface RequestWithStaff extends ShiftRequest {
  staffs: Pick<Staff, 'name' | 'employment_type'>
}

interface RuleWithStaff extends ShiftRule {
  staffs: Pick<Staff, 'name'>
}

// 自動生成プレビュー行
interface GeneratedRow {
  date: string
  shop_id: number
  shop_name: string
  staff_id: number
  staff_name: string
  type: '仕込み' | '営業'
  start_time: string
  end_time: string
  note: string
}

const DAY_NAMES = ['日', '月', '火', '水', '木', '金', '土']
const SHOP_NAMES: Record<number, string> = { 1: '三軒茶屋', 2: '下北沢' }

// =============================================
// タブ1: シフト確定（既存機能）
// =============================================

// アルバイトのシフト時間を店舗の設定に基づき自動分割する
// shift_config の 仕込み.default_end_time が仕込み/営業の境界時刻
// minShikomiStart: アルバイト/長期は '14:00' を渡す（仕込みスタートの下限）
function autoSplitShift(
  startTime: string,
  endTime: string,
  shopId: number,
  configs: ShiftConfig[],
  minShikomiStart?: string
): Array<{ type: '仕込み' | '営業'; start_time: string; end_time: string }> {
  const shikomiCfg = configs.find((c) => c.shop_id === shopId && c.type === '仕込み')
  if (!shikomiCfg) return [{ type: '営業', start_time: startTime, end_time: endTime }]
  const split5 = shikomiCfg.default_end_time.substring(0, 5)  // "17:00" or "18:00"（HH:MM正規化）
  const start5 = startTime.substring(0, 5)
  const end5 = endTime.substring(0, 5)
  if (start5 >= split5) return [{ type: '営業', start_time: startTime, end_time: endTime }]
  // アルバイト/長期は仕込みスタートを14:00未満にしない（社員は11:00スタートだがアルバイトは14:00固定）
  // ※ この cap は全ブランチに適用: 仕込みのみシフト・分割シフト両方で有効
  const shikomiStart = (minShikomiStart && start5 < minShikomiStart) ? minShikomiStart : startTime
  if (end5 <= split5) return [{ type: '仕込み', start_time: shikomiStart, end_time: endTime }]
  // shift_config の時刻はDB上 HH:MM:SS 形式のため substring(0,5) で HH:MM に統一
  return [
    { type: '仕込み', start_time: shikomiStart, end_time: split5 },
    { type: '営業', start_time: split5, end_time: endTime },
  ]
}

function ShiftConfirmTab() {
  const [selectedMonth, setSelectedMonth] = useState(() => new Date())
  const [requests, setRequests] = useState<RequestWithStaff[]>([])
  const [fixedShifts, setFixedShifts] = useState<ShiftFixed[]>([])
  const [configs, setConfigs] = useState<ShiftConfig[]>([])
  const [allStaffs, setAllStaffs] = useState<Staff[]>([])
  const [loading, setLoading] = useState(true)
  const [confirming, setConfirming] = useState(false)
  const [selectedDate, setSelectedDate] = useState<string | null>(null)
  const [message, setMessage] = useState('')
  const [closedDates, setClosedDates] = useState<string[]>([])
  const [offRequests, setOffRequests] = useState<OffRequest[]>([])
  const autoAdvancedRef = useRef(false)
  // 月切替時のfetch競合を防ぐためのバージョン管理（古い月のfetchが新しい月のデータを上書きしないよう）
  const fetchVersionRef = useRef(0)

  const monthStart = format(startOfMonth(selectedMonth), 'yyyy-MM-dd')
  const monthEnd = format(endOfMonth(selectedMonth), 'yyyy-MM-dd')

  const fetchAll = useCallback(async () => {
    const version = ++fetchVersionRef.current
    setLoading(true)
    const [reqRes, fixedRes, configRes, staffRes, closedRes, offRes] = await Promise.all([
      supabase.from('shift_requests').select('*, staffs(name, employment_type)')
        .gte('date', monthStart).lte('date', monthEnd).order('date', { ascending: true }),
      supabase.from('shifts_fixed').select('*')
        .gte('date', monthStart).lte('date', monthEnd).order('date', { ascending: true }),
      supabase.from('shift_config').select('*'),
      supabase.from('staffs').select('*').eq('is_active', true),
      supabase.from('closed_dates').select('date').gte('date', monthStart).lte('date', monthEnd),
      supabase.from('off_requests').select('*').gte('date', monthStart).lte('date', monthEnd),
    ])
    // 月切替により新しいfetchが開始されていたら古い結果は破棄する
    if (fetchVersionRef.current !== version) return
    if (reqRes.error) console.error('shift_requests取得失敗:', reqRes.error.message)
    else if (reqRes.data) setRequests(reqRes.data as RequestWithStaff[])
    if (fixedRes.error) console.error('shifts_fixed取得失敗:', fixedRes.error.message)
    else if (fixedRes.data) setFixedShifts(fixedRes.data)
    if (configRes.error) console.error('shift_config取得失敗:', configRes.error.message)
    else if (configRes.data) setConfigs(configRes.data)
    if (staffRes.error) console.error('staffs取得失敗:', staffRes.error.message)
    else if (staffRes.data) setAllStaffs(staffRes.data)
    if (closedRes.error) console.error('closed_dates取得失敗:', closedRes.error.message)
    else if (closedRes.data) setClosedDates(closedRes.data.map((c: {date: string}) => c.date.substring(0, 10)))
    if (offRes.error) console.error('off_requests取得失敗:', offRes.error.message)
    else if (offRes.data) setOffRequests(offRes.data as OffRequest[])
    setLoading(false)
  }, [monthStart, monthEnd])

  useEffect(() => { fetchAll() }, [fetchAll])

  // 月切替時に選択日付・メッセージをリセット
  useEffect(() => {
    setSelectedDate(null)
    setMessage('')
  }, [monthStart])

  // 日付切替時にメッセージをリセット（前日の確定/却下メッセージが残らないよう）
  useEffect(() => {
    setMessage('')
  }, [selectedDate])

  // 月切替時に自動遷移フラグをリセット（再度トリガされるよう）
  useEffect(() => {
    autoAdvancedRef.current = false
  }, [monthStart])

  // 当月全確定済なら翌月へ自動遷移
  useEffect(() => {
    if (!loading && !autoAdvancedRef.current) {
      autoAdvancedRef.current = true
      if (requests.length === 0 && fixedShifts.length > 0) {
        const now = new Date()
        if (format(selectedMonth, 'yyyy-MM') === format(now, 'yyyy-MM')) {
          setSelectedMonth(addMonths(now, 1))
        }
      }
    }
  // requests/fixedShifts/selectedMonth are intentionally omitted: we only want this to fire
  // once after loading completes, not on every state change. autoAdvancedRef prevents re-entry.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading])

  const dateMap = useMemo(() => {
    const map: Record<string, RequestWithStaff[]> = {}
    requests.forEach((r) => { const dk = r.date.substring(0, 10); if (!map[dk]) map[dk] = []; map[dk].push(r) })
    return map
  }, [requests])

  const fixedMap = useMemo(() => {
    const map: Record<string, ShiftFixed[]> = {}
    fixedShifts.forEach((f) => { const dk = f.date.substring(0, 10); if (!map[dk]) map[dk] = []; map[dk].push(f) })
    return map
  }, [fixedShifts])

  // 日付ごとの社員off申請マップ（dateStr -> staffId -> type）
  const offByDate = useMemo(() => {
    const map: Record<string, Record<number, string>> = {}
    offRequests.forEach((r) => {
      const dk = r.date.substring(0, 10)
      if (!map[dk]) map[dk] = {}
      map[dk][r.staff_id] = r.type
    })
    return map
  }, [offRequests])

  const calDays = useMemo(
    () => eachDayOfInterval({ start: startOfMonth(selectedMonth), end: endOfMonth(selectedMonth) }),
    [selectedMonth.toISOString()]
  )
  const firstDow = getDay(startOfMonth(selectedMonth))

  // 前半/後半確定状態
  const halfStatus = useMemo(() => {
    // スタッフ×日付ごとの確定済みシフト種別セット（仕込み・営業申請の部分確定検出に使用）
    const fixedTypesByKey: Record<string, Set<string>> = {}
    fixedShifts.forEach(f => {
      const key = f.staff_id + '_' + f.date.substring(0, 10)
      if (!fixedTypesByKey[key]) fixedTypesByKey[key] = new Set()
      fixedTypesByKey[key].add(f.type)
    })
    // 仕込み・営業申請は両方確定されて初めて「完全確定済み」とみなす
    const isFullyConfirmed = (r: RequestWithStaff) => {
      const types = fixedTypesByKey[r.staff_id + '_' + r.date.substring(0, 10)] ?? new Set<string>()
      if (r.type === '仕込み・営業') return types.has('仕込み') && types.has('営業')
      return types.has(r.type)
    }
    const pF = requests.filter(r =>
      parseInt(r.date.slice(8,10)) <= 15 &&
      r.status !== 'rejected' &&
      !isFullyConfirmed(r)
    ).length
    const pS = requests.filter(r =>
      parseInt(r.date.slice(8,10)) >= 16 &&
      r.status !== 'rejected' &&
      !isFullyConfirmed(r)
    ).length
    const fF = new Set(fixedShifts.filter(f => parseInt(f.date.slice(8,10)) <= 15).map(f => f.staff_id)).size
    const fS = new Set(fixedShifts.filter(f => parseInt(f.date.slice(8,10)) >= 16).map(f => f.staff_id)).size
    return { firstOk: pF===0 && fF>0, secondOk: pS===0 && fS>0, fp: pF, sp: pS }
  }, [requests, fixedShifts])

  const typeOrder: Record<string, number> = { '社員': 0, 'アルバイト': 1, '役員': 2, 'システム管理者': 3 }
  const selectedRequests = (selectedDate ? (dateMap[selectedDate] || []) : [])
    .slice()
    .sort((a, b) => (typeOrder[a.staffs.employment_type] ?? 1) - (typeOrder[b.staffs.employment_type] ?? 1))
  const selectedFixed = selectedDate ? (fixedMap[selectedDate] || []) : []

  const staffingStatus = useMemo(() => {
    if (!selectedDate) return []
    return configs.map((cfg) => {
      const filled = selectedFixed.filter((f) => f.shop_id === cfg.shop_id && f.type === cfg.type).length
      return {
        shopId: cfg.shop_id,
        shopName: SHOP_NAMES[cfg.shop_id] || String(cfg.shop_id),
        type: cfg.type,
        required: cfg.required_count,
        filled,
        diff: filled - cfg.required_count,
      }
    })
  }, [selectedDate, selectedFixed, configs])

  const handleConfirm = async (req: RequestWithStaff, shopId: number, type: '仕込み' | '営業') => {
    setConfirming(true)
    setMessage('')
    // アルバイト/長期/システム管理者は仕込みスタート14:00固定（社員は11:00スタートのためemployment_typeで判定）
    // shifts/page.tsx の isPartTimer 定義と一致させる
    const isPartTimer = req.staffs.employment_type === 'アルバイト' || req.staffs.employment_type === '長期' || req.staffs.employment_type === 'システム管理者'
    // 店舗config境界で申請時間を分割し、対象typeの時間帯のみ確定（shift_requestsは変更しない）
    const splits = autoSplitShift(req.start_time, req.end_time, shopId, configs, isPartTimer ? '14:00' : undefined)
    const split = splits.find(s => s.type === type)
    if (!split) {
      setMessage(`この申請時間帯は${type}に対応していません`)
      setConfirming(false)
      return
    }
    // upsertのonConflict不整合を避けるためdelete→insertを使用
    const { error: delErr } = await supabase.from('shifts_fixed')
      .delete()
      .eq('staff_id', req.staff_id)
      .eq('date', req.date)
      .eq('type', type)
    if (delErr) { setMessage('確定に失敗（削除エラー）: ' + delErr.message); setConfirming(false); return }
    const { error } = await supabase.from('shifts_fixed').insert({
      date: req.date, shop_id: shopId, type,
      staff_id: req.staff_id, start_time: split.start_time, end_time: split.end_time,
    })
    if (error) { setMessage('確定に失敗: ' + error.message); fetchAll() } // 削除後にinsertが失敗した場合でもUIを最新状態に更新
    else { setMessage(`${req.staffs.name}のシフトを確定しました（${SHOP_NAMES[shopId]} / ${type}）`); fetchAll() }
    setConfirming(false)
  }

  const handleRemoveFixed = async (fixedId: number) => {
    setConfirming(true)
    const { error } = await supabase.from('shifts_fixed').delete().eq('id', fixedId)
    if (error) { setMessage('取り消しに失敗: ' + error.message); setConfirming(false); return }
    setMessage('シフトを取り消しました')
    fetchAll()
    setConfirming(false)
  }

  const handleReject = async (req: RequestWithStaff) => {
    setConfirming(true)
    const { error } = await supabase.from('shift_requests').update({ status: 'rejected' }).eq('id', req.id)
    if (error) setMessage('却下に失敗: ' + error.message)
    else { setMessage(`${req.staffs.name}のシフトを却下しました`); fetchAll() }
    setConfirming(false)
  }

  // 却下された申請を申請中（pending）に戻す
  const handleRestore = async (req: RequestWithStaff) => {
    // 定休日に設定されている日の申請は復元不可（「定休日解除」で一括復元する）
    if (closedDates.includes(req.date.substring(0, 10))) {
      setMessage('定休日が設定されているため申請中に戻せません。先に定休日を解除してください。')
      return
    }
    setConfirming(true)
    const { error } = await supabase.from('shift_requests').update({ status: 'pending' }).eq('id', req.id)
    if (error) setMessage('復元に失敗: ' + error.message)
    else { setMessage(`${req.staffs.name}のシフト申請を申請中に戻しました`); fetchAll() }
    setConfirming(false)
  }

  // アルバイトの仕込み・営業リクエストを店舗設定で自動分割して確定
  const handleAutoConfirm = async (req: RequestWithStaff, shopId: number) => {
    setConfirming(true)
    setMessage('')
    // アルバイト/長期/システム管理者は仕込みスタート14:00固定（社員は11:00スタートのためemployment_typeで判定）
    // shifts/page.tsx の isPartTimer 定義と一致させる
    const isPartTimer = req.staffs.employment_type === 'アルバイト' || req.staffs.employment_type === '長期' || req.staffs.employment_type === 'システム管理者'
    const splits = autoSplitShift(req.start_time, req.end_time, shopId, configs, isPartTimer ? '14:00' : undefined)
    // この日のスタッフの既存確定をすべて削除してからinsert
    const { error: delErr } = await supabase.from('shifts_fixed')
      .delete()
      .eq('staff_id', req.staff_id)
      .eq('date', req.date)
    if (delErr) { setMessage('確定に失敗（削除エラー）: ' + delErr.message); setConfirming(false); return }
    const results = await Promise.all(
      splits.map((s) =>
        supabase.from('shifts_fixed').insert(
          { date: req.date, shop_id: shopId, type: s.type, staff_id: req.staff_id, start_time: s.start_time, end_time: s.end_time }
        )
      )
    )
    const errResult = results.find((r) => r.error)
    if (errResult?.error) {
      setMessage('確定に失敗: ' + errResult.error.message)
      fetchAll() // 削除後にinsertが失敗した場合でもUIを最新状態に更新
    } else {
      const typesStr = splits.map((s) => s.type).join('・')
      setMessage(`${req.staffs.name}のシフトを自動分割確定しました（${SHOP_NAMES[shopId]} / ${typesStr}）`)
      fetchAll()
    }
    setConfirming(false)
  }

  const setClosedDay = async (dateStr: string) => {
    // confirming ガードで連打による二重 DB 操作を防ぐ
    setConfirming(true)
    const alreadyClosed = closedDates.includes(dateStr)
    try {
      if (alreadyClosed) {
        // 定休日解除: closed_datesから削除 + shift_requestsをpendingに戻す
        const { error: delErr } = await supabase.from('closed_dates').delete().eq('date', dateStr)
        if (delErr) throw new Error('定休日解除に失敗: ' + delErr.message)
        const { error: updErr } = await supabase.from('shift_requests').update({ status: 'pending' }).eq('date', dateStr).eq('status', 'rejected')
        if (updErr) throw new Error('申請ステータス復元に失敗: ' + updErr.message)
      } else {
        // 定休日設定: closed_datesに追加 + pending申請のみrejectedに変更（既にrejectedのものは触らない）
        const { error: insErr } = await supabase.from('closed_dates').insert({ date: dateStr })
        if (insErr) throw new Error('定休日設定に失敗: ' + insErr.message)
        const { error: updErr } = await supabase.from('shift_requests').update({ status: 'rejected' }).eq('date', dateStr).eq('status', 'pending')
        if (updErr) throw new Error('申請却下に失敗: ' + updErr.message)
      }
      await fetchAll()
    } catch (e: any) {
      setMessage(e.message || '処理に失敗しました')
      await fetchAll()
    } finally {
      setConfirming(false)
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-center gap-4">
        <button onClick={() => setSelectedMonth((m) => subMonths(m, 1))} className="p-2 rounded-lg hover:bg-accent transition-colors">
          <ChevronLeft className="h-5 w-5" />
        </button>
        <span className="text-base font-semibold min-w-[120px] text-center">
          {format(selectedMonth, 'yyyy年M月', { locale: ja })}
        </span>
        <button onClick={() => setSelectedMonth((m) => addMonths(m, 1))} className="p-2 rounded-lg hover:bg-accent transition-colors">
          <ChevronRight className="h-5 w-5" />
        </button>
      </div>

      <div className="flex gap-2 mb-3">
        <div className={`flex-1 text-center py-1.5 rounded-lg text-xs font-semibold ${halfStatus.firstOk ? 'bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200' : halfStatus.fp > 0 ? 'bg-amber-50 text-amber-700 ring-1 ring-amber-200' : 'bg-zinc-100 text-zinc-500'}`}>
          前半{halfStatus.firstOk ? ' ✓ 確定済み' : halfStatus.fp > 0 ? ` ${halfStatus.fp}件待ち` : ' データなし'}
        </div>
        <div className={`flex-1 text-center py-1.5 rounded-lg text-xs font-semibold ${halfStatus.secondOk ? 'bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200' : halfStatus.sp > 0 ? 'bg-amber-50 text-amber-700 ring-1 ring-amber-200' : 'bg-zinc-100 text-zinc-500'}`}>
          後半{halfStatus.secondOk ? ' ✓ 確定済み' : halfStatus.sp > 0 ? ` ${halfStatus.sp}件待ち` : ' データなし'}
        </div>
      </div>
      <Card>
        <CardContent className="px-2 pt-4">
          <div className="grid grid-cols-7 mb-1">
            {DAY_NAMES.map((d, i) => (
              <div key={d} className={`text-center text-xs font-medium py-1 ${i === 0 ? 'text-red-500' : i === 6 ? 'text-blue-500' : 'text-muted-foreground'}`}>{d}</div>
            ))}
          </div>
          <div className="grid grid-cols-7 gap-0.5">
            {Array.from({ length: firstDow }).map((_, i) => <div key={`e-${i}`} />)}
            {calDays.map((date) => {
              const dateStr = format(date, 'yyyy-MM-dd')
              const reqs = (dateMap[dateStr] || []).filter(r => r.status !== 'rejected')
              const pendingReqs = reqs.filter(r => {
                const staffFixed = (fixedMap[dateStr] || []).filter(f => f.staff_id === r.staff_id)
                // 仕込み・営業申請は両方確定されていて初めて「処理済み」とみなす
                if (r.type === '仕込み・営業') {
                  return !(staffFixed.some(f => f.type === '仕込み') && staffFixed.some(f => f.type === '営業'))
                }
                return !staffFixed.some(f => f.type === r.type)
              })
              const fixed = fixedMap[dateStr] || []
              const isClosed = closedDates.includes(dateStr)
              const isSel = selectedDate === dateStr
              const dow = getDay(date)
              return (
                <button key={dateStr} onClick={() => setSelectedDate(isSel ? null : dateStr)}
                  className={`relative flex flex-col items-center justify-center rounded-lg py-1 min-h-[52px] text-sm transition-all cursor-pointer
                    ${isSel ? 'bg-zinc-900 text-white' : ''}
                    ${!isSel && isClosed ? 'bg-rose-100 ring-1 ring-rose-300' : !isSel && fixed.length > 0 ? 'bg-emerald-50 ring-1 ring-emerald-300' : ''}
                    ${!isSel && pendingReqs.length > 0 && fixed.length === 0 ? 'bg-amber-50 ring-1 ring-amber-200' : pendingReqs.length > 0 ? 'ring-1 ring-amber-300' : ''}
                    ${!isSel && reqs.length === 0 && fixed.length === 0 ? 'hover:bg-accent' : ''}
                    ${dow === 0 && !isSel ? 'text-red-500' : ''}
                    ${dow === 6 && !isSel ? 'text-blue-500' : ''}
                  `}>
                  <span className="font-medium">{format(date, 'd')}</span>
                      {isClosed && !isSel && <span className="text-[8px] text-rose-500 font-bold leading-none">休</span>}
                  {!isSel && (() => {
                    const aC = new Set(reqs.filter(r => r.staffs.employment_type === 'アルバイト' || r.staffs.employment_type === '長期').map(r => r.staff_id)).size
                    const socialEmployees = allStaffs.filter(s => s.employment_type === '社員')
                    const offOnDate = offByDate[dateStr] || {}
                    const eC = socialEmployees.filter(s => offOnDate[s.id] !== '休み').length
                    if (aC === 0 && eC === 0) return null
                    return <span className="text-[8px] leading-tight text-amber-600 flex flex-col">
                      {aC > 0 && <span>バイト{aC}名</span>}
                      {eC > 0 && <span>社員{eC}名</span>}
                    </span>
                  })()}
                  {fixed.length > 0 && !isSel && <span className="text-[8px] leading-tight text-emerald-600">{new Set(fixed.map(f => f.staff_id)).size}名確定</span>}
                </button>
              )
            })}
          </div>
          <div className="flex items-center gap-4 mt-3 px-2 text-[10px] text-muted-foreground">
            <span className="flex items-center gap-1"><span className="w-3 h-3 rounded bg-amber-50 ring-1 ring-amber-200" /> 希望あり</span>
            <span className="flex items-center gap-1"><span className="w-3 h-3 rounded bg-emerald-50 ring-1 ring-emerald-300" /> 確定済</span>
          </div>
        </CardContent>
      </Card>

      {selectedDate && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm flex items-center justify-between">
              <span>{format(new Date(selectedDate + 'T00:00:00'), 'M月d日（E）', { locale: ja })}</span>
              <span className="text-xs font-normal text-muted-foreground">希望 {selectedRequests.length}名 / 確定 {selectedFixed.length}名</span>
              <button
                onClick={() => setClosedDay(selectedDate!)}
                disabled={confirming}
                className={`text-xs px-2 py-0.5 rounded-full border transition-all disabled:opacity-50 disabled:cursor-not-allowed ${closedDates.includes(selectedDate!) ? 'bg-rose-50 border-rose-300 text-rose-600' : 'bg-zinc-50 border-zinc-300 text-zinc-500 hover:border-rose-300 hover:text-rose-500'}`}
              >
                {closedDates.includes(selectedDate!) ? '定休日解除' : '定休日に設定'}
              </button>
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {staffingStatus.length > 0 && (
              <div className="grid grid-cols-2 gap-2">
                {staffingStatus.map((s) => (
                  <div key={`${s.shopId}-${s.type}`}
                    className={`flex items-center justify-between p-2.5 rounded-lg border text-xs ${s.diff >= 0 ? 'bg-emerald-50 border-emerald-200' : 'bg-red-50 border-red-200'}`}>
                    <div>
                      <div className="font-medium text-[11px]">{s.shopName}</div>
                      <span className={`px-1.5 py-0.5 rounded-full ${s.type === '仕込み' ? 'bg-amber-100 text-amber-800' : 'bg-blue-100 text-blue-800'}`}>{s.type}</span>
                    </div>
                    <div className="text-right">
                      <div className={`text-base font-bold ${s.diff >= 0 ? 'text-emerald-700' : 'text-red-600'}`}>{s.filled}/{s.required}</div>
                      <div className={`text-[10px] ${s.diff >= 0 ? 'text-emerald-600' : 'text-red-500'}`}>
                        {s.diff > 0 ? `+${s.diff}名` : s.diff === 0 ? '充足' : `${s.diff}名不足`}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}

            {selectedFixed.length > 0 && (
              <div>
                <h4 className="text-xs font-medium text-emerald-700 mb-2 flex items-center gap-1">
                  <Check className="h-3 w-3" /> 確定済みシフト
                </h4>
                <div className="space-y-1.5">
                  {selectedFixed.map((f) => {
                    const staffName = allStaffs.find((s) => s.id === f.staff_id)?.name || '不明'
                    return (
                      <div key={f.id} className="flex items-center justify-between py-1.5 px-2 bg-emerald-50 rounded-lg">
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-medium">{staffName}</span>
                          <span className="text-xs text-muted-foreground">{formatTime(f.start_time)}–{formatTime(f.end_time)}</span>
                          <span className={`text-xs px-1.5 py-0.5 rounded-full ${f.type === '仕込み' ? 'bg-amber-100 text-amber-800' : 'bg-blue-100 text-blue-800'}`}>{f.type}</span>
                          <span className="text-xs text-muted-foreground">{f.shop_id === 1 ? '三茶' : '下北'}</span>
                        </div>
                        <button onClick={() => { if (window.confirm('このシフトを取り消しますか？')) handleRemoveFixed(f.id) }} disabled={confirming}
                          className="p-1 text-muted-foreground hover:text-destructive transition-colors">
                          <X className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    )
                  })}
                </div>
              </div>
            )}

            {selectedRequests.length > 0 ? (
              <div>
                <h4 className="text-xs font-medium text-amber-700 mb-2 flex items-center gap-1">
                  <Users className="h-3 w-3" /> シフト希望
                </h4>
                <div className="space-y-2">
                  {selectedRequests.map((req) => {
                    const isRejected = req.status === 'rejected'
                    const alreadyFixed = selectedFixed.some((f) => f.staff_id === req.staff_id)
                    const fixedForStaff = selectedFixed.filter(f => f.staff_id === req.staff_id)
                    return (
                      <div key={req.id} className={`p-3 rounded-lg border ${isRejected ? 'bg-red-50 border-red-200 opacity-70' : alreadyFixed ? 'bg-emerald-50/50 border-emerald-200' : 'bg-background'}`}>
                        <div className="flex items-center justify-between mb-2">
                          <div className="flex items-center gap-2">
                            <span className="text-sm font-semibold">{req.staffs.name}</span>
                            <span className={`text-[10px] px-1.5 py-0.5 rounded-full ${req.staffs.employment_type === '社員' ? 'bg-purple-100 text-purple-800' : req.staffs.employment_type === '役員' ? 'bg-amber-100 text-amber-800' : req.staffs.employment_type === 'システム管理者' ? 'bg-sky-100 text-sky-700' : 'bg-zinc-100 text-zinc-600'}`}>
                              {req.staffs.employment_type}
                            </span>
                          </div>
                          <div className="flex items-center gap-1.5">
                            {isRejected
                              ? <span className="inline-flex items-center rounded-full bg-red-100 text-red-800 text-[10px] px-1.5 py-0.5 font-semibold">却下</span>
                              : alreadyFixed
                              ? <span className="text-xs text-emerald-600 flex items-center gap-0.5"><Check className="h-3 w-3" /> 一部/全確定</span>
                              : <span className="inline-flex items-center rounded-full bg-amber-100 text-amber-800 text-[10px] px-1.5 py-0.5 font-semibold">承認待ち</span>
                            }
                          </div>
                        </div>
                        <div className="text-xs text-muted-foreground mb-2">
                          申請: {formatTime(req.start_time)}–{formatTime(req.end_time)} / {req.type}
                          {req.note && <span className="ml-2 text-amber-600">※ {req.note}</span>}
                        </div>
                        {/* 確定済みシフトの詳細表示 */}
                        {fixedForStaff.length > 0 && (
                          <div className="text-xs text-emerald-700 mb-2 flex flex-wrap gap-1">
                            {fixedForStaff.map(f => (
                              <span key={f.id} className="inline-flex items-center gap-0.5 bg-emerald-100 rounded-full px-2 py-0.5">
                                <Check className="h-2.5 w-2.5" />
                                {SHOP_NAMES[f.shop_id]} {f.type} {formatTime(f.start_time)}–{formatTime(f.end_time)}
                              </span>
                            ))}
                          </div>
                        )}
                        {isRejected ? (
                          <Button size="sm" variant="outline" className="h-8 text-xs" disabled={confirming} onClick={() => handleRestore(req)}>申請に戻す</Button>
                        ) : (
                          <div className="flex gap-2 flex-wrap">
                            {(req.type === '仕込み' || req.type === '仕込み・営業') && (
                              <>
                                <Button size="sm" variant="outline" className="h-8 text-xs" disabled={confirming} onClick={() => handleConfirm(req, 1, '仕込み')}>三茶 仕込み</Button>
                                <Button size="sm" variant="outline" className="h-8 text-xs" disabled={confirming} onClick={() => handleConfirm(req, 2, '仕込み')}>下北 仕込み</Button>
                              </>
                            )}
                            {(req.type === '営業' || req.type === '仕込み・営業') && (
                              <>
                                <Button size="sm" variant="outline" className="h-8 text-xs" disabled={confirming} onClick={() => handleConfirm(req, 1, '営業')}>三茶 営業</Button>
                                <Button size="sm" variant="outline" className="h-8 text-xs" disabled={confirming} onClick={() => handleConfirm(req, 2, '営業')}>下北 営業</Button>
                              </>
                            )}
                            {req.type === '仕込み・営業' && (
                              <>
                                <Button size="sm" className="h-8 text-xs bg-emerald-600 hover:bg-emerald-700 text-white" disabled={confirming} onClick={() => handleAutoConfirm(req, 1)}>三茶で確定</Button>
                                <Button size="sm" className="h-8 text-xs bg-blue-600 hover:bg-blue-700 text-white" disabled={confirming} onClick={() => handleAutoConfirm(req, 2)}>下北で確定</Button>
                              </>
                            )}
                            <Button size="sm" variant="outline" className="h-8 text-xs text-red-600 border-red-300 hover:bg-red-50" disabled={confirming} onClick={() => handleReject(req)}>却下</Button>
                          </div>
                        )}
                      </div>
                    )
                  })}
                </div>
              </div>
            ) : (
              <p className="text-sm text-muted-foreground text-center py-4">この日のシフト希望はありません</p>
            )}

            {message && (
              <p className={`text-sm text-center ${message.includes('失敗') ? 'text-destructive' : 'text-emerald-600'}`}>{message}</p>
            )}
          </CardContent>
        </Card>
      )}

      {loading && <div className="text-center py-8"><Loader2 className="h-6 w-6 animate-spin mx-auto text-muted-foreground" /></div>}
    </div>
  )
}

// =============================================
// タブ2: ルール設定（配属決定モデル）
// =============================================
function RulesTab() {
  const [allStaffs, setAllStaffs] = useState<Staff[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState('')
  // staffId -> 配属店舗ID（0 = 未設定）
  const [assignments, setAssignments] = useState<Record<number, number>>({})

  const fetchData = useCallback(async () => {
    setLoading(true)
    const [staffsRes, rulesRes] = await Promise.all([
      supabase.from('staffs').select('*').eq('is_active', true).eq('employment_type', '社員'),
      supabase.from('shift_rules').select('*'),
    ])
    if (staffsRes.error) console.error('staffs取得失敗:', staffsRes.error.message)
    else if (staffsRes.data) setAllStaffs(staffsRes.data)
    if (rulesRes.error) console.error('shift_rules取得失敗:', rulesRes.error.message)
    else if (rulesRes.data) {
      const map: Record<number, number> = {}
      ;(rulesRes.data as ShiftRule[]).forEach((r) => {
        // 同一スタッフに複数ルールがある場合は最初に見つかったものを使用
        if (!map[r.staff_id]) map[r.staff_id] = r.shop_id
      })
      setAssignments(map)
    }
    setLoading(false)
  }, [])

  useEffect(() => { fetchData() }, [fetchData])

  const handleAssignmentChange = (staffId: number, shopId: number) => {
    setAssignments((prev) => ({ ...prev, [staffId]: shopId }))
  }

  const handleSave = async () => {
    setSaving(true)
    setMessage('')
    try {
      // 全社員のルールを一括削除してから一括挿入（逐次処理より途中失敗リスクを低減）
      const staffIds = allStaffs.map(s => s.id)
      if (staffIds.length > 0) {
        const { error: delErr } = await supabase.from('shift_rules').delete().in('staff_id', staffIds)
        if (delErr) throw new Error('削除エラー: ' + delErr.message)
      }
      const insertRows = allStaffs
        .filter(s => (assignments[s.id] ?? 0) > 0)
        .map(s => ({ shop_id: assignments[s.id], staff_id: s.id, priority: 1, is_active: true }))
      if (insertRows.length > 0) {
        const { error: insErr } = await supabase.from('shift_rules').insert(insertRows)
        if (insErr) throw new Error('登録エラー: ' + insErr.message)
      }
      setMessage('配属設定を保存しました')
      fetchData()
    } catch (e: any) {
      setMessage('保存に失敗しました: ' + (e.message || ''))
      // 失敗後もDB実態に合わせてUIを更新する
      fetchData()
    }
    setSaving(false)
  }

  if (loading) return <div className="text-center py-8"><Loader2 className="h-6 w-6 animate-spin mx-auto text-muted-foreground" /></div>

  const shopCount = (shopId: number) => allStaffs.filter(s => (assignments[s.id] ?? 0) === shopId).length

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">
        社員ごとに配属店舗を設定します。配属先に設定された店舗にしか自動生成で割り当てられません。未設定の社員は補填候補として扱われます。
      </p>

      {/* 配属先サマリー */}
      <div className="grid grid-cols-3 gap-2">
        {[{ id: 1, label: '三軒茶屋' }, { id: 2, label: '下北沢' }, { id: 0, label: '未設定' }].map(({ id, label }) => (
          <div key={id} className={`text-center py-2.5 rounded-lg text-xs font-medium border ${
            id === 1 ? 'bg-emerald-50 border-emerald-200 text-emerald-700' :
            id === 2 ? 'bg-blue-50 border-blue-200 text-blue-700' :
            'bg-zinc-50 border-zinc-200 text-zinc-500'
          }`}>
            <div className="text-lg font-bold">{shopCount(id)}</div>
            <div>{label}</div>
          </div>
        ))}
      </div>

      <Card>
        <CardContent className="pt-4">
          <div className="divide-y">
            {allStaffs.map((staff) => {
              const assigned = assignments[staff.id] ?? 0
              return (
                <div key={staff.id} className="flex items-center gap-3 py-3">
                  <span className="text-sm font-medium flex-1">{staff.name}</span>
                  <select
                    value={assigned}
                    onChange={(e) => handleAssignmentChange(staff.id, Number(e.target.value))}
                    className={`h-9 rounded-md border px-2 text-sm transition-colors ${
                      assigned === 1 ? 'border-emerald-300 bg-emerald-50 text-emerald-800' :
                      assigned === 2 ? 'border-blue-300 bg-blue-50 text-blue-800' :
                      'border-input bg-background text-muted-foreground'
                    }`}
                  >
                    <option value={0}>未設定</option>
                    <option value={1}>三軒茶屋</option>
                    <option value={2}>下北沢</option>
                  </select>
                </div>
              )
            })}
            {allStaffs.length === 0 && (
              <p className="text-xs text-muted-foreground text-center py-4">社員が登録されていません</p>
            )}
          </div>
        </CardContent>
      </Card>

      <Button onClick={handleSave} disabled={saving} className="w-full h-11">
        {saving ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" />保存中...</> : <><Check className="mr-2 h-4 w-4" />配属設定を保存</>}
      </Button>

      {message && (
        <p className={`text-sm text-center ${message.includes('失敗') ? 'text-destructive' : 'text-emerald-600'}`}>{message}</p>
      )}
    </div>
  )
}

// =============================================
// タブ3: 自動生成
// =============================================

/**
 * 指定した日付を「含む」前半/後半の期間を返す
 * 1〜15日 → 当月1〜15日
 * 16〜末日 → 当月16日〜末日
 * ※ getSubmissionPeriod は「次の提出締め切り期間」を返すため
 *   ナビゲーション用途には使えない
 */
function getPeriodContaining(date: Date): { start: Date; end: Date; deadline: Date } {
  const year = date.getFullYear()
  const month = date.getMonth()
  const day = date.getDate()
  if (day <= 15) {
    return {
      start: new Date(year, month, 1),
      end: new Date(year, month, 15),
      deadline: new Date(year, month - 1, 20),
    }
  } else {
    return {
      start: new Date(year, month, 16),
      end: new Date(year, month + 1, 0),
      deadline: new Date(year, month, 5),
    }
  }
}

function AutoGenerateTab() {
  const today = new Date()

  // 対象期間（前半/後半の選択）
  const [periodOffset, setPeriodOffset] = useState(0) // 0=今期, 1=次期, -1=前期
  const basePeriod = getSubmissionPeriod(today)
  // periodOffsetに応じてずらす（前半↔後半を正確に1ステップずつ移動）
  const period = useMemo(() => {
    if (periodOffset === 0) return basePeriod
    let p = basePeriod
    const steps = Math.abs(periodOffset)
    for (let i = 0; i < steps; i++) {
      if (periodOffset > 0) {
        p = getPeriodContaining(addDays(p.end, 1))
      } else {
        p = getPeriodContaining(addDays(p.start, -1))
      }
    }
    return p
  }, [periodOffset, basePeriod.start.toISOString(), basePeriod.end.toISOString()])

  const [rules, setRules] = useState<RuleWithStaff[]>([])
  const [offRequests, setOffRequests] = useState<OffRequest[]>([])
  const [allStaffs, setAllStaffs] = useState<Staff[]>([])
  const [allExecutives, setAllExecutives] = useState<Staff[]>([])
  const [configs, setConfigs] = useState<ShiftConfig[]>([])
  const [closedDatesAuto, setClosedDatesAuto] = useState<string[]>([])
  const [loading, setLoading] = useState(false)
  const [preview, setPreview] = useState<GeneratedRow[] | null>(null)
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState('')
  // 期間切替時のfetch競合を防ぐためのバージョン管理（古い期間のfetchが新しい期間のデータを上書きしないよう）
  const fetchVersionRef = useRef(0)

  const fetchData = useCallback(async () => {
    const version = ++fetchVersionRef.current
    setLoading(true)
    const periodStart = format(period.start, 'yyyy-MM-dd')
    const periodEnd = format(period.end, 'yyyy-MM-dd')
    const [rulesRes, offRes, staffsRes, execRes, configRes, closedRes] = await Promise.all([
      supabase.from('shift_rules').select('*, staffs(name)').eq('is_active', true).order('shop_id').order('priority'),
      supabase.from('off_requests').select('*').gte('date', periodStart).lte('date', periodEnd),
      supabase.from('staffs').select('*').eq('is_active', true).eq('employment_type', '社員'),
      supabase.from('staffs').select('*').eq('is_active', true).eq('employment_type', '役員'),
      supabase.from('shift_config').select('*'),
      supabase.from('closed_dates').select('date').gte('date', periodStart).lte('date', periodEnd),
    ])
    // 期間切替により新しいfetchが開始されていたら古い結果は破棄する
    if (fetchVersionRef.current !== version) return
    if (rulesRes.error) console.error('shift_rules取得失敗:', rulesRes.error.message)
    else if (rulesRes.data) setRules(rulesRes.data as RuleWithStaff[])
    if (offRes.error) console.error('off_requests取得失敗:', offRes.error.message)
    else if (offRes.data) setOffRequests(offRes.data as OffRequest[])
    if (staffsRes.error) console.error('staffs(社員)取得失敗:', staffsRes.error.message)
    else if (staffsRes.data) setAllStaffs(staffsRes.data)
    if (execRes.error) console.error('staffs(役員)取得失敗:', execRes.error.message)
    else if (execRes.data) setAllExecutives(execRes.data)
    if (configRes.error) console.error('shift_config取得失敗:', configRes.error.message)
    else if (configRes.data) setConfigs(configRes.data)
    if (closedRes.error) console.error('closed_dates取得失敗:', closedRes.error.message)
    else if (closedRes.data) setClosedDatesAuto(closedRes.data.map((r: { date: string }) => r.date.substring(0, 10)))
    setLoading(false)
  }, [period.start.toISOString(), period.end.toISOString()])

  useEffect(() => { fetchData() }, [fetchData])

  // デフォルト時間を取得（shift_config は HH:MM:SS 形式のため HH:MM に正規化して返す）
  const getDefaultTime = (shopId: number, type: '仕込み' | '営業'): { start: string; end: string } => {
    // shift_config の仕込みレコードは default_end_time が仕込み/営業の境界時刻を示す
    // default_start_time と default_end_time が同値の場合はconfig設定不備のため fallback を使用
    const shikomiCfg = configs.find((c) => c.shop_id === shopId && c.type === '仕込み')
    const eigyoCfg = configs.find((c) => c.shop_id === shopId && c.type === '営業')
    const splitTime = (shikomiCfg?.default_end_time ?? '18:00:00').substring(0, 5)
    const closeTime = (eigyoCfg?.default_end_time ?? '24:00:00').substring(0, 5)
    if (type === '仕込み') {
      const startTime = (shikomiCfg?.default_start_time ?? '10:00:00').substring(0, 5)
      // startTime < splitTime なら正常なconfig、同値ならconfig不備なのでfallback
      return startTime < splitTime
        ? { start: startTime, end: splitTime }
        : { start: '10:00', end: splitTime }
    } else {
      return { start: splitTime, end: closeTime }
    }
  }

  // 自動生成ロジック（優先: ルール設定社員 → ルール外社員 → 役員（均等）→ 空欄）
  const generateShifts = () => {
    const dates = eachDayOfInterval({ start: period.start, end: period.end })
    const rows: GeneratedRow[] = []

    // offMap: staff_id -> date -> type
    const offMap: Record<number, Record<string, string>> = {}
    offRequests.forEach((r) => {
      if (!offMap[r.staff_id]) offMap[r.staff_id] = {}
      offMap[r.staff_id][r.date.substring(0, 10)] = r.type
    })

    const staffMap: Record<number, Staff> = {}
    allStaffs.forEach((s) => { staffMap[s.id] = s })

    // 役員シフト数トラッカー（均等配置用）
    const execShiftCount: Record<number, number> = {}
    allExecutives.forEach(s => { execShiftCount[s.id] = 0 })

    // 全店舗のルール設定済みスタッフID（Tier2で他店舗ルール社員を除外するために使用）
    const allRuledIds = new Set(rules.map(r => r.staff_id))

    for (const date of dates) {
      const dateStr = format(date, 'yyyy-MM-dd')

      // 休業日はスキップ
      if (closedDatesAuto.includes(dateStr)) continue

      // この日すでにいずれかの店舗に割り当て済みのスタッフID（重複配置防止）
      const assignedToday = new Set<number>()

      for (const shopId of [1, 2] as const) {
        const shopRules = rules
          .filter((r) => r.shop_id === shopId)
          .sort((a, b) => a.priority - b.priority)

        const shopRuledIds = new Set(shopRules.map(r => r.staff_id))

        let fullDayStaff: Staff | null = null
        const prepOnlyStaffList: Staff[] = []
        const eigyoOnlyStaffList: Staff[] = []

        // Tier1: ルール設定社員（優先順に）※他店舗割り当て済みは除外
        for (const rule of shopRules) {
          if (assignedToday.has(rule.staff_id)) continue
          const staff = staffMap[rule.staff_id]
          if (!staff) continue
          const offType = offMap[rule.staff_id]?.[dateStr]
          if (offType === '休み') continue
          if (offType === '仕込みのみ') {
            if (!fullDayStaff) prepOnlyStaffList.push(staff)
            continue
          }
          if (offType === '営業のみ') {
            if (!fullDayStaff) eigyoOnlyStaffList.push(staff)
            continue
          }
          fullDayStaff = staff
          break
        }

        // Tier2: 配属未設定の社員（どの店舗のルールにも含まれない）※他店舗割り当て済みは除外
        if (!fullDayStaff) {
          for (const staff of allStaffs) {
            if (allRuledIds.has(staff.id)) continue  // 他店舗含む全ルール社員を除外
            if (assignedToday.has(staff.id)) continue
            const offType = offMap[staff.id]?.[dateStr]
            if (offType === '休み') continue
            if (offType === '仕込みのみ') {
              prepOnlyStaffList.push(staff)
              continue
            }
            if (offType === '営業のみ') {
              eigyoOnlyStaffList.push(staff)
              continue
            }
            fullDayStaff = staff
            break
          }
        }

        // Tier3: 役員（最もシフト数が少ない人を優先）※他店舗割り当て済みは除外
        if (!fullDayStaff && allExecutives.length > 0) {
          const available = allExecutives.filter(s =>
            !assignedToday.has(s.id) && offMap[s.id]?.[dateStr] !== '休み'
          )
          if (available.length > 0) {
            available.sort((a, b) => (execShiftCount[a.id] ?? 0) - (execShiftCount[b.id] ?? 0))
            fullDayStaff = available[0]
          }
        }

        // 仕込みのみの人の行を追加
        for (const staff of prepOnlyStaffList) {
          const t = getDefaultTime(shopId, '仕込み')
          rows.push({
            date: dateStr, shop_id: shopId, shop_name: SHOP_NAMES[shopId],
            staff_id: staff.id, staff_name: staff.name,
            type: '仕込み', start_time: t.start, end_time: t.end, note: '仕込みのみ',
          })
          assignedToday.add(staff.id)
        }

        // 営業のみの人の行を追加
        for (const staff of eigyoOnlyStaffList) {
          const t = getDefaultTime(shopId, '営業')
          rows.push({
            date: dateStr, shop_id: shopId, shop_name: SHOP_NAMES[shopId],
            staff_id: staff.id, staff_name: staff.name,
            type: '営業', start_time: t.start, end_time: t.end, note: '営業のみ',
          })
          assignedToday.add(staff.id)
        }

        // フル出勤の人（仕込み+営業 = 2行）
        if (fullDayStaff) {
          const isExec = fullDayStaff.employment_type === '役員'
          if (isExec) execShiftCount[fullDayStaff.id] = (execShiftCount[fullDayStaff.id] ?? 0) + 1
          const t1 = getDefaultTime(shopId, '仕込み')
          const t2 = getDefaultTime(shopId, '営業')
          rows.push({
            date: dateStr, shop_id: shopId, shop_name: SHOP_NAMES[shopId],
            staff_id: fullDayStaff.id, staff_name: fullDayStaff.name,
            type: '仕込み', start_time: t1.start, end_time: t1.end, note: isExec ? '役員' : '',
          })
          rows.push({
            date: dateStr, shop_id: shopId, shop_name: SHOP_NAMES[shopId],
            staff_id: fullDayStaff.id, staff_name: fullDayStaff.name,
            type: '営業', start_time: t2.start, end_time: t2.end, note: isExec ? '役員' : '',
          })
          assignedToday.add(fullDayStaff.id)
        }
        // 埋まらない場合は空欄（エラーなし）
      }
    }

    setPreview(rows)
    setMessage('')
  }

  const confirmAll = async () => {
    if (!preview || preview.length === 0) return
    setSaving(true)
    setMessage('')
    // 期間内の社員・役員の確定シフトのみ削除してからinsert（前回生成分の残存を防ぐ）
    // ※ アルバイトの手動確定シフトは削除しない
    const periodStart = format(period.start, 'yyyy-MM-dd')
    const periodEnd = format(period.end, 'yyyy-MM-dd')
    const employeeIds = [
      ...allStaffs.map(s => s.id),
      ...allExecutives.map(s => s.id),
    ]
    if (employeeIds.length > 0) {
      const { error: delErr } = await supabase.from('shifts_fixed')
        .delete()
        .gte('date', periodStart)
        .lte('date', periodEnd)
        .in('staff_id', employeeIds)
      if (delErr) { setMessage('保存に失敗（削除エラー）: ' + delErr.message); setSaving(false); return }
    }
    const insertRows = preview.map((r) => ({
      date: r.date, shop_id: r.shop_id, type: r.type,
      staff_id: r.staff_id, start_time: r.start_time, end_time: r.end_time,
    }))
    const { error } = await supabase.from('shifts_fixed').insert(insertRows)
    if (error) {
      setMessage('保存に失敗: ' + error.message)
      // INSERT失敗後もfetchDataを呼んでUIをDB実態に同期する（DELETEは成功済みの可能性があるため）
      fetchData()
    } else {
      setMessage(`${preview.length}件のシフトを確定しました`)
      setPreview(null)
    }
    setSaving(false)
  }

  const periodLabel = `${format(period.start, 'M/d')}〜${format(period.end, 'M/d')}`

  // プレビューを日別に整理
  const previewByDate = useMemo(() => {
    if (!preview) return {}
    const map: Record<string, GeneratedRow[]> = {}
    preview.forEach((r) => {
      if (!map[r.date]) map[r.date] = []
      map[r.date].push(r)
    })
    return map
  }, [preview])

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">
        社員の休み希望とルール設定をもとに、シフトを自動生成します。
      </p>

      {/* 期間選択 */}
      <div className="flex items-center justify-center gap-4">
        <button onClick={() => { setPeriodOffset((p) => p - 1); setPreview(null) }}
          className="p-2 rounded-lg hover:bg-accent transition-colors">
          <ChevronLeft className="h-5 w-5" />
        </button>
        <span className="text-sm font-semibold min-w-[140px] text-center">{periodLabel}</span>
        <button onClick={() => { setPeriodOffset((p) => p + 1); setPreview(null) }}
          className="p-2 rounded-lg hover:bg-accent transition-colors">
          <ChevronRight className="h-5 w-5" />
        </button>
      </div>

      {/* 休み希望の概要 */}
      {offRequests.length > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">休み希望の状況</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-1">
              {allStaffs.map((staff) => {
                const staffOff = offRequests.filter((r) => r.staff_id === staff.id)
                const offCount = staffOff.filter((r) => r.type === '休み').length
                const prepCount = staffOff.filter((r) => r.type === '仕込みのみ').length
                const eigyoCount = staffOff.filter((r) => r.type === '営業のみ').length
                return (
                  <div key={staff.id} className="flex items-center justify-between text-sm py-0.5">
                    <span>{staff.name}</span>
                    <span className="text-xs text-muted-foreground">
                      {offCount > 0 && <span className="text-red-600 mr-1">休み {offCount}日</span>}
                      {prepCount > 0 && <span className="text-amber-600 mr-1">仕込みのみ {prepCount}日</span>}
                      {eigyoCount > 0 && <span className="text-indigo-600 mr-1">営業のみ {eigyoCount}日</span>}
                      {offCount === 0 && prepCount === 0 && eigyoCount === 0 && <span>未提出</span>}
                    </span>
                  </div>
                )
              })}
            </div>
          </CardContent>
        </Card>
      )}

      <Button onClick={generateShifts} className="w-full h-11" disabled={loading}>
        {loading ? (
          <><Loader2 className="mr-2 h-4 w-4 animate-spin" />読み込み中...</>
        ) : (
          <><Wand2 className="mr-2 h-4 w-4" />シフトを自動生成する</>
        )}
      </Button>

      {/* プレビュー */}
      {preview !== null && (
        <>
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm flex items-center justify-between">
                <span>生成プレビュー（{preview.length}件）</span>
                {preview.length === 0 && <span className="text-xs font-normal text-muted-foreground">割り当て可能な社員がいません</span>}
              </CardTitle>
            </CardHeader>
            <CardContent>
              {Object.entries(previewByDate).sort(([a], [b]) => a.localeCompare(b)).map(([date, rows]) => (
                <div key={date} className="mb-3 last:mb-0">
                  <div className="text-xs font-medium text-muted-foreground mb-1">
                    {format(new Date(date + 'T00:00:00'), 'M/d（E）', { locale: ja })}
                  </div>
                  <div className="space-y-1">
                    {rows.sort((a, b) => a.shop_id - b.shop_id || a.type.localeCompare(b.type)).map((r) => (
                      <div key={`${r.staff_name}-${r.shop_id}-${r.type}`} className="flex items-center gap-2 text-xs py-1 px-2 bg-muted/50 rounded">
                        <span className="text-muted-foreground w-12">{r.shop_name === '三軒茶屋' ? '三茶' : '下北'}</span>
                        <span className="font-medium">{r.staff_name}</span>
                        <span className={`px-1.5 py-0.5 rounded-full ${r.type === '仕込み' ? 'bg-amber-100 text-amber-800' : 'bg-blue-100 text-blue-800'}`}>{r.type}</span>
                        <span className="text-muted-foreground">{formatTime(r.start_time)}–{formatTime(r.end_time)}</span>
                        {r.note && <span className="text-amber-600">({r.note})</span>}
                      </div>
                    ))}
                  </div>
                </div>
              ))}
              {preview.length === 0 && (
                <p className="text-sm text-muted-foreground text-center py-4">生成できるシフトがありません</p>
              )}
            </CardContent>
          </Card>

          {preview.length > 0 && (
            <Button onClick={confirmAll} className="w-full h-11" disabled={saving}>
              {saving ? (
                <><Loader2 className="mr-2 h-4 w-4 animate-spin" />保存中...</>
              ) : (
                <><Check className="mr-2 h-4 w-4" />このシフトを確定する</>
              )}
            </Button>
          )}
        </>
      )}

      {message && (
        <p className={`text-sm text-center ${message.includes('失敗') ? 'text-destructive' : 'text-emerald-600'}`}>{message}</p>
      )}
    </div>
  )
}

// =============================================
// メインページ
// =============================================

type ManageTab = 'confirm' | 'rules' | 'auto'

export default function ManagePage() {
  const router = useRouter()
  const [currentStaff, setCurrentStaff] = useState<Staff | null>(null)
  const [staffLoaded, setStaffLoaded] = useState(false)
  const [activeTab, setActiveTab] = useState<ManageTab>('confirm')

  useEffect(() => {
    const staff = getStoredStaff()
    setCurrentStaff(staff)
    setStaffLoaded(true)
    if (!staff || (staff.employment_type !== '社員' && staff.employment_type !== '役員' && staff.employment_type !== 'システム管理者')) {
      router.replace('/home')
    }
  }, [router])

  if (!staffLoaded) return null
  if (!currentStaff || (currentStaff.employment_type !== '社員' && currentStaff.employment_type !== '役員' && currentStaff.employment_type !== 'システム管理者')) return null

  return (
    <div className="space-y-4">
      {/* タブ切替 */}
      <div className="flex gap-2 overflow-x-auto pb-1">
        <button onClick={() => setActiveTab('confirm')}
          className={`flex items-center gap-1.5 px-3 py-2 rounded-full text-sm font-medium whitespace-nowrap transition-colors ${
            activeTab === 'confirm' ? 'bg-zinc-900 text-white' : 'bg-secondary text-secondary-foreground hover:bg-secondary/80'
          }`}>
          <ClipboardCheck className="h-4 w-4" />
          シフト確定
        </button>
        <button onClick={() => setActiveTab('rules')}
          className={`flex items-center gap-1.5 px-3 py-2 rounded-full text-sm font-medium whitespace-nowrap transition-colors ${
            activeTab === 'rules' ? 'bg-zinc-900 text-white' : 'bg-secondary text-secondary-foreground hover:bg-secondary/80'
          }`}>
          <Settings className="h-4 w-4" />
          ルール設定
        </button>
        <button onClick={() => setActiveTab('auto')}
          className={`flex items-center gap-1.5 px-3 py-2 rounded-full text-sm font-medium whitespace-nowrap transition-colors ${
            activeTab === 'auto' ? 'bg-zinc-900 text-white' : 'bg-secondary text-secondary-foreground hover:bg-secondary/80'
          }`}>
          <Wand2 className="h-4 w-4" />
          自動生成
        </button>
      </div>

      {activeTab === 'confirm' && <ShiftConfirmTab />}
      {activeTab === 'rules' && <RulesTab />}
      {activeTab === 'auto' && <AutoGenerateTab />}
    </div>
  )
}

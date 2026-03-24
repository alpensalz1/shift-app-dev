'use client'

import { useEffect, useState, useCallback, useMemo, useRef } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabase'
import { getStoredStaff } from '@/lib/auth'
import { ShiftRequest, ShiftFixed, Staff, ShiftConfig, ShiftRule, OffRequest, Shop } from '@/types/database'
import { formatTime, getSubmissionPeriod, isJapaneseHoliday, isWeekendOrHoliday } from '@/lib/utils'
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
  ChevronUp,
  ChevronDown,
  UserPlus,
  AlertTriangle,
  Sliders,
  Save,
} from 'lucide-react'

interface RequestWithStaff extends ShiftRequest {
  staffs: Pick<Staff, 'name' | 'employment_type'>
}


const DAY_NAMES = ['日', '月', '火', '水', '木', '金', '土']
const SHOP_NAMES: Record<number, string> = { 1: '三軒茶屋', 2: '下北沢', 3: 'おにぎり' }
const ONIGIRI_SHOP_ID = 3

// =============================================
// タブ1: シフト確定（既存機能）
// =============================================

// アルバイトのシフト時間を店舗の設定に基づき自動分割する
// shift_config の 仕込み.default_end_time が仕込み/営業の境界時刻
// minShikomiStart: アルバイトは '14:00' を渡す（仕込みスタートの下限）
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
  // アルバイトは仕込みスタートを14:00未満にしない（社員は11:00スタートだがアルバイトは14:00固定）
  // ※ この cap は全ブランチに適用: 仕込みのみシフト・分割シフト両方で有効
  const shikomiStart = (minShikomiStart && start5 < minShikomiStart) ? minShikomiStart : startTime
  if (end5 <= split5) return [{ type: '仕込み', start_time: shikomiStart, end_time: endTime }]
  // shift_config の時刻はDB上 HH:MM:SS 形式のため substring(0,5) で HH:MM に統一
  return [
    { type: '仕込み', start_time: shikomiStart, end_time: split5 },
    { type: '営業', start_time: split5, end_time: endTime },
  ]
}

/**
 * アルバイトの申請時間帯が、指定した店舗・シフト種別と時間的に重なるか判定する。
 * 仕込み: reqEnd > '14:00'（アルバイト仕込み最小開始）かつ reqStart < splitTime
 * 営業:   reqEnd > splitTime
 */
function canAssignShiftType(
  reqStart: string,
  reqEnd: string,
  shopId: number,
  shiftType: '仕込み' | '営業',
  configs: ShiftConfig[]
): boolean {
  const shikomiCfg = configs.find((c) => c.shop_id === shopId && c.type === '仕込み')
  if (!shikomiCfg) return shiftType === '営業'
  const splitTime = shikomiCfg.default_end_time.substring(0, 5) // e.g. "17:00"
  const minShikomiStart = '14:00'
  const start5 = reqStart.substring(0, 5)
  const end5 = reqEnd === '24:00:00' ? '24:00' : reqEnd.substring(0, 5)
  if (shiftType === '仕込み') {
    return end5 > minShikomiStart && start5 < splitTime
  } else {
    return end5 > splitTime
  }
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
  const [expandedRequests, setExpandedRequests] = useState<Set<number>>(new Set())
  const [closedDates, setClosedDates] = useState<string[]>([])
  const [offRequests, setOffRequests] = useState<OffRequest[]>([])
  const [addStaffModal, setAddStaffModal] = useState<{ shopId: number; type: '仕込み' | '営業' } | null>(null)
  const [addingStaff, setAddingStaff] = useState(false)
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
      const filledEmployees = selectedFixed.filter((f) =>
        f.shop_id === cfg.shop_id &&
        f.type === cfg.type &&
        ['社員', '役員'].includes(allStaffs.find((s) => s.id === f.staff_id)?.employment_type ?? '')
      ).length
      return {
        shopId: cfg.shop_id,
        shopName: SHOP_NAMES[cfg.shop_id] || String(cfg.shop_id),
        type: cfg.type,
        required: cfg.required_count,
        filled,
        diff: filled - cfg.required_count,
        filledEmployees,
      }
    })
  }, [selectedDate, selectedFixed, configs])

  const handleConfirm = async (req: RequestWithStaff, shopId: number, type: '仕込み' | '営業') => {
    setConfirming(true)
    setMessage('')
    // アルバイト/システム管理者は仕込みスタート14:00固定（社員は11:00スタートのためemployment_typeで判定）
    // shifts/page.tsx の isPartTimer 定義と一致させる
    const isPartTimer = req.staffs.employment_type === 'アルバイト' || req.staffs.employment_type === 'システム管理者'
    // 店舗config境界で申請時間を分割し、対象typeの時間帯のみ確定（shift_requestsは変更しない）
    const splits = autoSplitShift(req.start_time, req.end_time, shopId, configs, isPartTimer ? '14:00' : undefined)
    const split = splits.find(s => s.type === type)
    if (!split) {
      setMessage(`この申請時間帯は${type}に対応していません`)
      setConfirming(false)
      return
    }
    try {
      // upsertのonConflict不整合を避けるためdelete→insertを使用
      const { error: delErr } = await supabase.from('shifts_fixed')
        .delete()
        .eq('staff_id', req.staff_id)
        .eq('date', req.date)
        .eq('type', type)
      if (delErr) { setMessage('確定に失敗（削除エラー）: ' + delErr.message); return }
      const { error } = await supabase.from('shifts_fixed').insert({
        date: req.date, shop_id: shopId, type,
        staff_id: req.staff_id, start_time: split.start_time, end_time: split.end_time,
      })
      if (error) { setMessage('確定に失敗: ' + error.message); fetchAll() } // 削除後にinsertが失敗した場合でもUIを最新状態に更新
      else { setMessage(`${req.staffs.name}のシフトを確定しました（${SHOP_NAMES[shopId]} / ${type}）`); fetchAll() }
    } finally {
      setConfirming(false)
    }
  }

  const handleRemoveFixed = async (fixedId: number) => {
    setConfirming(true)
    try {
      const { error } = await supabase.from('shifts_fixed').delete().eq('id', fixedId)
      if (error) { setMessage('取り消しに失敗: ' + error.message); return }
      setMessage('シフトを取り消しました')
      fetchAll()
    } finally {
      setConfirming(false)
    }
  }

  const handleReject = async (req: RequestWithStaff) => {
    setConfirming(true)
    try {
      const { error } = await supabase.from('shift_requests').update({ status: 'rejected' }).eq('id', req.id)
      if (error) setMessage('却下に失敗: ' + error.message)
      else { setMessage(`${req.staffs.name}のシフトを却下しました`); fetchAll() }
    } finally {
      setConfirming(false)
    }
  }

  // 却下された申請を申請中（pending）に戻す
  const handleRestore = async (req: RequestWithStaff) => {
    // 定休日に設定されている日の申請は復元不可（「定休日解除」で一括復元する）
    if (closedDates.includes(req.date.substring(0, 10))) {
      setMessage('休業日が設定されているため申請中に戻せません。先に休業日を解除してください。')
      return
    }
    setConfirming(true)
    try {
      const { error } = await supabase.from('shift_requests').update({ status: 'pending' }).eq('id', req.id)
      if (error) setMessage('復元に失敗: ' + error.message)
      else { setMessage(`${req.staffs.name}のシフト申請を申請中に戻しました`); fetchAll() }
    } finally {
      setConfirming(false)
    }
  }

  const toggleExpanded = (reqId: number) => {
    setExpandedRequests((prev) => {
      const next = new Set(prev)
      if (next.has(reqId)) next.delete(reqId)
      else next.add(reqId)
      return next
    })
  }

  // 未処理の申請を指定店舗で一括確定（案C）
  const handleBatchConfirm = async (shopId: number) => {
    const pendingReqs = selectedRequests.filter((req) => {
      if (req.status === 'rejected') return false
      const fixedForStaff = selectedFixed.filter((f) => f.staff_id === req.staff_id)
      if (req.type === '仕込み・営業') {
        return !(fixedForStaff.some((f) => f.type === '仕込み') && fixedForStaff.some((f) => f.type === '営業'))
      }
      return !fixedForStaff.some((f) => f.type === req.type)
    })
    if (pendingReqs.length === 0) return
    if (!window.confirm(`未処理の${pendingReqs.length}件を全て${SHOP_NAMES[shopId]}で確定します。よろしいですか？`)) return
    setConfirming(true)
    setMessage('')
    try {
      for (const req of pendingReqs) {
        const isPartTimer = req.staffs.employment_type === 'アルバイト' || req.staffs.employment_type === 'システム管理者'
        const splits = autoSplitShift(req.start_time, req.end_time, shopId, configs, isPartTimer ? '14:00' : undefined)
        await supabase.from('shifts_fixed').delete().eq('staff_id', req.staff_id).eq('date', req.date)
        if (splits.length > 0) {
          await supabase.from('shifts_fixed').insert(
            splits.map((s) => ({
              date: req.date, shop_id: shopId, type: s.type,
              staff_id: req.staff_id, start_time: s.start_time, end_time: s.end_time,
            }))
          )
        }
      }
      setMessage(`${pendingReqs.length}件を${SHOP_NAMES[shopId]}で一括確定しました`)
      fetchAll()
    } catch (e: any) {
      setMessage('一括確定に失敗: ' + (e.message || ''))
      fetchAll()
    } finally {
      setConfirming(false)
    }
  }

  // 社員・役員をシフト確定に直接追加（店舗デフォルト時間で挿入）
  const handleAddStaff = async (staffId: number) => {
    if (!addStaffModal || !selectedDate) return
    const { shopId, type } = addStaffModal
    const cfg = configs.find((c) => c.shop_id === shopId && c.type === type)
    if (!cfg) { setMessage('店舗設定が見つかりません'); return }
    setAddingStaff(true)
    // 下北沢の仕込みは土日・祝日のみ11:00スタート（三軒茶屋はデフォルト時間を使用）
    const dateObj = new Date(selectedDate + 'T00:00:00')
    const startTime =
      shopId === 2 && type === '仕込み' && isWeekendOrHoliday(dateObj)
        ? '11:00:00'
        : cfg.default_start_time
    try {
      const { error } = await supabase.from('shifts_fixed').insert({
        date: selectedDate,
        shop_id: shopId,
        type,
        staff_id: staffId,
        start_time: startTime,
        end_time: cfg.default_end_time,
      })
      if (error) { setMessage('追加に失敗: ' + error.message) }
      else {
        const staffName = allStaffs.find((s) => s.id === staffId)?.name || ''
        setMessage(`${staffName}を${SHOP_NAMES[shopId]} ${type}に追加しました`)
        setAddStaffModal(null)
        fetchAll()
      }
    } finally {
      setAddingStaff(false)
    }
  }

  // アルバイトの仕込み・営業リクエストを店舗設定で自動分割して確定
  const handleAutoConfirm = async (req: RequestWithStaff, shopId: number) => {
    setConfirming(true)
    setMessage('')
    // アルバイト/システム管理者は仕込みスタート14:00固定（社員は11:00スタートのためemployment_typeで判定）
    // shifts/page.tsx の isPartTimer 定義と一致させる
    const isPartTimer = req.staffs.employment_type === 'アルバイト' || req.staffs.employment_type === 'システム管理者'
    const splits = autoSplitShift(req.start_time, req.end_time, shopId, configs, isPartTimer ? '14:00' : undefined)
    try {
      // このスロットの既存確定を削除してからupsert（DELETEはベストエフォート）
      await supabase.from('shifts_fixed')
        .delete()
        .eq('staff_id', req.staff_id)
        .eq('date', req.date)
        .in('type', splits.map(s => s.type))
      const { error: insErr } = await supabase.from('shifts_fixed').insert(
        splits.map((s) => ({
          date: req.date, shop_id: shopId, type: s.type,
          staff_id: req.staff_id, start_time: s.start_time, end_time: s.end_time,
        }))
      )
      if (insErr) {
        setMessage('確定に失敗: ' + insErr.message)
        fetchAll()
      } else {
        const typesStr = splits.map((s) => s.type).join('・')
        setMessage(`${req.staffs.name}のシフトを自動分割確定しました（${SHOP_NAMES[shopId]} / ${typesStr}）`)
        fetchAll()
      }
      } finally {
      setConfirming(false)
    }
  }

  const setClosedDay = async (dateStr: string) => {
    // confirming ガードで連打による二重 DB 操作を防ぐ
    setConfirming(true)
    const alreadyClosed = closedDates.includes(dateStr)
    try {
      if (alreadyClosed) {
        // 休業日解除: closed_datesから削除 + shift_requestsをpendingに戻す
        const { error: delErr } = await supabase.from('closed_dates').delete().eq('date', dateStr)
        if (delErr) throw new Error('休業日解除に失敗: ' + delErr.message)
        const { error: updErr } = await supabase.from('shift_requests').update({ status: 'pending' }).eq('date', dateStr).eq('status', 'rejected')
        if (updErr) throw new Error('申請ステータス復元に失敗: ' + updErr.message)
      } else {
        // 休業日設定: closed_datesに追加 + pending申請のみrejectedに変更（既にrejectedのものは触らない）
        const { error: insErr } = await supabase.from('closed_dates').insert({ date: dateStr })
        if (insErr) throw new Error('休業日設定に失敗: ' + insErr.message)
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
              const isHoliday = isJapaneseHoliday(date)
              return (
                <button key={dateStr} onClick={() => setSelectedDate(isSel ? null : dateStr)}
                  className={`relative flex flex-col items-center justify-center rounded-lg py-1 min-h-[52px] text-sm transition-all cursor-pointer
                    ${isSel ? 'bg-zinc-900 text-white' : ''}
                    ${!isSel && isClosed ? 'bg-rose-100 ring-1 ring-rose-300' : !isSel && fixed.length > 0 ? 'bg-emerald-50 ring-1 ring-emerald-300' : ''}
                    ${!isSel && pendingReqs.length > 0 && fixed.length === 0 ? 'bg-amber-50 ring-1 ring-amber-200' : pendingReqs.length > 0 ? 'ring-1 ring-amber-300' : ''}
                    ${!isSel && reqs.length === 0 && fixed.length === 0 ? 'hover:bg-accent' : ''}
                    ${(dow === 0 || isHoliday) && !isSel ? 'text-red-500' : ''}
                    ${dow === 6 && !isHoliday && !isSel ? 'text-blue-500' : ''}
                  `}>
                  <span className="font-medium">{format(date, 'd')}</span>
                      {isClosed && !isSel && <span className="text-[8px] text-rose-500 font-bold leading-none">休</span>}
                      {isHoliday && !isClosed && !isSel && <span className="text-[8px] text-red-400 font-bold leading-none">祝</span>}
                  {!isSel && (() => {
                    const aC = new Set(reqs.filter(r => r.staffs.employment_type === 'アルバイト').map(r => r.staff_id)).size
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
                {closedDates.includes(selectedDate!) ? '休業日解除' : '休業日に設定'}
              </button>
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
                        {staffingStatus.length > 0 && (
              <div className="mt-3 space-y-2">
                <div className="text-[11px] font-semibold text-gray-400 uppercase tracking-wider px-0.5 mb-1">シフト状況</div>
                <div className="grid grid-cols-2 gap-2">
                  {staffingStatus.map((s) => (
                    <div
                      key={`${s.shopId}-${s.type}`}
                      className={`flex flex-col gap-2 p-3 rounded-xl border-2 text-xs ${
                        s.filledEmployees === 0
                          ? 'bg-orange-50 border-orange-300'
                          : s.diff >= 0
                          ? 'bg-emerald-50 border-emerald-200'
                          : 'bg-red-50 border-red-200'
                      }`}
                    >
                      <div className="flex items-start justify-between gap-1">
                        <div className="flex flex-col gap-0.5">
                          <div className="font-bold text-[12px] text-gray-800">{s.shopName}</div>
                          <span className={`inline-block w-fit px-1.5 py-0.5 rounded-full text-[10px] font-medium ${
                            s.type === '仕込み' ? 'bg-blue-100 text-blue-700' : 'bg-purple-100 text-purple-700'
                          }`}>{s.type}</span>
                        </div>
                        <div className="text-right shrink-0">
                          <div className={`text-base font-extrabold leading-none ${
                            s.diff >= 0 ? 'text-emerald-600' : 'text-red-600'
                          }`}>{s.filled}<span className="text-[11px] font-normal text-gray-400">/{s.required}</span></div>
                          <div className={`text-[10px] mt-0.5 font-medium ${
                            s.diff > 0 ? 'text-emerald-600' : s.diff === 0 ? 'text-emerald-600' : 'text-red-600'
                          }`}>{s.diff > 0 ? `+${s.diff}名` : s.diff === 0 ? '充足' : `${s.diff}名不足`}</div>
                        </div>
                      </div>
                      {s.filledEmployees === 0 && (
                        <div className="flex items-center gap-1.5 px-2 py-1.5 bg-orange-100 border border-orange-300 rounded-lg text-orange-700 text-[11px] font-semibold">
                          <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
                          社員を追加してください
                        </div>
                      )}
                      <button
                        onClick={() => setAddStaffModal({ shopId: s.shopId, type: s.type as '仕込み' | '営業' })}
                        disabled={confirming}
                        className="w-full flex items-center justify-center gap-1 h-7 rounded-md border border-dashed border-gray-400 text-gray-600 hover:bg-gray-50 transition-colors text-[11px] font-medium disabled:opacity-50"
                      >
                        <UserPlus className="h-3 w-3" />
                        社員を追加
                      </button>
                    </div>
                  ))}
                </div>
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

                {/* 案C: 一括確定ボタン（未処理2件以上のときのみ表示） */}
                {(() => {
                  const pendingCount = selectedRequests.filter((req) => {
                    if (req.status === 'rejected') return false
                    const fixedForStaff = selectedFixed.filter((f) => f.staff_id === req.staff_id)
                    if (req.type === '仕込み・営業') {
                      return !(fixedForStaff.some((f) => f.type === '仕込み') && fixedForStaff.some((f) => f.type === '営業'))
                    }
                    return !fixedForStaff.some((f) => f.type === req.type)
                  }).length
                  if (pendingCount < 2) return null
                  return (
                    <div className="flex gap-2 mb-3">
                      <button
                        onClick={() => handleBatchConfirm(1)}
                        disabled={confirming}
                        className="flex-1 h-8 rounded-lg text-xs font-medium bg-emerald-600 hover:bg-emerald-700 text-white disabled:opacity-40 transition-colors press-effect"
                      >
                        未処理を全員 三茶で確定（{pendingCount}件）
                      </button>
                      <button
                        onClick={() => handleBatchConfirm(2)}
                        disabled={confirming}
                        className="flex-1 h-8 rounded-lg text-xs font-medium bg-blue-600 hover:bg-blue-700 text-white disabled:opacity-40 transition-colors press-effect"
                      >
                        未処理を全員 下北で確定（{pendingCount}件）
                      </button>
                    </div>
                  )
                })()}

                <div className="space-y-2">
                  {selectedRequests.map((req) => {
                    const isRejected = req.status === 'rejected'
                    const alreadyFixed = selectedFixed.some((f) => f.staff_id === req.staff_id)
                    const fixedForStaff = selectedFixed.filter(f => f.staff_id === req.staff_id)
                    const isExpanded = expandedRequests.has(req.id)
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
                                {f.shop_id != null ? SHOP_NAMES[f.shop_id] : ''} {f.type} {formatTime(f.start_time)}–{formatTime(f.end_time)}
                              </span>
                            ))}
                          </div>
                        )}
                        {isRejected ? (
                          <Button size="sm" variant="outline" className="h-8 text-xs" disabled={confirming} onClick={() => handleRestore(req)}>申請に戻す</Button>
                        ) : (
                          <div className="space-y-1.5">
                            {/* 案A: 仕込み・営業は主ボタン2つ＋詳細トグル */}
                            {req.type === '仕込み・営業' ? (
                              <>
                                <div className="flex gap-2">
                                  <Button size="sm" className="flex-1 h-8 text-xs bg-emerald-600 hover:bg-emerald-700 text-white" disabled={confirming} onClick={() => handleAutoConfirm(req, 1)}>三茶で確定</Button>
                                  <Button size="sm" className="flex-1 h-8 text-xs bg-blue-600 hover:bg-blue-700 text-white" disabled={confirming} onClick={() => handleAutoConfirm(req, 2)}>下北で確定</Button>
                                  <Button size="sm" variant="outline" className="h-8 text-xs text-red-600 border-red-300 hover:bg-red-50" disabled={confirming} onClick={() => handleReject(req)}>却下</Button>
                                </div>
                                <button
                                  onClick={() => toggleExpanded(req.id)}
                                  className="text-[10px] text-muted-foreground hover:text-foreground transition-colors flex items-center gap-0.5"
                                >
                                  {isExpanded ? '▲ 詳細を閉じる' : '▼ 仕込み/営業を個別に確定'}
                                </button>
                                {isExpanded && (
                                  <div className="flex gap-1.5 flex-wrap pt-0.5">
                                    {canAssignShiftType(req.start_time, req.end_time, 1, '仕込み', configs) && (
                                      <Button size="sm" variant="outline" className="h-7 text-xs" disabled={confirming} onClick={() => handleConfirm(req, 1, '仕込み')}>三茶 仕込み</Button>
                                    )}
                                    {canAssignShiftType(req.start_time, req.end_time, 2, '仕込み', configs) && (
                                      <Button size="sm" variant="outline" className="h-7 text-xs" disabled={confirming} onClick={() => handleConfirm(req, 2, '仕込み')}>下北 仕込み</Button>
                                    )}
                                    {canAssignShiftType(req.start_time, req.end_time, 1, '営業', configs) && (
                                      <Button size="sm" variant="outline" className="h-7 text-xs" disabled={confirming} onClick={() => handleConfirm(req, 1, '営業')}>三茶 営業</Button>
                                    )}
                                    {canAssignShiftType(req.start_time, req.end_time, 2, '営業', configs) && (
                                      <Button size="sm" variant="outline" className="h-7 text-xs" disabled={confirming} onClick={() => handleConfirm(req, 2, '営業')}>下北 営業</Button>
                                    )}
                                  </div>
                                )}
                              </>
                            ) : (
                              /* 仕込みのみ・営業のみはそのまま3ボタン（時間重複チェック付き） */
                              <div className="flex gap-2 flex-wrap">
                                {(req.type === '仕込み') && (
                                  <>
                                    {canAssignShiftType(req.start_time, req.end_time, 1, '仕込み', configs) && (
                                      <Button size="sm" variant="outline" className="h-8 text-xs" disabled={confirming} onClick={() => handleConfirm(req, 1, '仕込み')}>三茶 仕込み</Button>
                                    )}
                                    {canAssignShiftType(req.start_time, req.end_time, 2, '仕込み', configs) && (
                                      <Button size="sm" variant="outline" className="h-8 text-xs" disabled={confirming} onClick={() => handleConfirm(req, 2, '仕込み')}>下北 仕込み</Button>
                                    )}
                                  </>
                                )}
                                {(req.type === '営業') && (
                                  <>
                                    {canAssignShiftType(req.start_time, req.end_time, 1, '営業', configs) && (
                                      <Button size="sm" variant="outline" className="h-8 text-xs" disabled={confirming} onClick={() => handleConfirm(req, 1, '営業')}>三茶 営業</Button>
                                    )}
                                    {canAssignShiftType(req.start_time, req.end_time, 2, '営業', configs) && (
                                      <Button size="sm" variant="outline" className="h-8 text-xs" disabled={confirming} onClick={() => handleConfirm(req, 2, '営業')}>下北 営業</Button>
                                    )}
                                  </>
                                )}
                                <Button size="sm" variant="outline" className="h-8 text-xs text-red-600 border-red-300 hover:bg-red-50" disabled={confirming} onClick={() => handleReject(req)}>却下</Button>
                              </div>
                            )}
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

            {/* 社員・役員追加モーダル */}
            {addStaffModal && (() => {
              const offOnDate = selectedDate ? (offByDate[selectedDate] || {}) : {}
              const alreadyFixedStaffIds = new Set(
                selectedFixed
                  .filter((f) => f.shop_id === addStaffModal.shopId && f.type === addStaffModal.type)
                  .map((f) => f.staff_id)
              )
              const candidates = allStaffs.filter((s) =>
                (s.employment_type === '社員' || s.employment_type === '役員') &&
                offOnDate[s.id] !== '休み' &&
                !alreadyFixedStaffIds.has(s.id)
              )
              return (
                <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40" onClick={() => setAddStaffModal(null)}>
                  <div className="w-full max-w-sm bg-background rounded-t-2xl p-5 pb-8 space-y-3 shadow-xl" onClick={(e) => e.stopPropagation()}>
                    <div className="flex items-center justify-between">
                      <h3 className="text-sm font-semibold">
                        {SHOP_NAMES[addStaffModal.shopId]}・{addStaffModal.type} に追加
                      </h3>
                      <button onClick={() => setAddStaffModal(null)} className="p-1 text-muted-foreground hover:text-foreground">
                        <X className="h-4 w-4" />
                      </button>
                    </div>
                    <p className="text-[11px] text-muted-foreground">
                      店舗のデフォルト時間で確定シフトに追加します。休み申請中の方は表示されません。
                    </p>
                    {candidates.length === 0 ? (
                      <p className="text-xs text-muted-foreground text-center py-4">追加できる社員・役員がいません</p>
                    ) : (
                      <div className="space-y-1.5 max-h-64 overflow-y-auto">
                        {candidates.map((s) => (
                          <button
                            key={s.id}
                            onClick={() => handleAddStaff(s.id)}
                            disabled={addingStaff}
                            className="w-full flex items-center justify-between px-3 py-2.5 rounded-lg border bg-background hover:bg-accent transition-colors disabled:opacity-50 text-sm"
                          >
                            <div className="flex items-center gap-2">
                              <span className="font-medium">{s.name}</span>
                              <span className={`text-[10px] px-1.5 py-0.5 rounded-full ${s.employment_type === '社員' ? 'bg-purple-100 text-purple-800' : 'bg-amber-100 text-amber-800'}`}>
                                {s.employment_type}
                              </span>
                            </div>
                            <UserPlus className="h-3.5 w-3.5 text-muted-foreground" />
                          </button>
                        ))}
                      </div>
                    )}
                    {addingStaff && <div className="flex justify-center"><Loader2 className="h-4 w-4 animate-spin text-muted-foreground" /></div>}
                  </div>
                </div>
              )
            })()}

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
        社員ごとの配属店舗を設定します。ここで設定した配属先が、シフト調整画面でのデフォルト出勤店舗として反映されます。
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
// (削除: 自動生成タブ)
// =============================================


// =============================================
// ã¿ã2: ã·ããèª¿æ´ï¼ç¤¾å¡ã»å½¹å¡ï¼
// =============================================
const MIN_OFF_DAYS = 5


// Shop color palette (index-based fallback if shop.color is not set)
const SHOP_BG = ['bg-indigo-500', 'bg-teal-500', 'bg-violet-500', 'bg-rose-500']
const SHOP_BG_HOVER = ['hover:bg-indigo-600', 'hover:bg-teal-600', 'hover:bg-violet-600', 'hover:bg-rose-600']
const SHOP_LIMIT_BG = ['bg-indigo-100', 'bg-teal-100', 'bg-violet-100', 'bg-rose-100']
const SHOP_LIMIT_TEXT = ['text-indigo-700', 'text-teal-700', 'text-violet-700', 'text-rose-700']
const SHOP_LIMIT_BORDER = ['border-indigo-300', 'border-teal-300', 'border-violet-300', 'border-rose-300']

function ShiftAdjustTab() {
  const today = useMemo(() => new Date(), [])
  // Default to the next half-month period that needs adjustment
  const defaultPeriod = useMemo(() => {
    const day = today.getDate()
    const year = today.getFullYear()
    const month = today.getMonth()
    // If in first half → show second half of this month; else show first half of next
    if (day <= 15) {
      return { year, month, isFirstHalf: false }
    } else {
      const d = new Date(year, month + 1, 1)
      return { year: d.getFullYear(), month: d.getMonth(), isFirstHalf: true }
    }
  }, [today])

  const [selectedYear, setSelectedYear] = useState(defaultPeriod.year)
  const [selectedMonth, setSelectedMonth] = useState(defaultPeriod.month) // 0-indexed
  const [isFirstHalf, setIsFirstHalf] = useState(defaultPeriod.isFirstHalf)
  const [offRequests, setOffRequests] = useState<OffRequest[]>([])
  const [fixedShifts, setFixedShifts] = useState<ShiftFixed[]>([])
  const [configs, setConfigs] = useState<ShiftConfig[]>([])
  const [fullTimeStaffs, setFullTimeStaffs] = useState<Staff[]>([])
  const [shops, setShops] = useState<Shop[]>([])
  // shift_rules による配属設定: staffId -> shopId（シフト調整の初期デフォルト店舗として使用）
  const [staffDefaultShops, setStaffDefaultShops] = useState<Record<number, number>>({})
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [msgText, setMsgText] = useState('')
  const [msgType, setMsgType] = useState<'ok' | 'warn' | 'err'>('ok')
  // admin-assigned off days: staffId -> Set<'yyyy-MM-dd'>
  const [assignedOff, setAssignedOff] = useState<Record<number, Set<string>>>({})
  // per-cell shop overrides: staffId -> date -> shopId (only when different from staffDefaultShops)
  const [cellShops, setCellShops] = useState<Record<number, Record<string, number>>>({})
  // 作業日（店舗なし出勤）: staffId -> Set<'yyyy-MM-dd'>
  const [taskDays, setTaskDays] = useState<Record<number, Set<string>>>({})

  const periodDays = useMemo(() => {
    const start = new Date(selectedYear, selectedMonth, isFirstHalf ? 1 : 16)
    const end = isFirstHalf
      ? new Date(selectedYear, selectedMonth, 15)
      : new Date(selectedYear, selectedMonth + 1, 0)
    return eachDayOfInterval({ start, end })
  }, [selectedYear, selectedMonth, isFirstHalf])

  const periodStart = useMemo(() => format(periodDays[0], 'yyyy-MM-dd'), [periodDays])
  const periodEnd = useMemo(() => format(periodDays[periodDays.length - 1], 'yyyy-MM-dd'), [periodDays])

  const fetchData = useCallback(async () => {
    setLoading(true)
    const [staffRes, offRes, fixedRes, configRes, shopsRes, rulesRes] = await Promise.all([
      supabase.from('staffs').select('*')
        .eq('is_active', true)
        .is('deleted_at', null)
        .in('employment_type', ['社員', '役員']),
      supabase.from('off_requests').select('*')
        .gte('date', periodStart)
        .lte('date', periodEnd),
      supabase.from('shifts_fixed').select('*')
        .gte('date', periodStart)
        .lte('date', periodEnd),
      supabase.from('shift_config').select('*'),
      supabase.from('shops').select('*').eq('is_active', true),
      supabase.from('shift_rules').select('*').eq('is_active', true),
    ])
    const staffs = (staffRes.data || []).filter((s: Staff) => s.name !== 'いっさ')
    setFullTimeStaffs(staffs)
    setOffRequests(offRes.data || [])
    setFixedShifts(fixedRes.data || [])
    setConfigs(configRes.data || [])
    setShops(shopsRes.data || [])
    // Build staffDefaultShops: staffId -> shopId (first rule wins per staff)
    const defaultShops: Record<number, number> = {}
    for (const rule of (rulesRes.data || []) as ShiftRule[]) {
      if (!defaultShops[rule.staff_id]) defaultShops[rule.staff_id] = rule.shop_id
    }
    setStaffDefaultShops(defaultShops)
    setLoading(false)
  }, [periodStart, periodEnd])

  useEffect(() => { fetchData() }, [fetchData])

  // Reconstruct assignedOff, cellShops, taskDays from existing shifts_fixed when data loads
  useEffect(() => {
    if (loading) return
    const newAsgn: Record<number, Set<string>> = {}
    const newCellShops: Record<number, Record<string, number>> = {}
    const newTaskDays: Record<number, Set<string>> = {}
    for (const staff of fullTimeStaffs) {
      const staffFixed = fixedShifts.filter(f => f.staff_id === staff.id)
      if (staffFixed.length === 0) continue // not saved yet → all default to work
      const fixedDates = new Set(staffFixed.map(f => f.date))
      const reqOffDates = new Set(
        offRequests.filter(r => r.staff_id === staff.id && r.type === '休み').map(r => r.date)
      )
      // Reconstruct assigned-off days
      const asgnSet = new Set<string>()
      for (const day of periodDays) {
        const ds = format(day, 'yyyy-MM-dd')
        if (!fixedDates.has(ds) && !reqOffDates.has(ds)) asgnSet.add(ds)
      }
      if (asgnSet.size > 0) newAsgn[staff.id] = asgnSet
      // Reconstruct 作業日 (type='作業日')
      const taskSet = new Set<string>()
      for (const fix of staffFixed) {
        if (fix.type === '作業日') taskSet.add(fix.date)
      }
      if (taskSet.size > 0) newTaskDays[staff.id] = taskSet
      // Reconstruct per-cell shop from first non-作業日 fixed shift per date
      const shopMap: Record<string, number> = {}
      for (const fix of staffFixed) {
        if (fix.type !== '作業日' && fix.shop_id != null && !shopMap[fix.date]) shopMap[fix.date] = fix.shop_id
      }
      if (Object.keys(shopMap).length > 0) newCellShops[staff.id] = shopMap
    }
    setAssignedOff(newAsgn)
    setCellShops(newCellShops)
    setTaskDays(newTaskDays)
  }, [loading]) // eslint-disable-line react-hooks/exhaustive-deps

  // Navigate month
  const prevMonth = () => {
    const d = new Date(selectedYear, selectedMonth - 1, 1)
    setSelectedYear(d.getFullYear()); setSelectedMonth(d.getMonth())
  }
  const nextMonth = () => {
    const d = new Date(selectedYear, selectedMonth + 1, 1)
    setSelectedYear(d.getFullYear()); setSelectedMonth(d.getMonth())
  }

  // Cell helpers
  const getOffReq = (staffId: number, ds: string) =>
    offRequests.find(r => r.staff_id === staffId && r.date === ds)

  const getCellState = (staffId: number, ds: string): 'work' | 'req-off' | 'limited' | 'asgn-off' | 'work-task' => {
    if (assignedOff[staffId]?.has(ds)) return 'asgn-off'
    if (taskDays[staffId]?.has(ds)) return 'work-task'
    const req = getOffReq(staffId, ds)
    if (!req) return 'work'
    return req.type === '休み' ? 'req-off' : 'limited'
  }

  // shift_rules が未設定のスタッフ（役員など）は、アクティブ店舗に順番に割り当てて均等分散する。
  // 例：役員2名・店舗2店の場合 → 1人目=三軒茶屋、2人目=下北沢
  // ※ cellShops（保存済み値）や staffDefaultShops（ルール設定）が存在する場合はそちらが優先される。
  const unruledDefault = useMemo(() => {
    const activeShopIds = shops.filter(sh => sh.is_active !== false).map(sh => sh.id)
    if (activeShopIds.length === 0) return {} as Record<number, number>
    const result: Record<number, number> = {}
    let unruledIdx = 0
    for (const staff of fullTimeStaffs) {
      if (staffDefaultShops[staff.id] !== undefined) continue // ルール設定あり → スキップ
      result[staff.id] = activeShopIds[unruledIdx % activeShopIds.length]
      unruledIdx++
    }
    return result
  }, [fullTimeStaffs, staffDefaultShops, shops])

  // Returns the shop_id for a given cell.
  // Priority: per-cell override (cellShops) → shift_rules config → unruled distribution → staff.shop_id
  const getCellShopId = (staffId: number, ds: string, fallbackShopId: number): number =>
    cellShops[staffId]?.[ds] ?? staffDefaultShops[staffId] ?? unruledDefault[staffId] ?? fallbackShopId

  // Returns shop index in the active shops array (for color/label picking)
  const getShopIdx = (shopId: number): number => {
    const idx = shops.findIndex(sh => sh.id === shopId)
    return idx >= 0 ? idx : 0
  }

  const showMsg = (text: string, type: 'ok' | 'warn' | 'err' = 'ok') => {
    setMsgText(text); setMsgType(type)
    setTimeout(() => setMsgText(''), 3000)
  }

  const handleCellClick = (staffId: number, ds: string, defaultShopId: number) => {
    const state = getCellState(staffId, ds)
    if (state === 'req-off') {
      showMsg('希望休は変更できません', 'warn'); return
    }

    if (state === 'asgn-off') {
      // 割当休 → 出勤（デフォルト店舗）に戻す
      setAssignedOff(prev => {
        const s = new Set(prev[staffId] || [])
        s.delete(ds)
        return { ...prev, [staffId]: s }
      })
      setCellShops(prev => {
        const m = { ...(prev[staffId] || {}) }
        delete m[ds]
        return { ...prev, [staffId]: m }
      })
      return
    }

    if (state === 'work-task') {
      // 作業日 → 割当休
      setTaskDays(prev => {
        const s = new Set(prev[staffId] || [])
        s.delete(ds)
        return { ...prev, [staffId]: s }
      })
      setAssignedOff(prev => {
        const s = new Set(prev[staffId] || [])
        s.add(ds)
        return { ...prev, [staffId]: s }
      })
      return
    }

    // work or limited → 店舗サイクル（全店舗を一周したら作業日 → 割当休）
    // おにぎりは土日のみ表示（平日はサイクルから除外）
    const dow = new Date(ds + 'T00:00:00').getDay()
    const isWeekend = dow === 0 || dow === 6
    const activeShops = shops.filter(sh => sh.is_active !== false && (sh.id !== ONIGIRI_SHOP_ID || isWeekend))
    if (activeShops.length < 2) {
      // 店舗が1つの場合: work → 作業日 → 割当休 → work
      if (state === 'work') {
        setTaskDays(prev => {
          const s = new Set(prev[staffId] || [])
          s.add(ds)
          return { ...prev, [staffId]: s }
        })
      }
      return
    }

    const currentShopId = getCellShopId(staffId, ds, defaultShopId)
    const currentIdx = activeShops.findIndex(sh => sh.id === currentShopId)
    const nextIdx = (currentIdx + 1) % activeShops.length
    const nextShop = activeShops[nextIdx]

    // 「全店舗を一周した」かどうかの判定:
    // 次の店舗がこのスタッフのデフォルト店舗に戻る、かつ
    // 既に明示的に店舗を切り替えた実績がある（cellShops override が存在する）場合のみ作業日へ。
    // これにより、デフォルトが下北沢のスタッフでも最初のタップで三軒茶屋を選べる。
    const naturalDefaultShopId = staffDefaultShops[staffId] ?? unruledDefault[staffId] ?? defaultShopId
    const hasExplicitOverride = cellShops[staffId]?.[ds] !== undefined

    if (state === 'work' && nextShop.id === naturalDefaultShopId && hasExplicitOverride) {
      // 全店舗を一周 → 作業日へ
      setTaskDays(prev => {
        const s = new Set(prev[staffId] || [])
        s.add(ds)
        return { ...prev, [staffId]: s }
      })
      setCellShops(prev => {
        const m = { ...(prev[staffId] || {}) }
        delete m[ds]
        return { ...prev, [staffId]: m }
      })
    } else {
      // 次の店舗へ
      setCellShops(prev => ({
        ...prev,
        [staffId]: { ...(prev[staffId] || {}), [ds]: nextShop.id }
      }))
    }
  }

  const getOffCount = (staffId: number) => {
    const req = offRequests.filter(r => r.staff_id === staffId && r.type === '休み').length
    return req + (assignedOff[staffId]?.size || 0)
  }
  const getWorkCount = (staffId: number) => periodDays.length - getOffCount(staffId)
  // 休日数が5〜6日の範囲内かチェック（0=OK, 正=不足, 負=過多）
  const getOffDiff = (staffId: number) => {
    const off = getOffCount(staffId)
    if (off < MIN_OFF_DAYS) return off - MIN_OFF_DAYS       // 負（不足）
    if (off > MIN_OFF_DAYS + 1) return off - (MIN_OFF_DAYS + 1) // 正（過多）
    return 0 // 5 or 6 → OK
  }
  const getNeedOff = (staffId: number) => Math.max(0, MIN_OFF_DAYS - getOffCount(staffId))

  const handleSave = async () => {
    const unmet = fullTimeStaffs.filter(s => getOffDiff(s.id) !== 0)
    if (unmet.length > 0) {
      const msgs = unmet.map(s => {
        const diff = getOffDiff(s.id)
        return diff < 0
          ? `${s.name}（あと${Math.abs(diff)}日休みが必要）`
          : `${s.name}（休みが${diff}日多い）`
      }).join('\n')
      const ok = window.confirm(`休日数が5〜6日の範囲外のスタッフがいます：\n${msgs}\n\nこのまま保存しますか？`)
      if (!ok) return
    }
    setSaving(true)
    try {
      const staffIds = fullTimeStaffs.map(s => s.id)
      // Delete all existing shifts_fixed for 社員/役員 in this period
      await supabase.from('shifts_fixed')
        .delete()
        .in('staff_id', staffIds)
        .gte('date', periodStart)
        .lte('date', periodEnd)

      const toInsert: Omit<ShiftFixed, 'id' | 'created_at'>[] = []

      for (const staff of fullTimeStaffs) {
        for (const day of periodDays) {
          const ds = format(day, 'yyyy-MM-dd')
          const state = getCellState(staff.id, ds)
          if (state === 'req-off' || state === 'asgn-off') continue

          // 作業日: 店舗なし・単一レコード（14:00〜24:00）
          if (state === 'work-task') {
            toInsert.push({
              date: ds, shop_id: null, staff_id: staff.id, type: '作業日',
              start_time: '14:00:00', end_time: '24:00:00',
            })
            continue
          }

          // Use per-cell shop if set, otherwise fall back to staff's default
          const shopId = getCellShopId(staff.id, ds, staff.shop_id)

          // おにぎり: 12:00-18:00固定・営業1レコードのみ
          if (shopId === ONIGIRI_SHOP_ID) {
            toInsert.push({
              date: ds, shop_id: shopId, staff_id: staff.id, type: '営業',
              start_time: '12:00:00', end_time: '18:00:00',
            })
            continue
          }

          const shimeCfg = configs.find(c => c.shop_id === shopId && c.type === '仕込み')
            ?? configs.find(c => c.type === '仕込み')
          const eigCfg = configs.find(c => c.shop_id === shopId && c.type === '営業')
            ?? configs.find(c => c.type === '営業')

          const offReq = getOffReq(staff.id, ds)
          const isShimeOnly = offReq?.type === '仕込みのみ'
          const isEigOnly = offReq?.type === '営業のみ'

          if (!isEigOnly) {
            toInsert.push({
              date: ds, shop_id: shopId, staff_id: staff.id, type: '仕込み',
              start_time: shimeCfg?.default_start_time ?? '14:00:00',
              end_time: shimeCfg?.default_end_time ?? '17:00:00',
            })
          }
          if (!isShimeOnly) {
            toInsert.push({
              date: ds, shop_id: shopId, staff_id: staff.id, type: '営業',
              start_time: eigCfg?.default_start_time ?? '17:00:00',
              end_time: eigCfg?.default_end_time ?? '24:00:00',
            })
          }
        }
      }

      if (toInsert.length > 0) {
        const { error } = await supabase.from('shifts_fixed').insert(toInsert)
        if (error) throw error
      }
      const savedDays = new Set(toInsert.map(r => `${r.staff_id}_${r.date}`)).size
      showMsg(`保存しました（${savedDays}日分のシフトを確定）`)
      await fetchData()
    } catch (e) {
      console.error(e)
      showMsg('エラーが発生しました', 'err')
    } finally {
      setSaving(false)
    }
  }

  const DAY_NAMES = ['日', '月', '火', '水', '木', '金', '土']
  const periodLabel = `${selectedMonth + 1}月${isFirstHalf ? '前半' : '後半'}`
  const okCount = fullTimeStaffs.filter(s => getNeedOff(s.id) === 0).length
  const activeShops = shops.filter(sh => sh.is_active !== false)

  return (
    <div className="space-y-3">
      {/* Message */}
      {msgText && (
        <div className={`px-3 py-2 rounded-lg text-sm font-medium ${
          msgType === 'ok' ? 'bg-emerald-50 text-emerald-700' :
          msgType === 'warn' ? 'bg-amber-50 text-amber-700' :
          'bg-red-50 text-red-700'
        }`}>{msgText}</div>
      )}

      {/* Rule reminder */}
      <div className="rounded-lg bg-amber-50 border border-amber-200 px-3 py-2 text-xs text-amber-800 leading-relaxed">
        <span className="font-bold">ルール：</span>
        社員・役員は半月につき <span className="font-bold">5日または6日の休み</span> が必要です。
        🌸希望休は変更不可。出勤セルは <span className="font-bold">タップで店舗切替</span>（全店舗を一周すると作業日→休みに）。
      </div>

      {/* Period selector */}
      <div className="flex items-center gap-2">
        <div className="flex items-center flex-1 bg-muted/40 rounded-xl px-2 py-1.5">
          <button onClick={prevMonth} className="p-1 hover:bg-white rounded-lg transition-colors">
            <ChevronLeft className="h-4 w-4" />
          </button>
          <span className="text-sm font-semibold flex-1 text-center">{selectedYear}年{periodLabel}</span>
          <button onClick={nextMonth} className="p-1 hover:bg-white rounded-lg transition-colors">
            <ChevronRight className="h-4 w-4" />
          </button>
        </div>
        {/* 前半/後半 toggle */}
        <div className="flex rounded-xl overflow-hidden border border-border bg-muted/30 flex-shrink-0">
          <button
            onClick={() => setIsFirstHalf(true)}
            className={`px-3 py-1.5 text-xs font-semibold transition-colors ${isFirstHalf ? 'bg-indigo-500 text-white' : 'text-muted-foreground hover:bg-muted/60'}`}
          >前半</button>
          <button
            onClick={() => setIsFirstHalf(false)}
            className={`px-3 py-1.5 text-xs font-semibold transition-colors ${!isFirstHalf ? 'bg-indigo-500 text-white' : 'text-muted-foreground hover:bg-muted/60'}`}
          >後半</button>
        </div>
      </div>

      {/* Legend */}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[10px] text-muted-foreground">
        {activeShops.map((shop, i) => (
          <div key={shop.id} className="flex items-center gap-1">
            <div className={`w-4 h-4 rounded ${SHOP_BG[i % SHOP_BG.length]} flex items-center justify-center`}>
              <span className="text-white font-bold" style={{ fontSize: 8 }}>{shop.name.slice(0, 2)}</span>
            </div>
            <span>出勤（{shop.name}）</span>
          </div>
        ))}
        <div className="flex items-center gap-1"><div className="w-4 h-4 rounded bg-pink-100 border border-pink-300" /><span>希望休・本人申請（変更不可）</span></div>
        <div className="flex items-center gap-1"><div className="w-4 h-4 rounded bg-sky-50 border border-sky-300 border-dashed" /><span>割り当て休</span></div>
        <div className="flex items-center gap-1"><div className="w-4 h-4 rounded bg-amber-100 border border-amber-300" /><span>限定出勤（仕込/営業のみ）</span></div>
        <div className="flex items-center gap-1"><div className="w-4 h-4 rounded bg-purple-100 border border-purple-300 flex items-center justify-center"><span className="text-purple-700 font-bold" style={{fontSize:8}}>作</span></div><span>作業日（店舗外勤務）</span></div>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-10">
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
        </div>
      ) : fullTimeStaffs.length === 0 ? (
        <p className="text-sm text-muted-foreground text-center py-8">社員・役員のスタッフが見つかりません</p>
      ) : (
        <>
          {/* Scrollable grid */}
          <div className="overflow-x-auto rounded-xl border border-border/70">
            <div style={{ minWidth: `${132 + periodDays.length * 36 + 136}px` }}>
              {/* Header */}
              <div className="flex items-end gap-1 bg-muted/40 px-2 py-1.5 border-b border-border/50">
                <div style={{ width: 132, flexShrink: 0 }} className="text-[10px] font-bold text-muted-foreground uppercase tracking-wide">スタッフ</div>
                {periodDays.map(day => {
                  const ds = format(day, 'yyyy-MM-dd')
                  const dow = getDay(day)
                  const wknd = dow === 0 || dow === 6
                  return (
                    <div key={ds} style={{ width: 34, flexShrink: 0, textAlign: 'center' }}>
                      <div className={`text-[10px] font-bold ${wknd ? 'text-red-500' : 'text-slate-500'}`}>{format(day, 'd')}</div>
                      <div className={`text-[8px] ${wknd ? 'text-red-400 font-semibold' : 'text-slate-400'}`}>{DAY_NAMES[dow]}</div>
                    </div>
                  )
                })}
                <div style={{ width: 136, flexShrink: 0 }} className="text-[10px] font-bold text-muted-foreground uppercase tracking-wide pl-2">状況</div>
              </div>

              {/* Staff rows */}
              {fullTimeStaffs.map((staff, idx) => {
                const offCount = getOffCount(staff.id)
                const workCount = getWorkCount(staff.id)
                const needOff = getNeedOff(staff.id)
                const offDiff = getOffDiff(staff.id)
                const ok = offDiff === 0
                const reqOffCount = offRequests.filter(r => r.staff_id === staff.id && r.type === '休み').length
                const asgnOffCount = assignedOff[staff.id]?.size || 0
                return (
                  <div
                    key={staff.id}
                    className={`flex items-center gap-1 px-2 py-2 border-b border-border/30 last:border-0 ${idx % 2 !== 0 ? 'bg-muted/15' : ''}`}
                  >
                    {/* Name */}
                    <div style={{ width: 132, flexShrink: 0 }}>
                      <div className="text-xs font-semibold text-foreground truncate">{staff.name}</div>
                      <span className={`text-[9px] px-1.5 py-0.5 rounded font-medium ${
                        staff.employment_type === '役員' ? 'bg-amber-100 text-amber-700' : 'bg-indigo-100 text-indigo-700'
                      }`}>{staff.employment_type}</span>
                    </div>

                    {/* Day cells */}
                    {periodDays.map(day => {
                      const ds = format(day, 'yyyy-MM-dd')
                      const state = getCellState(staff.id, ds)
                      const offReq = getOffReq(staff.id, ds)
                      const shopId = getCellShopId(staff.id, ds, staff.shop_id)
                      const shopIdx = getShopIdx(shopId)
                      const shop = activeShops[shopIdx]
                      const shopAbbr = shop ? shop.name.slice(0, 2) : '出'

                      let bg = '', label = ''
                      switch (state) {
                        case 'work':
                          bg = `${SHOP_BG[shopIdx % SHOP_BG.length]} ${SHOP_BG_HOVER[shopIdx % SHOP_BG_HOVER.length]} text-white cursor-pointer`
                          label = shopAbbr; break
                        case 'req-off':
                          bg = 'bg-pink-100 text-pink-700 border border-pink-300 cursor-not-allowed'
                          label = '休'; break
                        case 'limited':
                          bg = `${SHOP_LIMIT_BG[shopIdx % SHOP_LIMIT_BG.length]} ${SHOP_LIMIT_TEXT[shopIdx % SHOP_LIMIT_TEXT.length]} border ${SHOP_LIMIT_BORDER[shopIdx % SHOP_LIMIT_BORDER.length]} hover:opacity-80 cursor-pointer`
                          label = offReq?.type === '仕込みのみ' ? '仕' : '営'; break
                        case 'asgn-off':
                          bg = 'bg-sky-50 text-sky-600 border border-dashed border-sky-300 hover:bg-sky-100 cursor-pointer'
                          label = '休'; break
                        case 'work-task':
                          bg = 'bg-purple-100 text-purple-700 border border-purple-300 hover:bg-purple-200 cursor-pointer'
                          label = '作'; break
                      }
                      return (
                        <div
                          key={ds}
                          style={{ width: 34, height: 34, flexShrink: 0, position: 'relative' }}
                          className={`rounded-lg flex flex-col items-center justify-center select-none transition-colors ${bg}`}
                          onClick={() => handleCellClick(staff.id, ds, staff.shop_id)}
                          title={`${format(day, 'M/d')} ${DAY_NAMES[getDay(day)]}｜${
                            state === 'work' ? `${shop?.name ?? ''}出勤 → タップで店舗切替` :
                            state === 'req-off' ? '🌸 希望休（変更不可）' :
                            state === 'limited' ? `限定出勤（${offReq?.type}）@ ${shop?.name ?? ''}` :
                            state === 'work-task' ? '作業日（店舗外勤務）→ タップで割当休に' :
                            '割り当て休 → タップで出勤に戻す'
                          }`}
                        >
                          {state === 'req-off' ? (
                            <>
                              <span className="text-[11px] font-bold">{label}</span>
                              <div style={{ position: 'absolute', top: 2, right: 2, width: 5, height: 5, borderRadius: '50%', background: '#ec4899' }} />
                            </>
                          ) : (
                            <span className="text-[10px] font-bold leading-none">{label}</span>
                          )}
                        </div>
                      )
                    })}

                    {/* Status */}
                    <div style={{ width: 136, flexShrink: 0 }} className="pl-2 space-y-1">
                      <div className="flex items-center justify-between gap-1">
                        <span className="text-[10px] text-muted-foreground whitespace-nowrap">
                          {workCount}出/{reqOffCount}希+{asgnOffCount}付
                        </span>
                        {ok ? (
                          <span className="text-[10px] font-bold text-emerald-600 px-1.5 py-0.5 rounded-md bg-emerald-50 border border-emerald-200 whitespace-nowrap">OK</span>
                        ) : offDiff < 0 ? (
                          <span className="text-[10px] font-bold text-rose-600 px-1.5 py-0.5 rounded-md bg-rose-50 border border-rose-200 whitespace-nowrap">あと{Math.abs(offDiff)}日</span>
                        ) : (
                          <span className="text-[10px] font-bold text-orange-600 px-1.5 py-0.5 rounded-md bg-orange-50 border border-orange-200 whitespace-nowrap">{offDiff}日多い</span>
                        )}
                      </div>
                      <div className="h-1.5 rounded-full bg-muted/50 overflow-hidden">
                        <div
                          className={`h-full rounded-full transition-all ${ok ? 'bg-emerald-500' : offDiff > 0 ? 'bg-orange-400' : needOff >= 3 ? 'bg-rose-500' : 'bg-amber-500'}`}
                          style={{ width: `${Math.min(100, Math.round((workCount / periodDays.length) * 100))}%` }}
                        />
                      </div>
                    </div>
                  </div>
                )
              })}
            </div>
          </div>

          {/* Summary + Save */}
          <div className="flex items-center justify-between pt-1">
            <span className="text-xs text-muted-foreground">
              {okCount}/{fullTimeStaffs.length}名 条件クリア
            </span>
            <Button
              onClick={handleSave}
              disabled={saving}
              className="gap-1.5 bg-indigo-600 hover:bg-indigo-700 text-white"
            >
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
              シフトを確定・保存
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

type ManageTab = 'confirm' | 'rules' | 'adjust'

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
<button onClick={() => setActiveTab('adjust')}
          className={`flex items-center gap-1.5 px-3 py-2 rounded-full text-sm font-medium whitespace-nowrap transition-colors ${
            activeTab === 'adjust' ? 'bg-zinc-900 text-white' : 'bg-secondary text-secondary-foreground hover:bg-secondary/80'
          }`}
        >
          <Sliders className="h-4 w-4" />
          シフト調整
        </button>
      </div>

      {activeTab === 'confirm' && <ShiftConfirmTab />}
      {activeTab === 'rules' && <RulesTab />}
      {activeTab === 'adjust' && <ShiftAdjustTab />}
    </div>
  )
}

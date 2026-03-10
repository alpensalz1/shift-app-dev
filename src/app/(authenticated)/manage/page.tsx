'use client'

import { useEffect, useState, useCallback, useMemo } from 'react'
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

  const monthStart = format(startOfMonth(selectedMonth), 'yyyy-MM-dd')
  const monthEnd = format(endOfMonth(selectedMonth), 'yyyy-MM-dd')

  const fetchAll = useCallback(async () => {
    setLoading(true)
    const [reqRes, fixedRes, configRes, staffRes] = await Promise.all([
      supabase.from('shift_requests').select('*, staffs(name, employment_type)')
        .gte('date', monthStart).lte('date', monthEnd).order('date', { ascending: true }),
      supabase.from('shifts_fixed').select('*')
        .gte('date', monthStart).lte('date', monthEnd).order('date', { ascending: true }),
      supabase.from('shift_config').select('*'),
      supabase.from('staffs').select('*').eq('is_active', true),
    ])
    if (reqRes.data) setRequests(reqRes.data as RequestWithStaff[])
    if (fixedRes.data) setFixedShifts(fixedRes.data)
    if (configRes.data) setConfigs(configRes.data)
    if (staffRes.data) setAllStaffs(staffRes.data)
    setLoading(false)
  }, [monthStart, monthEnd])

  useEffect(() => { fetchAll() }, [fetchAll])

  const dateMap = useMemo(() => {
    const map: Record<string, RequestWithStaff[]> = {}
    requests.forEach((r) => { if (!map[r.date]) map[r.date] = []; map[r.date].push(r) })
    return map
  }, [requests])

  const fixedMap = useMemo(() => {
    const map: Record<string, ShiftFixed[]> = {}
    fixedShifts.forEach((f) => { if (!map[f.date]) map[f.date] = []; map[f.date].push(f) })
    return map
  }, [fixedShifts])

  const calDays = useMemo(
    () => eachDayOfInterval({ start: startOfMonth(selectedMonth), end: endOfMonth(selectedMonth) }),
    [selectedMonth.toISOString()]
  )
  const firstDow = getDay(startOfMonth(selectedMonth))

  const selectedRequests = selectedDate ? (dateMap[selectedDate] || []) : []
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
    const { error } = await supabase.from('shifts_fixed').upsert({
      date: req.date, shop_id: shopId, type,
      staff_id: req.staff_id, start_time: req.start_time, end_time: req.end_time,
    }, { onConflict: 'staff_id,date,type' })
    if (error) setMessage('確定に失敗: ' + error.message)
    else { setMessage(`${req.staffs.name}のシフトを確定しました`); fetchAll() }
    setConfirming(false)
  }

  const handleRemoveFixed = async (fixedId: number) => {
    setConfirming(true)
    await supabase.from('shifts_fixed').delete().eq('id', fixedId)
    setMessage('シフトを取り消しました')
    fetchAll()
    setConfirming(false)
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
              const reqs = dateMap[dateStr] || []
              const fixed = fixedMap[dateStr] || []
              const isSel = selectedDate === dateStr
              const dow = getDay(date)
              return (
                <button key={dateStr} onClick={() => setSelectedDate(isSel ? null : dateStr)}
                  className={`relative flex flex-col items-center justify-center rounded-lg py-1 min-h-[52px] text-sm transition-all cursor-pointer
                    ${isSel ? 'bg-zinc-900 text-white' : ''}
                    ${!isSel && fixed.length > 0 ? 'bg-emerald-50 ring-1 ring-emerald-300' : ''}
                    ${!isSel && reqs.length > 0 && fixed.length === 0 ? 'bg-amber-50 ring-1 ring-amber-200' : ''}
                    ${!isSel && reqs.length === 0 && fixed.length === 0 ? 'hover:bg-accent' : ''}
                    ${dow === 0 && !isSel ? 'text-red-500' : ''}
                    ${dow === 6 && !isSel ? 'text-blue-500' : ''}
                  `}>
                  <span className="font-medium">{format(date, 'd')}</span>
                  {reqs.length > 0 && !isSel && (() => { const aC = reqs.filter(r => r.staffs.employment_type === 'アルバイト').length; const eC = reqs.filter(r => r.staffs.employment_type !== 'アルバイト').length; return <span className="text-[8px] leading-tight text-amber-600 flex flex-col">{aC > 0 && <span>アルバイト{aC}名希望</span>}{eC > 0 && <span>社员{eC}名希望</span>}</span> })()}
                  {fixed.length > 0 && !isSel && <span className="text-[8px] leading-tight text-emerald-600">{fixed.length}名確定</span>}
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
                        <button onClick={() => handleRemoveFixed(f.id)} disabled={confirming}
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
                    const alreadyFixed = selectedFixed.some((f) => f.staff_id === req.staff_id)
                    return (
                      <div key={req.id} className={`p-3 rounded-lg border ${alreadyFixed ? 'bg-muted/50 opacity-60' : 'bg-background'}`}>
                        <div className="flex items-center justify-between mb-2">
                          <div className="flex items-center gap-2">
                            <span className="text-sm font-semibold">{req.staffs.name}</span>
                            <span className={`text-[10px] px-1.5 py-0.5 rounded-full ${req.staffs.employment_type === '社員' ? 'bg-purple-100 text-purple-800' : 'bg-zinc-100 text-zinc-600'}`}>
                              {req.staffs.employment_type}
                            </span>
                          </div>
                          {alreadyFixed && <span className="text-xs text-emerald-600 flex items-center gap-0.5"><Check className="h-3 w-3" /> 確定済</span>}
                        </div>
                        <div className="text-xs text-muted-foreground mb-2">
                          {formatTime(req.start_time)}–{formatTime(req.end_time)} / {req.type}
                          {req.note && <span className="ml-2 text-amber-600">※ {req.note}</span>}
                        </div>
                        {!alreadyFixed && (
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
// タブ2: ルール設定
// =============================================
function RulesTab() {
  const [rules, setRules] = useState<RuleWithStaff[]>([])
  const [allStaffs, setAllStaffs] = useState<Staff[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState('')
  const [addShopId, setAddShopId] = useState<1 | 2>(1)
  const [addStaffId, setAddStaffId] = useState<number>(0)

  const fetchRules = useCallback(async () => {
    setLoading(true)
    const [rulesRes, staffsRes] = await Promise.all([
      supabase.from('shift_rules').select('*, staffs(name)').order('shop_id').order('priority'),
      supabase.from('staffs').select('*').eq('is_active', true).eq('employment_type', '社員'),
    ])
    if (rulesRes.data) setRules(rulesRes.data as RuleWithStaff[])
    if (staffsRes.data) {
      setAllStaffs(staffsRes.data)
      if (staffsRes.data.length > 0 && addStaffId === 0) setAddStaffId(staffsRes.data[0].id)
    }
    setLoading(false)
  }, [])

  useEffect(() => { fetchRules() }, [fetchRules])

  const rulesForShop = (shopId: number) =>
    rules.filter((r) => r.shop_id === shopId).sort((a, b) => a.priority - b.priority)

  const toggleActive = async (rule: RuleWithStaff) => {
    const { error } = await supabase.from('shift_rules').update({ is_active: !rule.is_active }).eq('id', rule.id)
    if (!error) setRules((prev) => prev.map((r) => r.id === rule.id ? { ...r, is_active: !r.is_active } : r))
  }

  const movePriority = async (rule: RuleWithStaff, dir: 'up' | 'down') => {
    const shopRules = rulesForShop(rule.shop_id)
    const idx = shopRules.findIndex((r) => r.id === rule.id)
    const targetIdx = dir === 'up' ? idx - 1 : idx + 1
    if (targetIdx < 0 || targetIdx >= shopRules.length) return
    const other = shopRules[targetIdx]
    // swap priorities
    const [p1, p2] = [rule.priority, other.priority]
    await Promise.all([
      supabase.from('shift_rules').update({ priority: p2 }).eq('id', rule.id),
      supabase.from('shift_rules').update({ priority: p1 }).eq('id', other.id),
    ])
    setRules((prev) => prev.map((r) => {
      if (r.id === rule.id) return { ...r, priority: p2 }
      if (r.id === other.id) return { ...r, priority: p1 }
      return r
    }))
  }

  const addRule = async () => {
    if (!addStaffId) return
    setSaving(true)
    setMessage('')
    const shopRules = rulesForShop(addShopId)
    const maxPriority = shopRules.length > 0 ? Math.max(...shopRules.map((r) => r.priority)) : 0
    const { error } = await supabase.from('shift_rules').insert({
      shop_id: addShopId, staff_id: addStaffId, priority: maxPriority + 1, is_active: true,
    })
    if (error) setMessage('追加に失敗: ' + error.message)
    else { setMessage('追加しました'); fetchRules() }
    setSaving(false)
  }

  const deleteRule = async (id: number) => {
    await supabase.from('shift_rules').delete().eq('id', id)
    setRules((prev) => prev.filter((r) => r.id !== id))
  }

  if (loading) return <div className="text-center py-8"><Loader2 className="h-6 w-6 animate-spin mx-auto text-muted-foreground" /></div>

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">店舗ごとに社員の配属優先順位を設定します。優先度が高い（上の）社員から割り当てられます。</p>

      {[1, 2].map((shopId) => (
        <Card key={shopId}>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">{SHOP_NAMES[shopId]}</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {rulesForShop(shopId).map((rule, idx, arr) => (
                <div key={rule.id} className={`flex items-center gap-2 p-2.5 rounded-lg border ${rule.is_active ? 'bg-background' : 'bg-muted/50'}`}>
                  <span className="text-xs font-bold text-muted-foreground w-5 text-center">{idx + 1}</span>
                  <span className={`text-sm font-medium flex-1 ${!rule.is_active ? 'line-through text-muted-foreground' : ''}`}>
                    {rule.staffs.name}
                  </span>
                  <div className="flex items-center gap-1">
                    <button onClick={() => movePriority(rule, 'up')} disabled={idx === 0}
                      className="p-1 rounded hover:bg-accent disabled:opacity-30 transition-colors">
                      <ChevronUp className="h-3.5 w-3.5" />
                    </button>
                    <button onClick={() => movePriority(rule, 'down')} disabled={idx === arr.length - 1}
                      className="p-1 rounded hover:bg-accent disabled:opacity-30 transition-colors">
                      <ChevronDown className="h-3.5 w-3.5" />
                    </button>
                    <button onClick={() => toggleActive(rule)}
                      className={`px-2 py-0.5 rounded-full text-[10px] font-medium transition-colors ${
                        rule.is_active ? 'bg-emerald-100 text-emerald-700' : 'bg-zinc-100 text-zinc-500'
                      }`}>
                      {rule.is_active ? '有効' : '無効'}
                    </button>
                    <button onClick={() => deleteRule(rule.id)}
                      className="p-1 text-muted-foreground hover:text-destructive transition-colors">
                      <X className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </div>
              ))}
              {rulesForShop(shopId).length === 0 && (
                <p className="text-xs text-muted-foreground text-center py-2">ルールなし</p>
              )}
            </div>
          </CardContent>
        </Card>
      ))}

      {/* ルール追加 */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm">ルール追加</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex gap-2 items-end">
            <div className="space-y-1">
              <label className="text-xs text-muted-foreground">店舗</label>
              <select value={addShopId} onChange={(e) => setAddShopId(Number(e.target.value) as 1 | 2)}
                className="h-9 rounded-md border border-input bg-background px-2 text-sm">
                <option value={1}>三軒茶屋</option>
                <option value={2}>下北沢</option>
              </select>
            </div>
            <div className="space-y-1 flex-1">
              <label className="text-xs text-muted-foreground">社員</label>
              <select value={addStaffId} onChange={(e) => setAddStaffId(Number(e.target.value))}
                className="w-full h-9 rounded-md border border-input bg-background px-2 text-sm">
                {allStaffs.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
            </div>
            <Button size="sm" onClick={addRule} disabled={saving || !addStaffId} className="h-9">
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : '追加'}
            </Button>
          </div>
          {message && (
            <p className={`text-xs mt-2 ${message.includes('失敗') ? 'text-destructive' : 'text-emerald-600'}`}>{message}</p>
          )}
        </CardContent>
      </Card>
    </div>
  )
}

// =============================================
// タブ3: 自動生成
// =============================================
function AutoGenerateTab() {
  const today = new Date()

  // 対象期間（前半/後半の選択）
  const [periodOffset, setPeriodOffset] = useState(0) // 0=今期, 1=次期, -1=前期
  const basePeriod = getSubmissionPeriod(today)
  // periodOffsetに応じてずらす
  const period = useMemo(() => {
    if (periodOffset === 0) return basePeriod
    // 次期: basePeriod.end + 1日のperiod
    let ref = today
    for (let i = 0; i < Math.abs(periodOffset); i++) {
      if (periodOffset > 0) {
        ref = addDays(basePeriod.end, 1 + i * 16)
      } else {
        ref = addDays(basePeriod.start, -1 - i * 16)
      }
    }
    return getSubmissionPeriod(addDays(periodOffset > 0 ? basePeriod.end : basePeriod.start, periodOffset > 0 ? 1 : -1))
  }, [periodOffset, basePeriod.start.toISOString(), basePeriod.end.toISOString()])

  const [rules, setRules] = useState<RuleWithStaff[]>([])
  const [offRequests, setOffRequests] = useState<OffRequest[]>([])
  const [allStaffs, setAllStaffs] = useState<Staff[]>([])
  const [configs, setConfigs] = useState<ShiftConfig[]>([])
  const [loading, setLoading] = useState(false)
  const [preview, setPreview] = useState<GeneratedRow[] | null>(null)
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState('')

  const fetchData = useCallback(async () => {
    setLoading(true)
    const periodStart = format(period.start, 'yyyy-MM-dd')
    const periodEnd = format(period.end, 'yyyy-MM-dd')
    const [rulesRes, offRes, staffsRes, configRes] = await Promise.all([
      supabase.from('shift_rules').select('*, staffs(name)').eq('is_active', true).order('shop_id').order('priority'),
      supabase.from('off_requests').select('*').gte('date', periodStart).lte('date', periodEnd),
      supabase.from('staffs').select('*').eq('is_active', true).eq('employment_type', '社員'),
      supabase.from('shift_config').select('*'),
    ])
    if (rulesRes.data) setRules(rulesRes.data as RuleWithStaff[])
    if (offRes.data) setOffRequests(offRes.data as OffRequest[])
    if (staffsRes.data) setAllStaffs(staffsRes.data)
    if (configRes.data) setConfigs(configRes.data)
    setLoading(false)
  }, [period.start.toISOString(), period.end.toISOString()])

  useEffect(() => { fetchData() }, [fetchData])

  // デフォルト時間を取得
  const getDefaultTime = (shopId: number, type: '仕込み' | '営業'): { start: string; end: string } => {
    const cfg = configs.find((c) => c.shop_id === shopId && c.type === type)
    if (cfg) return { start: cfg.default_start_time, end: cfg.default_end_time }
    return type === '仕込み' ? { start: '09:00:00', end: '17:00:00' } : { start: '17:00:00', end: '24:00:00' }
  }

  // 自動生成ロジック
  const generateShifts = () => {
    const dates = eachDayOfInterval({ start: period.start, end: period.end })
    const rows: GeneratedRow[] = []

    // offMap: staff_id -> date -> type
    const offMap: Record<number, Record<string, '休み' | '仕込みのみ'>> = {}
    offRequests.forEach((r) => {
      if (!offMap[r.staff_id]) offMap[r.staff_id] = {}
      offMap[r.staff_id][r.date] = r.type as '休み' | '仕込みのみ'
    })

    const staffMap: Record<number, Staff> = {}
    allStaffs.forEach((s) => { staffMap[s.id] = s })

    for (const date of dates) {
      const dateStr = format(date, 'yyyy-MM-dd')

      for (const shopId of [1, 2]) {
        const shopRules = rules
          .filter((r) => r.shop_id === shopId)
          .sort((a, b) => a.priority - b.priority)

        // 仕込みのみの人と、フル出勤の人を分けて探す
        let fullDayStaff: RuleWithStaff | null = null
        const prepOnlyStaffs: RuleWithStaff[] = []

        for (const rule of shopRules) {
          const offType = offMap[rule.staff_id]?.[dateStr]
          if (offType === '休み') continue
          if (offType === '仕込みのみ') {
            prepOnlyStaffs.push(rule)
            continue
          }
          // available for full day
          if (!fullDayStaff) {
            fullDayStaff = rule
            break
          }
        }

        // フル出勤の人が見つかった場合は仕込みのみの人より先に
        // 実際にはprepOnlyの人はfullDayの前に来を可能性もあるが、
        // fullDayが確定したらprepOnlyは打ち切り
        const prepOnlyBeforeFull = prepOnlyStaffs.filter((p) => {
          if (!fullDayStaff) return true
          return p.priority < fullDayStaff.priority
        })

        // 仕込みのみの人つち (仕込みシフトはみ)
        for (const rule of prepOnlyBeforeFull) {
          const staff = staffMap[rule.staff_id]
          if (!staff) continue
          const t = getDefaultTime(shopId, '仕込み')
          rows.push({
            date: dateStr,
            shop_id: shopId,
            shop_name: SHOP_NAMES[shopId],
            staff_id: staff.id,
            staff_name: staff.name,
            type: '仕込み',
            start_time: t.start,
            end_time: t.end,
            note: '仕込みのみ',
          })
        }

        // フル出勤の人 (仕込み+営業 = 2行)
        if (fullDayStaff) {
          const staff = staffMap[fullDayStaff.staff_id]
          if (staff) {
            const t1 = getDefaultTime(shopId, '仕込み')
            const t2 = getDefaultTime(shopId, '営業')
            rows.push({
              date: dateStr, shop_id: shopId, shop_name: SHOP_NAMES[shopId],
              staff_id: staff.id, staff_name: staff.name,
              type: '仕込み', start_time: t1.start, end_time: t1.end, note: '',
            })
            rows.push({
              date: dateStr, shop_id: shopId, shop_name: SHOP_NAMES[shopId],
              staff_id: staff.id, staff_name: staff.name,
              type: '営業', start_time: t2.start, end_time: t2.end, note: '',
            })
          }
        }
      }
    }

    setPreview(rows)
    setMessage('')
  }

  const confirmAll = async () => {
    if (!preview || preview.length === 0) return
    setSaving(true)
    setMessage('')
    const upsertRows = preview.map((r) => ({
      date: r.date, shop_id: r.shop_id, type: r.type,
      staff_id: r.staff_id, start_time: r.start_time, end_time: r.end_time,
    }))
    const { error } = await supabase.from('shifts_fixed').upsert(upsertRows, { onConflict: 'staff_id,date,type' })
    if (error) setMessage('保存に失敗: ' + error.message)
    else { setMessage(`${preview.length}件のシフトを確定しました`); setPreview(null) }
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
                return (
                  <div key={staff.id} className="flex items-center justify-between text-sm py-0.5">
                    <span>{staff.name}</span>
                    <span className="text-xs text-muted-foreground">
                      {offCount > 0 && <span className="text-red-600 mr-1">休み {offCount}日</span>}
                      {prepCount > 0 && <span className="text-amber-600">仕込みのみ {prepCount}日</span>}
                      {offCount === 0 && prepCount === 0 && <span>未提出</span>}
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
                    {rows.sort((a, b) => a.shop_id - b.shop_id || a.type.localeCompare(b.type)).map((r, i) => (
                      <div key={i} className="flex items-center gap-2 text-xs py-1 px-2 bg-muted/50 rounded">
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
  const currentStaff = getStoredStaff()
  const [activeTab, setActiveTab] = useState<ManageTab>('confirm')

  useEffect(() => {
    if (currentStaff && currentStaff.employment_type !== '社員') {
      router.replace('/home')
    }
  }, [currentStaff, router])

  if (!currentStaff || currentStaff.employment_type !== '社員') return null

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

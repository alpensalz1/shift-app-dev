'use client'

import { useState, useEffect, useCallback } from 'react'
import { supabase } from '@/lib/supabase'
import { getStoredStaff } from '@/lib/auth'
import { Staff, ShiftFixed, ShiftConfig, Shop } from '@/types/database'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { calcWage, calcHours, formatDate } from '@/lib/utils'
import {
  BarChart2, Users, CalendarOff, TrendingUp, FileText,
  ChevronLeft, ChevronRight, Loader2, Plus,
  DollarSign, AlertTriangle, CheckCircle, X
} from 'lucide-react'

type Tab = 'labor' | 'staff' | 'fulfillment' | 'closed' | 'report'

interface WageHistory {
  id: number
  staff_id: number
  wage: number
  effective_from: string
  effective_to: string | null
  created_at: string
}

interface ClosedDate {
  id: number
  date: string
  shop_id?: number | null
  note?: string
  created_at: string
}

function getWageForDate(wageHistories: WageHistory[], staffId: number, date: string): number | null {
  const records = wageHistories
    .filter(w => w.staff_id === staffId)
    .sort((a, b) => b.effective_from.localeCompare(a.effective_from))
  for (const r of records) {
    if (date >= r.effective_from && (!r.effective_to || date <= r.effective_to)) {
      return r.wage
    }
  }
  return records.length > 0 ? records[records.length - 1].wage : null
}

export default function AdminPage() {
  const [tab, setTab] = useState<Tab>('labor')
  const [month, setMonth] = useState(() => {
    const d = new Date()
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
  })

  const tabs: { key: Tab; label: string; icon: React.ElementType }[] = [
    { key: 'labor', label: '人件費', icon: DollarSign },
    { key: 'staff', label: 'スタッフ', icon: Users },
    { key: 'fulfillment', label: '充足率', icon: TrendingUp },
    { key: 'closed', label: '休業日', icon: CalendarOff },
    { key: 'report', label: 'レポート', icon: FileText },
  ]

  const changeMonth = (delta: number) => {
    const [y, m] = month.split('-').map(Number)
    const d = new Date(y, m - 1 + delta, 1)
    setMonth(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`)
  }

  const [y, m] = month.split('-').map(Number)
  const monthLabel = `${y}年${m}月`

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <BarChart2 className="h-5 w-5" />
        <h1 className="text-lg font-bold">管理</h1>
      </div>

      <div className="flex gap-1 overflow-x-auto pb-1 -mx-1 px-1">
        {tabs.map(t => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`flex items-center gap-1.5 px-3 py-2 rounded-full text-xs font-medium whitespace-nowrap transition-colors ${
              tab === t.key ? 'bg-zinc-900 text-white' : 'bg-zinc-100 text-zinc-600 hover:bg-zinc-200'
            }`}
          >
            <t.icon className="h-3.5 w-3.5" />
            {t.label}
          </button>
        ))}
      </div>

      {['labor', 'fulfillment', 'report'].includes(tab) && (
        <div className="flex items-center justify-center gap-4">
          <button onClick={() => changeMonth(-1)} className="p-1"><ChevronLeft className="h-5 w-5" /></button>
          <span className="text-base font-semibold">{monthLabel}</span>
          <button onClick={() => changeMonth(1)} className="p-1"><ChevronRight className="h-5 w-5" /></button>
        </div>
      )}

      {tab === 'labor' && <LaborCostTab month={month} />}
      {tab === 'staff' && <StaffManagementTab />}
      {tab === 'fulfillment' && <FulfillmentTab month={month} />}
      {tab === 'closed' && <ClosedDatesTab />}
      {tab === 'report' && <MonthlyReportTab month={month} />}
    </div>
  )
}

/* ── 人件費タブ（wage_history対応） ── */
function LaborCostTab({ month }: { month: string }) {
  const [staffs, setStaffs] = useState<Staff[]>([])
  const [shifts, setShifts] = useState<ShiftFixed[]>([])
  const [wageHistories, setWageHistories] = useState<WageHistory[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const [y, m] = month.split('-').map(Number)
    const startDate = `${month}-01`
    const endDate = `${y}-${String(m).padStart(2, '0')}-${new Date(y, m, 0).getDate()}`
    Promise.all([
      supabase.from('staffs').select('*').eq('employment_type', 'アルバイト'),
      supabase.from('shifts_fixed').select('*').gte('date', startDate).lte('date', endDate),
      supabase.from('wage_history').select('*'),
    ]).then(([sR, shR, wR]) => {
      setStaffs(sR.data || [])
      setShifts(shR.data || [])
      setWageHistories(wR.data || [])
      setLoading(false)
    })
  }, [month])

  if (loading) return <div className="flex justify-center py-8"><Loader2 className="h-5 w-5 animate-spin" /></div>

  const staffWages = staffs.map(s => {
    const ss = shifts.filter(sh => sh.staff_id === s.id)
    let tw = 0, th = 0
    ss.forEach(sh => {
      const w = getWageForDate(wageHistories, s.id, sh.date) ?? s.wage
      tw += calcWage(sh.start_time, sh.end_time, w)
      th += calcHours(sh.start_time, sh.end_time)
    })
    return { staff: s, count: ss.length, hours: th, wage: tw }
  }).sort((a, b) => b.wage - a.wage)

  const total = staffWages.reduce((s, w) => s + w.wage, 0)

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm flex items-center gap-2">
          <DollarSign className="h-4 w-4" />アルバイト人件費
        </CardTitle>
        <p className="text-xs text-muted-foreground">確定シフトをもとに算出（時給変更履歴対応）</p>
      </CardHeader>
      <CardContent className="space-y-1">
        {staffWages.map(({ staff, count, hours, wage }) => (
          <div key={staff.id} className={`flex items-center justify-between py-2 border-b last:border-0 ${staff.deleted_at ? 'opacity-50' : ''}`}>
            <div>
              <p className="text-sm font-medium">{staff.name}{staff.deleted_at ? ' (退職)' : ''}</p>
              <p className="text-xs text-muted-foreground">
                {count}シフト / {hours.toFixed(1)}時間 / 時給{(getWageForDate(wageHistories, staff.id, `${month}-01`) ?? staff.wage)}円
              </p>
            </div>
            <span className="text-sm font-semibold">{Math.round(wage).toLocaleString()}円</span>
          </div>
        ))}
        <div className="flex items-center justify-between pt-3 border-t-2">
          <span className="font-bold">合計人件費</span>
          <span className="text-lg font-bold">{Math.round(total).toLocaleString()}円</span>
        </div>
      </CardContent>
    </Card>
  )
}

/* ── スタッフ管理タブ（ソフトデリート＋時給履歴） ── */
function StaffManagementTab() {
  const [staffs, setStaffs] = useState<Staff[]>([])
  const [wageHistories, setWageHistories] = useState<WageHistory[]>([])
  const [newName, setNewName] = useState('')
  const [newType, setNewType] = useState('アルバイト')
  const [newWage, setNewWage] = useState('')
  const [loading, setLoading] = useState(true)
  const [editingWage, setEditingWage] = useState<{ staffId: number; wage: string; effectiveFrom: string } | null>(null)

  const fetchData = useCallback(async () => {
    const [sR, wR] = await Promise.all([
      supabase.from('staffs').select('*').is('deleted_at', null).order('id'),
      supabase.from('wage_history').select('*').order('effective_from', { ascending: false }),
    ])
    setStaffs(sR.data || [])
    setWageHistories(wR.data || [])
    setLoading(false)
  }, [])

  useEffect(() => { fetchData() }, [fetchData])

  const handleAddStaff = async () => {
    if (!newName.trim()) return
    const wageNum = parseInt(newWage) || 0
    const all = (await supabase.from('staffs').select('id').order('id', { ascending: false }).limit(1)).data
    const nextId = (all?.[0]?.id ?? 0) + 1
    const token = newName.trim().toLowerCase().replace(/[^a-z]/g, '') + nextId

    const { data: inserted } = await supabase.from('staffs').insert({
      name: newName.trim(), token, employment_type: newType, wage: wageNum, is_active: true, shop_id: 1,
    }).select()

    if (wageNum > 0 && inserted?.[0]) {
      await supabase.from('wage_history').insert({
        staff_id: inserted[0].id, wage: wageNum, effective_from: formatDate(new Date()),
      })
    }
    setNewName(''); setNewWage('')
    fetchData()
  }

  const handleSoftDelete = async (s: Staff) => {
    if (!confirm(`${s.name}を削除しますか？\n過去の給与データは保持されます。`)) return
    await supabase.from('staffs').update({ deleted_at: new Date().toISOString(), is_active: false }).eq('id', s.id)
    fetchData()
  }

  const handleWageChange = async () => {
    if (!editingWage) return
    const nw = parseInt(editingWage.wage)
    if (!nw || !editingWage.effectiveFrom) return

    const prev = new Date(editingWage.effectiveFrom)
    prev.setDate(prev.getDate() - 1)
    const latest = wageHistories.find(w => w.staff_id === editingWage.staffId && !w.effective_to)
    if (latest) await supabase.from('wage_history').update({ effective_to: formatDate(prev) }).eq('id', latest.id)

    await supabase.from('wage_history').insert({ staff_id: editingWage.staffId, wage: nw, effective_from: editingWage.effectiveFrom })
    await supabase.from('staffs').update({ wage: nw }).eq('id', editingWage.staffId)
    setEditingWage(null)
    fetchData()
  }

  const handleToggleType = async (s: Staff, t: string) => {
    await supabase.from('staffs').update({ employment_type: t }).eq('id', s.id)
    fetchData()
  }

  if (loading) return <div className="flex justify-center py-8"><Loader2 className="h-5 w-5 animate-spin" /></div>

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-sm">新規スタッフ登録</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          <Input placeholder="名前" value={newName} onChange={e => setNewName(e.target.value)} />
          <div className="flex gap-2">
            <select value={newType} onChange={e => setNewType(e.target.value)} className="flex-1 h-10 rounded-md border border-input bg-background px-3 text-sm">
              <option value="アルバイト">アルバイト</option>
              <option value="社員">社員</option>
              <option value="役員">役員</option>
            </select>
            <Input placeholder="時給" type="number" value={newWage} onChange={e => setNewWage(e.target.value)} className="w-24" />
          </div>
          <Button onClick={handleAddStaff} className="w-full" disabled={!newName.trim()}>登録</Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-sm">スタッフ一覧（{staffs.length}名）</CardTitle></CardHeader>
        <CardContent className="space-y-1">
          {staffs.map(s => {
            const hist = wageHistories.filter(w => w.staff_id === s.id)
            return (
              <div key={s.id} className="py-2 border-b last:border-0">
                <div className="flex items-center justify-between">
                  <div>
                    <span className="text-sm font-medium">{s.name}</span>
                    <span className="ml-2 text-xs px-1.5 py-0.5 rounded bg-zinc-100 text-zinc-600">{s.employment_type}</span>
                    {s.wage > 0 && <span className="ml-1 text-xs text-muted-foreground">時給{s.wage}円</span>}
                  </div>
                  <div className="flex items-center gap-1">
                    {s.employment_type === 'アルバイト' && (
                      <>
                        <Button variant="outline" size="sm" className="text-xs h-7 px-2" onClick={() => handleToggleType(s, '社員')}>→社員</Button>
                        <Button variant="outline" size="sm" className="text-xs h-7 px-2" onClick={() => setEditingWage({ staffId: s.id, wage: String(s.wage), effectiveFrom: formatDate(new Date()) })}>時給変更</Button>
                      </>
                    )}
                    <Button variant="outline" size="sm" className="text-xs h-7 px-2 text-red-500 border-red-200 hover:bg-red-50" onClick={() => handleSoftDelete(s)}>削除</Button>
                  </div>
                </div>
                {hist.length > 0 && (
                  <div className="mt-1 ml-2 space-y-0.5">
                    {hist.slice(0, 3).map(h => (
                      <p key={h.id} className="text-[10px] text-muted-foreground">{h.effective_from}〜{h.effective_to || '現在'}: {h.wage}円</p>
                    ))}
                  </div>
                )}
              </div>
            )
          })}
        </CardContent>
      </Card>

      {editingWage && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={() => setEditingWage(null)}>
          <div className="bg-white rounded-xl p-5 w-80 shadow-2xl" onClick={e => e.stopPropagation()}>
            <h3 className="text-sm font-semibold mb-3">時給変更</h3>
            <div className="space-y-3">
              <div><label className="text-xs text-muted-foreground">新しい時給</label>
                <Input type="number" value={editingWage.wage} onChange={e => setEditingWage({ ...editingWage, wage: e.target.value })} /></div>
              <div><label className="text-xs text-muted-foreground">適用開始日</label>
                <Input type="date" value={editingWage.effectiveFrom} onChange={e => setEditingWage({ ...editingWage, effectiveFrom: e.target.value })} /></div>
              <div className="flex gap-2">
                <Button variant="outline" className="flex-1" onClick={() => setEditingWage(null)}>キャンセル</Button>
                <Button className="flex-1" onClick={handleWageChange}>保存</Button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

/* ── シフト充足率ダッシュボード ── */
function FulfillmentTab({ month }: { month: string }) {
  const [configs, setConfigs] = useState<ShiftConfig[]>([])
  const [shifts, setShifts] = useState<ShiftFixed[]>([])
  const [shops, setShops] = useState<Shop[]>([])
  const [closedDates, setClosedDates] = useState<ClosedDate[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const [y, m] = month.split('-').map(Number)
    const start = `${month}-01`
    const end = `${y}-${String(m).padStart(2, '0')}-${new Date(y, m, 0).getDate()}`
    Promise.all([
      supabase.from('shift_config').select('*'),
      supabase.from('shifts_fixed').select('*').gte('date', start).lte('date', end),
      supabase.from('shops').select('*'),
      supabase.from('closed_dates').select('*').gte('date', start).lte('date', end),
    ]).then(([cR, sR, shR, cdR]) => {
      setConfigs(cR.data || [])
      setShifts(sR.data || [])
      setShops(shR.data || [])
      setClosedDates(cdR.data || [])
      setLoading(false)
    })
  }, [month])

  if (loading) return <div className="flex justify-center py-8"><Loader2 className="h-5 w-5 animate-spin" /></div>

  const [y, m] = month.split('-').map(Number)
  const days = new Date(y, m, 0).getDate()
  const dates = Array.from({ length: days }, (_, i) => formatDate(new Date(y, m - 1, i + 1)))

  const shopData = shops.map(shop => {
    const sc = configs.filter(c => c.shop_id === shop.id)
    let req = 0, fill = 0
    const shortages: { date: string; type: string; required: number; actual: number }[] = []
    dates.forEach(date => {
      if (closedDates.some(cd => cd.date === date && (!cd.shop_id || cd.shop_id === shop.id))) return
      sc.forEach(c => {
        const r = c.required_employees
        const a = shifts.filter(s => s.date === date && s.shop_id === shop.id && s.type === c.type).length
        req += r; fill += Math.min(a, r)
        if (a < r) shortages.push({ date, type: c.type, required: r, actual: a })
      })
    })
    return { shop, rate: req > 0 ? (fill / req) * 100 : 100, req, fill, shortages }
  })

  return (
    <div className="space-y-4">
      {shopData.map(({ shop, rate, req, fill, shortages }) => (
        <Card key={shop.id}>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm flex items-center justify-between">
              <span>{shop.name}</span>
              <span className={`text-lg font-bold ${rate >= 90 ? 'text-green-600' : rate >= 70 ? 'text-yellow-600' : 'text-red-600'}`}>{rate.toFixed(0)}%</span>
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="w-full bg-zinc-100 rounded-full h-2 mb-3">
              <div className={`h-2 rounded-full ${rate >= 90 ? 'bg-green-500' : rate >= 70 ? 'bg-yellow-500' : 'bg-red-500'}`} style={{ width: `${Math.min(rate, 100)}%` }} />
            </div>
            <p className="text-xs text-muted-foreground mb-2">必要枠 {req} / 充足 {fill}</p>
            {shortages.length > 0 ? (
              <div>
                <p className="text-xs font-medium text-red-600 flex items-center gap-1"><AlertTriangle className="h-3 w-3" />人員不足（{shortages.length}件）</p>
                <div className="max-h-32 overflow-y-auto space-y-0.5 mt-1">
                  {shortages.slice(0, 10).map((s, i) => <p key={i} className="text-[11px] text-muted-foreground pl-4">{s.date} {s.type}: {s.actual}/{s.required}名</p>)}
                  {shortages.length > 10 && <p className="text-[11px] text-muted-foreground pl-4">...他{shortages.length - 10}件</p>}
                </div>
              </div>
            ) : (
              <p className="text-xs text-green-600 flex items-center gap-1"><CheckCircle className="h-3 w-3" />全日充足</p>
            )}
          </CardContent>
        </Card>
      ))}
    </div>
  )
}

/* ── 臨時休業日管理 ── */
function ClosedDatesTab() {
  const [closedDates, setClosedDates] = useState<ClosedDate[]>([])
  const [shops, setShops] = useState<Shop[]>([])
  const [newDate, setNewDate] = useState(formatDate(new Date()))
  const [newShopId, setNewShopId] = useState('')
  const [newNote, setNewNote] = useState('')
  const [loading, setLoading] = useState(true)

  const fetch_ = useCallback(async () => {
    const [cR, sR] = await Promise.all([
      supabase.from('closed_dates').select('*').order('date', { ascending: false }),
      supabase.from('shops').select('*'),
    ])
    setClosedDates(cR.data || [])
    setShops(sR.data || [])
    setLoading(false)
  }, [])

  useEffect(() => { fetch_() }, [fetch_])

  const handleAdd = async () => {
    if (!newDate) return
    await supabase.from('closed_dates').insert({ date: newDate, shop_id: newShopId ? parseInt(newShopId) : null, note: newNote })
    setNewDate(formatDate(new Date())); setNewNote(''); setNewShopId('')
    fetch_()
  }

  const handleDel = async (id: number) => {
    await supabase.from('closed_dates').delete().eq('id', id)
    fetch_()
  }

  if (loading) return <div className="flex justify-center py-8"><Loader2 className="h-5 w-5 animate-spin" /></div>

  const today = formatDate(new Date())
  const upcoming = closedDates.filter(cd => cd.date >= today)
  const past = closedDates.filter(cd => cd.date < today)

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-sm flex items-center gap-2"><CalendarOff className="h-4 w-4" />休業日を追加</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          <Input type="date" value={newDate} onChange={e => setNewDate(e.target.value)} />
          <select value={newShopId} onChange={e => setNewShopId(e.target.value)} className="w-full h-10 rounded-md border border-input bg-background px-3 text-sm">
            <option value="">全店舗</option>
            {shops.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
          <Input placeholder="備考（例：臨時休業）" value={newNote} onChange={e => setNewNote(e.target.value)} />
          <Button onClick={handleAdd} className="w-full" disabled={!newDate}><Plus className="h-4 w-4 mr-1" />休業日を登録</Button>
        </CardContent>
      </Card>

      {upcoming.length > 0 && (
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm">今後の休業日（{upcoming.length}件）</CardTitle></CardHeader>
          <CardContent className="space-y-2">
            {upcoming.map(cd => (
              <div key={cd.id} className="flex items-center justify-between py-1.5 border-b last:border-0">
                <div>
                  <p className="text-sm font-medium">{cd.date}</p>
                  <p className="text-xs text-muted-foreground">{cd.shop_id ? shops.find(s => s.id === cd.shop_id)?.name : '全店舗'}{cd.note ? ` - ${cd.note}` : ''}</p>
                </div>
                <button onClick={() => handleDel(cd.id)} className="p-1 text-red-400 hover:text-red-600"><X className="h-4 w-4" /></button>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      {past.length > 0 && (
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm text-muted-foreground">過去の休業日（{past.length}件）</CardTitle></CardHeader>
          <CardContent className="space-y-1">
            {past.slice(0, 5).map(cd => <p key={cd.id} className="text-xs text-muted-foreground">{cd.date} - {cd.shop_id ? shops.find(s => s.id === cd.shop_id)?.name : '全店舗'}{cd.note ? ` (${cd.note})` : ''}</p>)}
          </CardContent>
        </Card>
      )}
    </div>
  )
}

/* ── 月次レポート ── */
function MonthlyReportTab({ month }: { month: string }) {
  const [staffs, setStaffs] = useState<Staff[]>([])
  const [shifts, setShifts] = useState<ShiftFixed[]>([])
  const [wH, setWH] = useState<WageHistory[]>([])
  const [shops, setShops] = useState<Shop[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const [y, m] = month.split('-').map(Number)
    const s = `${month}-01`, e = `${y}-${String(m).padStart(2, '0')}-${new Date(y, m, 0).getDate()}`
    Promise.all([
      supabase.from('staffs').select('*'),
      supabase.from('shifts_fixed').select('*').gte('date', s).lte('date', e),
      supabase.from('wage_history').select('*'),
      supabase.from('shops').select('*'),
    ]).then(([sR, shR, wR, spR]) => {
      setStaffs(sR.data || []); setShifts(shR.data || []); setWH(wR.data || []); setShops(spR.data || [])
      setLoading(false)
    })
  }, [month])

  if (loading) return <div className="flex justify-center py-8"><Loader2 className="h-5 w-5 animate-spin" /></div>

  const [y, m] = month.split('-').map(Number)
  const ml = `${y}年${m}月`
  const albeits = staffs.filter(s => s.employment_type === 'アルバイト')
  const totalShifts = shifts.length
  const uniqueDays = new Set(shifts.map(s => s.date)).size
  let totalWage = 0, totalHours = 0, nightH = 0

  albeits.forEach(s => {
    shifts.filter(sh => sh.staff_id === s.id).forEach(sh => {
      const w = getWageForDate(wH, s.id, sh.date) ?? s.wage
      totalWage += calcWage(sh.start_time, sh.end_time, w)
      totalHours += calcHours(sh.start_time, sh.end_time)
      const [eH] = (sh.end_time || '24:00').split(':').map(Number)
      const [sH] = sh.start_time.split(':').map(Number)
      if (eH > 22 || !sh.end_time) nightH += Math.max(0, Math.min(eH, 24) - Math.max(sH, 22))
    })
  })

  const avgH = totalShifts > 0 ? shifts.reduce((sum, s) => sum + calcHours(s.start_time, s.end_time), 0) / totalShifts : 0
  const shopStats = shops.map(sp => ({ name: sp.name, count: shifts.filter(s => s.shop_id === sp.id).length }))

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm flex items-center gap-2"><FileText className="h-4 w-4" />{ml} 月次レポート</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid grid-cols-2 gap-3">
          <div className="bg-zinc-50 rounded-lg p-3">
            <p className="text-xs text-muted-foreground">総シフト数</p>
            <p className="text-xl font-bold">{totalShifts}</p>
            <p className="text-[10px] text-muted-foreground">{uniqueDays}営業日</p>
          </div>
          <div className="bg-zinc-50 rounded-lg p-3">
            <p className="text-xs text-muted-foreground">アルバイト人件費</p>
            <p className="text-xl font-bold">{Math.round(totalWage).toLocaleString()}<span className="text-sm">円</span></p>
          </div>
          <div className="bg-zinc-50 rounded-lg p-3">
            <p className="text-xs text-muted-foreground">総労働時間</p>
            <p className="text-xl font-bold">{totalHours.toFixed(1)}<span className="text-sm">h</span></p>
          </div>
          <div className="bg-zinc-50 rounded-lg p-3">
            <p className="text-xs text-muted-foreground">平均シフト時間</p>
            <p className="text-xl font-bold">{avgH.toFixed(1)}<span className="text-sm">h</span></p>
          </div>
        </div>
        <div>
          <p className="text-xs font-medium text-muted-foreground mb-2">店舗別シフト数</p>
          {shopStats.map(s => (
            <div key={s.name} className="flex justify-between py-1">
              <span className="text-sm">{s.name}</span>
              <span className="text-sm font-semibold">{s.count}シフト</span>
            </div>
          ))}
        </div>
        <div className="bg-amber-50 rounded-lg p-3">
          <p className="text-xs text-amber-700 font-medium">深夜割増（22:00〜）</p>
          <p className="text-sm text-amber-900">{nightH.toFixed(1)}時間 / 割増率1.25倍</p>
        </div>
      </CardContent>
    </Card>
  )
}

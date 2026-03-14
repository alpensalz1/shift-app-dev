'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabase'
import { getStoredStaff } from '@/lib/auth'
import { Staff, ShiftFixed, ShiftConfig, Shop } from '@/types/database'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { calcWage, calcHours } from '@/lib/utils'
import {
  BarChart2, Users, CalendarOff, TrendingUp, FileText,
  ChevronLeft, ChevronRight, Loader2, Plus,
  DollarSign, AlertTriangle, CheckCircle, X, Clock, Briefcase
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

function fmtDate(d: Date): string {
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0')
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
  // マッチする期間がない場合は最新レコードを返す（effective_toが全て設定されている稀なケース）
  return records.length > 0 ? records[0].wage : null
}

export default function AdminPage() {
  const router = useRouter()
  const [staffLoaded, setStaffLoaded] = useState(false)
  const [isAuthorized, setIsAuthorized] = useState(false)
  const [tab, setTab] = useState<Tab>('labor')
  const [month, setMonth] = useState(() => {
    const d = new Date()
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
  })

  useEffect(() => {
    const staff = getStoredStaff()
    const authorized = !!staff && (
      staff.employment_type === '社員' ||
      staff.employment_type === '役員' ||
      staff.employment_type === 'システム管理者'
    )
    setIsAuthorized(authorized)
    setStaffLoaded(true)
    if (!authorized) router.replace('/home')
  }, [router])

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

  if (!staffLoaded || !isAuthorized) return null

  return (
    <div className="px-4 pt-3 pb-24 space-y-4">
      {/* Header */}
      <div>
        <h2 className="text-lg font-bold flex items-center gap-2 tracking-tight">
          <BarChart2 className="h-5 w-5" />
          管理
        </h2>
        <p className="text-xs text-muted-foreground mt-0.5">店舗運営データの確認・管理</p>
      </div>

      {/* Tab navigation - scrollable pills */}
      <div className="flex gap-1.5 overflow-x-auto pb-1 -mx-1 px-1 scrollbar-hide">
        {tabs.map(t => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-medium whitespace-nowrap transition-all press-effect ${
              tab === t.key
                ? 'bg-foreground text-background shadow-sm'
                : 'bg-muted/60 text-muted-foreground hover:bg-muted'
            }`}
          >
            <t.icon className="h-3.5 w-3.5" />
            {t.label}
          </button>
        ))}
      </div>

      {/* Month selector */}
      {['labor', 'fulfillment', 'report'].includes(tab) && (
        <div className="flex items-center justify-between bg-muted/40 rounded-2xl px-2 py-1.5">
          <button
            onClick={() => changeMonth(-1)}
            className="p-2 hover:bg-white rounded-xl transition-colors press-effect"
          >
            <ChevronLeft className="h-4 w-4 text-muted-foreground" />
          </button>
          <span className="text-sm font-bold">{monthLabel}</span>
          <button
            onClick={() => changeMonth(1)}
            className="p-2 hover:bg-white rounded-xl transition-colors press-effect"
          >
            <ChevronRight className="h-4 w-4 text-muted-foreground" />
          </button>
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

/* ── 人件費タブ ── */
function LaborCostTab({ month }: { month: string }) {
  const [staffs, setStaffs] = useState<Staff[]>([])
  const [shifts, setShifts] = useState<ShiftFixed[]>([])
  const [wageHistories, setWageHistories] = useState<WageHistory[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    // 月切替時に古いデータが一瞬表示されないよう即座にローディング状態にリセット
    setLoading(true)
    const [y, m] = month.split('-').map(Number)
    const startDate = `${month}-01`
    const endDate = `${y}-${String(m).padStart(2, '0')}-${new Date(y, m, 0).getDate()}`
    Promise.all([
      supabase.from('staffs').select('*').in('employment_type', ['アルバイト', '長期']),
      supabase.from('shifts_fixed').select('*').gte('date', startDate).lte('date', endDate),
      supabase.from('wage_history').select('*'),
    ]).then(([sR, shR, wR]) => {
      if (cancelled) return
      if (sR.error) console.error('staffs取得失敗:', sR.error.message)
      else setStaffs(sR.data || [])
      if (shR.error) console.error('shifts_fixed取得失敗:', shR.error.message)
      else setShifts(shR.data || [])
      if (wR.error) console.error('wage_history取得失敗:', wR.error.message)
      else setWageHistories(wR.data || [])
      setLoading(false)
    })
    return () => { cancelled = true }
  }, [month])

  if (loading) return (
    <div className="space-y-3">
      <div className="skeleton h-16 w-full" />
      <div className="skeleton h-40 w-full" />
    </div>
  )

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
    <div className="space-y-3 animate-fade-in">
      {/* Total summary card */}
      <div className="rounded-xl bg-gradient-to-br from-emerald-50 to-teal-50/50 p-4 ring-1 ring-emerald-100/50">
        <div className="flex items-center gap-2 mb-1">
          <div className="w-6 h-6 rounded-lg bg-emerald-500/10 flex items-center justify-center">
            <DollarSign className="h-3.5 w-3.5 text-emerald-600" />
          </div>
          <span className="text-xs text-emerald-700/70 font-medium">アルバイト・長期人件費合計</span>
        </div>
        <p className="text-2xl font-extrabold text-emerald-900 tabular-nums">
          ¥{Math.round(total).toLocaleString()}
        </p>
        <p className="text-[10px] text-emerald-600/60 mt-1">確定シフトをもとに算出（時給変更履歴対応）</p>
      </div>

      {/* Staff breakdown */}
      <div className="rounded-xl bg-white ring-1 ring-border/40 overflow-hidden">
        <div className="px-3 py-2.5 border-b border-border/30">
          <h3 className="text-xs font-bold text-muted-foreground uppercase tracking-wider">スタッフ別内訳</h3>
        </div>
        <div className="divide-y divide-border/30">
          {staffWages.map(({ staff, count, hours, wage }, i) => (
            <div
              key={staff.id}
              className={`flex items-center justify-between px-3 py-2.5 animate-slide-up ${staff.deleted_at ? 'opacity-40' : ''}`}
              style={{ animationDelay: `${i * 30}ms` }}
            >
              <div>
                <p className="text-[13px] font-semibold">
                  {staff.name}
                  {staff.deleted_at && <span className="ml-1 text-[10px] text-muted-foreground">(退職)</span>}
                </p>
                <p className="text-[10px] text-muted-foreground mt-0.5">
                  {count}シフト / {hours.toFixed(1)}h / ¥{(getWageForDate(wageHistories, staff.id, `${month}-01`) ?? staff.wage).toLocaleString()}/h
                </p>
              </div>
              <span className="text-sm font-bold tabular-nums">¥{Math.round(wage).toLocaleString()}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

/* ── スタッフ管理タブ ── */
function StaffManagementTab() {
  const [staffs, setStaffs] = useState<Staff[]>([])
  const [wageHistories, setWageHistories] = useState<WageHistory[]>([])
  const [newName, setNewName] = useState('')
  const [newType, setNewType] = useState('アルバイト')
  const [newWage, setNewWage] = useState('')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [editingWage, setEditingWage] = useState<{ staffId: number; wage: string; effectiveFrom: string } | null>(null)
  // handleSoftDelete/handleToggleType は saving ガードがないため複数の fetchData が並走する可能性がある
  // fetchVersionRef で古い fetch 結果が新しい fetch 結果を上書きしないよう管理する
  const fetchVersionRef = useRef(0)

  const fetchData = useCallback(async () => {
    const version = ++fetchVersionRef.current
    const [sR, wR] = await Promise.all([
      supabase.from('staffs').select('*').is('deleted_at', null).order('id'),
      supabase.from('wage_history').select('*').order('effective_from', { ascending: false }),
    ])
    if (fetchVersionRef.current !== version) return
    if (sR.error) console.error('staffs取得失敗:', sR.error.message)
    else setStaffs(sR.data || [])
    if (wR.error) console.error('wage_history取得失敗:', wR.error.message)
    else setWageHistories(wR.data || [])
    setLoading(false)
  }, [])

  useEffect(() => { fetchData() }, [fetchData])

  const handleAddStaff = async () => {
    if (!newName.trim() || saving) return
    const wageNum = parseInt(newWage) || 0
    // ランダムなトークンを生成（日本語名でも安全に使えるよう英数字6文字）
    const token = Math.random().toString(36).slice(2, 8)

    setSaving(true)
    try {
      const { data: inserted, error: insErr } = await supabase.from('staffs').insert({
        name: newName.trim(), token, employment_type: newType, wage: wageNum, is_active: true, shop_id: 1,
      }).select()
      if (insErr) throw new Error('スタッフ登録エラー: ' + insErr.message)

      if (wageNum > 0 && inserted?.[0]) {
        const { error: wageErr } = await supabase.from('wage_history').insert({
          staff_id: inserted[0].id, wage: wageNum, effective_from: fmtDate(new Date()),
        })
        if (wageErr) throw new Error('時給履歴登録エラー: ' + wageErr.message)
      }
      setNewName(''); setNewWage('')
      fetchData()
    } catch (e: any) {
      alert('スタッフ追加に失敗しました: ' + (e.message || ''))
      // 失敗後もDB実態に合わせてUIを更新する
      fetchData()
    } finally {
      setSaving(false)
    }
  }

  const handleSoftDelete = async (s: Staff) => {
    if (s.name === 'いっさ') return
    if (!confirm(`${s.name}を削除しますか？\n過去の給与データは保持されます。`)) return
    const { error } = await supabase.from('staffs').update({ deleted_at: new Date().toISOString(), is_active: false }).eq('id', s.id)
    if (error) { alert('削除に失敗しました: ' + error.message); return }
    fetchData()
  }

  const handleWageChange = async () => {
    if (!editingWage || saving) return
    const nw = parseInt(editingWage.wage)
    if (!nw || !editingWage.effectiveFrom) return

    const [ey, em, ed] = editingWage.effectiveFrom.split('-').map(Number)
    const prev = new Date(ey, em - 1, ed - 1)
    setSaving(true)
    try {
      const latest = wageHistories.find(w => w.staff_id === editingWage.staffId && !w.effective_to)
      if (latest) {
        const { error: updErr } = await supabase.from('wage_history').update({ effective_to: fmtDate(prev) }).eq('id', latest.id)
        if (updErr) throw new Error('履歴更新エラー: ' + updErr.message)
      }
      const { error: insErr } = await supabase.from('wage_history').insert({ staff_id: editingWage.staffId, wage: nw, effective_from: editingWage.effectiveFrom })
      if (insErr) throw new Error('履歴追加エラー: ' + insErr.message)
      const { error: wageErr } = await supabase.from('staffs').update({ wage: nw }).eq('id', editingWage.staffId)
      if (wageErr) throw new Error('時給更新エラー: ' + wageErr.message)
      setEditingWage(null)
      fetchData()
    } catch (e: any) {
      alert('時給変更に失敗しました: ' + (e.message || ''))
      // 失敗後もDB実態に合わせてUIを更新する
      fetchData()
    } finally {
      setSaving(false)
    }
  }

  const handleToggleType = async (s: Staff, t: string) => {
    const { error } = await supabase.from('staffs').update({ employment_type: t }).eq('id', s.id)
    if (error) { alert('雇用形態の変更に失敗しました: ' + error.message); return }
    fetchData()
  }

  if (loading) return (
    <div className="space-y-3">
      <div className="skeleton h-32 w-full" />
      <div className="skeleton h-48 w-full" />
    </div>
  )

  const typeColors: Record<string, string> = {
    'アルバイト': 'bg-blue-100/80 text-blue-700',
    '社員': 'bg-zinc-200/60 text-zinc-600',
    '役員': 'bg-amber-100/80 text-amber-700',
    '長期': 'bg-purple-100/80 text-purple-700',
    'システム管理者': 'bg-sky-100/80 text-sky-700',
  }

  return (
    <div className="space-y-3 animate-fade-in">
      {/* Add staff form */}
      <div className="rounded-xl bg-gradient-to-br from-blue-50 to-indigo-50/50 p-4 ring-1 ring-blue-100/50">
        <div className="flex items-center gap-2 mb-3">
          <div className="w-6 h-6 rounded-lg bg-blue-500/10 flex items-center justify-center">
            <Plus className="h-3.5 w-3.5 text-blue-600" />
          </div>
          <span className="text-xs font-bold text-blue-900">新規スタッフ登録</span>
        </div>
        <div className="space-y-2">
          <Input placeholder="名前" value={newName} onChange={e => setNewName(e.target.value)} className="bg-white/80 border-blue-200/50 text-sm h-9" />
          <div className="flex gap-2">
            <select
              value={newType}
              onChange={e => { setNewType(e.target.value); if (e.target.value !== 'アルバイト' && e.target.value !== '長期') setNewWage('') }}
              className="flex-1 h-9 rounded-lg border border-blue-200/50 bg-white/80 px-3 text-sm"
            >
              <option value="アルバイト">アルバイト</option>
              <option value="長期">長期</option>
              <option value="社員">社員</option>
              <option value="役員">役員</option>
              <option value="システム管理者">システム管理者</option>
            </select>
            {(newType === 'アルバイト' || newType === '長期') && (
              <Input placeholder="時給" type="number" value={newWage} onChange={e => setNewWage(e.target.value)} className="w-24 bg-white/80 border-blue-200/50 text-sm h-9" />
            )}
          </div>
          <button
            onClick={handleAddStaff}
            disabled={!newName.trim() || saving}
            className="w-full h-9 rounded-lg bg-blue-600 text-white text-xs font-bold transition-all hover:bg-blue-700 disabled:opacity-40 disabled:cursor-not-allowed press-effect"
          >
            登録
          </button>
        </div>
      </div>

      {/* Staff list */}
      <div className="rounded-xl bg-white ring-1 ring-border/40 overflow-hidden">
        <div className="px-3 py-2.5 border-b border-border/30 flex items-center justify-between">
          <h3 className="text-xs font-bold text-muted-foreground uppercase tracking-wider">スタッフ一覧</h3>
          <span className="text-[10px] px-2 py-0.5 rounded-full bg-muted text-muted-foreground font-medium">{staffs.length}名</span>
        </div>
        <div className="divide-y divide-border/30">
          {staffs.map((s, i) => {
            const hist = wageHistories.filter(w => w.staff_id === s.id)
            return (
              <div key={s.id} className="px-3 py-2.5 animate-slide-up" style={{ animationDelay: `${i * 25}ms` }}>
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2 min-w-0">
                    <span className="text-[13px] font-semibold truncate">{s.name}</span>
                    <span className={`text-[9px] px-1.5 py-0.5 rounded-md font-medium shrink-0 ${typeColors[s.employment_type] || 'bg-gray-100 text-gray-600'}`}>
                      {s.employment_type}
                    </span>
                    {(s.employment_type === 'アルバイト' || s.employment_type === '長期') && s.wage > 0 && (
                      <span className="text-[10px] text-muted-foreground shrink-0 tabular-nums">¥{s.wage.toLocaleString()}/h</span>
                    )}
                  </div>
                  <div className="flex items-center gap-1 shrink-0 ml-2">
                    {(s.employment_type === 'アルバイト' || s.employment_type === '長期') && (
                      <>
                        <button
                          onClick={() => handleToggleType(s, '社員')}
                          className="text-[10px] px-2 py-1 rounded-lg bg-muted/60 text-muted-foreground hover:bg-muted transition-colors press-effect"
                        >
                          →社員
                        </button>
                        <button
                          onClick={() => setEditingWage({ staffId: s.id, wage: String(s.wage), effectiveFrom: fmtDate(new Date()) })}
                          className="text-[10px] px-2 py-1 rounded-lg bg-muted/60 text-muted-foreground hover:bg-muted transition-colors press-effect"
                        >
                          時給変更
                        </button>
                      </>
                    )}
                    {s.name !== 'いっさ' && (
                      <button
                        onClick={() => handleSoftDelete(s)}
                        className="text-[10px] px-2 py-1 rounded-lg text-red-400 hover:bg-red-50 hover:text-red-600 transition-colors press-effect"
                      >
                        削除
                      </button>
                    )}
                  </div>
                </div>
                {(s.employment_type === 'アルバイト' || s.employment_type === '長期') && hist.length > 0 && (
                  <div className="mt-1.5 ml-1 space-y-0.5">
                    {hist.slice(0, 3).map(h => (
                      <p key={h.id} className="text-[10px] text-muted-foreground/70 tabular-nums">
                        {h.effective_from} ~ {h.effective_to || '現在'}: ¥{h.wage.toLocaleString()}
                      </p>
                    ))}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      </div>

      {/* Wage edit modal */}
      {editingWage && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm" onClick={() => setEditingWage(null)}>
          <div className="bg-white rounded-2xl p-5 w-80 shadow-2xl ring-1 ring-border/20 animate-slide-up" onClick={e => e.stopPropagation()}>
            <h3 className="text-sm font-bold mb-4">時給変更</h3>
            <div className="space-y-3">
              <div>
                <label className="text-[10px] text-muted-foreground font-medium uppercase tracking-wider">新しい時給</label>
                <Input type="number" value={editingWage.wage} onChange={e => setEditingWage({ ...editingWage, wage: e.target.value })} className="mt-1" />
              </div>
              <div>
                <label className="text-[10px] text-muted-foreground font-medium uppercase tracking-wider">適用開始日</label>
                <Input type="date" value={editingWage.effectiveFrom} onChange={e => setEditingWage({ ...editingWage, effectiveFrom: e.target.value })} className="mt-1" />
              </div>
              <div className="flex gap-2 pt-1">
                <button onClick={() => setEditingWage(null)} className="flex-1 h-9 rounded-lg border border-border text-sm font-medium hover:bg-muted/50 transition-colors press-effect">
                  キャンセル
                </button>
                <button onClick={handleWageChange} disabled={saving} className="flex-1 h-9 rounded-lg bg-foreground text-background text-sm font-medium hover:opacity-90 transition-opacity disabled:opacity-40 disabled:cursor-not-allowed press-effect">
                  保存
                </button>
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
    let cancelled = false
    // 月切替時に古いデータが一瞬表示されないよう即座にローディング状態にリセット
    setLoading(true)
    const [y, m] = month.split('-').map(Number)
    const start = `${month}-01`
    const end = `${y}-${String(m).padStart(2, '0')}-${new Date(y, m, 0).getDate()}`
    Promise.all([
      supabase.from('shift_config').select('*'),
      supabase.from('shifts_fixed').select('*').gte('date', start).lte('date', end),
      supabase.from('shops').select('*'),
      supabase.from('closed_dates').select('*').gte('date', start).lte('date', end),
    ]).then(([cR, sR, shR, cdR]) => {
      if (cancelled) return
      if (cR.error) console.error('shift_config取得失敗:', cR.error.message)
      else setConfigs(cR.data || [])
      if (sR.error) console.error('shifts_fixed取得失敗:', sR.error.message)
      else setShifts(sR.data || [])
      if (shR.error) console.error('shops取得失敗:', shR.error.message)
      else setShops(shR.data || [])
      if (cdR.error) console.error('closed_dates取得失敗:', cdR.error.message)
      else setClosedDates(cdR.data || [])
      setLoading(false)
    })
    return () => { cancelled = true }
  }, [month])

  if (loading) return (
    <div className="space-y-3">
      <div className="skeleton h-32 w-full" />
      <div className="skeleton h-32 w-full" />
    </div>
  )

  const [y, m] = month.split('-').map(Number)
  const days = new Date(y, m, 0).getDate()
  const dates = Array.from({ length: days }, (_, i) => fmtDate(new Date(y, m - 1, i + 1)))

  const shopData = shops.map(shop => {
    const sc = configs.filter(c => c.shop_id === shop.id)
    let req = 0, fill = 0
    const shortages: { date: string; type: string; required: number; actual: number }[] = []
    dates.forEach(date => {
      if (closedDates.some(cd => cd.date === date && (!cd.shop_id || cd.shop_id === shop.id))) return
      sc.forEach(c => {
        const r = c.required_count
        const a = shifts.filter(s => s.date === date && s.shop_id === shop.id && s.type === c.type).length
        req += r; fill += Math.min(a, r)
        if (a < r) shortages.push({ date, type: c.type, required: r, actual: a })
      })
    })
    return { shop, rate: req > 0 ? (fill / req) * 100 : 100, req, fill, shortages }
  })

  const rateColor = (rate: number) => rate >= 90 ? 'emerald' : rate >= 70 ? 'amber' : 'red'

  return (
    <div className="space-y-3 animate-fade-in">
      {shopData.map(({ shop, rate, req, fill, shortages }, i) => {
        const color = rateColor(rate)
        return (
          <div
            key={shop.id}
            className={`rounded-xl p-4 ring-1 animate-slide-up ${
              color === 'emerald' ? 'bg-gradient-to-br from-emerald-50 to-green-50/50 ring-emerald-100/50' :
              color === 'amber' ? 'bg-gradient-to-br from-amber-50 to-yellow-50/50 ring-amber-100/50' :
              'bg-gradient-to-br from-red-50 to-rose-50/50 ring-red-100/50'
            }`}
            style={{ animationDelay: `${i * 80}ms` }}
          >
            <div className="flex items-center justify-between mb-3">
              <span className="text-sm font-bold">{shop.name}</span>
              <span className={`text-xl font-extrabold tabular-nums ${
                color === 'emerald' ? 'text-emerald-700' : color === 'amber' ? 'text-amber-700' : 'text-red-700'
              }`}>
                {rate.toFixed(0)}%
              </span>
            </div>

            {/* Progress bar */}
            <div className="w-full bg-white/60 rounded-full h-2 mb-2">
              <div
                className={`h-2 rounded-full transition-all duration-500 ${
                  color === 'emerald' ? 'bg-emerald-500' : color === 'amber' ? 'bg-amber-500' : 'bg-red-500'
                }`}
                style={{ width: `${Math.min(rate, 100)}%` }}
              />
            </div>
            <p className="text-[10px] text-muted-foreground mb-2 tabular-nums">必要枠 {req} / 充足 {fill}</p>

            {shortages.length > 0 ? (
              <div>
                <p className={`text-[11px] font-medium flex items-center gap-1 ${
                  color === 'red' ? 'text-red-600' : 'text-amber-600'
                }`}>
                  <AlertTriangle className="h-3 w-3" />
                  人員不足（{shortages.length}件）
                </p>
                <div className="max-h-28 overflow-y-auto space-y-0.5 mt-1">
                  {shortages.slice(0, 8).map((s) => (
                    <p key={`${s.date}-${s.type}`} className="text-[10px] text-muted-foreground pl-4 tabular-nums">
                      {s.date} {s.type}: {s.actual}/{s.required}名
                    </p>
                  ))}
                  {shortages.length > 8 && (
                    <p className="text-[10px] text-muted-foreground/60 pl-4">...他{shortages.length - 8}件</p>
                  )}
                </div>
              </div>
            ) : (
              <p className={`text-[11px] font-medium flex items-center gap-1 ${
                color === 'emerald' ? 'text-emerald-600' : ''
              }`}>
                <CheckCircle className="h-3 w-3" />全日充足
              </p>
            )}
          </div>
        )
      })}
    </div>
  )
}

/* ── 臨時休業日管理 ── */
function ClosedDatesTab() {
  const [closedDates, setClosedDates] = useState<ClosedDate[]>([])
  const [shops, setShops] = useState<Shop[]>([])
  const [newDate, setNewDate] = useState(fmtDate(new Date()))
  const [newShopId, setNewShopId] = useState('')
  const [newNote, setNewNote] = useState('')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  // handleDel は saving ガードがないため複数の fetch_ が並走する可能性がある
  // fetchVersionRef で古い fetch 結果が新しい fetch 結果を上書きしないよう管理する
  const fetchVersionRef = useRef(0)

  const fetch_ = useCallback(async () => {
    const version = ++fetchVersionRef.current
    const [cR, sR] = await Promise.all([
      supabase.from('closed_dates').select('*').order('date', { ascending: false }),
      supabase.from('shops').select('*'),
    ])
    if (fetchVersionRef.current !== version) return
    if (cR.error) console.error('closed_dates取得失敗:', cR.error.message)
    else setClosedDates(cR.data || [])
    if (sR.error) console.error('shops取得失敗:', sR.error.message)
    else setShops(sR.data || [])
    setLoading(false)
  }, [])

  useEffect(() => { fetch_() }, [fetch_])

  const handleAdd = async () => {
    if (!newDate || saving) return
    setSaving(true)
    const { error } = await supabase.from('closed_dates').insert({ date: newDate, shop_id: newShopId ? parseInt(newShopId) : null, note: newNote })
    if (error) { alert('休業日追加に失敗しました: ' + error.message); setSaving(false); return }
    setNewDate(fmtDate(new Date())); setNewNote(''); setNewShopId('')
    setSaving(false)
    fetch_()
  }

  const handleDel = async (id: number) => {
    const { error } = await supabase.from('closed_dates').delete().eq('id', id)
    if (error) { alert('休業日削除に失敗しました: ' + error.message); return }
    fetch_()
  }

  if (loading) return (
    <div className="space-y-3">
      <div className="skeleton h-40 w-full" />
    </div>
  )

  const today = fmtDate(new Date())
  const upcoming = closedDates.filter(cd => cd.date >= today)
  const past = closedDates.filter(cd => cd.date < today)

  return (
    <div className="space-y-3 animate-fade-in">
      {/* Add form */}
      <div className="rounded-xl bg-gradient-to-br from-purple-50 to-fuchsia-50/50 p-4 ring-1 ring-purple-100/50">
        <div className="flex items-center gap-2 mb-3">
          <div className="w-6 h-6 rounded-lg bg-purple-500/10 flex items-center justify-center">
            <CalendarOff className="h-3.5 w-3.5 text-purple-600" />
          </div>
          <span className="text-xs font-bold text-purple-900">休業日を追加</span>
        </div>
        <div className="space-y-2">
          <Input type="date" value={newDate} onChange={e => setNewDate(e.target.value)} className="bg-white/80 border-purple-200/50 text-sm h-9" />
          <select
            value={newShopId}
            onChange={e => setNewShopId(e.target.value)}
            className="w-full h-9 rounded-lg border border-purple-200/50 bg-white/80 px-3 text-sm"
          >
            <option value="">全店舗</option>
            {shops.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
          <Input placeholder="備考（例：臨時休業）" value={newNote} onChange={e => setNewNote(e.target.value)} className="bg-white/80 border-purple-200/50 text-sm h-9" />
          <button
            onClick={handleAdd}
            disabled={!newDate || saving}
            className="w-full h-9 rounded-lg bg-purple-600 text-white text-xs font-bold transition-all hover:bg-purple-700 disabled:opacity-40 press-effect flex items-center justify-center gap-1.5"
          >
            <Plus className="h-3.5 w-3.5" />休業日を登録
          </button>
        </div>
      </div>

      {/* Upcoming */}
      {upcoming.length > 0 && (
        <div className="rounded-xl bg-white ring-1 ring-border/40 overflow-hidden">
          <div className="px-3 py-2.5 border-b border-border/30 flex items-center justify-between">
            <h3 className="text-xs font-bold text-muted-foreground uppercase tracking-wider">今後の休業日</h3>
            <span className="text-[10px] px-2 py-0.5 rounded-full bg-red-100/80 text-red-600 font-medium">{upcoming.length}件</span>
          </div>
          <div className="divide-y divide-border/30">
            {upcoming.map((cd, i) => (
              <div key={cd.id} className="flex items-center justify-between px-3 py-2.5 animate-slide-up" style={{ animationDelay: `${i * 30}ms` }}>
                <div>
                  <p className="text-[13px] font-semibold tabular-nums">{cd.date}</p>
                  <p className="text-[10px] text-muted-foreground mt-0.5">
                    {cd.shop_id ? shops.find(s => s.id === cd.shop_id)?.name : '全店舗'}
                    {cd.note ? ` - ${cd.note}` : ''}
                  </p>
                </div>
                <button
                  onClick={() => handleDel(cd.id)}
                  className="p-1.5 rounded-lg text-red-300 hover:text-red-500 hover:bg-red-50 transition-colors press-effect"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Past */}
      {past.length > 0 && (
        <div className="rounded-xl bg-white ring-1 ring-border/40 overflow-hidden opacity-60">
          <div className="px-3 py-2.5 border-b border-border/30">
            <h3 className="text-xs font-bold text-muted-foreground/60 uppercase tracking-wider">過去の休業日（{past.length}件）</h3>
          </div>
          <div className="px-3 py-2 space-y-0.5">
            {past.slice(0, 5).map(cd => (
              <p key={cd.id} className="text-[10px] text-muted-foreground/60 tabular-nums">
                {cd.date} - {cd.shop_id ? shops.find(s => s.id === cd.shop_id)?.name : '全店舗'}
                {cd.note ? ` (${cd.note})` : ''}
              </p>
            ))}
          </div>
        </div>
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
    let cancelled = false
    // 月切替時に古いデータが一瞬表示されないよう即座にローディング状態にリセット
    setLoading(true)
    const [y, m] = month.split('-').map(Number)
    const s = `${month}-01`, e = `${y}-${String(m).padStart(2, '0')}-${new Date(y, m, 0).getDate()}`
    Promise.all([
      supabase.from('staffs').select('*'),
      supabase.from('shifts_fixed').select('*').gte('date', s).lte('date', e),
      supabase.from('wage_history').select('*'),
      supabase.from('shops').select('*'),
    ]).then(([sR, shR, wR, spR]) => {
      if (cancelled) return
      if (sR.error) console.error('staffs取得失敗:', sR.error.message)
      else setStaffs(sR.data || [])
      if (shR.error) console.error('shifts_fixed取得失敗:', shR.error.message)
      else setShifts(shR.data || [])
      if (wR.error) console.error('wage_history取得失敗:', wR.error.message)
      else setWH(wR.data || [])
      if (spR.error) console.error('shops取得失敗:', spR.error.message)
      else setShops(spR.data || [])
      setLoading(false)
    })
    return () => { cancelled = true }
  }, [month])

  if (loading) return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-2">
        <div className="skeleton h-20" />
        <div className="skeleton h-20" />
        <div className="skeleton h-20" />
        <div className="skeleton h-20" />
      </div>
    </div>
  )

  const [y, m] = month.split('-').map(Number)
  const ml = `${y}年${m}月`
  const albeits = staffs.filter(s => s.employment_type === 'アルバイト' || s.employment_type === '長期')
  const totalShifts = shifts.length
  const uniqueDays = new Set(shifts.map(s => s.date)).size
  let totalWage = 0, totalHours = 0, nightH = 0

  albeits.forEach(s => {
    shifts.filter(sh => sh.staff_id === s.id).forEach(sh => {
      const w = getWageForDate(wH, s.id, sh.date) ?? s.wage
      totalWage += calcWage(sh.start_time, sh.end_time, w)
      totalHours += calcHours(sh.start_time, sh.end_time)
      const endStr = sh.end_time || '24:00'
      const [eH, eM] = endStr.split(':').map(Number)
      const [sH, sM] = sh.start_time.split(':').map(Number)
      const endMin = eH * 60 + eM
      const startMin = sH * 60 + sM
      const NIGHT = 22 * 60
      if (endMin > NIGHT) nightH += Math.max(0, endMin - Math.max(startMin, NIGHT)) / 60
    })
  })

  const avgH = totalShifts > 0 ? shifts.reduce((sum, s) => sum + calcHours(s.start_time, s.end_time), 0) / totalShifts : 0
  const shopStats = shops.map(sp => ({ name: sp.name, count: shifts.filter(s => s.shop_id === sp.id).length }))

  const statCards = [
    { label: '総シフト数', value: String(totalShifts), sub: `${uniqueDays}営業日`, color: 'from-blue-50 to-indigo-50/50', ring: 'ring-blue-100/50', textColor: 'text-blue-900', icon: Briefcase, iconColor: 'text-blue-600', iconBg: 'bg-blue-500/10' },
    { label: '人件費', value: `¥${Math.round(totalWage).toLocaleString()}`, sub: 'アルバイト・長期', color: 'from-emerald-50 to-teal-50/50', ring: 'ring-emerald-100/50', textColor: 'text-emerald-900', icon: DollarSign, iconColor: 'text-emerald-600', iconBg: 'bg-emerald-500/10' },
    { label: '総労働時間', value: `${totalHours.toFixed(1)}h`, sub: '', color: 'from-purple-50 to-fuchsia-50/50', ring: 'ring-purple-100/50', textColor: 'text-purple-900', icon: Clock, iconColor: 'text-purple-600', iconBg: 'bg-purple-500/10' },
    { label: '平均シフト', value: `${avgH.toFixed(1)}h`, sub: '', color: 'from-amber-50 to-orange-50/50', ring: 'ring-amber-100/50', textColor: 'text-amber-900', icon: TrendingUp, iconColor: 'text-amber-600', iconBg: 'bg-amber-500/10' },
  ]

  return (
    <div className="space-y-3 animate-fade-in">
      {/* Header */}
      <div className="flex items-center gap-2">
        <div className="w-6 h-6 rounded-lg bg-muted flex items-center justify-center">
          <FileText className="h-3.5 w-3.5 text-muted-foreground" />
        </div>
        <span className="text-xs font-bold text-muted-foreground">{ml} レポート</span>
      </div>

      {/* Stat cards grid */}
      <div className="grid grid-cols-2 gap-2">
        {statCards.map((card, i) => (
          <div
            key={card.label}
            className={`rounded-xl bg-gradient-to-br ${card.color} p-3 ring-1 ${card.ring} animate-slide-up`}
            style={{ animationDelay: `${i * 60}ms` }}
          >
            <div className="flex items-center gap-1 mb-2">
              <div className={`w-5 h-5 rounded-md ${card.iconBg} flex items-center justify-center`}>
                <card.icon className={`h-3 w-3 ${card.iconColor}`} />
              </div>
              <span className="text-[9px] font-medium opacity-70">{card.label}</span>
            </div>
            <p className={`text-base font-extrabold ${card.textColor} tabular-nums leading-none`}>
              {card.value}
            </p>
            {card.sub && <p className="text-[9px] opacity-50 mt-1">{card.sub}</p>}
          </div>
        ))}
      </div>

      {/* Shop breakdown */}
      <div className="rounded-xl bg-white ring-1 ring-border/40 overflow-hidden">
        <div className="px-3 py-2.5 border-b border-border/30">
          <h3 className="text-xs font-bold text-muted-foreground uppercase tracking-wider">店舗別シフト数</h3>
        </div>
        <div className="divide-y divide-border/30">
          {shopStats.map((s, i) => (
            <div key={s.name} className="flex justify-between items-center px-3 py-2.5 animate-slide-up" style={{ animationDelay: `${(i + 4) * 60}ms` }}>
              <span className="text-[13px] font-medium">{s.name}</span>
              <span className="text-sm font-bold tabular-nums">{s.count}<span className="text-[10px] font-medium text-muted-foreground ml-0.5">シフト</span></span>
            </div>
          ))}
        </div>
      </div>

      {/* Night premium */}
      <div className="rounded-xl bg-gradient-to-br from-amber-50 to-orange-50/50 p-3 ring-1 ring-amber-100/50 animate-slide-up" style={{ animationDelay: '360ms' }}>
        <div className="flex items-center gap-2">
          <div className="w-5 h-5 rounded-md bg-amber-500/10 flex items-center justify-center">
            <Clock className="h-3 w-3 text-amber-600" />
          </div>
          <div>
            <p className="text-[10px] text-amber-700/70 font-medium">深夜割増（22:00〜）</p>
            <p className="text-[13px] text-amber-900 font-bold tabular-nums">{nightH.toFixed(1)}時間 / 1.25倍</p>
          </div>
        </div>
      </div>
    </div>
  )
}

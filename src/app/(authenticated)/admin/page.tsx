'use client'

import { useState, useEffect, useCallback, useRef, useMemo } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabase'
import { getStoredStaff } from '@/lib/auth'
import { Staff, ShiftFixed, ShiftConfig, Shop, ShiftRequest } from '@/types/database'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { calcWage, calcHours, getSubmissionPeriod } from '@/lib/utils'
import { format, addDays, endOfMonth } from 'date-fns'
import { ja } from 'date-fns/locale'
import {
  BarChart2, Users, CalendarOff, TrendingUp, FileText,
  ChevronLeft, ChevronRight, ChevronDown, ChevronUp, Loader2, Plus,
  DollarSign, AlertTriangle, CheckCircle, X, Clock, Briefcase, RefreshCw,
  ClipboardList, XCircle, Trash2, RotateCcw, Gift
} from 'lucide-react'

type Tab = 'labor' | 'staff' | 'closed' | 'report' | 'submission' | 'bonus'

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
  const [isSystemAdmin, setIsSystemAdmin] = useState(false)
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
    setIsSystemAdmin(!!staff && staff.employment_type === 'システム管理者')
    setStaffLoaded(true)
    if (!authorized) router.replace('/home')
  }, [router])

  const tabs: { key: Tab; label: string; icon: React.ElementType }[] = [
    { key: 'submission', label: '提出状況', icon: ClipboardList },
    { key: 'labor', label: '人件費', icon: DollarSign },
    { key: 'staff', label: 'スタッフ', icon: Users },
    { key: 'closed', label: '休業日', icon: CalendarOff },
    { key: 'report', label: 'レポート', icon: FileText },
    ...(!isSystemAdmin ? [{ key: 'bonus' as Tab, label: 'ボーナス', icon: Gift }] : []),
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
      {['labor', 'report', 'bonus'].includes(tab) && (
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

      {tab === 'submission' && <SubmissionStatusTab />}
      {tab === 'labor' && <LaborCostTab month={month} />}
      {tab === 'staff' && <StaffManagementTab isSystemAdmin={isSystemAdmin} isAuthorized={isAuthorized} />}
      {tab === 'closed' && <ClosedDatesTab />}
      {tab === 'report' && <MonthlyReportTab month={month} />}
      {tab === 'bonus' && !isSystemAdmin && <BonusTab month={month} />}
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
      supabase.from('staffs').select('*').eq('employment_type', 'アルバイト'),
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
      const w = getWageForDate(wageHistories, s.id, sh.date.substring(0, 10)) ?? s.wage
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
          <span className="text-xs text-emerald-700/70 font-medium">アルバイト人件費合計</span>
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
function StaffManagementTab({ isSystemAdmin, isAuthorized }: { isSystemAdmin: boolean; isAuthorized: boolean }) {
  const [staffs, setStaffs] = useState<Staff[]>([])
  const [wageHistories, setWageHistories] = useState<WageHistory[]>([])
  const [newName, setNewName] = useState('')
  const [newType, setNewType] = useState('アルバイト')
  const [newWage, setNewWage] = useState('')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [editingWage, setEditingWage] = useState<{ staffId: number; wage: string; effectiveFrom: string } | null>(null)
  const [editingName, setEditingName] = useState<{ staffId: number; name: string } | null>(null)
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
    if (saving) return
    if (s.name === 'いっさ') return
    if (!confirm(`${s.name}を削除しますか？\n過去の給与データは保持されます。`)) return
    setSaving(true)
    try {
      const { error } = await supabase.from('staffs').update({ deleted_at: new Date().toISOString(), is_active: false }).eq('id', s.id)
      if (error) { alert('削除に失敗しました: ' + error.message); return }
      fetchData()
    } finally {
      setSaving(false)
    }
  }

  const handleWageChange = async () => {
    if (!editingWage || saving) return
    const nw = parseInt(editingWage.wage)
    if (isNaN(nw) || nw <= 0 || !editingWage.effectiveFrom) return

    const prevDate = new Date(editingWage.effectiveFrom + 'T00:00:00')
    prevDate.setDate(prevDate.getDate() - 1)
    setSaving(true)
    try {
      const latest = wageHistories.find(w => w.staff_id === editingWage.staffId && !w.effective_to)
      if (latest) {
        const { error: updErr } = await supabase.from('wage_history').update({ effective_to: fmtDate(prevDate) }).eq('id', latest.id)
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

  const handleNameChange = async () => {
    if (!editingName || saving) return
    const trimmed = editingName.name.trim()
    if (!trimmed) return
    setSaving(true)
    try {
      const { error } = await supabase.from('staffs').update({ name: trimmed }).eq('id', editingName.staffId)
      if (error) throw new Error('名前更新エラー: ' + error.message)
      setEditingName(null)
      fetchData()
    } catch (e: any) {
      alert('名前の変更に失敗しました: ' + (e.message || ''))
      fetchData()
    } finally {
      setSaving(false)
    }
  }

  const handleToggleType = async (s: Staff, t: string) => {
    if (saving) return
    setSaving(true)
    try {
      const { error } = await supabase.from('staffs').update({ employment_type: t }).eq('id', s.id)
      if (error) { alert('雇用形態の変更に失敗しました: ' + error.message); return }
      fetchData()
    } finally {
      setSaving(false)
    }
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
              onChange={e => { setNewType(e.target.value); if (e.target.value !== 'アルバイト') setNewWage('') }}
              className="flex-1 h-9 rounded-lg border border-blue-200/50 bg-white/80 px-3 text-sm"
            >
              <option value="アルバイト">アルバイト</option>
              <option value="社員">社員</option>
              <option value="役員">役員</option>
              <option value="システム管理者">システム管理者</option>
            </select>
            {newType === 'アルバイト' && (
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
          <div className="flex items-center gap-2">
            <span className="text-[10px] px-2 py-0.5 rounded-full bg-muted text-muted-foreground font-medium">{staffs.length}名</span>
            <button
              onClick={fetchData}
              className="p-1 rounded-lg text-muted-foreground/60 hover:text-foreground hover:bg-muted/60 transition-all press-effect"
              title="更新"
            >
              <RefreshCw className="h-3 w-3" />
            </button>
          </div>
        </div>
        <div className="divide-y divide-border/30">
          {staffs.map((s, i) => {
            const hist = wageHistories.filter(w => w.staff_id === s.id)
            return (
              <div key={s.id} className="px-3 py-2.5 animate-slide-up" style={{ animationDelay: `${i * 25}ms` }}>
                {/* 1行目: 名前・雇用形態・時給 */}
                <div className="flex items-center gap-2 min-w-0">
                  <span className="text-[13px] font-semibold truncate">{s.name}</span>
                  <span className={`text-[9px] px-1.5 py-0.5 rounded-md font-medium shrink-0 ${typeColors[s.employment_type] || 'bg-gray-100 text-gray-600'}`}>
                    {s.employment_type}
                  </span>
                  {s.employment_type === 'アルバイト' && s.wage > 0 && (
                    <span className="text-[10px] text-muted-foreground shrink-0 tabular-nums">¥{s.wage.toLocaleString()}/h</span>
                  )}
                </div>
                {/* 2行目: アクションボタン */}
                {(s.employment_type === 'アルバイト' || (isAuthorized && s.name !== 'いっさ') || s.name !== 'いっさ') && (
                  <div className="flex items-center gap-1 flex-wrap mt-1.5">
                    {s.employment_type === 'アルバイト' && (
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
                    {isAuthorized && s.name !== 'いっさ' && (
                      <button
                        onClick={() => setEditingName({ staffId: s.id, name: s.name })}
                        className="text-[10px] px-2 py-1 rounded-lg bg-muted/60 text-muted-foreground hover:bg-muted transition-colors press-effect"
                      >
                        名前変更
                      </button>
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
                )}
                {isAuthorized && (
                  <div className="mt-1 ml-1 flex items-center gap-1">
                    <span className="text-[9px] text-muted-foreground/50 uppercase tracking-wider">パスコード</span>
                    <span className="text-[10px] text-muted-foreground/70 font-mono tabular-nums">{s.token}</span>
                  </div>
                )}
                {s.employment_type === 'アルバイト' && hist.length > 0 && (
                  <div className="mt-0.5 ml-1 space-y-0.5">
                    {hist.slice(0, 2).map(h => (
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

      {/* Name edit modal */}
      {editingName && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm" onClick={() => setEditingName(null)}>
          <div className="bg-white rounded-2xl p-5 w-80 shadow-2xl ring-1 ring-border/20 animate-slide-up" onClick={e => e.stopPropagation()}>
            <h3 className="text-sm font-bold mb-4">名前変更</h3>
            <div className="space-y-3">
              <div>
                <label className="text-[10px] text-muted-foreground font-medium uppercase tracking-wider">新しい名前</label>
                <Input
                  value={editingName.name}
                  onChange={e => setEditingName({ ...editingName, name: e.target.value })}
                  className="mt-1"
                  autoFocus
                />
              </div>
              <div className="flex gap-2 pt-1">
                <button onClick={() => setEditingName(null)} className="flex-1 h-9 rounded-lg border border-border text-sm font-medium hover:bg-muted/50 transition-colors press-effect">
                  キャンセル
                </button>
                <button onClick={handleNameChange} disabled={saving || !editingName.name.trim()} className="flex-1 h-9 rounded-lg bg-foreground text-background text-sm font-medium hover:opacity-90 transition-opacity disabled:opacity-40 disabled:cursor-not-allowed press-effect">
                  保存
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

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
      if (closedDates.some(cd => cd.date.substring(0, 10) === date && (!cd.shop_id || cd.shop_id === shop.id))) return
      sc.forEach(c => {
        const r = c.required_count
        const a = shifts.filter(s => s.date.substring(0, 10) === date && s.shop_id === shop.id && s.type === c.type).length
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
    try {
      const { error } = await supabase.from('closed_dates').insert({ date: newDate, shop_id: newShopId ? parseInt(newShopId) : null, note: newNote })
      if (error) { alert('休業日追加に失敗しました: ' + error.message); return }
      setNewDate(fmtDate(new Date())); setNewNote(''); setNewShopId('')
      fetch_()
    } finally {
      setSaving(false)
    }
  }

  const handleDel = async (id: number) => {
    if (saving) return
    setSaving(true)
    try {
      const { error } = await supabase.from('closed_dates').delete().eq('id', id)
      if (error) { alert('休業日削除に失敗しました: ' + error.message); return }
      fetch_()
    } finally {
      setSaving(false)
    }
  }

  if (loading) return (
    <div className="space-y-3">
      <div className="skeleton h-40 w-full" />
    </div>
  )

  const today = fmtDate(new Date())
  const upcoming = closedDates.filter(cd => cd.date.substring(0, 10) >= today)
  const past = closedDates.filter(cd => cd.date.substring(0, 10) < today)

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
  const albeits = staffs.filter(s => s.employment_type === 'アルバイト')
  const totalShifts = shifts.length
  const uniqueDays = new Set(shifts.map(s => s.date.substring(0, 10))).size
  let totalWage = 0, totalHours = 0, nightH = 0

  albeits.forEach(s => {
    shifts.filter(sh => sh.staff_id === s.id).forEach(sh => {
      const w = getWageForDate(wH, s.id, sh.date.substring(0, 10)) ?? s.wage
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

  const avgH = totalShifts > 0 ? Math.round(shifts.reduce((sum, s) => sum + calcHours(s.start_time, s.end_time), 0) / totalShifts * 10) / 10 : 0
  const shopStats = shops.map(sp => ({ name: sp.name, count: shifts.filter(s => s.shop_id === sp.id).length }))

  const statCards = [
    { label: '総シフト数', value: String(totalShifts), sub: `${uniqueDays}営業日`, color: 'from-blue-50 to-indigo-50/50', ring: 'ring-blue-100/50', textColor: 'text-blue-900', icon: Briefcase, iconColor: 'text-blue-600', iconBg: 'bg-blue-500/10' },
    { label: '人件費', value: `¥${Math.round(totalWage).toLocaleString()}`, sub: 'アルバイト', color: 'from-emerald-50 to-teal-50/50', ring: 'ring-emerald-100/50', textColor: 'text-emerald-900', icon: DollarSign, iconColor: 'text-emerald-600', iconBg: 'bg-emerald-500/10' },
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

/* ── 提出状況タブ ── */
function SubmissionStatusTab() {
  const [staffs, setStaffs] = useState<Staff[]>([])
  const [requests, setRequests] = useState<ShiftRequest[]>([])
  const [submittedFullIds, setSubmittedFullIds] = useState<Set<number>>(new Set())
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [periodOffset, setPeriodOffset] = useState(0)
  const [expandedStaffId, setExpandedStaffId] = useState<number | null>(null)
  const [operating, setOperating] = useState<number | null>(null)

  const selectedPeriod = useMemo(() => {
    const base = getSubmissionPeriod(new Date())
    let start = new Date(base.start)
    let end = new Date(base.end)
    for (let i = 0; i < Math.abs(periodOffset); i++) {
      if (periodOffset < 0) {
        const prevEnd = addDays(start, -1)
        end = prevEnd
        start = prevEnd.getDate() > 15
          ? new Date(prevEnd.getFullYear(), prevEnd.getMonth(), 16)
          : new Date(prevEnd.getFullYear(), prevEnd.getMonth(), 1)
      } else {
        const nextStart = addDays(end, 1)
        start = nextStart
        end = nextStart.getDate() === 1
          ? new Date(nextStart.getFullYear(), nextStart.getMonth(), 15)
          : endOfMonth(nextStart)
      }
    }
    const isFirstHalf = start.getDate() <= 15
    const m = start.getMonth() + 1
    const y = start.getFullYear()
    const deadline = isFirstHalf
      ? new Date(start.getFullYear(), start.getMonth() - 1, 20)
      : new Date(start.getFullYear(), start.getMonth(), 5)
    return {
      start, end, deadline,
      label: `${y}年${m}月${isFirstHalf ? '前半' : '後半'}`,
      isCurrent: periodOffset === 0,
    }
  }, [periodOffset])

  const periodStart = format(selectedPeriod.start, 'yyyy-MM-dd')
  const periodEnd   = format(selectedPeriod.end,   'yyyy-MM-dd')

  const load = useCallback(async (isRefresh = false) => {
    if (isRefresh) setRefreshing(true)
    else setLoading(true)
    const [staffRes, reqRes, fullReqs] = await Promise.all([
      supabase.from('staffs').select('*').eq('is_active', true).neq('employment_type', 'システム管理者').order('name'),
      supabase.from('shift_requests').select('*').gte('date', periodStart).lte('date', periodEnd).order('date', { ascending: true }),
      supabase.from('off_requests').select('staff_id').gte('date', periodStart).lte('date', periodEnd),
    ])
    setStaffs(staffRes.data || [])
    setRequests(reqRes.data || [])
    setSubmittedFullIds(new Set((fullReqs.data || []).map((r: any) => r.staff_id)))
    if (isRefresh) setRefreshing(false)
    else setLoading(false)
  }, [periodStart, periodEnd])

  useEffect(() => { load() }, [load])
  // 期間切替時に展開を閉じる
  useEffect(() => { setExpandedStaffId(null) }, [periodStart, periodEnd])

  const requestsByStaff = useMemo(() => {
    const map = new Map<number, ShiftRequest[]>()
    for (const r of requests) {
      if (!map.has(r.staff_id)) map.set(r.staff_id, [])
      map.get(r.staff_id)!.push(r)
    }
    return map
  }, [requests])

  const handleDelete = async (requestId: number) => {
    if (operating !== null) return
    setOperating(requestId)
    const { error } = await supabase.from('shift_requests').update({ status: 'deleted' }).eq('id', requestId)
    if (error) console.error('削除失敗:', error.message)
    else setRequests(prev => prev.map(r => r.id === requestId ? { ...r, status: 'deleted' as const } : r))
    setOperating(null)
  }

  const handleRestore = async (requestId: number) => {
    if (operating !== null) return
    setOperating(requestId)
    const { error } = await supabase.from('shift_requests').update({ status: 'pending' }).eq('id', requestId)
    if (error) console.error('復元失敗:', error.message)
    else setRequests(prev => prev.map(r => r.id === requestId ? { ...r, status: 'pending' as const } : r))
    setOperating(null)
  }

  const partTimers = staffs.filter(s => s.employment_type === 'アルバイト')
  const fullTimers = staffs.filter(s => s.employment_type === '社員' || s.employment_type === '役員')

  // 有効なリクエスト（deleted以外）が1件以上ある → 提出済み
  // リクエストが存在するが全てdeleted → 削除済み
  // リクエスト0件 → 未提出
  const partSubmitted    = partTimers.filter(s => (requestsByStaff.get(s.id) || []).some(r => r.status !== 'deleted'))
  const partAllDeleted   = partTimers.filter(s => { const rs = requestsByStaff.get(s.id) || []; return rs.length > 0 && rs.every(r => r.status === 'deleted') })
  const partNotSubmitted = partTimers.filter(s => (requestsByStaff.get(s.id) || []).length === 0)

  const DOW = ['日', '月', '火', '水', '木', '金', '土']
  function fmtDateLabel(dateStr: string) {
    const d = new Date(dateStr.substring(0, 10) + 'T00:00:00')
    return `${d.getMonth() + 1}/${d.getDate()}(${DOW[d.getDay()]})`
  }

  function renderPartRow(s: Staff, statusType: 'submitted' | 'allDeleted') {
    const reqs = (requestsByStaff.get(s.id) || []).slice().sort((a, b) => a.date.localeCompare(b.date))
    const isExpanded = expandedStaffId === s.id
    const activeCount = reqs.filter(r => r.status !== 'deleted').length
    const deletedCount = reqs.filter(r => r.status === 'deleted').length
    return (
      <div key={s.id}>
        <div
          className={`flex items-center justify-between px-3 py-2.5 cursor-pointer select-none transition-colors ${isExpanded ? 'bg-muted/20' : 'hover:bg-muted/10'}`}
          onClick={() => setExpandedStaffId(isExpanded ? null : s.id)}
        >
          <div className="flex items-center gap-2 flex-1 min-w-0">
            <span className="text-sm font-medium truncate">{s.name}</span>
            {activeCount > 0 && (
              <span className="text-[10px] bg-emerald-100 text-emerald-700 px-1.5 py-0.5 rounded-full font-medium shrink-0">
                {activeCount}日
              </span>
            )}
            {deletedCount > 0 && (
              <span className="text-[10px] bg-gray-100 text-gray-500 px-1.5 py-0.5 rounded-full font-medium shrink-0">
                削除済み{deletedCount}件
              </span>
            )}
          </div>
          <div className="flex items-center gap-1.5 shrink-0 ml-2">
            {statusType === 'submitted'
              ? <span className="flex items-center gap-1 text-xs font-semibold text-emerald-700"><CheckCircle className="h-3.5 w-3.5" />提出済み</span>
              : <span className="flex items-center gap-1 text-xs font-semibold text-gray-500"><XCircle className="h-3.5 w-3.5" />削除済み</span>
            }
            {isExpanded ? <ChevronUp className="h-3.5 w-3.5 text-muted-foreground" /> : <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />}
          </div>
        </div>

        {isExpanded && (
          <div className="border-t border-border/30 bg-muted/10 px-3 py-2 space-y-1.5">
            {reqs.length === 0 && (
              <p className="text-xs text-muted-foreground py-1">申請データがありません</p>
            )}
            {reqs.map(req => (
              <div
                key={req.id}
                className={`flex items-center justify-between py-1.5 px-2.5 rounded-lg text-sm ${req.status === 'deleted' ? 'bg-gray-50 opacity-60' : 'bg-white ring-1 ring-border/40'}`}
              >
                <div className="flex items-center gap-2">
                  <span className="text-xs font-semibold text-muted-foreground w-16 shrink-0">
                    {fmtDateLabel(req.date)}
                  </span>
                  <span className="text-xs font-medium">
                    {req.start_time.substring(0, 5)}〜{req.end_time.substring(0, 5)}
                  </span>
                  {req.status === 'deleted' && (
                    <span className="text-[10px] bg-gray-200 text-gray-500 px-1.5 py-0.5 rounded font-medium">削除済み</span>
                  )}
                </div>
                <div>
                  {req.status === 'deleted' ? (
                    <button
                      onClick={e => { e.stopPropagation(); handleRestore(req.id) }}
                      disabled={operating !== null}
                      className="flex items-center gap-1 text-[11px] text-blue-600 hover:text-blue-800 font-medium disabled:opacity-40 transition-colors"
                    >
                      {operating === req.id ? <Loader2 className="h-3 w-3 animate-spin" /> : <RotateCcw className="h-3 w-3" />}
                      復元
                    </button>
                  ) : (
                    <button
                      onClick={e => { e.stopPropagation(); handleDelete(req.id) }}
                      disabled={operating !== null}
                      className="flex items-center gap-1 text-[11px] text-red-500 hover:text-red-700 font-medium disabled:opacity-40 transition-colors"
                    >
                      {operating === req.id ? <Loader2 className="h-3 w-3 animate-spin" /> : <Trash2 className="h-3 w-3" />}
                      削除
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    )
  }

  return (
    <div className="space-y-4">
      {/* 期間ナビゲーター */}
      <div className="flex items-center gap-2">
        <button
          onClick={() => setPeriodOffset(o => o - 1)}
          className="p-2 rounded-xl bg-muted/40 hover:bg-muted/70 transition-colors"
        >
          <ChevronLeft className="h-4 w-4" />
        </button>
        <div className={`flex-1 rounded-2xl px-4 py-3 border ${selectedPeriod.isCurrent ? 'bg-indigo-50 border-indigo-200' : 'bg-muted/30 border-border'}`}>
          <p className={`text-[10px] font-semibold uppercase tracking-wider mb-0.5 ${selectedPeriod.isCurrent ? 'text-indigo-500' : 'text-muted-foreground'}`}>
            {selectedPeriod.isCurrent ? '次回シフト対象期間' : 'シフト対象期間'}
          </p>
          <p className={`text-sm font-bold ${selectedPeriod.isCurrent ? 'text-indigo-900' : 'text-foreground'}`}>
            {format(selectedPeriod.start, 'M月d日（E）', { locale: ja })} 〜 {format(selectedPeriod.end, 'M月d日（E）', { locale: ja })}
          </p>
          <p className={`text-xs mt-0.5 ${selectedPeriod.isCurrent ? 'text-indigo-600' : 'text-muted-foreground'}`}>
            締切：{format(selectedPeriod.deadline, 'M月d日（E）', { locale: ja })}
          </p>
        </div>
        <button
          onClick={() => setPeriodOffset(o => Math.min(0, o + 1))}
          disabled={selectedPeriod.isCurrent}
          className="p-2 rounded-xl bg-muted/40 hover:bg-muted/70 transition-colors disabled:opacity-30 disabled:pointer-events-none"
        >
          <ChevronRight className="h-4 w-4" />
        </button>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-10">
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
        </div>
      ) : (
        <>
          {/* アルバイト */}
          <div className="space-y-2">
            <div className="flex items-center justify-between px-0.5">
              <h3 className="text-xs font-bold text-muted-foreground uppercase tracking-wider">アルバイト</h3>
              <span className="text-xs font-semibold text-muted-foreground">
                {partSubmitted.length} / {partTimers.length} 名 提出済み
              </span>
            </div>

            {partNotSubmitted.length > 0 && (
              <div>
                <p className="text-[10px] text-red-500 font-semibold mb-1 px-0.5">未提出</p>
                <div className="rounded-xl bg-red-50 border border-red-200 divide-y divide-red-100 overflow-hidden">
                  {partNotSubmitted.map(s => (
                    <div key={s.id} className="flex items-center justify-between px-3 py-2.5">
                      <span className="text-sm font-medium">{s.name}</span>
                      <span className="flex items-center gap-1 text-xs font-semibold text-red-600">
                        <XCircle className="h-3.5 w-3.5" />
                        未提出
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {partSubmitted.length > 0 && (
              <div>
                <p className="text-[10px] text-emerald-600 font-semibold mb-1 px-0.5">提出済み（タップで詳細・削除）</p>
                <div className="rounded-xl bg-emerald-50 border border-emerald-200 divide-y divide-emerald-100 overflow-hidden">
                  {partSubmitted.map(s => renderPartRow(s, 'submitted'))}
                </div>
              </div>
            )}

            {partAllDeleted.length > 0 && (
              <div>
                <p className="text-[10px] text-gray-500 font-semibold mb-1 px-0.5">削除済み（タップで復元可）</p>
                <div className="rounded-xl bg-gray-50 border border-gray-200 divide-y divide-gray-100 overflow-hidden">
                  {partAllDeleted.map(s => renderPartRow(s, 'allDeleted'))}
                </div>
              </div>
            )}

            {partTimers.length === 0 && (
              <p className="text-xs text-muted-foreground px-0.5">アルバイトスタッフがいません</p>
            )}
          </div>

          {/* 社員・役員 */}
          {fullTimers.length > 0 && (
            <div className="space-y-2">
              <h3 className="text-xs font-bold text-muted-foreground uppercase tracking-wider px-0.5">社員・役員</h3>
              <div className="rounded-xl border bg-white divide-y overflow-hidden">
                {fullTimers.map(s => {
                  const hasChange = submittedFullIds.has(s.id)
                  return (
                    <div key={s.id} className="flex items-center justify-between px-3 py-2.5">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-medium">{s.name}</span>
                        <span className={`text-[10px] px-1.5 py-0.5 rounded-full ${s.employment_type === '役員' ? 'bg-amber-100 text-amber-800' : 'bg-purple-100 text-purple-800'}`}>
                          {s.employment_type}
                        </span>
                      </div>
                      {hasChange
                        ? <span className="flex items-center gap-1 text-xs font-semibold text-amber-600">
                            <AlertTriangle className="h-3.5 w-3.5" />
                            変更申請あり
                          </span>
                        : <span className="flex items-center gap-1 text-xs font-semibold text-emerald-700">
                            <CheckCircle className="h-3.5 w-3.5" />
                            フル出勤
                          </span>
                      }
                    </div>
                  )
                })}
              </div>
              <p className="text-[10px] text-muted-foreground px-0.5">
                ※ 社員・役員は変更なし＝フル出勤のため、提出有無は判別できません
              </p>
            </div>
          )}
        </>
      )}

      {/* 更新ボタン */}
      {!loading && (
        <button
          onClick={() => load(true)}
          disabled={refreshing}
          className="w-full flex items-center justify-center gap-2 py-2.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
        >
          <RefreshCw className={`h-3.5 w-3.5 ${refreshing ? 'animate-spin' : ''}`} />
          更新
        </button>
      )}
    </div>
  )
}

/* ── ボーナスタブ（社員・役員のみ表示） ── */
function BonusTab({ month }: { month: string }) {
  const [staffs, setStaffs] = useState<Staff[]>([])
  const [shifts, setShifts] = useState<ShiftFixed[]>([])
  const [shops, setShops] = useState<Shop[]>([])
  const [loading, setLoading] = useState(true)
  const [expandedId, setExpandedId] = useState<number | null>(null)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    const [y, m] = month.split('-').map(Number)
    const startDate = `${month}-01`
    const endDate = `${y}-${String(m).padStart(2, '0')}-${new Date(y, m, 0).getDate()}`
    Promise.all([
      supabase.from('staffs').select('*').in('employment_type', ['社員', '役員']).is('deleted_at', null).order('id'),
      supabase.from('shifts_fixed').select('*').gte('date', startDate).lte('date', endDate),
      supabase.from('shops').select('*'),
    ]).then(([sR, shR, spR]) => {
      if (cancelled) return
      if (sR.error) console.error('staffs取得失敗:', sR.error.message)
      else setStaffs(sR.data || [])
      if (shR.error) console.error('shifts_fixed取得失敗:', shR.error.message)
      else setShifts(shR.data || [])
      if (spR.error) console.error('shops取得失敗:', spR.error.message)
      else setShops(spR.data || [])
      setLoading(false)
    })
    return () => { cancelled = true }
  }, [month])

  const toMin = (t: string) => {
    const parts = t.split(':')
    return parseInt(parts[0]) * 60 + parseInt(parts[1] || '0')
  }

  const fmtMin = (min: number) => {
    const h = Math.floor(min / 60)
    const mm = min % 60
    return `${String(h).padStart(2, '0')}:${String(mm).padStart(2, '0')}`
  }

  const bonusData = useMemo(() => staffs.map(s => {
    const myShifts = shifts.filter(sh => sh.staff_id === s.id)
    const byDate = new Map<string, ShiftFixed[]>()
    myShifts.forEach(sh => {
      const d = sh.date.substring(0, 10)
      if (!byDate.has(d)) byDate.set(d, [])
      byDate.get(d)!.push(sh)
    })

    const days: { date: string; bonusDays: number; startMin: number; endMin: number; isWeekendOnly: boolean }[] = []
    byDate.forEach((dayShifts, date) => {
      const startMin = Math.min(...dayShifts.map(sh => toMin(sh.start_time)))
      const endMin = Math.max(...dayShifts.map(sh => toMin(sh.end_time || '24:00:00')))
      // 週末限定店舗（おにぎり等）のシフトのみの日は常に0.5日
      const isWeekendOnly = dayShifts.every(sh =>
        sh.shop_id != null && shops.find(sp => sp.id === sh.shop_id)?.weekend_only === true
      )
      // 判定: 週末限定店舗のみ → 0.5日 / 開始 ≤ 14:00 かつ 終了 ≥ 23:00 → 1日 / それ以外 → 0.5日
      const bonusDays = (!isWeekendOnly && startMin <= 14 * 60 && endMin >= 23 * 60) ? 1 : 0.5
      days.push({ date, bonusDays, startMin, endMin, isWeekendOnly })
    })
    days.sort((a, b) => a.date.localeCompare(b.date))
    const total = days.reduce((sum, d) => sum + d.bonusDays, 0)
    return { staff: s, days, total }
  }), [staffs, shifts, shops])

  const [y, m] = month.split('-').map(Number)
  const ml = `${y}年${m}月`
  const DOW_JP = ['日', '月', '火', '水', '木', '金', '土']

  if (loading) return (
    <div className="space-y-3">
      <div className="skeleton h-16 w-full" />
      <div className="skeleton h-40 w-full" />
    </div>
  )

  const grandTotal = bonusData.reduce((sum, d) => sum + d.total, 0)

  return (
    <div className="space-y-3 animate-fade-in">
      {/* サマリーカード */}
      <div className="rounded-xl bg-gradient-to-br from-amber-50 to-orange-50/50 p-4 ring-1 ring-amber-100/50">
        <div className="flex items-center gap-2 mb-1">
          <div className="w-6 h-6 rounded-lg bg-amber-500/10 flex items-center justify-center">
            <Gift className="h-3.5 w-3.5 text-amber-600" />
          </div>
          <span className="text-xs text-amber-700/70 font-medium">社員・役員 ボーナス該当日数（{ml}）</span>
        </div>
        <p className="text-2xl font-extrabold text-amber-900 tabular-nums">
          {grandTotal.toFixed(1)}<span className="text-sm font-medium ml-1">日分</span>
        </p>
        <p className="text-[10px] text-amber-600/60 mt-1">判定: 開始≤14:00 かつ 終了≥23:00 → 1日 / それ以外 → 0.5日（週末限定店舗は常に 0.5日）</p>
      </div>

      {/* スタッフ別内訳 */}
      {bonusData.map(({ staff, days, total }) => (
        <div key={staff.id} className="rounded-xl bg-white ring-1 ring-border/40 overflow-hidden">
          <button
            className="w-full flex items-center justify-between px-3 py-2.5 hover:bg-muted/30 transition-colors"
            onClick={() => setExpandedId(expandedId === staff.id ? null : staff.id)}
          >
            <div className="flex items-center gap-2">
              <span className="text-[13px] font-semibold">{staff.name}</span>
              <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-medium ${staff.employment_type === '役員' ? 'bg-amber-100/80 text-amber-700' : 'bg-zinc-200/60 text-zinc-600'}`}>
                {staff.employment_type}
              </span>
            </div>
            <div className="flex items-center gap-2">
              <span className={`text-sm font-extrabold tabular-nums ${total > 0 ? 'text-amber-700' : 'text-muted-foreground'}`}>
                {total.toFixed(1)}<span className="text-[10px] font-medium ml-0.5">日</span>
              </span>
              {expandedId === staff.id
                ? <ChevronUp className="h-3.5 w-3.5 text-muted-foreground" />
                : <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
              }
            </div>
          </button>

          {expandedId === staff.id && (
            <div className="border-t border-border/30">
              {days.length === 0 ? (
                <p className="text-[11px] text-muted-foreground px-3 py-3">この月のシフトなし</p>
              ) : (
                <div className="divide-y divide-border/20">
                  {days.map(({ date, bonusDays, startMin, endMin, isWeekendOnly }) => {
                    const dow = new Date(date + 'T00:00:00').getDay()
                    const [, mm, dd] = date.split('-')
                    const is1 = bonusDays === 1
                    return (
                      <div key={date} className="flex items-center justify-between px-3 py-2">
                        <div className="flex items-center gap-2">
                          <span className={`text-[11px] font-medium tabular-nums w-[52px] ${dow === 0 ? 'text-red-500' : dow === 6 ? 'text-blue-500' : ''}`}>
                            {mm}/{dd}({DOW_JP[dow]})
                          </span>
                          {isWeekendOnly ? (
                            <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-violet-100 text-violet-600 font-medium">おにぎり</span>
                          ) : (
                            <span className="text-[10px] text-muted-foreground tabular-nums">
                              {fmtMin(startMin)}–{fmtMin(endMin)}
                            </span>
                          )}
                        </div>
                        <span className={`text-xs font-bold px-2 py-0.5 rounded-full ${is1 ? 'bg-amber-100 text-amber-700' : 'bg-zinc-100 text-zinc-500'}`}>
                          {is1 ? '1.0日' : '0.5日'}
                        </span>
                      </div>
                    )
                  })}
                </div>
              )}
              <div className="px-3 py-2 bg-muted/20 flex justify-between items-center border-t border-border/30">
                <span className="text-[10px] text-muted-foreground font-medium">小計</span>
                <span className="text-sm font-extrabold tabular-nums text-amber-700">{total.toFixed(1)} 日</span>
              </div>
            </div>
          )}
        </div>
      ))}

      {bonusData.every(d => d.days.length === 0) && (
        <p className="text-center text-xs text-muted-foreground py-8">この月の確定シフトがありません</p>
      )}
    </div>
  )
}

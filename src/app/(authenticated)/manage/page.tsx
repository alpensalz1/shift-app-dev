'use client'

import { useEffect, useState, useCallback, useMemo } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabase'
import { getStoredStaff } from '@/lib/auth'
import { ShiftRequest, ShiftFixed, Staff, ShiftConfig } from '@/types/database'
import { formatTime } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import {
  format,
  eachDayOfInterval,
  startOfMonth,
  endOfMonth,
  addMonths,
  subMonths,
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
  AlertCircle,
} from 'lucide-react'

interface RequestWithStaff extends ShiftRequest {
  staffs: Pick<Staff, 'name' | 'employment_type'>
}

export default function ManagePage() {
  const router = useRouter()
  const currentStaff = getStoredStaff()

  // 社員でなければリダイレクト
  useEffect(() => {
    if (currentStaff && currentStaff.employment_type !== '社員') {
      router.replace('/home')
    }
  }, [currentStaff, router])

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
      supabase
        .from('shift_requests')
        .select('*, staffs(name, employment_type)')
        .gte('date', monthStart)
        .lte('date', monthEnd)
        .order('date', { ascending: true }),
      supabase
        .from('shifts_fixed')
        .select('*')
        .gte('date', monthStart)
        .lte('date', monthEnd)
        .order('date', { ascending: true }),
      supabase.from('shift_config').select('*'),
      supabase.from('staffs').select('*').eq('is_active', true),
    ])

    if (reqRes.data) setRequests(reqRes.data as RequestWithStaff[])
    if (fixedRes.data) setFixedShifts(fixedRes.data)
    if (configRes.data) setConfigs(configRes.data)
    if (staffRes.data) setAllStaffs(staffRes.data)
    setLoading(false)
  }, [monthStart, monthEnd])

  useEffect(() => {
    fetchAll()
  }, [fetchAll])

  // 日ごとの希望集計
  const dateMap = useMemo(() => {
    const map: Record<string, RequestWithStaff[]> = {}
    requests.forEach((r) => {
      if (!map[r.date]) map[r.date] = []
      map[r.date].push(r)
    })
    return map
  }, [requests])

  // 日ごとの確定済み
  const fixedMap = useMemo(() => {
    const map: Record<string, ShiftFixed[]> = {}
    fixedShifts.forEach((f) => {
      if (!map[f.date]) map[f.date] = []
      map[f.date].push(f)
    })
    return map
  }, [fixedShifts])

  const calDays = useMemo(() => {
    return eachDayOfInterval({ start: startOfMonth(selectedMonth), end: endOfMonth(selectedMonth) })
  }, [selectedMonth.toISOString()])

  const firstDow = getDay(startOfMonth(selectedMonth))

  // 選択した日の希望一覧
  const selectedRequests = selectedDate ? (dateMap[selectedDate] || []) : []
  const selectedFixed = selectedDate ? (fixedMap[selectedDate] || []) : []

  // シフト確定: 希望者をshifts_fixedに追加
  const handleConfirm = async (req: RequestWithStaff, shopId: number, type: '仕込み' | '営業') => {
    setConfirming(true)
    setMessage('')

    const { error } = await supabase.from('shifts_fixed').upsert({
      date: req.date,
      shop_id: shopId,
      type,
      staff_id: req.staff_id,
      start_time: req.start_time,
      end_time: req.end_time,
    }, {
      onConflict: 'staff_id,date,type',
    })

    if (error) {
      setMessage('確定に失敗: ' + error.message)
    } else {
      setMessage(`${req.staffs.name}のシフトを確定しました`)
      fetchAll()
    }
    setConfirming(false)
  }

  // シフト取消
  const handleRemoveFixed = async (fixedId: number) => {
    setConfirming(true)
    await supabase.from('shifts_fixed').delete().eq('id', fixedId)
    setMessage('シフトを取り消しました')
    fetchAll()
    setConfirming(false)
  }

  if (!currentStaff || currentStaff.employment_type !== '社員') return null

  const DAY_NAMES = ['日', '月', '火', '水', '木', '金', '土']

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-lg font-bold flex items-center gap-2">
          <ClipboardCheck className="h-5 w-5" />
          シフト確定
        </h2>
        <p className="text-sm text-muted-foreground">
          提出されたシフト希望を確認・確定
        </p>
      </div>

      {/* 月選択 */}
      <div className="flex items-center justify-center gap-4">
        <button onClick={() => setSelectedMonth((m) => subMonths(m, 1))}
          className="p-2 rounded-lg hover:bg-accent transition-colors">
          <ChevronLeft className="h-5 w-5" />
        </button>
        <span className="text-base font-semibold min-w-[120px] text-center">
          {format(selectedMonth, 'yyyy年M月', { locale: ja })}
        </span>
        <button onClick={() => setSelectedMonth((m) => addMonths(m, 1))}
          className="p-2 rounded-lg hover:bg-accent transition-colors">
          <ChevronRight className="h-5 w-5" />
        </button>
      </div>

      {/* カレンダー */}
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
            {Array.from({ length: firstDow }).map((_, i) => <div key={`e-${i}`} />)}
            {calDays.map((date) => {
              const dateStr = format(date, 'yyyy-MM-dd')
              const reqs = dateMap[dateStr] || []
              const fixed = fixedMap[dateStr] || []
              const isSelected = selectedDate === dateStr
              const dayOfWeek = getDay(date)
              const hasRequests = reqs.length > 0
              const hasFixed = fixed.length > 0

              return (
                <button
                  key={dateStr}
                  onClick={() => setSelectedDate(isSelected ? null : dateStr)}
                  className={`
                    relative flex flex-col items-center justify-center rounded-lg py-1 min-h-[52px] text-sm transition-all cursor-pointer
                    ${isSelected ? 'bg-zinc-900 text-white' : ''}
                    ${!isSelected && hasFixed ? 'bg-emerald-50 ring-1 ring-emerald-300' : ''}
                    ${!isSelected && hasRequests && !hasFixed ? 'bg-amber-50 ring-1 ring-amber-200' : ''}
                    ${!isSelected && !hasRequests && !hasFixed ? 'hover:bg-accent' : ''}
                    ${dayOfWeek === 0 && !isSelected ? 'text-red-500' : ''}
                    ${dayOfWeek === 6 && !isSelected ? 'text-blue-500' : ''}
                  `}
                >
                  <span className="font-medium">{format(date, 'd')}</span>
                  {hasRequests && !isSelected && (
                    <span className="text-[8px] leading-tight text-amber-600">
                      {reqs.length}名希望
                    </span>
                  )}
                  {hasFixed && !isSelected && (
                    <span className="text-[8px] leading-tight text-emerald-600">
                      {fixed.length}名確定
                    </span>
                  )}
                </button>
              )
            })}
          </div>
          <div className="flex items-center gap-4 mt-3 px-2 text-[10px] text-muted-foreground">
            <span className="flex items-center gap-1">
              <span className="w-3 h-3 rounded bg-amber-50 ring-1 ring-amber-200" /> 希望あり
            </span>
            <span className="flex items-center gap-1">
              <span className="w-3 h-3 rounded bg-emerald-50 ring-1 ring-emerald-300" /> 確定済
            </span>
          </div>
        </CardContent>
      </Card>

      {/* 選択した日の詳細 */}
      {selectedDate && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm flex items-center justify-between">
              <span>
                {format(new Date(selectedDate + 'T00:00:00'), 'M月d日（E）', { locale: ja })}
              </span>
              <span className="text-xs font-normal text-muted-foreground">
                希望 {selectedRequests.length}名 / 確定 {selectedFixed.length}名
              </span>
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {/* 確定済み */}
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
                          <span className="text-xs text-muted-foreground">
                            {formatTime(f.start_time)}–{formatTime(f.end_time)}
                          </span>
                          <span className={`text-xs px-1.5 py-0.5 rounded-full ${
                            f.type === '仕込み' ? 'bg-amber-100 text-amber-800' : 'bg-blue-100 text-blue-800'
                          }`}>{f.type}</span>
                          <span className="text-xs text-muted-foreground">
                            店舗{f.shop_id}
                          </span>
                        </div>
                        <button
                          onClick={() => handleRemoveFixed(f.id)}
                          disabled={confirming}
                          className="p-1 text-muted-foreground hover:text-destructive transition-colors"
                          title="取り消す"
                        >
                          <X className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    )
                  })}
                </div>
              </div>
            )}

            {/* 希望一覧 */}
            {selectedRequests.length > 0 ? (
              <div>
                <h4 className="text-xs font-medium text-amber-700 mb-2 flex items-center gap-1">
                  <Users className="h-3 w-3" /> シフト希望
                </h4>
                <div className="space-y-2">
                  {selectedRequests.map((req) => {
                    // この人が既に確定されているか
                    const alreadyFixed = selectedFixed.some(
                      (f) => f.staff_id === req.staff_id
                    )
                    return (
                      <div key={req.id} className={`p-3 rounded-lg border ${
                        alreadyFixed ? 'bg-muted/50 opacity-60' : 'bg-background'
                      }`}>
                        <div className="flex items-center justify-between mb-2">
                          <div className="flex items-center gap-2">
                            <span className="text-sm font-semibold">{req.staffs.name}</span>
                            <span className={`text-[10px] px-1.5 py-0.5 rounded-full ${
                              req.staffs.employment_type === '社員'
                                ? 'bg-purple-100 text-purple-800'
                                : 'bg-zinc-100 text-zinc-600'
                            }`}>{req.staffs.employment_type}</span>
                          </div>
                          {alreadyFixed && (
                            <span className="text-xs text-emerald-600 flex items-center gap-0.5">
                              <Check className="h-3 w-3" /> 確定済
                            </span>
                          )}
                        </div>
                        <div className="text-xs text-muted-foreground mb-2">
                          {formatTime(req.start_time)}–{formatTime(req.end_time)} / {req.type}
                          {req.note && <span className="ml-2 text-amber-600">※ {req.note}</span>}
                        </div>
                        {!alreadyFixed && (
                          <div className="flex gap-2">
                            {/* 仕込み or 営業 or 両方で確定ボタン */}
                            {(req.type === '仕込み' || req.type === '仕込み・営業') && (
                              <>
                                <Button size="sm" variant="outline"
                                  className="h-8 text-xs"
                                  disabled={confirming}
                                  onClick={() => handleConfirm(req, 1, '仕込み')}>
                                  三茶 仕込み
                                </Button>
                                <Button size="sm" variant="outline"
                                  className="h-8 text-xs"
                                  disabled={confirming}
                                  onClick={() => handleConfirm(req, 2, '仕込み')}>
                                  下北 仕込み
                                </Button>
                              </>
                            )}
                            {(req.type === '営業' || req.type === '仕込み・営業') && (
                              <>
                                <Button size="sm" variant="outline"
                                  className="h-8 text-xs"
                                  disabled={confirming}
                                  onClick={() => handleConfirm(req, 1, '営業')}>
                                  三茶 営業
                                </Button>
                                <Button size="sm" variant="outline"
                                  className="h-8 text-xs"
                                  disabled={confirming}
                                  onClick={() => handleConfirm(req, 2, '営業')}>
                                  下北 営業
                                </Button>
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
              <p className="text-sm text-muted-foreground text-center py-4">
                この日のシフト希望はありません
              </p>
            )}

            {message && (
              <p className={`text-sm text-center ${message.includes('失敗') ? 'text-destructive' : 'text-emerald-600'}`}>
                {message}
              </p>
            )}
          </CardContent>
        </Card>
      )}

      {loading && (
        <div className="text-center py-8">
          <Loader2 className="h-6 w-6 animate-spin mx-auto text-muted-foreground" />
        </div>
      )}
    </div>
  )
}

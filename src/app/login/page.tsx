'use client'

import { useState, useEffect, useRef } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabase'
import { storeStaff } from '@/lib/auth'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { CalendarDays, Loader2 } from 'lucide-react'

export default function LoginPage() {
  const router = useRouter()
  const [name, setName] = useState('')
  const [token, setToken] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [staffNames, setStaffNames] = useState<string[]>([])
  const [namesLoading, setNamesLoading] = useState(true)
  const tapCountRef = useRef(0)
  const tapTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [showAdminLogin, setShowAdminLogin] = useState(false)
  const [adminToken, setAdminToken] = useState('')
  const [adminError, setAdminError] = useState('')
  const [adminLoading, setAdminLoading] = useState(false)

  const handleLogoTap = () => {
    tapCountRef.current += 1
    if (tapTimerRef.current) clearTimeout(tapTimerRef.current)
    if (tapCountRef.current >= 5) {
      tapCountRef.current = 0
      setShowAdminLogin(true)
      return
    }
    tapTimerRef.current = setTimeout(() => {
      tapCountRef.current = 0
    }, 2000)
  }

  const handleAdminLogin = async () => {
    setAdminLoading(true)
    setAdminError('')
    const { data, error: dbError } = await supabase
      .from('staffs')
      .select('*')
      .eq('token', adminToken.trim())
      .single()
    setAdminLoading(false)
    if (dbError || !data) {
      setAdminError('トークンが違います')
      return
    }
    storeStaff(data)
    setShowAdminLogin(false)
    router.push('/')
  }

  useEffect(() => {
    supabase
      .from('staffs')
      .select('name')
      .eq('is_active', true)
      .order('id', { ascending: true })
      .then(({ data }) => {
        if (data) setStaffNames(data.map((s) => s.name))
        setNamesLoading(false)
      })
  }, [])

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    setLoading(true)

    try {
      const { data, error: dbError } = await supabase
        .from('staffs')
        .select('*')
        .eq('name', name.trim())
        .eq('token', token.trim())
        .eq('is_active', true)
        .single()

      if (dbError || !data) {
        setError('名前またはパスワードが正しくありません')
        setLoading(false)
        return
      }

      storeStaff(data)
      router.replace('/home')
    } catch {
      setError('通信エラーが発生しました')
      setLoading(false)
    }
  }

  return (
    <div className="flex items-center justify-center min-h-screen px-4 bg-gradient-to-b from-zinc-50 to-zinc-100">
      <Card className="w-full max-w-sm shadow-lg border-0">
        <CardHeader className="text-center pb-2">
          <div className="mx-auto mb-3 flex h-14 w-14 items-center justify-center rounded-full bg-zinc-900 cursor-pointer select-none" onClick={handleLogoTap}>
            <CalendarDays className="h-7 w-7 text-white" />
          </div>
          <CardTitle className="text-xl">シフト管理</CardTitle>
          <CardDescription>名前とパスワードでログイン</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleLogin} className="space-y-4">
            <div className="space-y-2">
              <label className="text-sm font-medium text-foreground" htmlFor="name">
                名前
              </label>
              {namesLoading ? (
                <div className="h-12 flex items-center justify-center">
                  <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                </div>
              ) : (
                <select
                  id="name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  required
                  className="w-full h-12 rounded-md border border-input bg-background px-3 text-base focus:outline-none focus:ring-2 focus:ring-ring"
                >
                  <option value="">選択してください</option>
                  {staffNames.map((n) => (
                    <option key={n} value={n}>{n}</option>
                  ))}
                </select>
              )}
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium text-foreground" htmlFor="token">
                パスワード
              </label>
              <Input
                id="token"
                type="password"
                placeholder="パスワードを入力"
                value={token}
                onChange={(e) => setToken(e.target.value)}
                required
                autoComplete="current-password"
                className="h-12 text-base"
              />
            </div>

            {error && (
              <p className="text-sm text-destructive text-center">{error}</p>
            )}

            <Button
              type="submit"
              className="w-full h-12 text-base"
              disabled={loading || !name || !token}
            >
              {loading ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  ログイン中...
                </>
              ) : (
                'ログイン'
              )}
            </Button>
          </form>
        </CardContent>
      </Card>

      {showAdminLogin && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={() => setShowAdminLogin(false)}>
          <div className="bg-white rounded-xl p-6 w-80 shadow-2xl" onClick={e => e.stopPropagation()}>
            <h2 className="text-lg font-semibold mb-4">管理者ログイン</h2>
            <Input
              type="text"
              placeholder="トークンを入力"
              value={adminToken}
              onChange={e => setAdminToken(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && handleAdminLogin()}
              className="mb-3"
              autoFocus
            />
            {adminError && <p className="text-red-500 text-sm mb-3">{adminError}</p>}
            <div className="flex gap-2">
              <Button variant="outline" className="flex-1" onClick={() => { setShowAdminLogin(false); setAdminToken(''); setAdminError('') }}>
                キャンセル
              </Button>
              <Button className="flex-1" onClick={handleAdminLogin} disabled={adminLoading}>
                {adminLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : 'ログイン'}
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

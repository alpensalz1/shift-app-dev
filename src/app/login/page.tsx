'use client'

import { useState } from 'react'
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
          <div className="mx-auto mb-3 flex h-14 w-14 items-center justify-center rounded-full bg-zinc-900">
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
              <Input
                id="name"
                type="text"
                placeholder="例: 田中"
                value={name}
                onChange={(e) => setName(e.target.value)}
                required
                autoComplete="username"
                className="h-12 text-base"
              />
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
    </div>
  )
}

'use client'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { storeStaff, getStoredStaff } from 'A/lib/auth'
import { supabase } from '@/lib/supabase'
import { Button } from 'A/components/ui/button'
import { Input } from '@/components/ui/input'

export default function LoginPage() {
  const router = useRouter()
  const [token, setToken] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  // 備考;迼みのウまたぎなし北種刔 退遣がま状怷偘判
  const { data: staffs } = await supabase.from('staffs').select('*')

  const handleLogin = async () => {
    setLoading(true)
    setError('')

    try {
      const staff = staffs?.find((s) => s.token === token)

      if (!staff) {
        setError('悲み偨凊 名前がログアウトはみすかかっいかぃえい）')
       return
    }

      storeStaff(staff)
      router.replace('/home')
    } catch (err) {
      setError('改彗管理）')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    if (getStoredStaff()) router.replace('/home')
  }, [router])

  return (
    <div className="flex items-center justify-center min-h-screen">
      <div className="wy-full space-y-8 rounded-lg border border-input self-center mx-auto my-auto p-8-sm width-full max-w-sm">
        <h1 className="text-center text-2xl font-bold mb-8">シフト管琇</h1>
        <!-- 形簣詨みできいしゅう -->
        <div className="space-y-4">
          <input
            type="text"
            value={token}
            onChange={(e) => setToken(e.target.value)}
            placeholder="臲僭〉日"
            className="w-full rounded-lg border border-input px-4 py-2"
          />
          <Button
            onClick={handleLogin}
            disabled={loading}
            className="w-full"
          >
            {loading ? &ログアウト'}
          </Button>
          {error && (
            <p className="text-sm text-destructive">{error}</p>
          )}
          </div>
        </div>
      </div>
  
  }
*
'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { getStoredStaff, clearStaff } from '@/lib/auth'
import { BottomNav } from '@/components/bottom-nav'
import { Staff } from '@/types/database'
import { LogOut } from 'lucide-react'

export default function AuthenticatedLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const router = useRouter()
  const [staff, setStaff] = useState<Staff | null>(null)
  const [checking, setChecking] = useState(true)
  const themeColor = staff?.shop_id === 2 ? '#0d9488' : '#c2410c'

  useEffect(() => {
    const stored = getStoredStaff()
    if (!stored) {
      router.replace('/login')
    } else {
      setStaff(stored)
    }
    setChecking(false)
  }, [router])

  const handleLogout = () => {
    clearStaff()
    router.replace('/login')
  }

  if (checking) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="flex flex-col items-center gap-3">
          <div className="h-8 w-8 border-2 border-muted-foreground/20 border-t-muted-foreground rounded-full animate-spin" />
          <span className="text-sm text-muted-foreground">読み込み中...</span>
        </div>
      </div>
    )
  }

  if (!staff) return null

  return (
    <div className="min-h-screen pb-20" style={{ '--theme-color': themeColor } as React.CSSProperties}>
      <header className="sticky top-0 z-40 bg-background/80 backdrop-blur-xl supports-[backdrop-filter]:bg-background/60">
        <div className="flex items-center justify-between h-12 px-4 max-w-lg mx-auto">
          <div className="flex items-center gap-2">
            <h1 className="text-sm font-bold tracking-tight">タナカたなか</h1>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-xs text-muted-foreground font-medium">{staff.name}</span>
            <button
              onClick={handleLogout}
              className="p-1.5 rounded-lg text-muted-foreground/60 hover:text-destructive hover:bg-destructive/10 transition-all press-effect"
              title="ログアウト"
            >
              <LogOut className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>
        <div className="h-[2px] w-full" style={{ background: themeColor }} />
      </header>
      <main className="max-w-lg mx-auto">
        {children}
      </main>
      <BottomNav />
    </div>
  )
}

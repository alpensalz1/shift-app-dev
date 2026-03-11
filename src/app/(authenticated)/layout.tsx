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
  const shopName = staff.shop_id === 2 ? '下北沢' : '三軍茶屋'
  const themeColor = staff.shop_id === 2 ? '#0d9488' : '#c2410c'

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
        <div className="animate-pulse text-muted-foreground">読み込み中...</div>
      </div>
    )
  }

  if (!staff) return null

  return (
    <div className="min-h-screen pb-20" style={{ '--theme-color': themeColor } as React.CSSProperties}>
      <header className="sticky top-0 z-40 bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/80" style={{ borderBottom: '2px solid ' + themeColor }}>
        <div style={{ height: '4px', backgroundColor: themeColor }} />
        <div className="flex items-center justify-between h-14 px-4 max-w-lg mx-auto">
          <h1 className="text-base font-semibold">シフト管理</h1>
          <div className="flex items-center gap-3">
            <span className="text-sm text-muted-foreground">{staff.name}</span>
            <button
              onClick={handleLogout}
              className="p-1.5 rounded-md text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors"
              title="ログアウト"
            >
              <LogOut className="h-4 w-4" />
            </button>
          </div>
        </div>
      </header>
      <main className="max-w-lg mx-auto px-4 py-4">
        {children}
      </main>
      <BottomNav />
    </div>
  )
}

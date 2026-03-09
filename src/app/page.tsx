'use client'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { getStoredStaff } from '@/lib/auth'

export default function RootPage() {
  const router = useRouter()

  useEffect(() => {
    const staff = getStoredStaff()
    if (staff) {
      router.replace('/home')
    } else {
      router.replace('/login')
    }
  }, [router])

  return (
    <div className="flex items-center justify-center min-h-screen">
      <div className="animate-pulse text-muted-foreground">読み込み中...</div>
    </div>
  )
}

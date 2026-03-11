'use client'

import { useState, useEffect } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { Home, CalendarPlus, Wallet, ClipboardCheck } from 'lucide-react'
import { cn } from '@/lib/utils'
import { getStoredStaff } from '@/lib/auth'
import { supabase } from '@/lib/supabase'

export function BottomNav() {
  const pathname = usePathname()
  const [isManager, setIsManager] = useState(false)
  const [pendingCount, setPendingCount] = useState(0)
  const [showSalary, setShowSalary] = useState(false)

  useEffect(() => {
    const staff = getStoredStaff()
    const manager = staff?.employment_type === '社員' || staff?.employment_type === '長期'
    setIsManager(manager)
    setShowSalary(staff?.employment_type === 'アルバイト')
    if (manager) {
      supabase
        .from('shift_requests')
        .select('*', { count: 'exact', head: true })
        .eq('status', 'pending')
        .then(({ count }) => { if (count != null) setPendingCount(count) })
    }
  }, [pathname])

  const navItems = [
    { href: '/home', label: 'ホーム', icon: Home },
    { href: '/shifts', label: 'シフト申請', icon: CalendarPlus },
    ...(showSalary ? [{ href: '/salary', label: '給与概算', icon: Wallet }] : []),
    ...(isManager
      ? [{ href: '/manage', label: 'シフト管理', icon: ClipboardCheck }]
      : []),
  ]

  return (
    <nav className="fixed bottom-0 left-0 right-0 z-50 border-t bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/80 pb-[env(safe-area-inset-bottom)]">
      <div className="flex items-center justify-around h-16 max-w-lg mx-auto">
        {navItems.map((item) => {
          const isActive = pathname === item.href
          const showBadge = item.href === '/manage' && pendingCount > 0
          return (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                'flex flex-col items-center justify-center gap-1 flex-1 h-full transition-colors',
                isActive
                  ? 'text-foreground'
                  : 'text-muted-foreground hover:text-foreground'
              )}
            >
              <div className="relative">
                <item.icon className={cn('h-5 w-5', isActive && 'stroke-[2.5]')} />
                {showBadge && (
                  <span className="absolute -top-1.5 -right-1.5 min-w-[16px] h-4 bg-red-500 text-white text-[9px] font-bold rounded-full flex items-center justify-center px-0.5 leading-none">
                    {pendingCount > 9 ? '9+' : pendingCount}
                  </span>
                )}
              </div>
              <span className="text-[10px] font-medium">{item.label}</span>
            </Link>
          )
        })}
      </div>
    </nav>
  )
}

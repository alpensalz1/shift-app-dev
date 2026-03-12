'use client'

import { useState, useEffect } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { Home, CalendarPlus, Wallet, ClipboardCheck, BarChart2 } from 'lucide-react'
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
    const manager =
      staff?.employment_type === '社員' ||
      staff?.employment_type === '長期' ||
      staff?.employment_type === '役員'
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
      ? [{ href: '/manage', label: 'シフト管理', icon: ClipboardCheck, badge: pendingCount }]
      : []),
    ...(isManager
      ? [{ href: '/admin', label: '管理', icon: BarChart2, badge: 0 }]
      : []),
  ]

  return (
    <nav className="fixed bottom-0 left-0 right-0 z-50 border-t border-border/50 bg-background/90 backdrop-blur-xl supports-[backdrop-filter]:bg-background/70 pb-[env(safe-area-inset-bottom)]">
      <div className="flex items-center justify-around h-14 max-w-lg mx-auto">
        {navItems.map((item) => {
          const isActive = pathname === item.href
          const showBadge = (item.badge ?? 0) > 0
          return (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                'flex flex-col items-center justify-center gap-0.5 flex-1 h-full transition-all press-effect relative',
                isActive
                  ? 'text-foreground'
                  : 'text-muted-foreground/60 hover:text-muted-foreground'
              )}
            >
              {isActive && (
                <span className="absolute top-0 left-1/2 -translate-x-1/2 w-8 h-0.5 rounded-full bg-foreground" />
              )}
              <div className="relative">
                <item.icon className={cn(
                  'h-[18px] w-[18px] transition-all',
                  isActive ? 'stroke-[2.5]' : 'stroke-[1.5]'
                )} />
                {showBadge && (
                  <span className="absolute -top-1 -right-2 min-w-[14px] h-3.5 bg-red-500 text-white text-[8px] font-bold rounded-full flex items-center justify-center px-0.5 leading-none shadow-sm">
                    {(item.badge ?? 0) > 9 ? '9+' : item.badge}
                  </span>
                )}
              </div>
              <span className={cn(
                'text-[9px] leading-none',
                isActive ? 'font-bold' : 'font-medium'
              )}>{item.label}</span>
            </Link>
          )
        })}
      </div>
    </nav>
  )
}

'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { Home, CalendarPlus, Wallet, ClipboardCheck } from 'lucide-react'
import { cn } from '@/lib/utils'
import { getStoredStaff } from '@/lib/auth'

export function BottomNav() {
  const pathname = usePathname()
  const staff = getStoredStaff()
  const isManager = staff?.employment_type === '社員'

  const navItems = [
    { href: '/home', label: 'ホーム', icon: Home },
    { href: '/shifts', label: 'シフト提出', icon: CalendarPlus },
    { href: '/salary', label: '給与概算', icon: Wallet },
    // 社員のみ: シフト確定画面
    ...(isManager
      ? [{ href: '/manage', label: 'シフト確定', icon: ClipboardCheck }]
      : []),
  ]

  return (
    <nav className="fixed bottom-0 left-0 right-0 z-50 border-t bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/80 pb-[env(safe-area-inset-bottom)]">
      <div className="flex items-center justify-around h-16 max-w-lg mx-auto">
        {navItems.map((item) => {
          const isActive = pathname === item.href
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
              <item.icon className={cn('h-5 w-5', isActive && 'stroke-[2.5]')} />
              <span className="text-[10px] font-medium">{item.label}</span>
            </Link>
          )
        })}
      </div>
    </nav>
  )
}

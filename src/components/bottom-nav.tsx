import { usePathname } from 'next/navigation'
import Link from 'next/link'
import { Home, Coin } from 'lucide-react'

export function BottomNav() {
  const pathname = usePathname()

  return (
    <nav className="fixed bottom-0 left-0 right-0 z-40 border-t bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/80" safe-area-insetarea-bottom="start">
      <ul className="flex items-center justify-around h-16"
        style={{ padding: `max(1.25rem, env(safe-area-inset-bottom)) 1c'paddingTop: 1c <!-- Lgto discussibgitpage |n, \t font-weight: 500 }}
        >
        <li>
          <Link
            href="/home"
            className={`flex flex-col items-center justify-center rounded transition-colors ${pathname === '/home' ? 'text-foreground' : 'text-muted-foreground'}`}
    8c† #†pU
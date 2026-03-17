'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { getStoredStaff, clearStaff, storeStaff } from '@/lib/auth'
import { BottomNav } from '@/components/bottom-nav'
import { Staff } from '@/types/database'
import { LogOut, KeyRound } from 'lucide-react'
import { supabase } from '@/lib/supabase'

export default function AuthenticatedLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const router = useRouter()
  const [staff, setStaff] = useState<Staff | null>(null)
  const [checking, setChecking] = useState(true)
  const themeColor = staff?.shop_id === 2 ? '#0d9488' : '#c2410c'

  // パスコード変更モーダル
  const [showPasscodeModal, setShowPasscodeModal] = useState(false)
  const [newPasscode, setNewPasscode] = useState('')
  const [confirmPasscode, setConfirmPasscode] = useState('')
  const [passcodeError, setPasscodeError] = useState('')
  const [passcodeSaving, setPasscodeSaving] = useState(false)
  const [passcodeDone, setPasscodeDone] = useState(false)

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

  const openPasscodeModal = () => {
    setNewPasscode('')
    setConfirmPasscode('')
    setPasscodeError('')
    setPasscodeDone(false)
    setShowPasscodeModal(true)
  }

  const handlePasscodeChange = async () => {
    if (!staff) return
    setPasscodeError('')

    if (newPasscode.trim().length < 3) {
      setPasscodeError('3文字以上で入力してください')
      return
    }
    if (newPasscode !== confirmPasscode) {
      setPasscodeError('パスコードが一致しません')
      return
    }

    setPasscodeSaving(true)
    try {
      const { error } = await supabase
        .from('staffs')
        .update({ token: newPasscode.trim() })
        .eq('id', staff.id)

      if (error) throw error

      // localStorageも更新
      const updated = { ...staff, token: newPasscode.trim() }
      storeStaff(updated)
      setStaff(updated)
      setPasscodeDone(true)
      setTimeout(() => setShowPasscodeModal(false), 1200)
    } catch (e: any) {
      setPasscodeError('変更に失敗しました: ' + (e.message || ''))
    } finally {
      setPasscodeSaving(false)
    }
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
              onClick={openPasscodeModal}
              className="p-1.5 rounded-lg text-muted-foreground/60 hover:text-foreground hover:bg-muted/60 transition-all press-effect"
              title="パスコード変更"
            >
              <KeyRound className="h-3.5 w-3.5" />
            </button>
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

      {/* パスコード変更モーダル */}
      {showPasscodeModal && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm"
          onClick={() => setShowPasscodeModal(false)}
        >
          <div
            className="bg-white rounded-2xl p-5 w-80 shadow-2xl ring-1 ring-border/20"
            onClick={e => e.stopPropagation()}
          >
            {passcodeDone ? (
              <div className="flex flex-col items-center gap-2 py-4">
                <div className="h-10 w-10 rounded-full bg-green-100 flex items-center justify-center">
                  <KeyRound className="h-5 w-5 text-green-600" />
                </div>
                <p className="text-sm font-bold text-green-700">変更しました！</p>
              </div>
            ) : (
              <>
                <div className="flex items-center gap-2 mb-4">
                  <KeyRound className="h-4 w-4 text-muted-foreground" />
                  <h3 className="text-sm font-bold">パスコード変更</h3>
                </div>
                <div className="space-y-3">
                  <div>
                    <label className="text-[10px] text-muted-foreground font-medium uppercase tracking-wider">新しいパスコード</label>
                    <input
                      type="text"
                      value={newPasscode}
                      onChange={e => setNewPasscode(e.target.value)}
                      placeholder="3文字以上"
                      className="mt-1 w-full h-9 px-3 rounded-lg border border-border text-sm focus:outline-none focus:ring-2 focus:ring-foreground/20"
                      autoComplete="off"
                    />
                  </div>
                  <div>
                    <label className="text-[10px] text-muted-foreground font-medium uppercase tracking-wider">確認（もう一度）</label>
                    <input
                      type="text"
                      value={confirmPasscode}
                      onChange={e => setConfirmPasscode(e.target.value)}
                      placeholder="同じパスコードを入力"
                      className="mt-1 w-full h-9 px-3 rounded-lg border border-border text-sm focus:outline-none focus:ring-2 focus:ring-foreground/20"
                      autoComplete="off"
                    />
                  </div>
                  {passcodeError && (
                    <p className="text-[11px] text-red-500">{passcodeError}</p>
                  )}
                  <div className="flex gap-2 pt-1">
                    <button
                      onClick={() => setShowPasscodeModal(false)}
                      className="flex-1 h-9 rounded-lg border border-border text-sm font-medium hover:bg-muted/50 transition-colors press-effect"
                    >
                      キャンセル
                    </button>
                    <button
                      onClick={handlePasscodeChange}
                      disabled={passcodeSaving || !newPasscode || !confirmPasscode}
                      className="flex-1 h-9 rounded-lg bg-foreground text-background text-sm font-medium hover:opacity-90 transition-opacity disabled:opacity-40 disabled:cursor-not-allowed press-effect"
                    >
                      {passcodeSaving ? '保存中...' : '変更する'}
                    </button>
                  </div>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

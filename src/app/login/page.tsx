'use client'

import { useState, useEffect, useRef, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabase'
import { storeStaff } from '@/lib/auth'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { CalendarDays, Loader2 } from 'lucide-react'

/* ── Matrix Rain Canvas ── */
function MatrixRain() {
  const canvasRef = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    const resize = () => {
      canvas.width = window.innerWidth
      canvas.height = window.innerHeight
    }
    resize()
    window.addEventListener('resize', resize)

    const chars = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ@#$%^&*(){}[]|;:<>?/~+=_-'
    const fontSize = 14
    const columns = Math.floor(canvas.width / fontSize)
    const drops: number[] = Array(columns).fill(0).map(() => Math.random() * -100)

    const draw = () => {
      ctx.fillStyle = 'rgba(0, 0, 0, 0.05)'
      ctx.fillRect(0, 0, canvas.width, canvas.height)
      ctx.fillStyle = '#0f0'
      ctx.font = `${fontSize}px monospace`

      for (let i = 0; i < drops.length; i++) {
        const char = chars[Math.floor(Math.random() * chars.length)]
        const x = i * fontSize
        const y = drops[i] * fontSize

        // Brighter head character
        if (Math.random() > 0.5) {
          ctx.fillStyle = '#fff'
          ctx.fillText(char, x, y)
          ctx.fillStyle = '#0f0'
        } else {
          ctx.fillStyle = `rgba(0, ${150 + Math.random() * 105}, 0, ${0.5 + Math.random() * 0.5})`
          ctx.fillText(char, x, y)
        }

        if (y > canvas.height && Math.random() > 0.975) {
          drops[i] = 0
        }
        drops[i]++
      }
    }

    const interval = setInterval(draw, 50)
    return () => {
      clearInterval(interval)
      window.removeEventListener('resize', resize)
    }
  }, [])

  return (
    <canvas
      ref={canvasRef}
      className="fixed inset-0 z-0"
      style={{ background: '#000' }}
    />
  )
}

/* ── Glitch Text Effect ── */
function GlitchText({ text, className = '' }: { text: string; className?: string }) {
  return (
    <span className={`relative inline-block ${className}`}>
      <span className="relative z-10">{text}</span>
      <span className="absolute top-0 left-0 z-0 opacity-70" style={{
        color: '#0ff',
        clipPath: 'inset(0 0 50% 0)',
        animation: 'glitch1 2s infinite linear alternate-reverse',
        transform: 'translate(-2px, -1px)',
      }}>{text}</span>
      <span className="absolute top-0 left-0 z-0 opacity-70" style={{
        color: '#f0f',
        clipPath: 'inset(50% 0 0 0)',
        animation: 'glitch2 3s infinite linear alternate-reverse',
        transform: 'translate(2px, 1px)',
      }}>{text}</span>
    </span>
  )
}

/* ── Typing Effect Hook ── */
function useTypingEffect(text: string, speed = 50, startDelay = 500) {
  const [displayed, setDisplayed] = useState('')
  const [done, setDone] = useState(false)

  useEffect(() => {
    setDisplayed('')
    setDone(false)
    const timeout = setTimeout(() => {
      let i = 0
      const interval = setInterval(() => {
        if (i < text.length) {
          setDisplayed(text.slice(0, i + 1))
          i++
        } else {
          setDone(true)
          clearInterval(interval)
        }
      }, speed)
      return () => clearInterval(interval)
    }, startDelay)
    return () => clearTimeout(timeout)
  }, [text, speed, startDelay])

  return { displayed, done }
}

/* ── Terminal Log Lines ── */
function TerminalLines({ lines, onDone }: { lines: string[]; onDone?: () => void }) {
  const [visibleCount, setVisibleCount] = useState(0)

  useEffect(() => {
    if (visibleCount < lines.length) {
      const t = setTimeout(() => setVisibleCount(v => v + 1), 400 + Math.random() * 300)
      return () => clearTimeout(t)
    } else if (onDone) {
      onDone()
    }
  }, [visibleCount, lines.length, onDone])

  return (
    <div className="font-mono text-xs space-y-1">
      {lines.slice(0, visibleCount).map((line, i) => (
        <div key={i} className={line.startsWith('[OK]') ? 'text-green-400' : line.startsWith('[!!]') ? 'text-red-400' : 'text-green-500/70'}>
          {line}
        </div>
      ))}
    </div>
  )
}

/* ── Matrix Admin Login Panel ── */
function MatrixAdminLogin({
  adminToken,
  setAdminToken,
  adminError,
  adminLoading,
  onSubmit,
  onBack,
}: {
  adminToken: string
  setAdminToken: (v: string) => void
  adminError: string
  adminLoading: boolean
  onSubmit: () => void
  onBack: () => void
}) {
  const [phase, setPhase] = useState<'boot' | 'input' | 'auth'>('boot')
  const inputRef = useRef<HTMLInputElement>(null)
  const { displayed: titleText, done: titleDone } = useTypingEffect('SHIFT-ADMIN TERMINAL v2.0', 40, 300)

  const bootLines = [
    '> Initializing secure connection...',
    '[OK] TLS 1.3 handshake complete',
    '[OK] Supabase endpoint verified',
    '> Loading authentication module...',
    '[OK] Crypto module loaded',
    '[OK] Token validator ready',
    '> System ready. Awaiting credentials.',
  ]

  const handleBootDone = useCallback(() => {
    setTimeout(() => {
      setPhase('input')
      setTimeout(() => inputRef.current?.focus(), 100)
    }, 500)
  }, [])

  return (
    <div className="fixed inset-0 z-50">
      <MatrixRain />
      <style>{`
        @keyframes glitch1 {
          0% { transform: translate(0); }
          20% { transform: translate(-2px, 2px); }
          40% { transform: translate(-2px, -2px); }
          60% { transform: translate(2px, 2px); }
          80% { transform: translate(2px, -2px); }
          100% { transform: translate(0); }
        }
        @keyframes glitch2 {
          0% { transform: translate(0); }
          25% { transform: translate(2px, -1px); }
          50% { transform: translate(-1px, 2px); }
          75% { transform: translate(1px, -2px); }
          100% { transform: translate(0); }
        }
        @keyframes blink {
          0%, 50% { opacity: 1; }
          51%, 100% { opacity: 0; }
        }
        @keyframes scanline {
          0% { transform: translateY(-100%); }
          100% { transform: translateY(100vh); }
        }
        @keyframes flicker {
          0% { opacity: 0.97; }
          5% { opacity: 0.9; }
          10% { opacity: 0.98; }
          15% { opacity: 0.92; }
          20% { opacity: 0.99; }
          100% { opacity: 0.98; }
        }
        .terminal-cursor::after {
          content: '█';
          animation: blink 1s step-end infinite;
          color: #0f0;
        }
        .scanline::after {
          content: '';
          position: absolute;
          inset: 0;
          background: linear-gradient(transparent 50%, rgba(0,255,0,0.03) 50%);
          background-size: 100% 4px;
          pointer-events: none;
        }
      `}</style>

      {/* Scanline overlay */}
      <div className="fixed inset-0 z-10 pointer-events-none scanline" />

      {/* CRT flicker effect */}
      <div className="fixed inset-0 z-10 pointer-events-none" style={{
        animation: 'flicker 0.15s infinite',
        boxShadow: 'inset 0 0 120px rgba(0,255,0,0.05)',
      }} />

      {/* Terminal window */}
      <div className="relative z-20 flex items-center justify-center min-h-screen px-4">
        <div className="w-full max-w-lg">
          {/* Terminal header bar */}
          <div className="bg-green-900/40 border border-green-500/30 rounded-t-lg px-4 py-2 flex items-center justify-between backdrop-blur-sm">
            <div className="flex items-center gap-2">
              <div className="w-3 h-3 rounded-full bg-red-500/80" />
              <div className="w-3 h-3 rounded-full bg-yellow-500/80" />
              <div className="w-3 h-3 rounded-full bg-green-500/80" />
            </div>
            <span className="text-green-400/60 text-xs font-mono">admin@shift-app:~</span>
            <button
              onClick={onBack}
              className="text-green-500/50 hover:text-green-400 text-xs font-mono transition-colors"
            >
              [ESC]
            </button>
          </div>

          {/* Terminal body */}
          <div className="bg-black/90 border border-t-0 border-green-500/30 rounded-b-lg p-6 backdrop-blur-sm min-h-[320px]">
            {/* Title with glitch effect */}
            <div className="mb-4 text-center">
              <h2 className="text-green-400 font-mono text-lg font-bold tracking-wider">
                <GlitchText text={titleText} />
                {!titleDone && <span className="terminal-cursor" />}
              </h2>
              <div className="h-px bg-gradient-to-r from-transparent via-green-500/50 to-transparent mt-2" />
            </div>

            {/* Boot sequence */}
            {titleDone && phase === 'boot' && (
              <TerminalLines lines={bootLines} onDone={handleBootDone} />
            )}

            {/* Input phase */}
            {phase === 'input' && (
              <div className="space-y-4 mt-4">
                <div className="font-mono text-xs text-green-500/70 mb-3">
                  <p>{'>'} Authentication required.</p>
                  <p>{'>'} Enter admin token to proceed.</p>
                </div>

                <form
                  onSubmit={(e) => {
                    e.preventDefault()
                    setPhase('auth')
                    onSubmit()
                  }}
                  className="space-y-4"
                >
                  <div className="flex items-center gap-2 font-mono">
                    <span className="text-green-400 text-sm whitespace-nowrap">root@shift $</span>
                    <input
                      ref={inputRef}
                      type="password"
                      value={adminToken}
                      onChange={(e) => setAdminToken(e.target.value)}
                      disabled={adminLoading}
                      className="flex-1 bg-transparent border-none outline-none text-green-300 text-sm font-mono caret-green-400 placeholder:text-green-800"
                      placeholder="enter_token_here"
                      autoFocus
                    />
                    <span className="terminal-cursor" />
                  </div>

                  {adminError && (
                    <div className="font-mono text-xs">
                      <span className="text-red-400">[!!] ACCESS DENIED:</span>{' '}
                      <span className="text-red-300">{adminError}</span>
                    </div>
                  )}

                  <div className="flex gap-3 pt-2">
                    <button
                      type="submit"
                      disabled={adminLoading || !adminToken.trim()}
                      className="flex-1 bg-green-500/20 border border-green-500/50 text-green-400 py-2 px-4 rounded font-mono text-sm hover:bg-green-500/30 transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
                    >
                      {adminLoading ? (
                        <span className="flex items-center justify-center gap-2">
                          <Loader2 className="h-3 w-3 animate-spin" />
                          AUTHENTICATING...
                        </span>
                      ) : (
                        '[ AUTHENTICATE ]'
                      )}
                    </button>
                    <button
                      type="button"
                      onClick={onBack}
                      className="bg-transparent border border-green-500/30 text-green-600 py-2 px-4 rounded font-mono text-sm hover:border-green-500/50 hover:text-green-400 transition-colors"
                    >
                      [ EXIT ]
                    </button>
                  </div>
                </form>

                {/* Decorative system info */}
                <div className="mt-6 pt-4 border-t border-green-500/10 font-mono text-[10px] text-green-700/50 space-y-0.5">
                  <p>SYS: shift-management-os v3.2.1</p>
                  <p>NET: supabase-endpoint | latency: {Math.floor(Math.random() * 20 + 5)}ms</p>
                  <p>SEC: AES-256-GCM | TLS 1.3</p>
                  <p>PID: {Math.floor(Math.random() * 9000 + 1000)} | MEM: {Math.floor(Math.random() * 30 + 40)}%</p>
                </div>
              </div>
            )}

            {/* Auth phase - show while loading */}
            {phase === 'auth' && adminLoading && (
              <div className="space-y-2 mt-4 font-mono text-xs">
                <p className="text-green-500/70">{'>'} Validating token hash...</p>
                <p className="text-green-500/70">{'>'} Checking authorization level...</p>
                <div className="flex items-center gap-2 text-green-400">
                  <Loader2 className="h-3 w-3 animate-spin" />
                  <span>Processing...</span>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

/* ── Main Login Page ── */
export default function LoginPage() {
  const router = useRouter()
  const [name, setName] = useState('')
  const [token, setToken] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [staffNames, setStaffNames] = useState<string[]>([])
  const [namesLoading, setNamesLoading] = useState(true)
  const tapCountRef = useRef(0)
  const tapTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [showAdminLogin, setShowAdminLogin] = useState(false)
  const [adminToken, setAdminToken] = useState('')
  const [adminError, setAdminError] = useState('')
  const [adminLoading, setAdminLoading] = useState(false)

  const handleLogoTap = () => {
    tapCountRef.current += 1
    if (tapTimerRef.current) clearTimeout(tapTimerRef.current)
    if (tapCountRef.current >= 5) {
      tapCountRef.current = 0
      setShowAdminLogin(true)
      return
    }
    tapTimerRef.current = setTimeout(() => {
      tapCountRef.current = 0
    }, 2000)
  }

  const handleAdminLogin = async () => {
    setAdminLoading(true)
    setAdminError('')
    const { data, error: dbError } = await supabase
      .from('staffs')
      .select('*')
      .eq('token', adminToken.trim())
      .eq('is_active', true)
      .single()
    setAdminLoading(false)
    if (dbError || !data) {
      setAdminError('Invalid token. Access denied.')
      return
    }
    storeStaff(data)
    setShowAdminLogin(false)
    router.replace('/home')
  }

  useEffect(() => {
    supabase
      .from('staffs')
      .select('name')
      .eq('is_active', true)
      .order('id', { ascending: true })
      .then(({ data, error }) => {
        if (error) console.error('スタッフ名取得失敗:', error.message)
        else if (data) setStaffNames(data.map((s) => s.name).filter((n) => n !== 'いっさ'))
        setNamesLoading(false)
      })
  }, [])

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
    <>
      {showAdminLogin && (
        <MatrixAdminLogin
          adminToken={adminToken}
          setAdminToken={setAdminToken}
          adminError={adminError}
          adminLoading={adminLoading}
          onSubmit={handleAdminLogin}
          onBack={() => {
            setShowAdminLogin(false)
            setAdminToken('')
            setAdminError('')
          }}
        />
      )}

      <div className="flex items-center justify-center min-h-screen px-4 bg-gradient-to-b from-zinc-50 to-zinc-100">
        <Card className="w-full max-w-sm shadow-lg border-0">
          <CardHeader className="text-center pb-2">
            <button
              onClick={handleLogoTap}
              type="button"
              className="mx-auto mb-2 p-2 hover:bg-secondary rounded-lg transition-colors"
            >
              <CalendarDays className="h-8 w-8 text-zinc-900" />
            </button>
            <CardTitle className="text-2xl">タナカたなか シフト管理</CardTitle>
            <CardDescription>名前とパスワードでログインしてください</CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleLogin} className="space-y-4">
              <div>
                <label className="block text-sm font-medium mb-2">名前</label>
                <select
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  disabled={loading || namesLoading}
                  className="w-full h-10 rounded-md border border-input bg-background px-3 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <option value="">選択してください</option>
                  {staffNames.map((staffName) => (
                    <option key={staffName} value={staffName}>{staffName}</option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-sm font-medium mb-2">パスワード</label>
                <Input
                  type="password"
                  value={token}
                  onChange={(e) => setToken(e.target.value)}
                  placeholder="パスワードを入力"
                  disabled={loading}
                />
              </div>

              {error && <p className="text-sm text-red-600 text-center">{error}</p>}

              <Button type="submit" className="w-full" disabled={loading || namesLoading || !name}>
                {loading && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                ログイン
              </Button>
            </form>
          </CardContent>
        </Card>
      </div>
    </>
  )
}

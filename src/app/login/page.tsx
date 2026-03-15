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
function MatrixRain({ turbo = false, lastKeypressRef }: {
  turbo?: boolean
  lastKeypressRef?: React.MutableRefObject<number>
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const turboRef = useRef(false)
  const turboStartRef = useRef<number | null>(null)

  // turbo prop → ref に同期（draw ループはクロージャで ref を参照するため）
  useEffect(() => {
    if (turbo && !turboRef.current) {
      turboRef.current = true
      turboStartRef.current = Date.now()
    }
  }, [turbo])

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

    const drawFrame = () => {
      // turbo 進捗（0→1 over 1000ms）
      let t = 0
      if (turboRef.current && turboStartRef.current) {
        t = Math.min((Date.now() - turboStartRef.current) / 1000, 1)
      }
      const speedMult = 1 + t * 11   // 1x → 12x
      const brightness = t           // 0=緑 → 1=白

      // キータイプフィードバック: 直近150ms以内の入力でスピード+光バースト
      const sinceKey = lastKeypressRef?.current ? Date.now() - lastKeypressRef.current : 9999
      const keyPulse = sinceKey < 150 ? (1 - sinceKey / 150) : 0
      const effectiveSpeed = speedMult + keyPulse * 5
      const keyBright = keyPulse * 0.4

      // turbo 加速中はトレイルを短く（ハッキリ見せる）、最終盤は長め残像でグロー感
      const fadeAlpha = t > 0.7 ? 0.08 : t > 0.2 ? 0.12 : 0.05
      ctx.fillStyle = `rgba(0,0,0,${fadeAlpha})`
      ctx.fillRect(0, 0, canvas.width, canvas.height)
      ctx.font = `${fontSize}px monospace`

      for (let i = 0; i < drops.length; i++) {
        const char = chars[Math.floor(Math.random() * chars.length)]
        const x = i * fontSize
        const y = drops[i] * fontSize

        if (brightness > 0.05) {
          // 緑 → 白 へ補間。先頭文字は常に白く輝く
          const isHead = Math.random() < 0.15 + brightness * 0.6
          if (isHead) {
            ctx.fillStyle = `rgba(255,255,255,${0.85 + brightness * 0.15})`
          } else {
            const r = Math.min(255, Math.floor(brightness * 240))
            const g = Math.min(255, Math.floor(120 + brightness * 135))
            const b = Math.min(255, Math.floor(brightness * 240))
            ctx.fillStyle = `rgba(${r},${g},${b},${0.6 + brightness * 0.4})`
          }
        } else if (Math.random() > 0.5) {
          ctx.fillStyle = '#fff'
          ctx.fillText(char, x, y)
          ctx.fillStyle = '#0f0'
        } else {
          ctx.fillStyle = `rgba(0,${150 + Math.random() * 105},0,${0.5 + Math.random() * 0.5})`
        }
        ctx.fillText(char, x, y)

        // turbo 中は画面外ドロップを即リセット（密度を維持）
        if (drops[i] * fontSize > canvas.height) {
          drops[i] = turboRef.current ? Math.random() * -10 : (Math.random() > 0.975 ? 0 : drops[i])
        }
        drops[i] += effectiveSpeed
      }
    }

    // requestAnimationFrame でループ
    // turbo 中は毎フレーム（~60fps）描画、通常時は 50ms スロットル（~20fps）
    let rafId: number
    let lastNormal = 0
    const loop = (now: number) => {
      rafId = requestAnimationFrame(loop)
      if (turboRef.current) {
        drawFrame()
      } else if (now - lastNormal >= 50) {
        lastNormal = now
        drawFrame()
      }
    }
    rafId = requestAnimationFrame(loop)
    return () => {
      cancelAnimationFrame(rafId)
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

/* ── Particle Explosion Canvas ── */
function ParticleCanvas({ active }: { active: boolean }) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const startedRef = useRef(false)

  useEffect(() => {
    if (!active || startedRef.current) return
    startedRef.current = true
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    canvas.width = window.innerWidth
    canvas.height = window.innerHeight

    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789@#$%&*!?<>{}[]'
    const cx = canvas.width / 2
    const cy = canvas.height / 2

    // 70 particles fly from center
    const particles = Array.from({ length: 70 }, () => {
      const angle = Math.random() * Math.PI * 2
      const speed = 3 + Math.random() * 8
      const size = 10 + Math.random() * 14
      const life = 0.8 + Math.random() * 0.7  // seconds
      const r = Math.random()
      const color = r < 0.6
        ? `hsl(${130 + Math.random() * 40},100%,${50 + Math.random() * 30}%)`
        : r < 0.85
          ? '#ffffff'
          : `hsl(${180 + Math.random() * 40},100%,70%)`
      return {
        x: cx, y: cy,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        char: chars[Math.floor(Math.random() * chars.length)],
        size, life, maxLife: life, color,
        rotation: Math.random() * Math.PI * 2,
        rotSpeed: (Math.random() - 0.5) * 0.3,
      }
    })

    const start = performance.now()
    let rafId: number

    const draw = (now: number) => {
      const elapsed = (now - start) / 1000
      ctx.clearRect(0, 0, canvas.width, canvas.height)

      let alive = false
      for (const p of particles) {
        const age = elapsed
        if (age >= p.maxLife) continue
        alive = true
        const progress = age / p.maxLife
        const alpha = 1 - progress
        p.x += p.vx
        p.y += p.vy
        p.vy += 0.18  // gravity
        p.vx *= 0.985  // air resistance
        p.rotation += p.rotSpeed

        ctx.save()
        ctx.translate(p.x, p.y)
        ctx.rotate(p.rotation)
        ctx.globalAlpha = alpha
        ctx.fillStyle = p.color
        ctx.shadowColor = p.color
        ctx.shadowBlur = 8 + (1 - progress) * 12
        ctx.font = `bold ${p.size}px monospace`
        ctx.textAlign = 'center'
        ctx.textBaseline = 'middle'
        ctx.fillText(p.char, 0, 0)
        ctx.restore()
      }

      if (alive) {
        rafId = requestAnimationFrame(draw)
      }
    }

    rafId = requestAnimationFrame(draw)
    return () => cancelAnimationFrame(rafId)
  }, [active])

  return (
    <canvas
      ref={canvasRef}
      className="fixed inset-0 pointer-events-none"
      style={{ zIndex: 36 }}
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
    // intervalRef をクロージャで保持し、setTimeout後に開始したintervalもアンマウント時に正しくクリアする
    // setTimeout内のreturnはuseEffectのcleanupにはならないため、外側で管理する必要がある
    let interval: ReturnType<typeof setInterval> | null = null
    const timeout = setTimeout(() => {
      let i = 0
      interval = setInterval(() => {
        if (i < text.length) {
          setDisplayed(text.slice(0, i + 1))
          i++
        } else {
          setDone(true)
          if (interval) clearInterval(interval)
        }
      }, speed)
    }, startDelay)
    return () => {
      clearTimeout(timeout)
      if (interval) clearInterval(interval)
    }
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
  turbo = false,
  onTurboDone,
}: {
  adminToken: string
  setAdminToken: (v: string) => void
  adminError: string
  adminLoading: boolean
  onSubmit: () => void
  onBack: () => void
  turbo?: boolean
  onTurboDone?: () => void
}) {
  const [phase, setPhase] = useState<'boot' | 'input' | 'auth' | 'success'>('boot')
  const [showAccepted, setShowAccepted] = useState(false)  // PASSCODE ACCEPTED. ポップ
  const [flashReady, setFlashReady] = useState(false)       // フラッシュ開始フラグ
  const [showGlitch, setShowGlitch] = useState(false)       // グリッチフラッシュ
  const lastKeypressRef = useRef<number>(0)                 // タイピングフィードバック

  // turbo 開始のタイムライン:
  //  0ms   → 雨加速
  //  550ms → グリッチ開始
  //  750ms → グリッチ終了
  //  800ms → PASSCODE ACCEPTED. ぽっ
  // 1200ms → フラッシュ開始
  // 5700ms → 画面遷移 (1200 + 4500)
  useEffect(() => {
    if (!turbo) return
    setPhase('success')
    const t0a = setTimeout(() => setShowGlitch(true), 550)
    const t0b = setTimeout(() => setShowGlitch(false), 750)
    const t1 = setTimeout(() => setShowAccepted(true), 800)
    const t2 = setTimeout(() => setFlashReady(true), 1200)
    const t3 = setTimeout(() => onTurboDone?.(), 5700)
    return () => { clearTimeout(t0a); clearTimeout(t0b); clearTimeout(t1); clearTimeout(t2); clearTimeout(t3) }
  }, [turbo, onTurboDone])
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
      <MatrixRain turbo={turbo} lastKeypressRef={lastKeypressRef} />
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
        @keyframes issaGlow {
          0%   { transform: scale(0.4); opacity: 0; }
          30%  { opacity: 1; }
          100% { transform: scale(7); opacity: 0.9; }
        }
        @keyframes issaFlash {
          0%   { opacity: 0; }
          30%  { opacity: 0; }
          60%  { opacity: 0.2; }
          80%  { opacity: 0.55; }
          100% { opacity: 1; }
        }
        @keyframes acceptedPop {
          0%   { transform: scale(0.25) translateY(16px); opacity: 0; filter: blur(8px); }
          55%  { transform: scale(1.05) translateY(-3px); opacity: 1; filter: blur(0); }
          75%  { transform: scale(0.98) translateY(1px); }
          100% { transform: scale(1)    translateY(0);   opacity: 1; }
        }
        @keyframes acceptedSweep {
          from { transform: skewX(-12deg) translateX(-120%); }
          to   { transform: skewX(-12deg) translateX(500%); }
        }
        @keyframes borderPulse {
          0%, 100% { box-shadow: 0 0 30px rgba(0,255,70,0.5), 0 0 80px rgba(0,255,70,0.2), inset 0 0 20px rgba(0,255,70,0.05); }
          50%      { box-shadow: 0 0 60px rgba(0,255,70,0.8), 0 0 140px rgba(0,255,70,0.3), inset 0 0 30px rgba(0,255,70,0.1); }
        }
        @keyframes welcomeFade {
          from { opacity: 0; transform: translateY(6px); }
          to   { opacity: 1; transform: translateY(0); }
        }
        @keyframes glitchScreen {
          0%   { opacity: 0; clip-path: inset(0 0 100% 0); }
          8%   { opacity: 1; clip-path: inset(20% 0 30% 0); transform: skewX(8deg) translateX(-4px); }
          16%  { clip-path: inset(50% 0 10% 0); transform: skewX(-6deg) translateX(6px); }
          24%  { clip-path: inset(5% 0 60% 0);  transform: skewX(4deg) translateX(-2px); }
          32%  { clip-path: inset(70% 0 5% 0);  transform: skewX(-10deg) translateX(8px); }
          40%  { clip-path: inset(30% 0 40% 0); transform: skewX(5deg) translateX(-5px); }
          50%  { clip-path: inset(0 0 0 0);      transform: skewX(0); }
          60%  { clip-path: inset(40% 0 20% 0); transform: skewX(-4deg) translateX(3px); }
          70%  { clip-path: inset(10% 0 55% 0); transform: skewX(7deg) translateX(-6px); }
          80%  { clip-path: inset(60% 0 15% 0); transform: skewX(-3deg) translateX(4px); }
          90%  { clip-path: inset(0 0 0 0);      transform: skewX(0); opacity: 0.8; }
          100% { opacity: 0; clip-path: inset(0 0 100% 0); }
        }
      `}</style>

      {/* ② グリッチフラッシュオーバーレイ */}
      {showGlitch && (
        <div
          className="fixed inset-0 pointer-events-none"
          style={{
            zIndex: 25,
            background: 'repeating-linear-gradient(0deg, rgba(0,255,60,0.15) 0px, rgba(0,255,60,0.15) 2px, transparent 2px, transparent 4px), rgba(0,220,50,0.08)',
            animation: 'glitchScreen 0.2s steps(1) forwards',
            mixBlendMode: 'screen',
          }}
        />
      )}

      {/* ⑥ パーティクル爆発（ACCEPTED 出現と同時） */}
      <ParticleCanvas active={showAccepted} />

      {/* PASSCODE ACCEPTED ポップ */}
      {showAccepted && (
        <div className="fixed inset-0 flex items-center justify-center pointer-events-none" style={{ zIndex: 35 }}>
          <div style={{
            animation: 'acceptedPop 0.4s cubic-bezier(0.34,1.56,0.64,1) forwards, borderPulse 1.5s ease-in-out 0.4s infinite',
            background: 'rgba(0,4,0,0.88)',
            border: '1px solid rgba(0,255,70,0.75)',
            borderRadius: '10px',
            padding: '30px 56px',
            textAlign: 'center',
            position: 'relative',
            overflow: 'hidden',
          }}>
            {/* スキャンラインスイープ */}
            <div style={{
              position: 'absolute', top: 0, left: 0,
              width: '35%', height: '100%',
              background: 'linear-gradient(90deg, transparent, rgba(0,255,70,0.18), transparent)',
              animation: 'acceptedSweep 0.7s ease-out 0.3s forwards',
            }} />
            {/* ラベル */}
            <p style={{
              color: '#00cc44', fontFamily: 'monospace', fontSize: '10px',
              letterSpacing: '0.22em', marginBottom: '14px',
              textTransform: 'uppercase', opacity: 0.75,
            }}>
              ✓ &nbsp; authentication&nbsp;successful
            </p>
            {/* メインテキスト */}
            <p style={{
              color: '#00ff88', fontFamily: 'monospace', fontSize: '24px',
              fontWeight: 'bold', letterSpacing: '0.07em',
              textShadow: '0 0 24px rgba(0,255,100,0.9), 0 0 48px rgba(0,255,100,0.4)',
              marginBottom: '10px',
            }}>
              PASSCODE ACCEPTED
            </p>
            {/* サブテキスト */}
            <p style={{
              color: '#ffffff', fontFamily: 'monospace', fontSize: '15px',
              letterSpacing: '0.05em', opacity: 0.9,
              textShadow: '0 0 12px rgba(255,255,255,0.6)',
              animation: 'welcomeFade 0.4s ease-out 0.45s both',
            }}>
              Welcome Issa&nbsp;&nbsp;^_^
            </p>
            {/* 区切り線 */}
            <div style={{
              marginTop: '18px',
              height: '1px',
              background: 'linear-gradient(90deg, transparent, rgba(0,255,70,0.5), transparent)',
            }} />
            <p style={{
              color: '#00ff44', fontFamily: 'monospace', fontSize: '9px',
              letterSpacing: '0.18em', marginTop: '10px', opacity: 0.45,
            }}>
              ROOT ACCESS GRANTED &nbsp;·&nbsp; CLEARANCE: OMEGA
            </p>
          </div>
        </div>
      )}

      {/* turbo 発光オーバーレイ（フラッシュ準備完了後に表示） */}
      {flashReady && (
        <>
          {/* 中央から広がる緑グロー */}
          <div className="fixed inset-0 z-30 pointer-events-none" style={{
            background: 'radial-gradient(circle at 50% 50%, rgba(0,255,60,0.75) 0%, rgba(0,200,0,0.25) 40%, transparent 65%)',
            animation: 'issaGlow 1.8s ease-out forwards',
          }} />
          {/* 全画面ホワイトフラッシュ（ぶわぁぁぁぁ） */}
          <div className="fixed inset-0 z-40 pointer-events-none" style={{
            background: 'linear-gradient(135deg, #00ff44 0%, #ffffff 60%)',
            animation: 'issaFlash 4.5s ease-in forwards',
          }} />
        </>
      )}

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
                      onChange={(e) => { setAdminToken(e.target.value); lastKeypressRef.current = Date.now() }}
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

            {/* Success phase - ぶわぁぁぁぁ直前 */}
            {phase === 'success' && (
              <div className="space-y-1.5 mt-4 font-mono text-xs">
                <p className="text-green-400">[OK] Token verified: <span className="text-white">████████████</span></p>
                <p className="text-green-400">[OK] Identity confirmed: <span className="text-white font-bold">ISSA</span></p>
                <p className="text-green-300">[OK] CLEARANCE LEVEL: <span className="text-yellow-300 font-bold">OMEGA</span></p>
                <p className="text-green-400 mt-3">{'>'} Initializing admin session...</p>
                <p className="text-green-400">{'>'} Loading all systems...</p>
                <div className="flex items-center gap-2 text-green-300 mt-2">
                  <Loader2 className="h-3 w-3 animate-spin" />
                  <span className="terminal-cursor font-bold tracking-widest">ACCESS GRANTED</span>
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
  const [turboMode, setTurboMode] = useState(false)

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
    // このログイン画面はいっさ専用
    if (data.name !== 'いっさ') {
      setAdminError('ACCESS RESTRICTED. Authorization level insufficient.')
      return
    }
    storeStaff(data)
    // ナビゲーションは turbo 演出が終わったあと onTurboDone で行う
    setTurboMode(true)
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
            setTurboMode(false)
          }}
          turbo={turboMode}
          onTurboDone={() => router.replace('/home')}
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

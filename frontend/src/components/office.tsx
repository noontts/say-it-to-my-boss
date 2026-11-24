import { useEffect, useEffectEvent, useRef, useState } from 'react'
import type { OfficeEntry } from '../services/practice'
import { createOfficeScene, deskCamera, officeAim, officeSpawn, officeWalkable, phonePosition, type OfficeCamera } from './office-scene'
import { officeReferences, ReferenceFacts, type OfficeReference } from './office-references'

const ringDelay = 10_000
const ringDuration = 12_000
const ringInterval = 1_400
const cameraPushDuration = 360

type OfficeProps = {
  inCall: boolean
  busy: boolean
  error: string
  start: (entry: OfficeEntry) => void
  fallback: () => void
}

type OfficeHUD = { remaining: number; phone: OfficeEntry | null; documents: OfficeReference[] }
const initialHUD: OfficeHUD = { remaining: -1, phone: null, documents: [] }

export function Office({ inCall, busy, error, start, fallback }: OfficeProps) {
  const canvas = useRef<HTMLCanvasElement>(null)
  const scene = useRef<ReturnType<typeof createOfficeScene>>(null)
  const player = useRef<OfficeCamera>({ ...officeSpawn })
  const keys = useRef(new Set<string>())
  const ringAt = useRef(0)
  const deadline = useRef(0)
  const nextRing = useRef(0)
  const audio = useRef<AudioContext | null>(null)
  const ringing = useRef<(() => void) | null>(null)
  const cameraPush = useRef<{ from: OfficeCamera; started: number } | null>(null)
  const choice = useRef<OfficeEntry | null>(null)
  const reading = useRef<OfficeReference | null>(null)
  const [entered, setEntered] = useState(false)
  const [locked, setLocked] = useState(false)
  const [captureFailed, setCaptureFailed] = useState(false)
  const [muted, setMuted] = useState(false)
  const [reference, setReference] = useState<OfficeReference | null>(null)
  const [committed, setCommitted] = useState<OfficeEntry | null>(null)
  const [hud, setHUD] = useState(initialHUD)
  const mutedNow = useRef(false)

  function capture() {
    const view = canvas.current
    if (!view || document.pointerLockElement === view) return
    // Older browsers return void from requestPointerLock.
    try {
      void Promise.resolve(view.requestPointerLock()).catch(() => setCaptureFailed(true))
    } catch {
      setCaptureFailed(true)
    }
  }

  function release() {
    keys.current.clear()
    if (document.pointerLockElement === canvas.current) document.exitPointerLock()
  }

  function enter() {
    const now = performance.now()
    ringAt.current = now + ringDelay
    deadline.current = ringAt.current + ringDuration
    nextRing.current = ringAt.current
    try {
      audio.current ??= new AudioContext()
      void audio.current.resume().catch(() => {})
    } catch { /* The alert and phone flash also signal the ring. */ }
    setEntered(true)
    capture()
  }

  function getPhone(now: number): OfficeEntry | null {
    const p = player.current
    if (now < ringAt.current || officeAim(p, phonePosition) === null) return null
    return now < deadline.current ? 'answer' : 'callback'
  }

  function openReference(document: OfficeReference) {
    if (choice.current || officeAim(player.current, document.position) === null) return
    reading.current = document
    setReference(document)
    release()
  }

  function closeReference() {
    reading.current = null
    setReference(null)
  }

  function interactWithPhone(entry: OfficeEntry) {
    const now = performance.now()
    if (reading.current || choice.current || busy || !entered || getPhone(now) !== entry) return
    choice.current = entry
    if (!window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      cameraPush.current = { from: { ...player.current }, started: now }
    }
    release()
    ringing.current?.()
    ringing.current = null
    setCommitted(entry)
    start(entry)
  }

  const onKeyDown = useEffectEvent((event: KeyboardEvent) => {
    if (choice.current || inCall || event.altKey || event.ctrlKey || event.metaKey) return
    const key = event.key.toLowerCase()
    if (reading.current) {
      if (!event.repeat && (key === 'escape' || key === 'e')) closeReference()
      return
    }
    if (key === 'w' || key === 'a' || key === 's' || key === 'd') {
      event.preventDefault()
      keys.current.add(key)
    }
    if (key !== 'e' || event.repeat) return
    const phone = getPhone(performance.now())
    if (phone) {
      interactWithPhone(phone)
      return
    }
    const reachable = officeReferences
      .map((document) => ({ document, aim: officeAim(player.current, document.position) }))
      .sort((a, b) => (a.aim ?? Infinity) - (b.aim ?? Infinity))[0]
    if (reachable.aim !== null) openReference(reachable.document)
  })

  const drawScene = useEffectEvent((renderer: NonNullable<typeof scene.current>) => {
    renderer.draw(inCall ? deskCamera : player.current, false)
  })
  const reportUnsupported = useEffectEvent(fallback)
  useEffect(() => {
    const view = canvas.current
    if (!view) return
    const renderer = createOfficeScene(view)
    if (!renderer) {
      reportUnsupported()
      return
    }
    scene.current = renderer
    drawScene(renderer)
    const lost = (event: Event) => {
      event.preventDefault()
      reportUnsupported()
    }
    view.addEventListener('webglcontextlost', lost)
    return () => {
      view.removeEventListener('webglcontextlost', lost)
      if (document.pointerLockElement === view) document.exitPointerLock()
      renderer.dispose()
      scene.current = null
      const context = audio.current
      audio.current = null
      if (context && context.state !== 'closed') void context.close().catch(() => {})
    }
  }, [])

  useEffect(() => {
    if (!entered || committed || inCall) return
    const view = canvas.current
    const down = (event: KeyboardEvent) => onKeyDown(event)
    const up = (event: KeyboardEvent) => keys.current.delete(event.key.toLowerCase())
    const clear = () => keys.current.clear()
    const lock = () => {
      const acquired = document.pointerLockElement === view
      if (acquired && (reading.current || choice.current)) {
        document.exitPointerLock()
        return
      }
      setLocked(acquired)
      if (acquired) setCaptureFailed(false)
      clear()
    }
    const look = (event: MouseEvent) => {
      if (!view || document.pointerLockElement !== view || reading.current || choice.current) return
      player.current.angle += event.movementX * 0.0025
      const pitch = (player.current.pitch ?? 0) - event.movementY * 0.0025
      player.current.pitch = Math.max(-0.85, Math.min(0.85, pitch))
    }
    document.addEventListener('keydown', down)
    document.addEventListener('keyup', up)
    document.addEventListener('mousemove', look)
    const lockFailed = () => setCaptureFailed(true)
    document.addEventListener('pointerlockchange', lock)
    document.addEventListener('pointerlockerror', lockFailed)
    document.addEventListener('visibilitychange', clear)
    window.addEventListener('blur', clear)
    return () => {
      document.removeEventListener('keydown', down)
      document.removeEventListener('keyup', up)
      document.removeEventListener('mousemove', look)
      document.removeEventListener('pointerlockchange', lock)
      document.removeEventListener('pointerlockerror', lockFailed)
      document.removeEventListener('visibilitychange', clear)
      window.removeEventListener('blur', clear)
      clear()
    }
  }, [entered, inCall, committed])

  useEffect(() => {
    if (!entered || committed || inCall) return
    let frame = 0
    let last = performance.now()
    let previousHUD = ''
    function tick(now: number) {
      if (choice.current) return
      const p = player.current
      move(p, keys.current, Math.min(0.05, Math.max(0, (now - last) / 1000)))
      last = now
      const remaining = now < ringAt.current ? -1 : Math.max(0, Math.ceil((deadline.current - now) / 1000))
      if (remaining > 0 && !mutedNow.current && now >= nextRing.current) {
        nextRing.current = now + ringInterval
        ringing.current = playRing(audio.current, p)
      } else if (remaining === 0) {
        ringing.current?.()
        ringing.current = null
      }
      const phone = getPhone(now)
      const documents = officeReferences.filter((document) => officeAim(p, document.position) !== null)
      const nextHUD = [remaining, phone, ...documents.map((document) => document.id)].join('/')
      if (nextHUD !== previousHUD) {
        previousHUD = nextHUD
        setHUD({ remaining, phone, documents })
      }
      scene.current?.draw(p, remaining > 0 && Math.floor(now / 280) % 2 === 0)
      frame = requestAnimationFrame(tick)
    }
    frame = requestAnimationFrame(tick)
    return () => {
      cancelAnimationFrame(frame)
      ringing.current?.()
      ringing.current = null
    }
  }, [entered, inCall, committed])

  useEffect(() => {
    if (!inCall && !committed) return
    let frame = 0
    function draw(now: number) {
      const transition = cameraPush.current
      const fraction = transition ? Math.min(1, Math.max(0, (now - transition.started) / cameraPushDuration)) : 1
      scene.current?.draw(transition ? slideToDesk(transition.from, fraction) : deskCamera, false)
      if (fraction < 1) frame = requestAnimationFrame(draw)
      else cameraPush.current = null
    }
    draw(performance.now())
    return () => cancelAnimationFrame(frame)
  }, [inCall, committed])

  const seated = inCall || Boolean(committed)
  return (
    <section className="office" aria-label={seated ? 'มุมมองโต๊ะทำงาน' : 'ออฟฟิศ'}>
      <canvas ref={canvas} width={384} height={216} className="office-view" aria-label="มุมมองออฟฟิศ"
        onClick={() => entered && !seated && !reference && capture()} />
      {seated ? (
        <div className="office-desk-label">
          <span>โต๊ะทำงาน</span>
          {!inCall && (error
            ? <button className="button primary" disabled={busy} onClick={() => committed && start(committed)}>ลองเริ่มสายอีกครั้ง</button>
            : <p role="status">กำลังต่อสาย…</p>)}
        </div>
      ) : !entered ? (
        <div className="office-overlay">
          <h3>ก่อนหัวหน้าโทรมา</h3>
          <p>สำรวจออฟฟิศ อ่านเอกสาร แล้วกลับมารับสายที่โต๊ะ</p>
          <button className="button primary" onClick={enter}>เข้าออฟฟิศ</button>
        </div>
      ) : (
        <>
          <div className="office-hud">
            <p>WASD เดิน · เมาส์มอง · E โต้ตอบ · Esc ปล่อยเมาส์</p>
            <button className="office-icon-button" aria-pressed={!muted} onClick={() => {
              mutedNow.current = !mutedNow.current
              setMuted(mutedNow.current)
              if (mutedNow.current) {
                ringing.current?.()
                ringing.current = null
              }
            }}>{muted ? 'เปิดเสียงเรียกเข้า' : 'ปิดเสียงเรียกเข้า'}</button>
          </div>
          {hud.remaining >= 0 && (
            <div className="office-ring" data-active={hud.remaining > 0} role="status">
              {hud.remaining > 0 ? (
                <><span>สายเรียกเข้าจากหัวหน้า</span><strong role="timer" aria-live="off">เหลือ {hud.remaining} วินาที</strong></>
              ) : 'ไม่ได้รับสายหัวหน้าทันเวลา'}
            </div>
          )}
          {!reference && (
            <>
              <span className="office-crosshair" aria-hidden="true" />
              <div className="office-actions">
                {hud.phone && <button className="button primary" onClick={() => hud.phone && interactWithPhone(hud.phone)}>
                  {hud.phone === 'answer' ? 'รับสาย' : 'โทรกลับ'}
                </button>}
                {hud.documents.map((document) => <button key={document.id} className="office-icon-button"
                  onClick={() => openReference(document)}>{document.action}</button>)}
                {!locked && <button className="office-icon-button" onClick={capture}>คลิกเพื่อควบคุมมุมมอง</button>}
                {captureFailed && <button className="office-icon-button" onClick={fallback}>เริ่มคุยโดยตรง</button>}
              </div>
            </>
          )}
          {reference && (
            <section className="office-document" role="dialog" aria-labelledby="office-reference-title">
              <h3 id="office-reference-title">{reference.title}</h3>
              <ReferenceFacts reference={reference} />
              <button className="office-icon-button" autoFocus onClick={closeReference}>ปิดเอกสาร</button>
            </section>
          )}
        </>
      )}
    </section>
  )
}

function move(player: OfficeCamera, keys: Set<string>, deltaSeconds: number) {
  const forward = Number(keys.has('w')) - Number(keys.has('s'))
  const sideways = Number(keys.has('d')) - Number(keys.has('a'))
  if (!forward && !sideways) return
  const speed = deltaSeconds * 2.1 / Math.hypot(forward, sideways)
  const dx = (Math.cos(player.angle) * forward - Math.sin(player.angle) * sideways) * speed
  const dy = (Math.sin(player.angle) * forward + Math.cos(player.angle) * sideways) * speed
  if (officeWalkable(player.x + dx, player.y)) player.x += dx
  if (officeWalkable(player.x, player.y + dy)) player.y += dy
}

function slideToDesk(from: OfficeCamera, fraction: number): OfficeCamera {
  const progress = 1 - (1 - fraction) ** 3
  const blend = (a: number, b: number) => a + (b - a) * progress
  const angleDelta = deskCamera.angle - from.angle
  return {
    x: blend(from.x, deskCamera.x),
    y: blend(from.y, deskCamera.y),
    angle: from.angle + Math.atan2(Math.sin(angleDelta), Math.cos(angleDelta)) * progress,
    pitch: blend(from.pitch ?? 0, deskCamera.pitch ?? 0),
    height: blend(from.height ?? 1.55, deskCamera.height ?? 1.55),
  }
}

function playRing(context: AudioContext | null, player: OfficeCamera) {
  if (!context || context.state !== 'running') return null
  const oscillator = context.createOscillator()
  const gain = context.createGain()
  const pan = context.createStereoPanner()
  const dx = phonePosition[0] - player.x, dy = phonePosition[1] - player.y
  const distance = Math.hypot(dx, dy)
  pan.pan.value = (-Math.sin(player.angle) * dx + Math.cos(player.angle) * dy) / Math.max(0.2, distance)
  const peak = 0.12 / (1 + distance * 0.32)
  const now = context.currentTime
  gain.gain.setValueAtTime(0, now)
  for (const offset of [0, 0.22]) {
    gain.gain.linearRampToValueAtTime(peak, now + offset + 0.035)
    gain.gain.setValueAtTime(peak, now + offset + 0.11)
    gain.gain.linearRampToValueAtTime(0, now + offset + 0.16)
  }
  oscillator.type = 'triangle'
  oscillator.frequency.value = 660
  oscillator.connect(gain).connect(pan).connect(context.destination)
  oscillator.onended = () => {
    oscillator.disconnect()
    gain.disconnect()
    pan.disconnect()
  }
  oscillator.start(now)
  oscillator.stop(now + 0.4)
  return () => {
    if (context.state !== 'closed') gain.gain.cancelScheduledValues(context.currentTime)
    gain.gain.value = 0
  }
}

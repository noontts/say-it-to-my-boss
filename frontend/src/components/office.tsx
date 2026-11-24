import { useEffect, useEffectEvent, useRef, useState } from 'react'
import { playIncomingRing } from './incoming-ring'
import { createOfficeScene, deskCamera, officePhoneInReach, officeSpawn, officeWalkable, type OfficeCamera } from './office-scene'

export const officeRingDelay = 5_000
const ringInterval = 1_400
const movementKeys = new Set(['w', 'a', 's', 'd', 'arrowleft', 'arrowright'])
const touchControls = [
  { key: 'w', label: 'เดินหน้า', icon: '↑' },
  { key: 'a', label: 'เดินซ้าย', icon: '←' },
  { key: 's', label: 'เดินถอยหลัง', icon: '↓' },
  { key: 'd', label: 'เดินขวา', icon: '→' },
] as const

type OfficeIncoming = {
  ringAt: number
  character: string
  audio: AudioContext | null
  busy: boolean
  error: string
  answer: () => void
}

export function Office({ incoming }: { incoming?: OfficeIncoming }) {
  const canvas = useRef<HTMLCanvasElement>(null)
  const heading = useRef<HTMLHeadingElement>(null)
  const answerButton = useRef<HTMLButtonElement>(null)
  const camera = useRef<OfficeCamera>({ ...officeSpawn })
  const keys = useRef(new Set<string>())
  const drag = useRef<{ pointer: number; x: number; y: number } | null>(null)
  const answerLocked = useRef(false)
  const stopRing = useRef<(() => void) | undefined>(undefined)
  const nextRing = useRef(0)
  const muted = useRef(false)
  const [ringMuted, setRingMuted] = useState(false)
  const [rendererUnavailable, setRendererUnavailable] = useState(false)
  const [ringing, setRinging] = useState(false)
  const [phoneInReach, setPhoneInReach] = useState(false)
  const exploring = Boolean(incoming)
  const error = incoming?.error
  const ringAt = incoming?.ringAt

  function answer() {
    if (!incoming || performance.now() < incoming.ringAt || incoming.busy || answerLocked.current) return
    if (!rendererUnavailable && !officePhoneInReach(camera.current)) return
    answerLocked.current = true
    keys.current.clear()
    stopRing.current?.()
    stopRing.current = undefined
    if (canvas.current && document.pointerLockElement === canvas.current) document.exitPointerLock()
    incoming.answer()
  }

  const onKeyDown = useEffectEvent((event: KeyboardEvent) => {
    if (event.altKey || event.ctrlKey || event.metaKey) return
    const key = event.key.toLowerCase()
    if (movementKeys.has(key)) {
      event.preventDefault()
      keys.current.add(key)
    }
    if (key === 'e' && !event.repeat) answer()
  })

  const onFrame = useEffectEvent((now: number) => {
    if (!incoming || now < incoming.ringAt || answerLocked.current) return false
    if (!muted.current && now >= nextRing.current) {
      nextRing.current = now + ringInterval
      try {
        stopRing.current = playIncomingRing(incoming.audio, camera.current)
      } catch { /* The phone still flashes if audio cannot play. */ }
    }
    return true
  })

  useEffect(() => {
    if (exploring) heading.current?.focus()
  }, [exploring])

  useEffect(() => {
    if (error) {
      answerLocked.current = false
      answerButton.current?.focus()
    }
  }, [error])

  useEffect(() => {
    const view = canvas.current
    if (!view) return
    const scene = createOfficeScene(view)
    if (!scene) {
      setRendererUnavailable(true)
      return
    }

    const lost = (event: Event) => {
      event.preventDefault()
      setRendererUnavailable(true)
    }
    view.addEventListener('webglcontextlost', lost)
    let frame = 0
    let last = performance.now()
    let wasRinging = false
    let wasInReach = false
    function tick(now: number) {
      if (!scene) return
      if (!answerLocked.current) move(camera.current, keys.current, Math.min(0.05, Math.max(0, now - last) / 1_000))
      last = now
      const isRinging = onFrame(now)
      const inReach = officePhoneInReach(camera.current)
      if (isRinging !== wasRinging && !answerLocked.current) {
        wasRinging = isRinging
        setRinging(isRinging)
      }
      if (inReach !== wasInReach) {
        wasInReach = inReach
        setPhoneInReach(inReach)
      }
      scene.draw(answerLocked.current ? deskCamera : camera.current, isRinging && Math.floor(now / 280) % 2 === 0)
      frame = requestAnimationFrame(tick)
    }
    if (exploring) frame = requestAnimationFrame(tick)
    else scene.draw(deskCamera, false)
    return () => {
      cancelAnimationFrame(frame)
      stopRing.current?.()
      view.removeEventListener('webglcontextlost', lost)
      if (document.pointerLockElement === view) document.exitPointerLock()
      scene.dispose()
    }
  }, [exploring, rendererUnavailable])

  useEffect(() => {
    if (!rendererUnavailable || ringAt === undefined) return
    const timeout = window.setTimeout(() => setRinging(true), Math.max(0, ringAt - performance.now()))
    return () => window.clearTimeout(timeout)
  }, [rendererUnavailable, ringAt])

  useEffect(() => {
    if (!exploring) return
    const down = (event: KeyboardEvent) => onKeyDown(event)
    const up = (event: KeyboardEvent) => keys.current.delete(event.key.toLowerCase())
    const clear = () => keys.current.clear()
    const look = (event: MouseEvent) => {
      if (document.pointerLockElement === canvas.current && canvas.current) {
        turn(camera.current, event.movementX ?? 0, event.movementY ?? 0)
      }
    }
    document.addEventListener('keydown', down)
    document.addEventListener('keyup', up)
    document.addEventListener('mousemove', look)
    document.addEventListener('pointerlockchange', clear)
    document.addEventListener('visibilitychange', clear)
    window.addEventListener('blur', clear)
    return () => {
      document.removeEventListener('keydown', down)
      document.removeEventListener('keyup', up)
      document.removeEventListener('mousemove', look)
      document.removeEventListener('pointerlockchange', clear)
      document.removeEventListener('visibilitychange', clear)
      window.removeEventListener('blur', clear)
      clear()
    }
  }, [exploring])

  if (!incoming && rendererUnavailable) return null

  return (
    <section className={incoming ? 'office office-exploring' : 'office'}
      aria-label={incoming ? 'ออฟฟิศ' : 'มุมมองโต๊ะทำงาน'}>
      {!rendererUnavailable && (
        <canvas ref={canvas} width={384} height={216} className="office-view" aria-label="มุมมองออฟฟิศ"
          onPointerDown={(event) => {
            if (!incoming || incoming.busy || document.pointerLockElement === event.currentTarget) return
            drag.current = { pointer: event.pointerId, x: event.clientX, y: event.clientY }
            event.currentTarget.setPointerCapture(event.pointerId)
            if (event.pointerType === 'mouse') {
              try {
                void Promise.resolve(event.currentTarget.requestPointerLock?.()).catch(() => {})
              } catch { /* Dragging and the arrow keys also turn the camera. */ }
            }
          }}
          onPointerMove={(event) => {
            const point = drag.current
            if (!point || point.pointer !== event.pointerId || document.pointerLockElement === event.currentTarget) return
            turn(camera.current, event.clientX - point.x, event.clientY - point.y)
            drag.current = { pointer: event.pointerId, x: event.clientX, y: event.clientY }
          }}
          onLostPointerCapture={() => { drag.current = null }} />
      )}
      {incoming && (
        <>
          <div className="office-hud">
            <h1 tabIndex={-1} ref={heading}>ออฟฟิศ</h1>
            {!rendererUnavailable && !incoming.busy && (
              <>
                <p className="office-keyboard">WASD เดิน · เมาส์หรือลูกศรซ้ายขวามอง · E รับสาย</p>
                <p className="office-touch-label">กดลูกศรเพื่อเดิน · ลากเพื่อมอง</p>
                <button type="button" className="office-control" aria-pressed={ringMuted} onClick={() => {
                  muted.current = !muted.current
                  setRingMuted(muted.current)
                  if (muted.current) stopRing.current?.()
                }}>ปิดเสียงเรียกเข้า</button>
              </>
            )}
          </div>
          {!rendererUnavailable && !incoming.busy && <span className="office-crosshair" aria-hidden="true" />}
          <div className="office-phone">
            {incoming.busy ? <p role="status">กำลังต่อสาย…</p> : (
              <>
                <p role="status">{ringing ? `สายเรียกเข้าจาก ${incoming.character}` : 'เดินสำรวจออฟฟิศระหว่างรอสาย'}</p>
                {ringing && !rendererUnavailable && !phoneInReach && <p>เดินไปที่โต๊ะเพื่อรับสาย</p>}
              </>
            )}
            {error && <p role="alert">{error}</p>}
            {ringing && (rendererUnavailable || phoneInReach) && (
              <button type="button" className="game-button" ref={answerButton}
                disabled={incoming.busy} onClick={answer}>รับสาย</button>
            )}
          </div>
          {!rendererUnavailable && !incoming.busy && (
            <div className="office-touch" aria-label="ปุ่มเดิน">
              {touchControls.map(({ key, label, icon }) => (
                <button key={key} type="button" className="office-control" aria-label={label} onPointerDown={(event) => {
                  keys.current.add(key)
                  event.currentTarget.setPointerCapture(event.pointerId)
                }} onLostPointerCapture={() => keys.current.delete(key)}>{icon}</button>
              ))}
            </div>
          )}
        </>
      )}
    </section>
  )
}

function turn(camera: OfficeCamera, dx: number, dy: number) {
  camera.angle += dx * 0.0025
  camera.pitch = Math.max(-0.85, Math.min(0.85, (camera.pitch ?? 0) - dy * 0.0025))
}

function move(player: OfficeCamera, keys: Set<string>, seconds: number) {
  player.angle += (Number(keys.has('arrowright')) - Number(keys.has('arrowleft'))) * 1.6 * seconds
  const forward = Number(keys.has('w')) - Number(keys.has('s'))
  const sideways = Number(keys.has('d')) - Number(keys.has('a'))
  if (!forward && !sideways) return
  const speed = seconds * 2.1 / Math.hypot(forward, sideways)
  const dx = (Math.cos(player.angle) * forward - Math.sin(player.angle) * sideways) * speed
  const dy = (Math.sin(player.angle) * forward + Math.cos(player.angle) * sideways) * speed
  if (officeWalkable(player.x + dx, player.y)) player.x += dx
  if (officeWalkable(player.x, player.y + dy)) player.y += dy
}

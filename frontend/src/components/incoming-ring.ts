import { phonePosition, type OfficeCamera } from './office-scene'

export function playIncomingRing(context: AudioContext | null, player: OfficeCamera) {
  if (!context || context.state !== 'running') return

  const now = context.currentTime
  if (!Number.isFinite(now)) return
  const oscillator = context.createOscillator()
  const gain = context.createGain()
  const panner = context.createStereoPanner?.()
  const dx = phonePosition[0] - player.x
  const dy = phonePosition[1] - player.y
  const distance = Math.hypot(dx, dy)
  if (panner) {
    panner.pan.value = (-Math.sin(player.angle) * dx + Math.cos(player.angle) * dy) / Math.max(0.2, distance)
  }
  const peak = 0.12 / (1 + distance * 0.32)
  gain.gain.setValueAtTime(0, now)
  for (const offset of [0, 0.22]) {
    gain.gain.linearRampToValueAtTime(peak, now + offset + 0.035)
    gain.gain.setValueAtTime(peak, now + offset + 0.11)
    gain.gain.linearRampToValueAtTime(0, now + offset + 0.16)
  }
  oscillator.type = 'triangle'
  oscillator.frequency.value = 660
  oscillator.connect(gain)
  if (panner) gain.connect(panner).connect(context.destination)
  else gain.connect(context.destination)
  oscillator.onended = () => {
    oscillator.disconnect()
    gain.disconnect()
    panner?.disconnect()
  }
  oscillator.start(now)
  oscillator.stop(now + 0.4)
  return () => {
    if (context.state === 'closed') return
    const time = context.currentTime
    if (!Number.isFinite(time)) return
    gain.gain.cancelScheduledValues(time)
    gain.gain.setValueAtTime(0, time)
  }
}

// The short ring starts in the same gesture that draws the next scenario.
export function playIncomingRing() {
  if (typeof AudioContext === 'undefined') return

  let context: AudioContext
  try {
    context = new AudioContext()
  } catch {
    return
  }

  function stop() {
    if (context.state !== 'closed') void context.close().catch(() => {})
  }

  void context.resume().then(() => {
    if (context.state !== 'running') return
    const oscillator = context.createOscillator()
    const gain = context.createGain()
    const start = context.currentTime
    gain.gain.setValueAtTime(0, start)
    for (const offset of [0, 0.24]) {
      gain.gain.linearRampToValueAtTime(0.08, start + offset + 0.04)
      gain.gain.setValueAtTime(0.08, start + offset + 0.12)
      gain.gain.linearRampToValueAtTime(0, start + offset + 0.18)
    }
    oscillator.type = 'triangle'
    oscillator.frequency.value = 660
    oscillator.connect(gain).connect(context.destination)
    oscillator.onended = stop
    oscillator.start(start)
    oscillator.stop(start + 0.44)
  }).catch(stop)

  return stop
}

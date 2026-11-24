export const pcmStreamType = 'application/vnd.angry-boss.pcm'

const sampleRate = 24_000
const maxBytes = 8 * 1024 * 1024

function asWav(chunks: ArrayBuffer[], size: number) {
  const header = new ArrayBuffer(44)
  const view = new DataView(header)
  const bytes = new Uint8Array(header)
  const encoder = new TextEncoder()
  bytes.set(encoder.encode('RIFF'), 0)
  view.setUint32(4, 36 + size, true)
  bytes.set(encoder.encode('WAVEfmt '), 8)
  view.setUint32(16, 16, true)
  view.setUint16(20, 1, true)
  view.setUint16(22, 1, true)
  view.setUint32(24, sampleRate, true)
  view.setUint32(28, sampleRate * 2, true)
  view.setUint16(32, 2, true)
  view.setUint16(34, 16, true)
  bytes.set(encoder.encode('data'), 36)
  view.setUint32(40, size, true)
  return new Blob([header, ...chunks], { type: 'audio/wav' })
}

export function createPcmPlayback(context: AudioContext, rate: number, onStart: () => void, onEnd: () => void) {
  const sources = new Set<AudioBufferSourceNode>()
  let nextStart = 0
  let finished = false
  let cancelled = false
  let activeReader: ReadableStreamDefaultReader<Uint8Array> | undefined

  function queue(frame: ArrayBuffer) {
    const pcm = new DataView(frame)
    const buffer = context.createBuffer(1, frame.byteLength / 2, sampleRate)
    const samples = buffer.getChannelData(0)
    for (let index = 0; index < samples.length; index++) {
      samples[index] = pcm.getInt16(index * 2, true) / 32768
    }

    const source = context.createBufferSource()
    source.buffer = buffer
    source.playbackRate.value = rate
    source.connect(context.destination)
    source.onended = () => {
      source.disconnect()
      sources.delete(source)
      if (finished && sources.size === 0) onEnd()
    }
    const start = Math.max(nextStart, context.currentTime + 0.02)
    source.start(start)
    sources.add(source)
    if (!nextStart) onStart()
    nextStart = start + buffer.duration / rate
  }

  async function read(body: ReadableStream<Uint8Array>, onProgress: () => void) {
    const reader = body.getReader()
    activeReader = reader
    const chunks: ArrayBuffer[] = []
    let pending = new Uint8Array()
    let size = 0
    let wireBytes = 0
    try {
      while (!cancelled) {
        const { value, done } = await reader.read()
        if (done || cancelled) break
        onProgress()
        wireBytes += value.byteLength
        if (wireBytes > maxBytes) throw new Error('Voice stream exceeded the size limit')
        const bytes = new Uint8Array(pending.length + value.length)
        bytes.set(pending)
        bytes.set(value, pending.length)
        const view = new DataView(bytes.buffer)
        let offset = 0

        // Each frame starts with a 32-bit little-endian byte count. Zero marks clean EOF.
        while (bytes.length - offset >= 4) {
          const length = view.getUint32(offset, true)
          if (length === 0) {
            if (size === 0 || bytes.length - offset !== 4) throw new Error('Invalid voice stream ending')
            return asWav(chunks, size)
          }
          if (length % 2 || length + 8 > maxBytes) throw new Error('Invalid voice frame size')
          if (bytes.length - offset < length + 4) break
          const frame = bytes.slice(offset + 4, offset + 4 + length).buffer
          chunks.push(frame)
          size += length
          offset += length + 4
          queue(frame)
        }
        pending = bytes.slice(offset)
      }
      throw new Error('Voice stream stopped before the final frame')
    } finally {
      activeReader = undefined
      if (!cancelled) void reader.cancel().catch(() => {})
      reader.releaseLock()
    }
  }

  return {
    read,
    finish() {
      finished = true
      if (sources.size === 0) onEnd()
    },
    cancel() {
      cancelled = true
      void activeReader?.cancel().catch(() => {})
      for (const source of sources) {
        source.onended = null
        source.stop()
        source.disconnect()
      }
      sources.clear()
    },
  }
}

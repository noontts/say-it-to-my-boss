import { useEffect, useRef, useState } from 'react'
import { createOfficeScene, deskCamera } from './office-scene'

export function Office() {
  const canvas = useRef<HTMLCanvasElement>(null)
  const [unavailable, setUnavailable] = useState(false)

  useEffect(() => {
    const view = canvas.current
    if (!view) return

    const renderer = createOfficeScene(view)
    if (!renderer) {
      setUnavailable(true)
      return
    }

    renderer.draw(deskCamera)
    const lost = (event: Event) => {
      event.preventDefault()
      setUnavailable(true)
    }
    view.addEventListener('webglcontextlost', lost)
    return () => {
      view.removeEventListener('webglcontextlost', lost)
      renderer.dispose()
    }
  }, [])

  if (unavailable) return null

  return (
    <section className="office" aria-label="มุมมองโต๊ะทำงาน">
      <canvas ref={canvas} width={384} height={216} className="office-view" aria-label="มุมมองออฟฟิศ" />
    </section>
  )
}

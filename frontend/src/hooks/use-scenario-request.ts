import { useEffect, useState } from 'react'

type RequestState<T> =
  | { status: 'loading' }
  | { status: 'error' }
  | { status: 'ready'; data: T }

export function useScenarioRequest<T>(path: string) {
  const [state, setState] = useState<RequestState<T>>({ status: 'loading' })
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    const controller = new AbortController()

    async function load() {
      try {
        const response = await fetch(path, { signal: controller.signal })
        if (!response.ok) {
          throw new Error(`Scenario request failed with HTTP ${response.status}`)
        }
        const data: T = await response.json()
        if (!controller.signal.aborted) {
          setState({ status: 'ready', data })
        }
      } catch {
        if (!controller.signal.aborted) {
          setState({ status: 'error' })
        }
      }
    }

    void load()
    return () => controller.abort()
  }, [path, attempt])

  function retry() {
    setState({ status: 'loading' })
    setAttempt((previous) => previous + 1)
  }

  return { state, retry }
}

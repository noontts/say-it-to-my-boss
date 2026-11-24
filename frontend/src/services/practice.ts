const sessions = '/api/v1/sessions'

export type OfficeEntry = 'answer' | 'callback'

export interface Session {
  id: string
  scenarioId: string
  officeEntry?: OfficeEntry
  messages: { role: 'npc' | 'player'; text: string }[]
  objectives: { id: string; description: string }[]
  achieved: string[]
  turn: number
  turnLimit?: number
  trust: number
  mood: 'frustrated' | 'concerned' | 'reassured'
  status: 'active' | 'succeeded' | 'needs_practice'
  endReason?: 'silence' | 'player' | 'npc'
  mode: 'local' | 'ai'
  results?: {
    scores: Record<'clarity' | 'empathy' | 'professionalism' | 'problemSolving', number>
    strengths: string[]
    suggestions: string[]
    summary: string
    objectiveCompletion: number
  }
}

export interface TurnSubmission {
  requestId: string
  turn: number
  text: string
}

export class PracticeError extends Error {
  constructor(readonly status: number) {
    super(`Practice request failed with HTTP ${status}`)
  }
}

async function request(path: string, signal: AbortSignal, body?: object): Promise<Session> {
  const response = await fetch(path, {
    signal,
    ...(body && {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }),
  })
  if (!response.ok) throw new PracticeError(response.status)
  return response.json()
}

export function startSession(scenarioId: string, signal: AbortSignal, officeEntry?: OfficeEntry) {
  return request(sessions, signal, { scenarioId, ...(officeEntry && { officeEntry }) })
}

export function readSession(id: string, signal: AbortSignal) {
  return request(`${sessions}/${encodeURIComponent(id)}`, signal)
}

export function npcVoiceURL(session: Session, index: number) {
  if (session.messages[index]?.role !== 'npc') return undefined
  return `${sessions}/${encodeURIComponent(session.id)}/voice/${index}`
}

export function bossVoiceURL(session: Session, cue: 'interjection' | 'takeover' | 'reminder') {
  return `${sessions}/${encodeURIComponent(session.id)}/voice/${cue}`
}

export function sendMessage(id: string, input: TurnSubmission, signal: AbortSignal) {
  return request(`${sessions}/${encodeURIComponent(id)}/messages`, signal, input)
}

export function finishSession(id: string, signal: AbortSignal) {
  return request(`${sessions}/${encodeURIComponent(id)}/finish`, signal, {})
}

export function hangUpSession(id: string, input: { turn: number } | { reason: 'player' }, signal: AbortSignal) {
  return request(`${sessions}/${encodeURIComponent(id)}/hang-up`, signal, input)
}

export function updatePracticeURL(scenarioId?: string, sessionId?: string) {
  const url = new URL(window.location.href)
  url.searchParams.delete('scenario')
  url.searchParams.delete('session')
  if (scenarioId && sessionId) {
    url.searchParams.set('scenario', scenarioId)
    url.searchParams.set('session', sessionId)
  }
  window.history.replaceState(null, '', url)
}

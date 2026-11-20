export interface ScenarioSummary {
  id: string
  title: string
  profession: string
  character?: string
  description: string
  playable: boolean
}

export interface Choice {
  id: string
  text: string
  reaction: string
  feedback: string
}

export interface Turn {
  id: string
  prompt: string
  choices: Choice[]
}

export interface Scenario extends ScenarioSummary {
  turns: Turn[]
}

export interface ScenarioCatalog {
  scenarios: ScenarioSummary[]
}

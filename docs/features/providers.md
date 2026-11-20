# Dialogue and speech providers

Gin selects the dialogue provider at startup. The backend [entry point](../../backend/cmd/server/main.go) wires the provider and speech proxy. [README setup](../../README.md#run-locally) has commands for running them.

## Dialogue modes

| Startup configuration | Session mode | NPC replies and coaching |
| --- | --- | --- |
| OpenRouter settings empty | `local` | Scenario preset replies and phrase-based coaching |
| `MOCK_OPENROUTER=true` | `ai` | Sample Thai replies with local objective matching and coaching, without an OpenRouter request |
| Both `OPENROUTER_API_KEY` and `OPENROUTER_MODEL` set | `ai` | OpenRouter generates replies and coaching |

Mock mode takes precedence over the OpenRouter settings. Outside mock mode, setting only one OpenRouter variable prevents startup.

Local objective matching checks one reply at a time. Every cue group for an objective must have a Thai substring match, and any phrase within a group is sufficient. Each newly achieved objective adds 10 trust, capped at 20 per turn. Local coaching checks the combined player lines for two groups of phrases per score, worth 50 points each, and uses achieved and outstanding objectives for strengths and suggestions. [Local rules and scoring](../../backend/internal/game/results.go) · [Mock replies](../../backend/internal/game/mock_ai.go)

## OpenRouter contract

The Go client sends the persona, scenario, objectives, current state, and committed dialogue with the new player reply for each turn. The evaluation request sends the completed transcript. The configured model must support JSON object responses. The client uses a 20-second timeout, allows four simultaneous inferences and 30 starts per one-minute window across replies and evaluations, and expects one completed choice.

Go validates a reply's text, trust delta from −20 through 20, and list of known objective IDs before saving a turn. Coaching requires all four scores as integers from 0 through 100, zero to three strengths, one to three suggestions, and a summary. Coaching text items must be nonblank and at most 500 code points each. Go owns outcome and objective completion. [OpenRouter client](../../backend/internal/llm/openrouter.go) · [Turn validation](../../backend/internal/game/practice.go) · [Coaching validation](../../backend/internal/game/results.go)

## Generated Thai audio

1. The browser requests `GET /api/v1/sessions/:id/voice/:index` when an AI-mode NPC line needs generated audio. The index identifies a saved message, and the bundled line map takes precedence.
2. Gin looks up the session, requires a saved NPC message in AI mode, and posts its scenario ID and text to the configured worker at `/speak`. The proxy accepts a successful `audio/wav` response up to 8 MiB and uses a 25-second timeout. Worker failures return 502. The voice request is read-only and audio availability is independent of the saved turn. [Speech proxy](../../backend/internal/transport/http/voice.go)
3. The [Python worker](../../tts/server.py) binds to loopback, warms the VachanaTTS models at startup, and synthesizes WAVs on the CPU. It validates request size, scenario, and text length, and returns 503 while another synthesis holds the worker lock. It maps the boss to `th_m_1`, the project client to `th_f_1`, and the retail customer to `th_f_2`. The [character reference](../../playtest/thai-characters.json) records the voice and portrait direction used for the bundled assets.

The Go server defaults `TTS_BACKEND_URL` to `http://127.0.0.1:8091`. [Compose](../../compose.yaml) starts Vite and Gin, passes the OpenRouter credentials, and leaves worker startup and the mock and worker URL settings to the direct-run setup.

## Verification

The [OpenRouter integration tests](../../backend/internal/llm/openrouter_integration_test.go) use a local HTTP fake to exercise the real client, including retry after invalid data and timeout. The [speech proxy test](../../backend/internal/transport/http/voice_test.go) verifies forwarding saved character and dialogue to a local fake worker. [Browser tests](../../frontend/e2e/voice-call.spec.ts) stub the generated audio request to verify playback order and recovery when synthesis fails.

# Dialogue and speech providers

Gin selects the dialogue provider at startup. The backend [entry point](../../backend/cmd/server/main.go) wires the provider and speech proxy. [README setup](../../README.md#run-locally) has commands for running them.

## Dialogue modes

| Startup configuration | Session mode | NPC replies and coaching |
| --- | --- | --- |
| AI provider settings empty | `local` | Scenario preset replies and phrase-based coaching |
| `MOCK_OPENROUTER=true` | `ai` | Sample Thai replies with local objective matching and coaching |
| `LM_STUDIO_MODEL` set | `ai` | LM Studio generates replies and coaching on the configured server |
| Both `OPENROUTER_API_KEY` and `OPENROUTER_MODEL` set | `ai` | OpenRouter generates replies and coaching |

Mock mode takes precedence, followed by LM Studio, then OpenRouter. If neither mock mode nor LM Studio is selected, setting only one OpenRouter variable prevents startup. A request failure returns through the existing retry flow using the selected provider.

Local objective matching checks one reply at a time. Every cue group for an objective must have a Thai substring match, and any phrase within a group is sufficient. Each newly achieved objective adds 10 trust, capped at 20 per turn. Local coaching checks the combined player lines for two groups of phrases per score, worth 50 points each, and uses achieved and outstanding objectives for strengths and suggestions. [Local rules and scoring](../../backend/internal/game/results.go) · [Mock replies](../../backend/internal/game/mock_ai.go)

## AI dialogue contract

AI NPCs use short, spoken Thai in the scenario's voice. They can respond curtly or push back when the player mocks them or brushes them off, then ease up when the player apologizes or returns to the work.

The Go client uses English system instructions and asks both providers to respond in Thai. Each turn includes the persona, scenario, objectives, current state, committed dialogue, and new player reply. For coaching, LM Studio receives only the player's lines. OpenRouter receives the completed transcript and uses NPC lines as context. Both providers allow four simultaneous inferences and 30 starts per one-minute window across replies and evaluations, and expect one completed choice. OpenRouter uses JSON object mode and a 20-second timeout. LM Studio uses a JSON schema for each response type, requests reasoning off, and has a 30-second timeout. [LM Studio structured output](https://lmstudio.ai/docs/developer/openai-compat/structured-output)

Go validates a reply's text, trust delta from −20 through 20, list of known objective IDs, and required boolean `endCall` before saving an AI turn. The provider decides when to hang up based on the dialogue and includes a closing line when it does. The mock provider signals hang-up on its last preset reply. Coaching requires all four scores as integers from 0 through 100, zero to three strengths, one to three suggestions, and a summary. Coaching text items must be nonblank and at most 500 code points each. Go owns outcome and objective completion. [Chat completions client](../../backend/internal/llm/chat_completions.go) · [Turn validation](../../backend/internal/game/practice.go) · [Coaching validation](../../backend/internal/game/results.go)

## Generated Thai audio

1. The browser requests `GET /api/v1/sessions/:id/voice/:line` for every spoken NPC line in every dialogue mode. Numeric selectors identify saved NPC messages. For active boss calls, `interjection`, `takeover`, and `reminder` select server-defined lines triggered by the call UI.
2. Gin resolves the scenario and line from the saved session and sends them to the worker at `/speak`. When the browser requests `application/vnd.angry-boss.pcm`, Gin forwards the response incrementally with a 25-second limit. Each frame begins with a little-endian 32-bit length followed by signed 16-bit mono PCM at 24 kHz. A zero length marks successful completion. WAV remains available with the existing eight-second timeout. Both formats are limited to 8 MiB and leave the saved turn intact. [Speech proxy](../../backend/internal/transport/http/voice.go)
3. The [Python worker](../../tts/server.py) warms PyThaiTTS and ONNX Runtime before accepting requests. It voices the boss with `newvoice_male`, the project client with Paradee, and the retail customer with `newvoice_female`. Question marks become phrase boundaries in the speech input so MakHamTTS does not pronounce them as an extra glottal sound. Short lines use one synthesis pass to preserve phrasing. Longer lines use the MakHamTTS Thai chunker. The worker accepts one synthesis at a time, with up to one second of waiting when busy. [MakHamTTS model card](https://huggingface.co/pythainlp/MakHamTTS) · [Character reference](../../playtest/thai-characters.json)

The direct-run worker binds to loopback by default. Gin defaults `TTS_BACKEND_URL` to `http://127.0.0.1:8091`. [Compose](../../compose.yaml) uses a private service address for the worker and stores downloaded models in a named volume.

## Verification

The [OpenRouter integration tests](../../backend/internal/llm/openrouter_integration_test.go) use a local HTTP fake to exercise the real client, including retry after invalid data and timeout. The [speech proxy test](../../backend/internal/transport/http/voice_test.go) verifies forwarding openings, saved replies, and boss cues to a local fake worker in both dialogue modes. [Browser tests](../../frontend/e2e/voice-call.spec.ts) cover incremental streamed playback and recovery from a dropped stream, as well as WAV playback and failure.

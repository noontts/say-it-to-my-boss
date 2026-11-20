# ขอคุยกับหัวหน้า MVP roadmap

For current implementation details, see [practice sessions](docs/features/practice.md), [voice calls](docs/features/voice-calls.md), and [dialogue and speech providers](docs/features/providers.md).

The MVP lets players practice three difficult workplace conversations in Thai, reply by voice in a supporting browser, and receive coaching. Local mode uses scripted replies and phrase-based feedback. OpenRouter mode uses AI dialogue and evaluation.

## Phase 0 — Scripted practice · Complete

- React and Vite serve the Thai interface. Go and Gin load the scenario JSON and expose the catalog and scenario details under `/api/scenarios`.
- Players can complete a three-turn, multiple-choice practice session about a late report and see coaching on their choices. The refund and early-delivery scenarios are available to preview.

## Phase 1 — Backend sessions and free-text practice · Implemented

- Define the playable scenario data in JSON, including the NPC persona, opening line, player objectives, turn limit, and completion conditions.
- Add an in-memory session store and Gin endpoints under `/api/v1` to list scenarios, start and read sessions, and submit messages. Add `GET /health` and update the frontend to use the versioned routes.
- Connect the late-report screen to the session API with free-text input, conversation history, and Thai loading, error, and retry states. Use a fixed NPC reply to test the flow before connecting OpenRouter.
- Keep session progress on the server. Validate input and guard against duplicate or concurrent turns.

**Done when** a player can open the late-report scenario, submit a Thai reply, see the NPC response, and reload the session with the same conversation history.

## Phase 2 — AI NPC dialogue and game rules · Verified with a mock provider

- Add a backend OpenRouter client. Build prompts from the scenario, NPC persona, session state, and bounded conversation history.
- Validate structured model output before saving the turn. Let Go rules determine trust, mood, progress, and session outcomes. Keep trust within 0–100.
- Bound request size, rate, and inference time. Keep the OpenRouter key on the backend and keep private dialogue out of routine logs.

**Done when** the boss responds naturally in Thai and remembers prior turns. A timeout or invalid model response leaves the turn uncommitted and lets the player retry.

## Phase 3 — Thai voice input and output · Implemented

- Use browser speech recognition with `th-TH` where supported. Send the final transcript automatically when recording ends.
- Synthesize all NPC lines on the server with a distinct Thai voice for each character. Include a voice toggle, rate control, and on-screen dialogue. Stop the previous clip when a new reply plays.
- The call uses voice replies. Show microphone permission and compatibility messages, and keep the NPC caption and transcript available when Thai playback is unavailable.

**Done when** a player can dictate a Thai reply that sends automatically and hear the response in a supported browser. The transcript remains available on screen.

## Phase 4 — Results and coaching · Implemented

- Add the session finish endpoint and Thai results screen. Show the outcome, final trust, and communication scores for clarity, empathy, professionalism, problem solving, and objective completion.
- Validate the structured evaluation. Present strengths, suggestions, and a summary based on the conversation as practice feedback.
- Let players retry with a fresh session or return to scenario selection.

**Done when** both successful and unsuccessful conversations lead to a results screen, and retry starts a fresh conversation.

## Phase 5 — Three-scenario demo · Implemented

- Make the refund and early-delivery scenarios playable through the same session flow. Give each an NPC, objectives, and success and failure conditions suited to its workplace.
- Review Thai dialogue and coaching for natural register in each role. Add NPC portraits and simple speaking states.
- Verify each scenario end to end, including voice replies, model failure and retry, and the documented local and Compose setup.

**Done when** a player can start, finish, and replay any of the three scenarios and receive Thai coaching for each.

## Verification

- Go race-enabled tests and the frontend production build pass. Backend tests cover both outcomes and replay for all three scenarios, plus retry after invalid AI dialogue or coaching.
- All three scenarios were played through in Chrome with Docker Compose. Results survived reloads, replay started fresh, and injected service errors could be retried. The direct Go and Vite setup also passed a smoke test.
- Chrome completed native Thai playback and auto-submitted a transcript from a generated Thai audio track. Permission-denied fallback and playback controls were checked with simulated browser APIs.
- A local HTTP mock exercised the OpenRouter client and session API together for all three scenarios. It checked full dialogue history, Thai replies and coaching, both outcomes, timeout recovery, retry after invalid replies or scores, reload, and replay. No live provider call was made.

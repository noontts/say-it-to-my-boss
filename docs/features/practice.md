# Scenarios, practice sessions, and results

The [domain glossary](../../CONTEXT.md) names the concepts shared by the frontend and backend. For microphone behavior, interruptions, and call audio, read [Voice calls](voice-calls.md). For provider configuration and validation, read [Dialogue and speech providers](providers.md).

## Scenario catalog

| Scenario | Situation | Objectives |
| --- | --- | --- |
| [`angry-boss`](../../scenarios/angry-boss.json) | Explain a late report to a team lead who needs material for a meeting | Explain the delay and progress, give a partial delivery time, and commit to final delivery and a risk update |
| [`demanding-client`](../../scenarios/demanding-client.json) | Negotiate an early delivery request from a project client | Acknowledge the launch and team constraints, prioritize launch assets with a delivery time, and confirm when the rest and the next update will arrive |
| [`difficult-customer`](../../scenarios/difficult-customer.json) | Respond to a retail customer asking for a refund past the deadline | Acknowledge the inconvenience, explain the policy, and offer a service or warranty next step |

The [catalog loader](../../backend/internal/game/catalog.go) reads JSON at startup, validates scenario metadata and practice rules, rejects duplicate IDs, and lists scenarios by ID. All three scenarios have a practice spec with three preset turns for local and mock practice. The spec holds the persona, opening line, objectives and local cues, turn limit, minimum trust, and preset replies. The legacy multiple-choice script remains in the boss JSON and is exposed through the unversioned API. The game draws from playable versioned summaries. The presence of a practice spec determines playability. [Scenario routes](../../backend/internal/transport/http/scenarios.go)

## Session lifecycle

1. **เริ่มเกม** opens the first-person office and draws a playable scenario. The player can walk and look around as the desk phone waits five seconds, then rings with the selected caller. Near the desk, **รับสาย** or **E** creates the practice session and begins the call. Calls use the stationary desk view when rendering is supported. The existing API still accepts and restores office callback sessions.
2. Starting a session creates a random ID, saves the NPC opening line, and initializes turn `0` and an empty set of achieved objectives. An on-time answer or direct call starts with the usual opening, Trust 50, and concerned Mood. A callback starts with a line about the missed call, Trust 35, and frustrated Mood.
3. A submission carries `requestId`, zero-based `turn`, and `text`. Go trims the reply, validates it, and accepts one in-flight turn per session. It commits the player reply, NPC reply, and progress together after reply validation. A matching retry of an already committed request ID returns the latest snapshot, and reusing the ID with different input returns a conflict. A failed generation leaves the turn available for retry.
4. Go applies the reply's trust delta, clamps trust to 0–100, and accumulates known objective IDs. Mood is `frustrated` below 40, `reassured` at 70 or above, and `concerned` in between.
5. Local calls end at the preset turn limit. AI calls omit `turnLimit` and end when the provider sets `endCall` to true. Go saves the closing reply and `endReason: npc` with the final turn. At either kind of ending, the outcome is `succeeded` when every objective is achieved and trust meets the scenario minimum. The boss minimum is 50, and the other two are 65. Otherwise the outcome is `needs_practice`. Player and silence hang-ups set `needs_practice` and record `endReason` as `player` or `silence`. A manual hang-up cancels an in-flight reply and prevents it from committing.

Sessions and results live in Go process memory. Start, committed turns, hang-up, and saved results refresh the two-hour expiry. Reads leave expiry as stored. New sessions prune expired idle entries and the store caps at 1,000 sessions. A URL with `scenario` and `session` restores an active call or its practice score. An expired or missing session clears the URL and offers a fresh start. A saved office session restores the desk view on supported desktops. [Session rules](../../backend/internal/game/practice.go) · [Game entry](../../frontend/src/app.tsx) · [Practice page](../../frontend/src/pages/practice.tsx)

## Hint and practice score

**Hint** reveals the current scenario objectives during the call. The guidance is collapsed at first and does not affect objective progress or scoring.

The practice score appears automatically after the call and any closing audio. It is the whole-number percentage of objectives achieved in the final snapshot. **เล่นต่อ** clears the previous session URL and opens the office for the next round. The draw excludes the preceding scenario when another is playable. With a single playable scenario, the player can start a fresh session of that scenario.

The coaching endpoint remains available to API clients. The server validates and saves the first successful evaluation. Subsequent requests reuse saved results. [Evaluation and scoring](../../backend/internal/game/results.go) · [Practice score screen](../../frontend/src/components/practice-score.tsx)

## HTTP contract

| Route | Behavior |
| --- | --- |
| `GET /health` | Gin liveness |
| `GET /api/scenarios`, `GET /api/scenarios/:id` | Legacy catalog and scenario detail with the multiple-choice script when present |
| `GET /api/v1/scenarios`, `GET /api/v1/scenarios/:id` | Practice catalog and scenario summary |
| `POST /api/v1/sessions` | Create a session with `{ "scenarioId": "…" }` and optional `officeEntry` of `"answer"` or `"callback"` for `angry-boss`, returns 201 |
| `GET /api/v1/sessions/:id` | Read the saved session snapshot |
| `POST /api/v1/sessions/:id/messages` | Submit a reply, returns the updated snapshot |
| `POST /api/v1/sessions/:id/hang-up` | Send `{ "reason": "player" }` or, for boss silence, `{ "turn": 0 }` with the current turn |
| `POST /api/v1/sessions/:id/finish` | Evaluate a completed session or read its saved results |
| `GET /api/v1/sessions/:id/voice/:line` | Fetch synthesized audio for a saved NPC message or an active boss call cue |

Session JSON inputs parsed by the transport are capped at 8 KiB and reject unknown fields and trailing data. Player replies are capped at 1,000 Unicode code points and request IDs at 64 bytes. Session routes send `Cache-Control: no-store`. The JSON session API uses 400 for rejected input or an unplayable scenario, 404 for missing sessions or scenarios, 409 for state conflicts, 502 for reply or evaluation failures, and 503 at session capacity. On a submit conflict the UI checks whether the server has already advanced before asking the player to try again. [HTTP handlers](../../backend/internal/transport/http/practice.go) · [Frontend API client](../../frontend/src/services/practice.ts)

## Verification

The [game tests](../../backend/internal/game/) cover validation, idempotency, cancellation, and evaluation retry. The [desktop office tests](../../frontend/e2e/office.spec.ts) cover the desk, references, playback, fallback, and saved callback sessions. The [HTTP tests](../../backend/internal/transport/http/) exercise catalog loading, both outcomes and replay across all scenarios, silence hang-up, and the speech proxy. The browser journeys cover [random rounds and score restore](../../frontend/e2e/game-round.spec.ts), [Hint](../../frontend/e2e/call-hint.spec.ts), and [voice interaction](../../frontend/e2e/voice-call.spec.ts).

# Scenarios, practice sessions, and results

The [domain glossary](../../CONTEXT.md) names the concepts shared by the frontend and backend. For microphone behavior, interruptions, and call audio, read [Voice calls](voice-calls.md). For provider configuration and validation, read [Dialogue and speech providers](providers.md).

## Scenario catalog

| Scenario | Situation | Objectives |
| --- | --- | --- |
| [`angry-boss`](../../scenarios/angry-boss.json) | Explain a late report to a team lead who needs material for a meeting | Explain the delay and progress, give a partial delivery time, and commit to final delivery and a risk update |
| [`demanding-client`](../../scenarios/demanding-client.json) | Negotiate an early delivery request from a project client | Acknowledge the launch and team constraints, prioritize launch assets with a delivery time, and confirm when the rest and the next update will arrive |
| [`difficult-customer`](../../scenarios/difficult-customer.json) | Respond to a retail customer asking for a refund past the deadline | Acknowledge the inconvenience, explain the policy, and offer a service or warranty next step |

The [catalog loader](../../backend/internal/game/catalog.go) reads JSON at startup, validates scenario metadata and practice rules, rejects duplicate IDs, and lists scenarios by ID. All three scenarios have a practice spec and three turns. The spec holds the persona, opening line, objectives and local cues, turn limit, minimum trust, and preset replies. The legacy multiple-choice script remains in the boss JSON and is exposed through the unversioned API. The current picker uses versioned summaries, where the presence of a practice spec determines playability. [Scenario routes](../../backend/internal/transport/http/scenarios.go)

## Session lifecycle

1. Starting a session creates a random ID, saves the NPC opening line, and initializes turn `0`, trust `50`, mood `concerned`, and an empty set of achieved objectives.
2. A submission carries `requestId`, zero-based `turn`, and `text`. Go trims the reply, validates it, and accepts one in-flight turn per session. It commits the player reply, NPC reply, and progress together after reply validation. A matching retry of an already committed request ID returns the latest snapshot, and reusing the ID with different input returns a conflict. A failed generation leaves the turn available for retry.
3. Go applies the reply's trust delta, clamps trust to 0–100, and accumulates known objective IDs. Mood is `frustrated` below 40, `reassured` at 70 or above, and `concerned` in between.
4. At the turn limit, the outcome is `succeeded` when every objective is achieved and trust meets the scenario minimum. The boss minimum is 50, and the other two are 65. Otherwise the outcome is `needs_practice`. Either hang-up path also sets `needs_practice` and records `endReason` as `player` or `silence`. A manual hang-up cancels an in-flight reply and prevents it from committing.

Sessions and results live in Go process memory. Start, committed turns, hang-up, and saved results refresh the two-hour expiry. Reads leave expiry as stored. New sessions prune expired idle entries and the store caps at 1,000 sessions. In the UI, a URL with `scenario` and `session` restores server progress or saved results. An expired or missing session clears the URL and offers a fresh start. Replay creates a new session for the same scenario. [Session rules](../../backend/internal/game/practice.go) · [Picker](../../frontend/src/app.tsx) · [Practice page](../../frontend/src/pages/practice.tsx)

## Results

After a call ends, **ดูผลการฝึก** requests coaching. The server validates and saves the first successful evaluation. A failed evaluation leaves the finished session available for retry, and subsequent requests reuse saved results. Go computes objective completion as the integer percentage of achieved objectives. The UI shows that percentage alongside final trust, outcome, four communication scores (clarity, empathy, professionalism, problem solving), a summary, strengths when present, and suggestions. [Evaluation and scoring](../../backend/internal/game/results.go) · [Results screen](../../frontend/src/components/practice-results.tsx)

## HTTP contract

| Route | Behavior |
| --- | --- |
| `GET /health` | Gin liveness |
| `GET /api/scenarios`, `GET /api/scenarios/:id` | Legacy catalog and scenario detail with the multiple-choice script when present |
| `GET /api/v1/scenarios`, `GET /api/v1/scenarios/:id` | Practice catalog and scenario summary |
| `POST /api/v1/sessions` | Create a session with `{ "scenarioId": "…" }`, returns 201 |
| `GET /api/v1/sessions/:id` | Read the saved session snapshot |
| `POST /api/v1/sessions/:id/messages` | Submit a reply, returns the updated snapshot |
| `POST /api/v1/sessions/:id/hang-up` | Send `{ "reason": "player" }` or, for boss silence, `{ "turn": 0 }` with the current turn |
| `POST /api/v1/sessions/:id/finish` | Evaluate a completed session or read its saved results |
| `GET /api/v1/sessions/:id/voice/:index` | Fetch synthesized audio for a saved NPC message in AI mode |

Session JSON inputs parsed by the transport are capped at 8 KiB and reject unknown fields and trailing data. Player replies are capped at 1,000 Unicode code points and request IDs at 64 bytes. Session routes send `Cache-Control: no-store`. The JSON session API uses 400 for rejected input or an unplayable scenario, 404 for missing sessions or scenarios, 409 for state conflicts, 502 for reply or evaluation failures, and 503 at session capacity. On a submit conflict the UI checks whether the server has already advanced before asking the player to try again. [HTTP handlers](../../backend/internal/transport/http/practice.go) · [Frontend API client](../../frontend/src/services/practice.ts)

## Verification

The [game tests](../../backend/internal/game/) cover validation, idempotency, cancellation, and evaluation retry. The [HTTP tests](../../backend/internal/transport/http/) exercise catalog loading, both outcomes and replay across all scenarios, silence hang-up, and the speech proxy. [Browser tests](../../frontend/e2e/voice-call.spec.ts) exercise completion, saved results, and replay through the voice UI.

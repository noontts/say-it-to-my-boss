# Voice calls

The React [practice page](../../frontend/src/pages/practice.tsx) coordinates the session API, microphone, transcript, and NPC audio. Read [Scenarios, practice sessions, and results](practice.md) for server state and [Dialogue and speech providers](providers.md) for generated audio.

## Microphone and reply submission

- Starting a call requests the microphone and plays the opening line. Restoring an active call shows committed dialogue with the mic off until the player selects **เปิดไมค์**.
- The [speech recognition hook](../../frontend/src/hooks/use-speech-to-text.ts) uses the browser's standard or prefixed recognition API with `th-TH`, continuous listening, and interim results. Where available it requests a microphone track with echo cancellation and noise suppression. The browser handles recognition and Gin receives the finalized text.
- Interim text appears as a draft in the transcript. Final fragments are combined and submitted after an 850 ms pause, or when recognition ends with a buffered reply. Recognition restarts after 300 ms on end or no speech while the mic remains enabled. Muting or ending the call stops recognition and releases the capture track.
- The UI ignores recognized fragments while a request is pending, an unsent draft is visible, or the boss has taken over. It also filters fragments that match current or recent NPC audio. After a failed submission the player can retry the same text or discard it and speak again. An overlong draft can be discarded and re-recorded. Unsupported recognition and permission errors show Thai recovery messages. The call UI accepts replies by voice.

## Boss interruptions and silence

- In the boss scenario, with audio enabled, the UI rolls for an interruption once the player has spoken for 1.25 seconds and the interim answer reaches 30 code points. It rolls at most once per turn. The chance is 65% below trust 40, 40% from 40 through 69, and 15% at 70 or higher. One third of triggered interruptions are takeovers. A brief interjection lets the player continue. A takeover discards the current speech and resumes listening after the boss's line.
- For the boss only, eight consecutive seconds of waiting triggers one reminder per turn. Requesting mic access, submitting, playing the NPC, handling a takeover, or displaying a draft clears the timer. Muting the microphone still permits the timer to run.
- If the player remains silent for eight more seconds of waiting after the reminder, the UI requests hang-up for the current turn. The server checks the scenario and turn and appends the reminder and goodbye to the saved transcript. If the player answers after the reminder, the call continues. The UI keeps interjections and reminders in local state until reload, with the reminder and goodbye saved by the silence hang-up path. [Client timing and transcript](../../frontend/src/pages/practice.tsx) · [Server hang-up](../../backend/internal/game/practice.go)

## Playback and call ending

- The [voice hook](../../frontend/src/hooks/use-npc-voice.ts) selects a [bundled clip](../../frontend/src/data/npc-voices.json) by scenario and exact line, then falls back to the session audio URL when supplied. The scripted opening, local replies, and boss interruption, reminder, and goodbye lines use bundled MP3s.
- The player can toggle NPC playback and choose a speed. New audio stops prior playback, and enabling playback replays the current line. An audio error leaves the line visible and allows the call to proceed.
- Manual hang-up stops capture and playback and signals the end immediately. At the turn limit or on a silence hang-up, the final line normally plays before the end tone. The tone is gated by the speaker toggle and plays at most once per session in the page. Results use a separate request after the call ends.
- The transcript is visible during the call and scrolls as dialogue or draft text changes. The call also shows the portrait and speaking state, turn counter, objectives, and trust. [Voice controls and call rendering](../../frontend/src/pages/practice.tsx)

## Verification

The [Playwright suite](../../frontend/e2e/voice-call.spec.ts) simulates Thai recognition and covers microphone recovery, automatic submission and retry, playback controls, both interruptions, silence and manual hang-up, and closing audio order with successful and failed speech requests. The [test configuration](../../frontend/playwright.config.ts) starts Go in local mode and Vite on dedicated ports. Generated audio cases stub browser network responses.

# Voice calls

The React [practice page](../../frontend/src/pages/practice.tsx) coordinates the session API, microphone, transcript, and NPC audio. Read [Scenarios, practice sessions, and results](practice.md) for server state and [Dialogue and speech providers](providers.md) for generated audio.

## Microphone and reply submission

- Starting a call requests the microphone and plays the opening line. Restoring an active call shows committed dialogue with the mic off until the player selects **เปิดไมค์**.
- The [speech recognition hook](../../frontend/src/hooks/use-speech-to-text.ts) uses the browser's standard or prefixed recognition API with `th-TH`, continuous listening, and interim results. Where available it requests a microphone track with echo cancellation and noise suppression. The browser handles recognition and Gin receives the finalized text.
- Interim text appears as a draft in the transcript. Final fragments are combined and submitted after an 850 ms pause, or when recognition ends with a buffered reply. Recognition restarts after 300 ms on end or no speech while the mic remains enabled. Muting or ending the call stops recognition and releases the capture track.
- The UI ignores recognized fragments while a request is pending, an unsent draft is visible, or the boss has taken over. It also filters fragments that match current or recent NPC audio. After a failed submission the player can retry the same text or discard it and speak again. An overlong draft can be discarded and re-recorded. Unsupported recognition and permission errors show Thai recovery messages. If microphone access or recognition is unavailable, the player can type a reply. A typed draft pauses the silence timer.

## Boss interruptions and silence

- In the boss scenario, with audio enabled, the UI rolls for an interruption once the player has spoken for 1.25 seconds and the interim answer reaches 30 code points. It rolls at most once per turn. The chance is 65% below trust 40, 40% from 40 through 69, and 15% at 70 or higher. One third of triggered interruptions are takeovers. A brief interjection lets the player continue. A takeover discards the current speech and resumes listening after the boss's line.
- For the boss only, eight consecutive seconds of waiting triggers one reminder per turn. Requesting mic access, submitting, playing the NPC, handling a takeover, or displaying a draft clears the timer. Muting the microphone still permits the timer to run.
- If the player remains silent for eight more seconds of waiting after the reminder, the UI requests hang-up for the current turn. The server checks the scenario and turn and appends the reminder and goodbye to the saved transcript. If the player answers after the reminder, the call continues. The UI keeps interjections and reminders in local state until reload, with the reminder and goodbye saved by the silence hang-up path. [Client timing and transcript](../../frontend/src/pages/practice.tsx) · [Server hang-up](../../backend/internal/game/practice.go)

## Playback and call ending

- The [voice hook](../../frontend/src/hooks/use-npc-voice.ts) primes Web Audio and the reusable WAV player on the Start Call tap. A browser with an active audio context requests PCM and schedules each complete phrase as it arrives. WAV is available when streaming is unavailable and as a retry after a dropped stream. If autoplay is blocked, the player can tap to play.
- The player can toggle playback and choose a speed. New audio cancels prior playback or loading. The browser keeps the latest complete line as a WAV in memory for replay. If synthesis or playback fails, the transcript stays visible and the player can retry the audio.
- Manual hang-up stops capture and playback and signals the end immediately. When the NPC hangs up, the microphone stops and the closing line plays before the end tone. Preset endings and silence hang-ups also play their final line before the tone. The tone is gated by the speaker toggle and plays at most once per session in the page. Results use a separate request after the call ends.
- The transcript is visible during the call and scrolls as dialogue or draft text changes. The call also shows the portrait and speaking state, current turn, objectives, and trust. The turn counter shows a total for local calls. [Voice controls and call rendering](../../frontend/src/pages/practice.tsx)

## Verification

The mobile Chromium and WebKit [Playwright suite](../../frontend/e2e/voice-call.spec.ts) simulates Thai recognition and covers microphone recovery, automatic submission and retry, playback controls, both interruptions, silence and manual hang-up, and closing audio order with successful and failed speech requests. The [test configuration](../../frontend/playwright.config.ts) starts Go in local mode and Vite on dedicated ports. The default suite uses PCM and WAV fixtures. The focused live test streams audio from a running worker.

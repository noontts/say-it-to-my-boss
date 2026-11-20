# Thai character voice audition

Reviewed 20 November 2026.

Start with **ChindaTTS Kaitom** for พี่นนท์. Audition the same voice with a firm opening and a calmer follow-up. Compare it with **Gemini 3.8 Flash TTS** using the same lines if you want more precise direction over how the boss speaks. These are audition candidates. The game lines have yet to be compared in a blind listening test. [ChindaTTS samples](https://one.iapp.co.th/th/voice/chindatts) · [Google AI Studio](https://aistudio.google.com/generate-speech)

| Candidate | Why try it for this game |
| --- | --- |
| **iApp ChindaTTS** | Thai and mixed Thai-English speech with selectable styles such as `serious`, `calm`, and `empathetic`. The API can return WAV, which fits the game's current audio format. Test reliability before rollout because iApp labels the endpoint Alpha. [Listen to stock voices and styles](https://one.iapp.co.th/th/voice/chindatts) · [API docs](https://iapp.co.th/en/docs/speech/text-to-speech/text-to-speech-v3) |
| **Gemini 3.8 Flash TTS** | Thai support with directions for pace, accent, and tone. Use a single fixed voice for the boss, with subtle delivery changes for each line. Google's language table lists Thai for Flash TTS. The unary API returns WAV. [Try it in AI Studio](https://aistudio.google.com/generate-speech) · [Speech generation docs](https://ai.google.dev/gemini-api/docs/speech-generation#languages) |
| **ElevenLabs Eleven v4 Turbo** | Lists Thai and is designed for interactive dialogue. Audition a Thai-accented voice with restrained direction. The model guide lists a WebSocket dialogue API for this model, so test latency and integration effort separately from voice quality. The Thai demo gives a quick impression of available voices. Confirm its selected model when comparing. [Thai demo](https://elevenlabs.io/text-to-speech/thai) · [Model docs](https://elevenlabs.io/docs/overview/models#eleven-v4-turbo) |

For self-hosted evaluation, JaiTTS has a public demo. Its downloadable F5-TTS variant is a 1.35 GB research prototype under CC BY-NC 4.0. Use it as a comparison for noncommercial research. Verify the exact checkpoint's terms before choosing a deployable model. [JaiTTS demo](https://jaitts-demo.jts.co.th/) · [Checkpoint and terms](https://huggingface.co/JTS-AI/JaiTTS-F5TTS/tree/main)

## What to listen for

Use the same Thai lines and similar playback volume across the current VachanaTTS voices and the alternatives. Start with the boss opening, an interruption, and a calmer reply with a time or deadline. Ask native Thai listeners which sounds most like a person on a workplace call. Check natural pauses, phrase endings, Thai tones, and whether the same character remains recognizable as their mood changes. Include some English workplace terms and a number or date. [Current boss scenario](../../scenarios/angry-boss.json) · [Character directions](../../playtest/thai-characters.json)

- **พี่นนท์** sounds like a team lead who needs an answer soon. Try Kaitom in `serious` for the opening and `calm` after the player gives a clear plan.
- **คุณเมย์** gets to the point quickly and speaks politely. Audition a clear, conversational female voice on the [client opening](../../scenarios/demanding-client.json).
- **คุณอ้อย** sounds disappointed and still polite. Audition a separate female voice that can soften once the player offers a practical next step. [Customer opening](../../scenarios/difficult-customer.json)

For a first implementation trial, use a server-side provider setting for the boss. Keep the existing dialogue and playback flow, then compare time from reply text to audible playback on real calls. Keep a single voice per character across the opening, generated replies, and call cues. [Current synthesis endpoint](../../backend/internal/transport/http/voice.go) · [Voice call behavior](../features/voice-calls.md)

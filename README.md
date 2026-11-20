# ขอคุยกับหัวหน้า · Say It to My Boss

Practice three Thai workplace conversations about a late report, a refund past the deadline, or an early delivery request. Each scenario has three turns. Select **เริ่มคุย**, allow microphone access, and reply in Thai. The mic stays on during the call and sends each reply after a pause. Use **ปิดไมค์** to mute or **เปิดไมค์** to resume, including after reloading an active session. In the boss scenario, the boss sometimes cuts in during a longer answer. If the boss asks you to listen first, wait for the line to finish and answer again. After eight seconds without an answer, even if the mic is muted, the boss follows up once per turn with “ทำไมยังไม่ตอบครับ?” If there is still no answer eight seconds after the reminder, the boss says “งั้นไว้ค่อยคุยกันครับ” and ends the call. Use the red **วางสาย** button to end any call yourself. After the call, select **ดูผลการฝึก** to see your outcome, final trust, scores, and coaching, then replay or choose another scenario. Reload the session URL to resume the conversation or revisit saved results. Sessions are stored in backend memory and expire two hours after starting or last saving progress.

See the [feature documentation](docs/agents/domain.md) for current behavior and the [MVP roadmap](ROADMAP.md) for the implementation phases.

```text
frontend/
  src/                 React entry point, components, pages, hooks, services, stores, and types
  public/avatars/      Character assets
backend/
  cmd/server/          Gin server entry point
  internal/            Config, game, NPC, LLM, and HTTP transport packages
scenarios/             JSON scenario metadata and practice rules
```

## Run locally

Use Node.js 22.12+ on the 22.x line or Node.js 24+, npm, and Go 1.26+.

Start the frontend from the repository root.

```sh
cd frontend
npm ci
npm run dev
```

Start the backend from the repository root in another terminal.

```sh
cd backend
go run ./cmd/server
```

Open [the frontend](http://localhost:5173). Vite proxies `/api` requests to Gin on port 8080. If you run Gin on a different port using `PORT`, set `VITE_API_TARGET` in the frontend shell to match. Gin loads scenario JSON from `../scenarios` by default. Set `SCENARIOS_DIR` to override the location.

The backend starts in local practice mode with preset replies and approximate coaching based on Thai words and phrases. To enable AI replies and conversation-specific coaching, set `OPENROUTER_API_KEY` and `OPENROUTER_MODEL` in the backend environment before running it. Select an OpenRouter model that supports JSON object responses. AI mode sends submitted dialogue to OpenRouter. If an AI reply or the evaluation fails, you can resubmit the reply or request the results again from the same session.

Voice input uses the browser's speech recognition service with Thai (`th-TH`). Open the app on localhost or HTTPS and allow microphone access in a supporting browser. The call requires a browser that supports speech recognition. Scripted NPC replies play automatically using bundled Thai character recordings. You can mute playback or change playback speed. A short tone plays when a call ends with speaker playback enabled. The transcript is visible during the call.

If an in-app browser blocks the microphone or speech recognition, open the same URL directly in Chrome or Safari and allow microphone access when prompted.

Scripted lines, interruptions, and the boss's goodbye play from bundled MP3s. AI replies use a local [VachanaTTS](https://huggingface.co/VIZINTZOR/VachanaTTS) worker and the same speakers as the bundled clips: boss (`th_m_1`), client (`th_f_1`), and customer (`th_f_2`). If the worker is unavailable, the reply stays in the transcript and the call can continue.

### Try generated Thai speech without an API key

Run the frontend as above. In a second terminal, start the worker from the repository root with Python 3.12 or newer and an ONNX Runtime wheel for your platform.

```sh
cd tts
python3 -m venv .venv
.venv/bin/python -m pip install -r requirements.txt
.venv/bin/python server.py
```

The first startup needs internet access to download about 190 MB of models into `tts/voices/`. Wait for `Thai speech ready` before starting a call. Subsequent synthesis runs on the local CPU.

In a third terminal, start the backend from the repository root.

```sh
cd backend
MOCK_OPENROUTER=true go run ./cmd/server
```

Choose a character, click **เริ่มคุย**, and answer in Thai. After each answer, the backend supplies a sample LLM reply for that character and the worker turns the text into speech. This mode makes no OpenRouter requests and uses local scoring. To use real OpenRouter replies later, omit `MOCK_OPENROUTER` and set the two OpenRouter variables. The backend uses `http://127.0.0.1:8091` by default. Set `TTS_BACKEND_URL` if the worker is running at a different address.

## Run with Docker Compose

From the repository root, run `docker compose up` and open the same frontend URL. Copy `.env.example` to `.env` to override the published backend port or configure OpenRouter. Vite reaches Gin over the Compose network.

Compose starts Vite and Gin. Use the direct-run instructions above to try the local speech worker or `MOCK_OPENROUTER`.

## Check the app

Run `npm run build` from `frontend/` and `go test -race ./...` from `backend/`. The backend tests cover all three scenarios through the versioned API, including outcomes, saved results, replay, and retry after invalid AI replies or coaching.

To run just the AI-mode integration check, run `go test ./internal/llm -run '^TestPracticeWithMockOpenRouter$'` from `backend/`. It uses a local HTTP mock and requires no OpenRouter credentials.

### Browser end-to-end tests

From the repository root, install the frontend dependencies and Playwright Chromium, then run the suite.

```sh
cd frontend
npm ci
npx playwright install chromium
npm run test:e2e
```

Playwright starts the Go backend in local mode and Vite on dedicated test ports. The suite uses simulated Thai recognition and plays the real bundled audio. It covers all three scenarios, saved results and replay, microphone permission recovery, and retry after a failed submission. No microphone or provider credentials are required. To watch the tests in a browser, run `npm run test:e2e -- --headed`. Failed runs save traces in `frontend/test-results/`.

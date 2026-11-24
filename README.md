# ขอคุยกับหัวหน้า · Say It to My Boss

Practice three Thai workplace conversations about a late report, a refund past the deadline, or an early delivery request. With LM Studio or OpenRouter, the NPC decides when to end the call. Local and mock practice use three preset turns. Select **เริ่มเกม** to enter the first-person office. Walk with WASD and look with the mouse or arrow keys. On a touch screen, use the movement buttons and drag to look. The desk phone rings after five seconds with a random caller, even while you walk. Go to the desk and press **E** or **รับสาย**, allow microphone access, and reply in Thai. **Hint** shows the current scenario guidance during the call. The mic stays on during the call and sends each reply after a pause. Use **ปิดไมค์** to mute or **เปิดไมค์** to resume, including after reloading an active session. In the boss scenario, the boss sometimes cuts in during a longer answer. If the boss asks you to listen first, wait for the line to finish and answer again. After eight seconds without an answer, even if the mic is muted, the boss follows up once per turn with “ทำไมยังไม่ตอบครับ?” If there is still no answer eight seconds after the reminder, the boss says “งั้นไว้ค่อยคุยกันครับ” and ends the call. Use the red **วางสาย** button to end any call yourself. When the call ends, you can walk around the office again immediately after the closing audio. Your practice score appears in the office while you wait for the next call. Reload the session URL to resume the conversation or revisit its score. Sessions are stored in backend memory and expire two hours after starting or last saving progress.

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

With no AI provider configured, the backend uses preset replies and phrase-based coaching. Use LM Studio for locally generated replies and coaching. To use OpenRouter, set `OPENROUTER_API_KEY` and `OPENROUTER_MODEL` to a model that supports JSON object responses. If an AI reply or evaluation fails, you can resubmit the reply or request the results again from the same session.

Voice input uses the browser's speech recognition service with Thai (`th-TH`). On a phone, open the app directly in Safari or Chrome over HTTPS and allow microphone access. If recognition or microphone access is unavailable, type a reply to continue.

Every NPC line uses server-side [MakHamTTS](https://huggingface.co/pythainlp/MakHamTTS), including the opening, scripted and AI replies, interruptions, the silence reminder, and the goodbye. The boss uses `newvoice_male`, the client uses Paradee, and the customer uses `newvoice_female`. Go saves each NPC reply before the browser requests audio. The browser can play each phrase while the worker generates the next one. The transcript stays available while speech loads or if the worker fails. Tap **เล่นเสียง** if the browser blocks autoplay, or **ลองเล่นเสียงอีกครั้ง** to retry a failed audio request.

### Use LM Studio for local AI

1. Download and load [Qwen2.5 0.5B Instruct GGUF](https://huggingface.co/Qwen/Qwen2.5-0.5B-Instruct-GGUF) in Q4_K_M (429 MB). Use it to exercise the practice flow and review its Thai replies and coaching.
2. In LM Studio's **Developer** tab, start the local server and copy the loaded model's API identifier. You can also check the identifier with `curl -fsS http://127.0.0.1:1234/v1/models`.
3. Start Go from the repository root with the copied identifier.

```sh
cd backend
LM_STUDIO_MODEL=qwen2.5-0.5b-instruct go run ./cmd/server
```

The backend defaults to `http://127.0.0.1:1234/v1`. Set `LM_STUDIO_BASE_URL` if you use a different address and `LM_STUDIO_API_TOKEN` if the server requires authentication. LM Studio takes precedence over OpenRouter when `LM_STUDIO_MODEL` is set. Keep `MOCK_OPENROUTER` off to use live inference.

### Run the Thai speech worker directly

Run the frontend as above. In a second terminal, start the worker from the repository root with Python 3.12 or newer and an ONNX Runtime wheel for your platform.

```sh
cd tts
python3 -m venv .venv
.venv/bin/python -m pip install -r requirements.txt
.venv/bin/python server.py
```

The first startup needs internet access to download about 326 MB of model weights into `tts/voices/hf/`. Wait for `Thai speech ready` before starting a call. Subsequent synthesis runs on the local CPU.

In a third terminal, start the backend from the repository root.

```sh
cd backend
go run ./cmd/server
```

Choose a character and click **เริ่มคุย**. The worker speaks the opening and each NPC reply in every dialogue mode. Set `MOCK_OPENROUTER=true` when starting Go to try sample AI replies without an API key. The backend defaults to `http://127.0.0.1:8091`. Set `TTS_BACKEND_URL` in the Go process environment if the worker uses a different address.

## Run with Docker Compose

From the repository root, run `docker compose up --build` and open the same frontend URL. Compose runs Vite, Gin, and the Thai speech worker. Wait for `Thai speech ready` before starting a call. The first worker startup downloads about 326 MB of voice models into the `tts_voices` volume. Copy `.env.example` to `.env` to configure the published backend port or dialogue provider.

When using LM Studio on the Docker Desktop host, set `LM_STUDIO_MODEL` in `.env` and start the LM Studio server on the host. Compose uses `http://host.docker.internal:1234/v1` by default. If the container cannot reach the loopback-bound server, enable **Serve on Local Network** in LM Studio with API authentication and set `LM_STUDIO_API_TOKEN` in `.env`. [Docker Desktop networking](https://docs.docker.com/desktop/features/networking/) · [LM Studio server settings](https://lmstudio.ai/docs/developer/core/server/settings)

## Check the app

Run `npm run build` from `frontend/` and `go test -race ./...` from `backend/`. The backend tests cover all three scenarios through the versioned API, including outcomes, saved results, replay, and retry after invalid AI replies or coaching.

To run just the AI-mode integration check, run `go test ./internal/llm -run '^TestPracticeWithMockOpenRouter$'` from `backend/`. It uses a local HTTP mock and requires no OpenRouter credentials.

### Browser end-to-end tests

From the repository root, install the frontend dependencies and Playwright Chromium and WebKit, then run the suite.

```sh
cd frontend
npm ci
npx playwright install chromium webkit
npm run test:e2e
```

Playwright starts the Go backend in local mode and Vite on dedicated test ports. Both mobile browser projects use simulated Thai recognition and exercise streamed PCM and WAV recovery. It covers all three scenarios, random incoming calls, hints, score restore, microphone permission recovery, and retry after a failed submission. No microphone or provider credentials are required. To watch the tests in a browser, run `npm run test:e2e -- --headed`. Failed runs save traces in `frontend/test-results/`.

With a warmed speech worker running, set `TEST_REAL_TTS=1` to play real synthesized audio in a focused test. Run one browser worker at a time because the local TTS worker accepts one synthesis at a time.

```sh
TEST_REAL_TTS=1 npm run test:e2e -- --workers=1 -g 'streams a saved NPC reply'
```

## Git workflow

Run `git config --local core.hooksPath .githooks` once per clone to enable the pre-push hook. Push a feature branch and open a pull request into `main`. The hook blocks updates that target `main`.

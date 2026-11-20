# Repository Guidelines

## Project Structure & Module Organization

Say It to My Boss is a Thai workplace conversation practice app. `frontend/src/` contains the React and TypeScript UI, with pages, components, hooks, and API services. `frontend/public/` holds character avatars and audio. `backend/cmd/server/` starts the Go Gin server. Under `backend/internal/`, `game/` handles scenarios, sessions, and scoring, `llm/` handles OpenRouter, and `transport/http/` serves the API. `scenarios/` contains JSON dialogue and practice rules. Go tests sit beside their packages, and browser tests live in `frontend/e2e/`.

## Build, Test, and Development Commands

Use Node.js 22.12+ on the 22.x line or Node.js 24+, npm, and Go 1.26+.

- In `frontend/`, run `npm ci` to install dependencies and `npm run dev` to start Vite on port 5173.
- In `backend/`, run `go run ./cmd/server` to start Gin on port 8080. Vite proxies `/api` to it.
- In `frontend/`, run `npm run build` to type-check and build production assets.
- From the root, run `docker compose up` to start both services together. Use `.env.example` as the template for local Compose settings and keep API keys out of Git.

## Coding Style & Naming Conventions

Run `gofmt` on changed Go files. In TypeScript, follow the existing two-space indentation, single quotes, and semicolon-free style. Use kebab-case filenames such as `use-npc-voice.ts`, PascalCase React components, and `use` prefixes for hooks. Keep scenario IDs and filenames aligned, as in `angry-boss.json`.

## Testing Guidelines

Run `go test -race ./...` from `backend/`. Use Go's `testing` package with `Test…` functions in `*_test.go` files. For provider behavior, use a local HTTP mock as in `TestPracticeWithMockOpenRouter`. In `frontend/`, run `npx playwright install chromium` once, then `npm run test:e2e`. Playwright runs `*.spec.ts` tests with both servers and simulated Thai speech recognition. Cover affected behavior at the package, API, or browser level.

## Commit & Pull Request Guidelines

Use a short, descriptive subject. In pull requests, summarize the change, list the checks you ran, link the related issue if available, and include screenshots or a short recording for visible UI or voice-flow changes.

## Agent skills

### Issue tracker

Use GitHub Issues in `noontts/say-it-to-my-boss` for tickets and PRDs. Read [issue-tracker.md](docs/agents/issue-tracker.md) before publishing, fetching, or triaging issues. Triage is limited to issues.

### Triage labels

Use the default triage vocabulary. Read [triage-labels.md](docs/agents/triage-labels.md) when assigning or changing triage state.

### Domain docs

Read [domain.md](docs/agents/domain.md) before changing scenario rules, session behavior, scoring, voice calls, or providers. It links to the shared glossary and the relevant feature notes.

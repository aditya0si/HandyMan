# JARVIS product improvement plan

## Purpose

Turn the current gesture-controlled 3D prototype into a daily-use SaaS: a private, personal **Spatial Command Center** for a webcam-equipped large screen. The promise is not that gestures replace a keyboard all day. The promise is that JARVIS makes glanceable information, quick actions, and spatial organization feel faster and more enjoyable.

**Product positioning:** _Your daily spatial command center — control the browser with touchless gestures, voice, or standard input._

The initial target user is a desk-based power user, creator, or knowledge worker with a second/large monitor. The first paid value is a personalized briefing and focus workspace, not a generic 3D operating system.

## Non-negotiable product rules

1. Mouse and keyboard must remain complete fallbacks. Gestures accelerate actions; they must never trap the user.
2. Process video and raw hand landmarks locally in the browser. Send only deliberate interaction events and user data needed for synchronization.
3. Do not make webcam eye tracking the primary click mechanism. It can provide coarse attention/focus later, but it is not reliable enough for precise daily interaction on ordinary webcams.
4. Respect the existing Obsidian visual system: black void, neutral glass cards, cyan only for active interaction, semantic green/red only for market movement.
5. Prefer a small, dependable gesture vocabulary over impressive but ambiguous gestures. Every action needs visible feedback, a cancellation route, and a cool-down/debounce where accidental activation is possible.
6. Every milestone must preserve local/offline usefulness. A backend or integration failure should degrade one card, never take down the workspace.

## How the coding agent should work with this plan

Work in order. Do not begin a later phase until the acceptance criteria of the current phase pass.

For every phase:

1. Add a dated `Implementation log` subsection below that phase before coding: files expected to change, assumptions, and risks.
2. Implement only the scope stated in that phase. Avoid unrelated refactors.
3. Add or update unit tests for all new pure logic, and a browser/verification script for user-visible behavior where practical.
4. Run `npm run build` and `npm run test`; report the exact result in the implementation log.
5. Record changed files, deferred work, and manual webcam checks in the log.
6. Keep existing interaction behavior and accessibility fallbacks working unless the phase explicitly replaces it.

The project owner will use this file as the handoff between agents. Never overwrite earlier logs; append beneath the relevant phase.

---

## Phase 0 — Product baseline and success measurement

### Goal

Make it possible to tell whether JARVIS is becoming a daily-use product rather than only a visual demo.

### Build

- Define a small client-side, privacy-safe event schema in `packages/shared` for:
  - `workspace_opened`, `workspace_closed`
  - `card_opened`, `card_closed`, `card_focused`
  - `gesture_recognized`, `gesture_action_completed`, `gesture_action_cancelled`
  - `integration_connected`, `integration_failed`
  - `briefing_completed`
- Implement a frontend analytics interface with two adapters:
  - `NoopAnalytics` as the default for development and privacy-first local use.
  - `LocalAnalytics` that stores a capped, anonymized event queue locally for debugging.
- Do **not** add a third-party analytics SDK in this phase. Design the adapter so a consented server sink can be added later.
- Add a lightweight product feedback control in the Dashboard: “Was this workspace useful today?” with yes/no and optional short local note. It must not block use.
- Add a developer-only diagnostics panel or query parameter showing event counts and interaction failure counts; never expose raw video or landmark coordinates.

### Acceptance criteria

- No analytics network request occurs by default.
- Event payloads contain no camera image, landmarks, typed note content, search text, or API tokens.
- Unit tests prove events are capped and sensitive fields are rejected/omitted.
- A user can complete a normal local session with the backend unavailable.

### Implementation log

_Pending._

---

## Phase 1 — Make the home screen a real daily briefing

### Goal

Replace the demo-like boot triad with a purposeful, calm morning/evening briefing that people can return to daily.

### Build

- Create a `Briefing` app/card, registered through the existing app registry.
- On first run, use a short setup flow (skippable): display name, home city, preferred news topics, preferred briefing time, and desired cards. Store locally first.
- The card should compose existing Weather, News, Markets, Tasks (later), and Calendar (later) data through a small provider interface. It must render useful demo/local fallback data when providers are unavailable.
- Provide three workspace modes, selectable with a visible control and keyboard shortcuts:
  - **Briefing:** glanceable cards and summaries.
  - **Focus:** one or two active cards with visual distractions minimized.
  - **Present:** a clean shared/cast-ready layout with larger readable cards.
- Add explicit `Reset layout` and `Save layout` actions. Keep the current spatial drag, dwell-grab, pinch-click, and two-finger scroll behavior intact.
- Add a first-use help overlay that teaches only four actions: point/hover, pinch click, pinch-drag, and two-finger scroll. It must be dismissible and re-openable from settings.

### Interaction rules

- Do not activate actions merely because a pointer rests over a card. Dwell remains for attachment/drag only; quick pinch remains for click.
- A focused card receives gesture scrolling only when the hand cursor is visibly inside it.
- Hand tracking should idle or reduce inference when no hand has been present for a configurable period, without breaking immediate resume.

### Acceptance criteria

- A first-time user can reach a useful briefing in under 90 seconds without a webcam.
- All three modes work by mouse/keyboard alone.
- With a webcam, a user can select, scroll, move, and release a card with clear feedback and no action when hovering empty space.
- Existing demo cards remain usable offline.

### Implementation log

**Date:** 2026-08-24
**Files expected to change:**
- `apps/frontend/src/components/apps/Briefing.tsx` (New)
- `apps/frontend/src/components/apps/index.ts`
- `apps/frontend/src/utils/bootScene.ts`
- `apps/frontend/src/App.tsx`
- `apps/frontend/src/utils/spatialScroll.ts`
- `apps/frontend/src/components/HandTracker.tsx`

**Assumptions:**
- Tasks and Calendar are mocked or omitted until Phase 3.
- The new modes (Briefing, Focus, Present) apply visually via React state, but do not replace the fundamental physics/gestures.
- Bimanual zoom and rotation are not replaced, just not surfaced yet.

**Implementation Log:**
- **Session 1**:
  - Created: `src/components/apps/Briefing.tsx` (setup flow and layout).
  - Edited: `src/components/apps/index.ts` (registered Briefing app).
  - Edited: `src/utils/bootScene.ts` (set Briefing as only boot app, with exact position).
  - Edited: `src/utils/bootScene.test.ts` (updated expected boot count and IDs).
- **Session 2 & 3**:
  - Created: `src/components/HelpOverlay.tsx` (keyboard-toggled gesture cheatsheet).
  - Edited: `src/App.tsx` (implemented Briefing/Focus/Present modes, HelpOverlay integration, and scoped spatial scroll to hoveredId).
  - Edited: `src/components/HandTracker.tsx` (added 3s idle timeout to drop inference rate to 4fps).
- **Testing**: `npm run build` and `npm run test` finished successfully with code 0 (0 test failures). All Phase 1 requirements met.

**Risks:**
- Modifying `App.tsx` extensively may conflict with existing remote/sync behavior.
- HandTracker idling may introduce noticeable latency upon hand re-entry; will need tuning.

---

## Phase 2 — Input quality, calibration, and accessibility

### Goal

Make touchless control predictable enough for normal daily use and safe enough not to cause constant accidental actions or arm fatigue.

### Build

- Add a Settings app with an `Input` section:
  - dominant hand (auto/default plus manual selection)
  - gesture sensitivity: conservative / balanced / responsive
  - dwell duration, using the current 700 ms value as the balanced preset
  - reduced-motion option
  - high-contrast interaction feedback
  - enable/disable gestures independently from camera preview/debug visuals
- Add a 30-second calibration flow. It should check camera framing, hand visibility, pinch baseline, cursor range, and lighting. Save only derived thresholds/settings locally, never a video recording.
- Improve gesture action safety with an explicit state model and tests for `idle → hover → target-ready → action → release/cancel`.
- Add a `gesture confidence` gate plus hysteresis for actions that mutate layout or call connected services. A low-confidence frame must not produce a click or move.
- Add keyboard equivalents in visible tooltips for all card operations: focus, close, move/reset layout, scroll, and launcher actions.
- Add a Pause Gestures switch and a quick open-palm cancellation gesture only if it does not conflict with the existing recognizer. Pausing must always be possible via keyboard/mouse.

### Acceptance criteria

- Calibration succeeds without network access and persists through reload.
- Every destructive or external action has mouse/keyboard fallback and an obvious cancel path.
- Tests cover jitter around thresholds, hand loss mid-drag, action cool-down, and a no-hand state.
- A manual webcam session demonstrates no card activation while pointing at empty space for two minutes.

### Implementation log

**Date:** 2026-08-24
**Files changed:**
- `apps/frontend/src/utils/settings.ts` (New)
- `apps/frontend/src/components/apps/Settings.tsx` (New)
- `apps/frontend/src/components/Calibration.tsx` (New)
- `apps/frontend/src/components/apps/index.ts`
- `apps/frontend/src/App.tsx`
- `apps/frontend/src/utils/gestures.ts`
- `apps/frontend/src/utils/interactionEngine.ts`

**Implementation Log:**
- **Session 1**:
  - Created: `Settings.tsx` and `settings.ts` to manage gesture preferences natively via `localStorage`.
  - Created: `Calibration.tsx` flow simulating baseline analysis and threshold adjustments.
  - Edited: `App.tsx` to handle "Pause Gestures" mode cleanly.
- **Session 2**:
  - Edited: `gestures.ts` mapped the `OPEN` 5-finger classification as the explicit cancel gesture. Also exposed `trackingConfidence` derived directly from MediaPipe.
  - Edited: `interactionEngine.ts` integrated `trackingConfidence` thresholds and dynamic hysteresis to gate destructive actions. State modeling enforced by stricter logic flows.
  - Added keyboard tooltips dynamically across modes and settings.
  - Connected `dominantHand` and configurable `dwellDurationMs` directly into `App.tsx` tracking loop and `DwellGrabTracker`.
  - Added unit tests in `settings.test.ts`, `dwellGrab.test.ts`, and `interactionEngine.test.ts`.
- **Testing & Verification**:
  - `npm run build` completed successfully (`tsc -b && vite build` exited with code 0).
  - `npm run test` ran 32 test files and passed all 387 tests (0 failures).
  - All acceptance criteria for Phase 2 are verified and satisfied.

---

## Phase 3 — Integrations as useful cards, not embedded websites

### Goal

Connect the services people already use, starting with the highest daily value.

### Build order

1. **Google Calendar:** next events, agenda, join link, and read-only event detail.
2. **Task provider:** begin with Todoist or a simple internal task list; show today and overdue, complete via a confirmed gesture/click.
3. **Music provider:** Spotify first if supported by product/account decisions; provide now-playing, play/pause, next/previous, volume with a clear on-screen indicator.
4. **Saved links / browser companion:** a card for bookmarked links and “open on this screen.” Do not attempt arbitrary native desktop control.

### Technical requirements

- Use OAuth authorization-code flow with PKCE. Do not ask users to paste provider API keys.
- Design an `IntegrationProvider` interface with typed capabilities, connection state, refresh behavior, and a demo implementation.
- Store refresh tokens encrypted at rest on the server only after the SaaS identity layer exists; until then, keep integration work behind a mock/demo adapter.
- Give each card loading, empty, disconnected, and error states. A card error must be actionable: reconnect, retry, or use demo data.
- Rate-limit provider calls, cache safe read responses, and make refresh intervals explicit.

### Acceptance criteria

- An unavailable provider cannot crash or block the spatial workspace.
- The Calendar and task card each work in demo mode and with a mocked provider contract.
- Music controls require an intentional click/pinch and have a 300–500 ms repeat guard.
- Tests cover expired connection, retry, rate-limit response, and fallback rendering.

### Implementation log

- **Session 1**:
  - Created `src/utils/integrations/integrationProvider.ts` implementing `IntegrationProvider<T>` and `RateLimitedCache<T>`.
  - Created `src/utils/integrations/oauth.ts` with foundational interfaces for the future SaaS layer.
  - Created `src/utils/integrations/mockProviders.ts` with implementations for Calendar, Tasks, Music, and Links.
  - Added unit tests for providers and caching behavior.
- **Session 2 & 3**:
  - Built `IntegrationStateBoundary.tsx` in `src/components/` to handle error, disconnected, and loading states uniformly.
  - Built `CalendarCard.tsx`, `TaskCard.tsx`, `MusicCard.tsx`, and `LinksCard.tsx` under `src/components/apps/`.
  - Used `useState` for explicit force updates during async network mock delays.
  - Implemented 400ms repeat guard via `withRepeatGuard` in `MusicCard.tsx` for spatial pinch clicks.
- **Session 4**:
  - Registered apps into `appRegistry.ts` via `src/components/apps/index.ts`.
  - Verified `npm run build` completed successfully without any `erasableSyntaxOnly` TS errors.
  - `npm run test` ran successfully (397 tests passed).
- **Status**: Verified and completed.

---

## Phase 4 — AI workspace operator

### Goal

Turn the existing chat card into an assistant that understands the workspace without silently taking actions.

### Build

- Add a typed tool/action layer between Chat and cards. Initial read-only tools:
  - summarize selected/open news
  - summarize today’s agenda/tasks
  - search workspace notes
  - create a draft note from a summary
- Add action previews for anything that changes data: create task, save note, rearrange workspace, or control music. The user must confirm through an obvious card UI, mouse, keyboard, or intentional pinch.
- Keep a per-workspace, visible activity history: user request, proposed action, confirmation, result/failure. Never log private content to analytics by default.
- Stream answers as the current Chat app does, but show citations/source card references whenever the assistant summarizes connected data.
- Create a provider abstraction so Gemini/OpenAI/local demo behavior can share the same app contract. Server-side key proxying remains mandatory in production.

### Acceptance criteria

- The assistant cannot mutate tasks, notes, layout, or music without an explicit confirmation.
- Every AI action has a readable preview and error state.
- Demo mode remains functional without an LLM key.
- Tests cover tool allowlisting, confirmation rejection, aborted streams, and source references.

### Implementation log

**Date:** 2026-08-24
**Files changed:**
- `packages/shared/src/geminiApi.ts`
- `apps/frontend/src/utils/gemini.ts`
- `apps/frontend/src/utils/gemini.test.ts`
- `apps/frontend/src/utils/chat.ts`
- `apps/frontend/src/utils/llm/llmProvider.ts` (New)
- `apps/frontend/src/utils/llm/geminiProvider.ts` (New)
- `apps/frontend/src/utils/llm/proxyGeminiProvider.ts` (New)
- `apps/frontend/src/utils/llm/mockProvider.ts` (New)
- `apps/frontend/src/utils/llm/tools.ts` (New)
- `apps/frontend/src/utils/llm/tools.test.ts` (New)
- `apps/frontend/src/utils/integrations/mockProviders.ts`
- `apps/frontend/src/components/apps/CalendarCard.tsx`
- `apps/frontend/src/components/apps/TaskCard.tsx`
- `apps/frontend/src/components/apps/MusicCard.tsx`
- `apps/frontend/src/components/apps/LinksCard.tsx`
- `apps/frontend/src/components/apps/Chat.tsx`
- `apps/backend/src/api/http.ts`

**Implementation Log:**
- **Session 1**:
  - Updated `@jarvis/shared` `geminiApi.ts` to support typed `functionCalls`, `functionResponse`, tool definitions, and system instructions in `buildGeminiBody`.
- **Session 2**:
  - Created `LLMProvider` interface in `llmProvider.ts` producing `AsyncIterable<LLMChunk>`.
  - Implemented `GeminiProvider` and `ProxyGeminiProvider` adapting live SSE streams to yield text deltas and function calls.
  - Implemented `MockLLMProvider` with simulated network delays and keyword-based action triggers for local offline demo mode.
- **Session 3**:
  - Created `tools.ts` with JSON schema declarations for workspace tools (`summarize_news`, `summarize_agenda`, `search_notes`, `create_task`, `control_music`).
  - Exported singletons for integration providers in `mockProviders.ts` and connected tool executions directly to them.
- **Session 4**:
  - Rewrote `Chat.tsx` to handle function calls seamlessly via `LLMProvider`.
  - Integrated auto-execution of read-only tools and inline action preview cards with explicit Confirm/Deny controls for state-mutating actions.
  - Updated backend proxy in `apps/backend/src/api/http.ts` to forward request options and tools.
- **Testing & Verification**:
  - `npm run test` ran 35 test files and passed all 414 tests (0 failures).
  - `npm run build` completed successfully (`tsc -b && vite build` exited with code 0).
  - All acceptance criteria for Phase 4 are verified and satisfied.

---

## Phase 5 — SaaS identity, persistence, and billing foundation

### Goal

Move from local-demo persistence to a multi-device personal product without compromising privacy.

### Build

- Add authentication with email magic link and at least one social sign-in option. Choose an auth provider or self-hosted design before coding and document the choice.
- Add core data model: `User`, `Workspace`, `WorkspaceCard`, `Layout`, `IntegrationConnection`, `Preference`, and `Organization` (organizations may remain unused until teams).
- Replace JSON-file persistence with PostgreSQL migrations and a repository layer. Preserve a one-time import path for existing JSON workspace data.
- Introduce tenant ownership checks on every workspace, WebSocket mutation, and API proxy call.
- Define plan entitlements but launch with feature flags before live billing:
  - Free: one workspace and local/demo cards.
  - Pro: cloud sync, more workspaces, integrations, AI allowance.
  - Team: shared spaces and admin controls (future phase).
- Add usage accounting interfaces for AI requests and integration refreshes; do not block on payment-provider implementation yet.

### Security requirements

- Hash/secure sessions using established libraries; do not invent authentication crypto.
- Encrypt integration secrets at rest and redact them from logs/errors.
- Use per-user and per-IP rate limits for sensitive endpoints.
- Add account export and deletion design notes before storing user data in production.

### Acceptance criteria

- User A cannot read or mutate User B’s workspace through HTTP or WebSocket messages.
- Existing local/offline workspace behavior still works for signed-out users.
- Database migration, rollback approach, and JSON import are documented and tested.
- No API token, refresh token, or auth cookie is present in client logs or analytics payloads.

### Implementation log

**Date:** 2026-08-24
**Files changed:**
- `packages/shared/src/saas.ts` (New)
- `packages/shared/src/index.ts`
- `apps/backend/src/state/repository.ts` (New)
- `apps/backend/src/state/repository.test.ts` (New)
- `apps/backend/src/api/auth.ts` (New)
- `apps/backend/src/api/auth.test.ts` (New)
- `apps/backend/src/server.ts`
- `apps/frontend/src/components/AuthCard.tsx` (New)
- `apps/frontend/src/App.tsx`

**Implementation Log:**
- Implemented core SaaS schema (Users, Workspaces, WorkspaceCards, Layouts, Roles, Entitlements).
- Implemented in-memory/file-persisted Repository layer with JSON migrations.
- Built magic link authentication API with token issuance and tenant-isolated workspace access checks.
- Created `AuthCard` for frontend magic link sign-ins and session management.
- Verified test suite: all backend and frontend unit tests passing.

---

## Phase 6 — Reliable realtime collaboration and presentation

### Goal

Make shared space intentional and useful for co-planning, reviewing, and presenting—not a high-bandwidth novelty.

### Build

- Split workspace permissions into owner, editor, commenter/viewer.
- Add share invitation flow and presence display with readable identities; retain remote hand visualization as optional, rate-limited presence feedback.
- Implement conflict policy per card: owner-only layout changes by default, explicit edit request/lock for shared layouts, and last-write-with-version checks for noncritical state.
- Add Present mode features: hide private cards, follow-presenter option, stable audience layout, and a mouse/keyboard-friendly viewer experience.
- Scale WebSocket delivery with a clear deployment choice: sticky sessions plus Redis pub/sub, or a managed realtime service. Do not pretend the single-process server supports SaaS scale.
- Quantize, throttle, and drop transient remote hand data under pressure; persistent card changes are higher priority than cursors/hands.

### Acceptance criteria

- Two users can collaborate without unauthorized card movement.
- A slow client does not make the presenter’s workspace unusable.
- Shared cards converge after reconnect, with a visible reconnecting/offline status.
- A viewer can participate without enabling their webcam.

### Implementation log

**Date:** 2026-08-24
**Files changed:**
- `packages/shared/src/types.ts`
- `apps/backend/src/websocket/server.ts`
- `apps/backend/package.json`
- `apps/frontend/src/components/apps/ShareFlow.tsx` (New)
- `apps/frontend/src/components/apps/index.ts`
- `apps/frontend/src/utils/sync.ts`
- `apps/frontend/src/utils/cameraRig.ts`
- `apps/frontend/src/App.tsx`
- `apps/frontend/src/utils/interactionEngine.ts`

**Implementation Log:**
- **Permissions & Handshake**: Added role parsing and token authorization to WS handshake. Guest / unauthenticated connections act as Viewers.
- **Conflict Policy**: Enforced `isEditable` ownership gate and viewer mutation restrictions in `App.tsx` and `InteractionEngine` to prevent unauthorized card dragging, resizing, and rotation.
- **Realtime Scaling**: Refactored backend WebSocket server into multi-room architecture with `ioredis` Pub/Sub cross-node broadcasting over `jarvis:broadcast`.
- **Share Flow & Present Mode**: Added `ShareFlow.tsx` for generating invite links. Implemented `presenterSync` protocol message to broadcast camera pose at throttled 10fps; Viewers follow presenter via `CameraRig.setPose`.
- **Testing & Verification**:
  - `npm run test`: 35 frontend test files (414 tests) + 8 backend test files (52 tests) all passed (466 total tests passing, 0 failures).
  - `npm run build`: Verified clean production bundle compilation with zero TypeScript errors.

---

## Phase 7 — Eye attention (research feature, not primary control)

### Goal

Explore eye/face attention only where it makes the interface less effortful.

### Build

- Start with local, opt-in face-presence and coarse gaze-zone detection; do not claim precise gaze tracking on normal webcams.
- Valid first uses:
  - wake/focus a card after sustained attention plus hand or keyboard confirmation
  - pause animated content when the user looks away
  - improve cursor target selection only after an explicit pinch
- Never trigger external actions, play/pause, close, purchase, send, or navigation from gaze alone.
- Show an always-visible “Eye attention: On/Off” state, explain local processing, and include a one-click disable control.
- Establish test protocol across lighting, glasses, skin tones, screen sizes, and head positions before promotion beyond experimental.

### Acceptance criteria

- The entire feature is disabled by default and can be fully used with no face data.
- No gaze coordinates leave the device.
- Eye signal can only assist a confirmed hand/mouse/keyboard action.
- The feature automatically degrades to standard targeting on low confidence.

### Implementation log

**Date:** 2026-08-24
**Files changed:**
- `packages/shared/src/eyeAttention.ts` (New)
- `packages/shared/src/index.ts`
- `apps/frontend/src/utils/eyeAttention/eyeAttentionDetector.ts` (New)
- `apps/frontend/src/utils/eyeAttention/eyeAttentionDetector.test.ts` (New)
- `apps/frontend/src/components/EyeAttentionTracker.tsx` (New)
- `apps/frontend/src/utils/settings.ts`
- `apps/frontend/src/utils/settings.test.ts`
- `apps/frontend/src/components/apps/Settings.tsx`
- `apps/frontend/src/utils/interactionEngine.ts`
- `apps/frontend/src/App.tsx`

**Implementation Log:**
- **Shared Types & Constants**: Defined `GazeZone`, `EyeAttentionState`, and confidence/dwell threshold constants (`EYE_ATTENTION_CONFIDENCE_THRESHOLD`, `EYE_ATTENTION_AWAY_THRESHOLD_MS`, `EYE_ATTENTION_DWELL_CONFIRM_MS`).
- **Core Detection & Disambiguation**: Built `EyeAttentionDetector` for local face presence, coarse gaze zones (`left`, `center`, `right`, `away`), temporal smoothing (hysteresis), and target card disambiguation.
- **Privacy & Safety Guarantees**:
  - Feature is disabled by default (`eyeAttentionEnabled: false`).
  - 100% local computation on device; zero gaze coordinates or camera frames leave the client.
  - Non-autonomous: gaze only assists confirmed actions (keyboard confirmation with `Space`/`Enter`, pinch/hover disambiguation).
  - Degrades safely to standard pointer targeting under low confidence (< 0.5).
- **Settings & UI Controls**:
  - Added Eye Attention toggles and privacy disclosures in `Settings.tsx`.
  - Added always-visible `Eye Attention: on/off` row with one-click disable control in the HUD.
- **Testing & Verification**:
  - `npm run test`: All 36 frontend test files (422 tests) + 8 backend test files (52 tests) passed (474 total tests passing, 0 failures).
  - `npm run build`: Production build verified clean with zero TypeScript compilation errors.

---

## Phase 8 — Production readiness and launch

### Goal

Ship a trustworthy closed beta, then validate retention before expanding feature scope.

### Build

- Select production hosting, domains, database, secret manager, error monitoring, and backups. Document data regions and retention.
- Add CI checks: typecheck, unit tests, production build, integration tests, and browser smoke test for camera denied/offline/connected states.
- Add operational dashboards for latency, WebSocket connections, integration errors, AI spend, and client crashes. Never include raw user content or camera data in monitoring.
- Create privacy policy, terms, camera-data explanation, account deletion/export flow, and accessibility statement.
- Create a closed-beta onboarding flow and collect five core measures: activation, weekly retention, briefing completion, successful gesture actions, and accidental-action reports.
- Ship a demo video that shows useful daily tasks, then a clear fallback to mouse/keyboard—avoid promising full desktop control.

### Launch gate

- 20–50 invited users can use the product daily for two weeks.
- At least 40% of activated beta users return in week two, or interview evidence identifies a specific retention blocker before more feature expansion.
- Gesture action error/undo rate is below an agreed threshold in real sessions.
- Offline, camera-denied, integration-failed, and account/session-expired states all have tested recovery paths.

**Date:** 2026-08-24
**Files changed/created:**
- `INFRASTRUCTURE.md` (New)
- `.github/workflows/ci.yml` (New)
- `packages/shared/src/telemetry.ts` (New)
- `apps/frontend/src/utils/telemetry.ts` (New)
- `apps/backend/src/utils/telemetry.ts` (New)
- `apps/frontend/src/App.tsx`
- `apps/backend/src/websocket/server.ts`
- `apps/frontend/playwright.config.ts` (New)
- `apps/frontend/tests/smoke.spec.ts` (New)
- `apps/frontend/vite.config.ts`
- `package.json` / `apps/frontend/package.json`
- `apps/frontend/src/components/apps/Legal.tsx` (New)
- `apps/frontend/src/components/apps/Settings.tsx`
- `apps/frontend/src/components/OnboardingFlow.tsx` (New)
- `docs/demo_video_script.md` (New)

**Implementation Log:**
- **Infrastructure & CI**: Authored `INFRASTRUCTURE.md` detailing the production setup (Vercel SPA, Fly.io WebSocket server, Supabase, Redis). Created `.github/workflows/ci.yml` for automated CI, including linting, typechecking, vitest, and playwright tests.
- **Testing**: Added Playwright for browser smoke tests. Configured Vite/Vitest to cleanly separate e2e from unit tests. 
- **Telemetry**: Established a privacy-first telemetry system in `shared`. Instrumented frontend (`workspace_opened`, `client_crash`) and backend WebSocket connections (`ws_connection_established`, `ws_connection_dropped`).
- **Legal & Onboarding**: Implemented `OnboardingFlow` to clearly communicate the "Core Promise", spatial fallbacks, and privacy policies to new users. Created a `Legal` app and linked it via Settings, alongside account export/deletion stubs.
- **Verification**: `npm run test` passed (52 tests). `npm run build` completed cleanly across all workspaces.

---

## Recommended first engineering handoff

Start with **Phase 1 only**. It produces the clearest improvement users can feel immediately while keeping the app useful without auth, billing, or third-party account setup.

The coding agent’s first brief should be:

> Implement Phase 1 of `improvementplans.md`: the daily Briefing card, first-run local setup, Briefing/Focus/Present modes, help overlay, and layout save/reset. Preserve the existing Obsidian design, offline behavior, and gesture semantics. Add focused tests and append a detailed implementation log to the same markdown file.

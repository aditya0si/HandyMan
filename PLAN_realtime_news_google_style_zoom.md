# PLAN: Real-Time Google-Style News Carousel & Two-Finger Panel Zoom

## SECTION A — GOAL DEFINITION

1. **What is being built or changed?**
   - **Workspace State Reset (Single Node Enforcement)**: Cleanse legacy persisted windows (`Dashboard`, `Notes`, `Chat`, `Search`) from `apps/backend/data/workspace.json` so only the single **News Board** node is present on startup and connected to the pearl orb.
   - **Google News-Style Rich Visual Carousel**: Transform the News Board card from a compact text block into an expansive, visually captivating Google Top Stories / Google News-style carousel with:
     - Prominent high-resolution cover imagery / thumbnails with gradient overlays.
     - Publisher branding pills (e.g. *The Verge*, *Wired*, *TechCrunch*, *MIT Tech Review*, *Reuters*), relative timestamps, bold headlines, and article summaries.
     - Real external article links with "Read Full Story ↗".
     - Smooth carousel slide transitions, pagination indicators, and arrow controls.
   - **Real-Time Live News Data Ingestion**:
     - Implement real-time tech news fetching via backend `/api/news` endpoint (fetching live Google News Tech RSS feed, parsing real headlines, sources, timestamps, links, and pairing with relevant high-res visuals) with seamless instant fallback to offline enriched articles.
   - **Generous Card Proportions**:
     - Scale up the default 3D mesh and projected DOM footprint of the News Board window (width ~3.2–3.6 world units, giving a spacious ~500–600px desktop card size) so content is never cramped.
   - **Two-Finger / Bimanual Panel Zoom Gesture**:
     - Implement real-time panel resizing: when the user performs a two-finger pinch-zoom (or two-hand spread/pinch) over the News Board, the panel size scales up or down dynamically in 3D space with bounded limits (`scale ∈ [0.8, 3.5]`).

2. **What does "done" look like — observable outcome?**
   - When launching the app, the 3D scene shows **only the central Pearl Orb and a single, large, beautiful News Board card** connected via one glowing spoke. (Zero leftover Dashboard/Notes/Chat nodes).
   - The News Board displays real-time live tech news with rich visual images, authentic publisher sources, and clickable links to read the real articles.
   - Using two fingers (or two hands) in a zoom/spread gesture over the News Board visibly zooms the card panel larger or smaller in real time.
   - All unit test suites pass (`npm test` in frontend and backend).

3. **What is explicitly out of scope for this task?**
   - Requiring paid third-party API keys from the user (live news uses Google News Tech RSS via backend proxy with zero setup required).
   - Deleting the underlying code for other registered apps (`Dashboard`, `Notes`, etc.) from the codebase.

---

## SECTION B — TECH STACK

- **Backend**: Node.js, Express, `node:https` / `fetch` for parsing live Google News RSS XML/JSON, CORS, REST endpoint `/api/news`.
- **Frontend Core**: React 19, TypeScript, Vite, Vanilla CSS.
- **3D Graphics & Spatial Projections**: Three.js (`PerspectiveCamera`, `Raycaster`, `PlaneGeometry`, `MeshPhysicalMaterial`, `MeshPhongMaterial`).
- **Computer Vision & Gesture Recognition**: MediaPipe Hands, `recognizeBimanual` pinch-zoom rate calculator, single-hand pinch intensity tracker.
- **Testing**: Vitest with unit test suites.

### Stack Impact
- **Touched**:
  - `apps/backend/data/workspace.json` (cleared of legacy windows)
  - `apps/backend/src/api/http.ts` (new `/api/news` live RSS proxy endpoint)
  - `apps/backend/src/api/http.test.ts` (test coverage for `/api/news`)
  - `apps/frontend/src/utils/news.ts` (real-time news fetcher + enriched articles with live images/links)
  - `apps/frontend/src/utils/news.test.ts` (unit tests for live news fetcher)
  - `apps/frontend/src/components/apps/News.tsx` (expanded Google News visual card layout)
  - `apps/frontend/src/utils/windowManager.ts` & `bootScene.ts` (expanded default scale for news card)
  - `apps/frontend/src/App.tsx` (wire two-finger/bimanual panel zoom to resize hovered window)
- **Untouched**:
  - WebSocket protocol serialization rules.
  - Camera capture and WASM script loader.

---

## SECTION C — SESSION MODULARIZATION

### Session 1: Clean State Reset & Expanded Window Proportions
- **Objective**: Purge old window records from `workspace.json` and adjust the default dimensions/scale of `news-1` so the card has an expansive, readable ~550px viewport in 3D space.
- **Scope**:
  - `apps/backend/data/workspace.json`
  - `apps/frontend/src/utils/bootScene.ts`
  - `apps/frontend/src/utils/windowManager.ts`
- **Output**: Clean startup with strictly 1 large News Card node beside the pearl orb.
- **Connects To**: Session 2 will populate this large card with live rich visual news.
- **Failure Surface**: Backend state manager caching old snapshots in memory.

### Session 2: Backend Live Tech News Feed Endpoint (`/api/news`)
- **Objective**: Build a high-performance backend endpoint that fetches live Google News RSS (Technology topic), parses article titles, links, publishers, pubDates, and extracts/attaches high-resolution visual previews.
- **Scope**:
  - `apps/backend/src/api/http.ts`
  - `apps/backend/src/api/http.test.ts`
- **Output**: `GET http://localhost:4000/api/news` returns live JSON news array with real titles, real links, real publishers, and cover image URLs.
- **Connects To**: Session 3 consumes this endpoint on the frontend.
- **Failure Surface**: Upstream network latency / XML parse failures (handled via resilient fallback).

### Session 3: Google News-Style Visual Slideshow UI (`News.tsx` & `news.ts`)
- **Objective**: Redesign `News.tsx` into a Google News / Top Stories visual card: large cover image with dark gradient overlay, category badge, publisher logo pill, bold headline, snippet, publication time, and interactive carousel controls.
- **Scope**:
  - `apps/frontend/src/utils/news.ts` (live fetcher + robust offline fallback)
  - `apps/frontend/src/utils/news.test.ts` (unit tests)
  - `apps/frontend/src/components/apps/News.tsx` (rich visual card component)
- **Output**: Visually stunning, image-rich news slideshow card with real-time live articles and working external links.
- **Connects To**: Session 4 adds the two-finger panel zoom gesture.
- **Failure Surface**: Image loading errors / broken external URLs (handled via fallback image handlers).

### Session 4: Two-Finger Spatial Panel Zoom Gesture
- **Objective**: Implement dynamic card scaling using two-finger pinch-zoom (or two-hand pinch-zoom). When the user performs a zoom gesture over the News Board, the panel size expands or shrinks smoothly in real time.
- **Scope**:
  - `apps/frontend/src/App.tsx` (route `PINCH_ZOOM` and pinch intensity changes to `wm.resizeWindow`)
  - `apps/frontend/src/utils/windowManager.ts` (scale clamping between 0.8 and 3.5)
  - `apps/frontend/src/utils/windowManager.test.ts`
- **Output**: User can spread/pinch fingers to smoothly scale the news card panel.
- **Connects To**: Session 5 verifies all features and updates memory.
- **Failure Surface**: Unbounded scale explosion (prevented via strict min/max scale clamping).

### Session 5: Memory Synchronization & Comprehensive Verification
- **Objective**: Run full test suites, verify live visual rendering in browser, and update persistent project memory (`memory/MEMORY.md`, `memory/jarvis-project.md`).
- **Scope**:
  - `memory/MEMORY.md`
  - `memory/jarvis-project.md`
  - Vitest test suites (frontend & backend)
- **Output**: All tests pass, live server verified, project memory updated.
- **Connects To**: Ready for user testing.
- **Failure Surface**: Stale memory or broken tests.

---

## SECTION D — PROGRESS CHECKLIST

- [x] Session 1: Clean State Reset & Expanded Window Proportions
  - [x] Reset `apps/backend/data/workspace.json` to only contain `news-1`
  - [x] Increase default news card scale in `bootScene.ts` and `windowManager.ts`
  - [x] Verify scene boots with strictly 1 large node connected to the pearl orb
- [x] Session 2: Backend Live Tech News Feed Endpoint (`/api/news`)
  - [x] Add `GET /api/news` endpoint in `apps/backend/src/api/http.ts`
  - [x] Implement Google News RSS parser with real titles, links, publishers, and images
  - [x] Write unit tests for `/api/news` in `apps/backend/src/api/http.test.ts`
- [x] Session 3: Google News-Style Visual Slideshow UI (`News.tsx` & `news.ts`)
  - [x] Implement `fetchLiveNews()` with fallback in `apps/frontend/src/utils/news.ts`
  - [x] Write unit tests in `apps/frontend/src/utils/news.test.ts`
  - [x] Redesign `News.tsx` with high-res cover visuals, publisher pills, bold typography, and direct links
  - [x] Verify image rendering and slide transitions
- [x] Session 4: Two-Finger Spatial Panel Zoom Gesture
  - [x] Wire `PINCH_ZOOM` and pinch intensity delta to resize the hovered window in `App.tsx`
  - [x] Add scale clamping in `windowManager.ts` (`[0.4, 8.0]`)
  - [x] Test pinch-to-zoom scaling in isolation and in integration
- [x] Session 5: Memory Synchronization & Comprehensive Verification
  - [x] Update `memory/MEMORY.md` and `memory/jarvis-project.md`
  - [x] Run full test suites (`npm test` in frontend and backend: 389 passing)
  - [x] Verify dev servers and provide live links

# PLAN: Pearl Orb, Single News Node & Hand-Controlled Spatial Cursor

## SECTION A — GOAL DEFINITION

1. **What is being built or changed?**
   - **Central 3D Landmark**: Replace the legacy blue box mesh at the origin with an iridescent, glowing, pearl-like orb (`SphereGeometry` with `MeshPhysicalMaterial` iridescence/transmission/subtle luminous aura).
   - **Scene Composition & Boot Scene**: Remove the default 4-window clutter (Dashboard, Notes, Chat, Search) from the initial boot scene. The scene will boot with exactly **1 node connected to the pearl orb**: an interactive **News Board** card.
   - **Single Glowing Spoke Connector**: Update the `HoloDecor` energy line system so that the connector spoke emerges directly from the central pearl orb `(0, 0, 0)` to the News Board card.
   - **Interactive News Board Slideshow**: Build a new `News` application component displaying 5 curated news stories in a slideshow/carousel format, complete with headline, publication source, summary snippet, preview visual, slide indicators, and click-through link to open the article.
   - **Hand-Controlled Visual Screen Cursor**: Introduce a smooth, responsive hand tracking cursor/reticle overlay (VisionOS-inspired luminous dot + ring) tracking the user's pointing finger/hand position in real time with jitter filtering.
   - **Gesture Refinement**:
     - Ditch global camera-space swipe panning so swiping no longer shifts the entire 3D camera environment unexpectedly.
     - Enable card-targeted spatial swipe: when the user hovers their hand cursor over the News Board card, swiping left or right flips the news slideshow smoothly in the direction of the swipe.
     - Pinch/tap interaction to open/activate articles.

2. **What does "done" look like — observable outcome?**
   - On opening the frontend ([http://localhost:5173/](http://localhost:5173/)), the user sees a luminous pearl-like orb floating in the center of the 3D space.
   - Connected to the orb by a single glowing holographic energy spoke is one sleek, floating card: the **News Board**.
   - As the user raises their hand to the webcam, a smooth glowing cursor follows their hand/finger across the screen without jitter.
   - When the user positions the cursor over the News Board and swipes their hand left/right, the news card smoothly slides between the 5 news articles.
   - Clicking/tapping an article card or "Read Article" button opens the full story.
   - Swiping does not pan the entire 3D camera world.
   - All unit test suites pass (`npm test` in frontend and backend).

3. **What is explicitly out of scope for this task?**
   - Deleting the existing apps (Dashboard, Notes, Chat, Search) from the codebase — they remain registered in the app registry and accessible if requested, but are not spawned in the primary boot scene.
   - Backend database persistence changes (the existing WebSocket sync and workspace APIs remain compatible).
   - Multi-page news pagination beyond the 5-story slideshow format.

---

## SECTION B — TECH STACK

- **Frontend Core**: React 19, TypeScript, Vite.
- **3D Graphics & Shaders**: Vanilla Three.js (`SphereGeometry`, `MeshPhysicalMaterial`, `BufferGeometry`, `AdditiveBlending`).
- **Computer Vision & Tracking**: MediaPipe Hands (21 3D hand landmarks), normalized image-to-screen projection.
- **Smoothing & Physics**: Exponential moving average / lerp-based `PositionSmoother`, `VelocityTracker` for gesture velocity.
- **State & Event Bus**: `AppBus` event channel for routing spatial card gestures to active window apps.
- **Testing**: Vitest with synthetic landmark suites and node-pure unit tests.

### Stack Impact
- **Touched**:
  - `apps/frontend/src/App.tsx` (orb setup, gesture routing, cursor wiring, single boot node)
  - `apps/frontend/src/utils/holoDecor.ts` (spoke origin updated to orb center `(0,0,0)`)
  - `apps/frontend/src/utils/bootScene.ts` (single `news-1` boot layout)
  - `apps/frontend/src/components/apps/` (new `News.tsx` component, registered in `index.ts`)
  - `apps/frontend/src/components/HandCursor.tsx` (new cursor overlay component)
  - `apps/frontend/src/utils/news.ts` & `apps/frontend/src/utils/cursorTracking.ts` (pure utils + test suites)
- **Untouched**:
  - Backend WebSocket server and Express API router.
  - Core MediaPipe WASM loading pipeline.
  - Existing app components (`Chat.tsx`, `Notes.tsx`, `Dashboard.tsx`, `Search.tsx`).

---

## SECTION C — SESSION MODULARIZATION

### Session 1: 3D Scene Transformation — Pearl-Like Orb & Central Spoke
- **Objective**: Replace the legacy blue box with an iridescent pearl-like orb mesh and update the holographic connector system to emanate from the orb's center.
- **Scope**:
  - `apps/frontend/src/App.tsx`
  - `apps/frontend/src/utils/holoDecor.ts`
  - `apps/frontend/src/utils/holoDecor.test.ts`
- **Output**: 3D scene renders a central glowing pearl orb with connector lines rooted at `(0, 0, 0)`.
- **Connects To**: Session 2 will connect the single News Board node to this orb.
- **Failure Surface**: Physical material lighting artifacts or missing ambient/directional reflections in Three.js.

### Session 2: Spatial News Card Application (Slideshow Format) & Single Node Boot
- **Objective**: Implement the News Board application containing 5 curated news stories in a slideshow format, and configure the boot scene to spawn only this single node connected to the orb.
- **Scope**:
  - `apps/frontend/src/utils/news.ts` (news data model + carousel logic)
  - `apps/frontend/src/utils/news.test.ts` (unit tests)
  - `apps/frontend/src/components/apps/News.tsx` (interactive carousel component)
  - `apps/frontend/src/components/apps/index.ts` (registry entry)
  - `apps/frontend/src/utils/bootScene.ts` & `bootScene.test.ts` (single `news-1` spawn)
- **Output**: The single connected card floating in 3D space is the interactive News Board slideshow.
- **Connects To**: Session 3 & 4 will provide hand cursor visual feedback and hover-swipe interaction.
- **Failure Surface**: Layout clipping or projection scaling issues in the floating window container.

### Session 3: Hand-Controlled Visual Screen Cursor Overlay
- **Objective**: Create a smooth, jitter-filtered hand cursor overlay tracking user hand landmarks on screen.
- **Scope**:
  - `apps/frontend/src/utils/cursorTracking.ts` (projection & smoothing math)
  - `apps/frontend/src/utils/cursorTracking.test.ts` (unit tests)
  - `apps/frontend/src/components/HandCursor.tsx` (visual reticle component)
  - `apps/frontend/src/App.tsx` (cursor state and landmark feeding)
- **Output**: Real-time visual feedback cursor following the user's hand movements across the screen.
- **Connects To**: Session 4 uses cursor position/hover state to trigger card-targeted swipe gestures.
- **Failure Surface**: Coordinate mismatch between MediaPipe normalized coords and DOM screen pixels; landmark jitter.

### Session 4: Gesture Refinement — Ditch Global Swipe & Wire News Card Hover-Swipe
- **Objective**: Disable global camera panning on swipe. Route swipe gestures to the News Board card when the hand cursor hovers over it.
- **Scope**:
  - `apps/frontend/src/App.tsx` (swipe routing logic & camera pan bypass)
  - `apps/frontend/src/components/apps/News.tsx` (swipe event listener and transition triggers)
  - `apps/frontend/src/utils/interactionEngine.ts` / tests (hover event integration)
- **Output**: Swiping while pointing at the news card changes slides; camera stays stable.
- **Connects To**: Session 5 verifies all interactions and updates project memory.
- **Failure Surface**: Gesture event race conditions or gesture misclassification between POINT and SWIPE.

### Session 5: Memory System Sync & Full Verification
- **Objective**: Update project memory documentation to reflect the new interaction model, run all unit tests, and verify end-to-end functionality.
- **Scope**:
  - `memory/MEMORY.md`
  - `memory/jarvis-project.md`
  - Full test suite execution across frontend and backend
- **Output**: Clean passing tests and updated persistent memory.
- **Connects To**: Ready for user testing and subsequent feature expansion.
- **Failure Surface**: Stale memory references or obsolete test assertions from older boot window configurations.

---

## SECTION D — PROGRESS CHECKLIST

- [x] Session 1: 3D Scene Transformation — Pearl-Like Orb & Central Spoke
  - [x] Implement luminous pearl orb mesh (`SphereGeometry` + `MeshPhysicalMaterial`) at `(0,0,0)`
  - [x] Update `holoDecor.ts` hub point to `(0,0,0)` and verify connector spokes
  - [x] Verify `holoDecor.test.ts` passes cleanly
- [x] Session 2: Spatial News Card Application (Slideshow Format) & Single Node Boot
  - [x] Implement `news.ts` data model with 5 curated tech/spatial computing stories
  - [x] Write unit tests for news slideshow logic in `news.test.ts`
  - [x] Build interactive `News.tsx` component with slide transitions and article links
  - [x] Register `news` app and configure `bootScene.ts` for single `news-1` startup
  - [x] Update `bootScene.test.ts` and verify app builds
- [x] Session 3: Hand-Controlled Visual Screen Cursor Overlay
  - [x] Implement `cursorTracking.ts` with landmark projection and smoothing filter
  - [x] Add unit tests for cursor projection and smoothing in `cursorTracking.test.ts`
  - [x] Build `HandCursor.tsx` reticle component with idle/hover/active visual states
  - [x] Mount and wire `HandCursor` in `App.tsx`
- [x] Session 4: Gesture Refinement — Ditch Global Swipe & Wire News Card Hover-Swipe
  - [x] Remove whole-space camera panning from `SWIPE` gestures in `App.tsx`
  - [x] Connect hover-targeted swipe gestures to `News.tsx` via `appBus`
  - [x] Add pinch/tap interaction to open active news article
  - [x] Verify smooth slide navigation upon user hand swipe
- [x] Session 5: Memory System Sync & Full Verification
  - [x] Update `memory/MEMORY.md` and `memory/jarvis-project.md` with new features and architectural changes
  - [x] Run full test suites (`npm test` in frontend and backend: 388/388 passed)
  - [x] Verify dev servers and document live test workflow

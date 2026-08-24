# PLAN: Single-Hand Pinch-Spread Zoom & Hover Dwell-to-Grab Spatial Interactions

## SECTION A — GOAL DEFINITION

1. **What is being built or changed?**
   - **Feature 1: Single-Hand Pinch-and-Spread Dynamic Zoom**:
     - Implement intuitive 2-finger single-hand zoom: when the index finger (Landmark 8) and thumb (Landmark 4) join together in a pinch and then separate from each other, the spatial card scales/zooms in direct proportion to the finger spread distance in real time.
   - **Feature 2: Hover Dwell-to-Grab with Stylized Holographic Lock Border**:
     - When the hand cursor hovers continuously over a card for **2 seconds**:
       - An animated holographic charging contour traces around the perimeter of the card over the 2s dwell duration ($0 \to 100\%$).
       - At 2s, the card transitions into an **Attached / Grabbed** state with a glowing neon cyan/electric-blue lock border.
       - The card locks to the hand position, allowing the user to smoothly move/translate the card in 3D space.
       - Releasing via open hand or flick settles the card at its new 3D coordinates.

2. **What does "done" look like — observable outcome?**
   - Pinching thumb + index finger and spreading them apart over the News Card dynamically expands or shrinks the card size smoothly without jitter.
   - Hovering the hand cursor over the card for 2 seconds displays a charging holographic border around the card and attaches the card to the hand, allowing natural 3D repositioning.
   - All existing tests pass without regressions (`npm test` passes).

3. **What is explicitly out of scope for this task?**
   - Modifying backend WebSocket synchronization logic.
   - Breaking existing multi-window registration or legacy apps.

---

## SECTION B — TECH STACK

- **Skill**: `.agents/skills/spatial-card-interactions/SKILL.md`
- **Core Frameworks**: React 19, TypeScript, Three.js (`Vector3`, `PerspectiveCamera`, `Raycaster`), MediaPipe Hands (21 landmarks).
- **Styling & Shaders**: SVG animated contour stroke, CSS glassmorphism, glowing box-shadows.
- **Testing**: Vitest with unit test suites.

### Stack Impact
- **Touched**:
  - `apps/frontend/src/utils/pinchZoom.ts` (new Euclidean pinch-spread tracking helper)
  - `apps/frontend/src/utils/pinchZoom.test.ts` (unit tests for pinch zoom math)
  - `apps/frontend/src/utils/dwellGrab.ts` (new dwell state machine & hover time tracker)
  - `apps/frontend/src/utils/dwellGrab.test.ts` (unit tests for dwell state machine)
  - `apps/frontend/src/components/FloatingWindow.tsx` (stylized holographic charging border & locked glow)
  - `apps/frontend/src/App.tsx` (wire pinch-spread zoom and dwell-attached translation into interaction loop)
- **Untouched**:
  - Backend proxy & server routes.
  - Video capture pipeline.

---

## SECTION C — SESSION MODULARIZATION

### Session 1: Single-Hand Pinch-and-Spread Dynamic Zoom Engine
- **Objective**: Create a robust Euclidean distance tracking engine (`pinchZoom.ts`) for thumb-to-index pinch spread with anchor distance caching, smoothing, and sensitivity scaling.
- **Scope**:
  - `apps/frontend/src/utils/pinchZoom.ts`
  - `apps/frontend/src/utils/pinchZoom.test.ts`
- **Output**: Unit-tested pinch-spread tracker returning smooth scale factors.
- **Connects To**: Session 4 wires this into `App.tsx`.
- **Failure Surface**: Jitter when fingers touch (mitigated via minimum deadband and exponential moving average).

### Session 2: Hover Dwell Timer & Stylized Holographic Charging Border UI
- **Objective**: Create the dwell tracking utility (`dwellGrab.ts`) and render an animated holographic charging contour and locked neon border in `FloatingWindow.tsx`.
- **Scope**:
  - `apps/frontend/src/utils/dwellGrab.ts`
  - `apps/frontend/src/utils/dwellGrab.test.ts`
  - `apps/frontend/src/components/FloatingWindow.tsx`
- **Output**: Interactive card border that visibly charges over 2s of continuous hover and pulses when locked.
- **Connects To**: Session 3 wires the attached 3D translation when locked.
- **Failure Surface**: Premature dwell resets on small cursor jitter (mitigated by spatial tolerance radius).

### Session 3: Dwell Lock & Spatial Hand-Attached Card Translation
- **Objective**: When dwell hits 2000ms, attach the card to hand cursor motion, updating its 3D world position (`wm.moveWindow`) smoothly following hand translation.
- **Scope**:
  - `apps/frontend/src/App.tsx`
  - `apps/frontend/src/utils/interactionEngine.ts`
- **Output**: User can move the card freely in 3D space once the 2s dwell lock activates.
- **Connects To**: Session 4 adds release and settle dynamics.
- **Failure Surface**: Coordinate jumping on initial grab (mitigated by capturing grab offset relative to window center).

### Session 4: Gesture Integration & Release / Settle Dynamics
- **Objective**: Integrate single-hand pinch spread into the active gesture loop and implement natural release/detach when the user shows an open palm or pulls hand away.
- **Scope**:
  - `apps/frontend/src/App.tsx`
- **Output**: Seamless combined interaction: pinch-to-zoom + dwell-to-grab + hand-move + release.
- **Connects To**: Session 5 verifies all tests and syncs memory.
- **Failure Surface**: Interaction conflict between pinch zoom and dwell grab.

### Session 5: Multi-Agent Review, Verification & Memory Sync
- **Objective**: Execute review by the Reviewer agent, verify all Vitest test suites, build production bundle, and update persistent project memory.
- **Scope**:
  - `docs/briefs/pinch-dwell-brief.md`
  - `docs/reviews/pinch-dwell-review.md`
  - `memory/MEMORY.md` & `memory/jarvis-project.md`
- **Output**: All tests pass, zero build errors, updated memory files.
- **Connects To**: Ready for user testing.
- **Failure Surface**: Broken regression tests.

---

## SECTION D — PROGRESS CHECKLIST

- [x] Session 1: Single-Hand Pinch-and-Spread Dynamic Zoom Engine
  - [x] Create `apps/frontend/src/utils/pinchZoom.ts`
  - [x] Write unit tests in `apps/frontend/src/utils/pinchZoom.test.ts`
- [x] Session 2: Hover Dwell Timer & Stylized Holographic Charging Border UI
  - [x] Create `apps/frontend/src/utils/dwellGrab.ts`
  - [x] Write unit tests in `apps/frontend/src/utils/dwellGrab.test.ts`
  - [x] Add stylized holographic SVG charging contour & locked state in `FloatingWindow.tsx`
- [x] Session 3: Dwell Lock & Spatial Hand-Attached Card Translation
  - [x] Wire 2s dwell lock event in `App.tsx`
  - [x] Update window 3D position following hand translation with smooth lerp
- [x] Session 4: Gesture Integration & Release / Settle Dynamics
  - [x] Wire single-hand pinch-spread zoom in `App.tsx`
  - [x] Wire open-palm / flick release with momentum settling
- [x] Session 5: Multi-Agent Review, Verification & Memory Sync
  - [x] Author Orchestrator brief & Reviewer evaluation report
  - [x] Run full test suite (`npm test`) across frontend and backend (396 tests PASS)
  - [x] Update `memory/MEMORY.md` and `memory/jarvis-project.md`

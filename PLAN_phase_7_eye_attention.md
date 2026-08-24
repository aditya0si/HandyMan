# PLAN — Phase 7: Eye Attention (Research Feature, Not Primary Control)

## Section A — Goal & Acceptance Criteria
- **Technical Restatement:** Implement a lightweight, 100% client-side, opt-in face-presence and coarse gaze-zone detection engine that assists target disambiguation, card focus upon user confirmation, and automatic animation pausing when looking away, strictly respecting privacy with zero network data transmission.
- **Observable "Done" Definition:**
  1. Disabled by default (`eyeAttentionEnabled: false`), fully functional with no face/eye data.
  2. Zero gaze/face data sent over WebSocket or HTTP (pure local execution).
  3. Gaze assists only confirmed actions (never triggers destructive actions or navigation on its own).
  4. Detects gaze zones (`center`, `left`, `right`, `away`) with hysteresis and degrades safely to standard pointer targeting under low confidence (< 0.5).
  5. Looking away (`away`) pauses active card animations and dims non-focused elements gently.
  6. Visible "Eye: Off" / "Eye: [Zone]" indicator in HUD with a 1-click disable toggle.
  7. Automated unit tests passing with zero build errors (`npm run build` and `npm run test`).
- **Out of Scope:** High-precision gaze tracking (not supported on standard webcams), eye-tracking click triggers, autonomous navigation.

## Section B — Tech Stack & Constraints
- **Languages & Frameworks:** TypeScript, React 19, Three.js, Canvas 2D image processing.
- **Privacy & Security Constraints:** 100% in-browser processing. No video frames, coordinates, or face metrics leave the client.
- **Fallbacks:** Mouse, keyboard, and standard hand gestures remain complete and independent primary controls.

## Section C — Blocking Questions & Assumptions
- **Blocking Questions:** None (0).
- **Assumptions:**
  - `[ASSUMPTION 1: Opt-in Default]` Feature is disabled by default in `localStorage` input settings.
  - `[ASSUMPTION 2: Coarse Zones]` Coarse screen classification (`left`, `center`, `right`, `away`) provides reliable assistance without claiming sub-pixel precision.
  - `[ASSUMPTION 3: Local Only]` No backend endpoints or WebSocket messages are needed for eye attention.

## Section D — Session Modularization
1. **Session 1: Shared Models & Detection Engine**
   - Create `packages/shared/src/eyeAttention.ts` and `apps/frontend/src/utils/eyeAttention/eyeAttentionDetector.ts`.
   - Implement pure unit tests in `eyeAttentionDetector.test.ts`.
2. **Session 2: Settings & UI Controls**
   - Update `settings.ts` and `Settings.tsx` to include the Eye Attention toggles and privacy disclaimers.
   - Update HUD in `App.tsx` with one-click disable control and status display.
3. **Session 3: Camera Tracker & Interaction Integration**
   - Create `EyeAttentionTracker.tsx` component processing video stream when enabled.
   - Integrate gaze assistance into `InteractionEngine` raycasting disambiguation.
   - Wire animation pause/dimming state for looking away in `App.tsx`.
4. **Session 4: Verification & Handoff**
   - Run `npm run test` and `npm run build`.
   - Update `improvementplans.md` implementation log.

## Section E — Progress Checklist
- [x] Session 1: Shared Models & Detection Engine
  - [x] Create `packages/shared/src/eyeAttention.ts`
  - [x] Implement `eyeAttentionDetector.ts`
  - [x] Add `eyeAttentionDetector.test.ts`
- [x] Session 2: Settings & UI Controls
  - [x] Update `settings.ts` with eye attention defaults
  - [x] Add Eye Attention section in `Settings.tsx`
  - [x] Add HUD indicator in `App.tsx`
- [x] Session 3: Camera Tracker & Interaction Integration
  - [x] Build `EyeAttentionTracker.tsx`
  - [x] Connect gaze assistance to card disambiguation in `InteractionEngine`
  - [x] Implement look-away animation pause in `App.tsx`
- [x] Session 4: Verification & Handoff
  - [x] `npm run test` (all tests passing)
  - [x] `npm run build` (clean compilation)
  - [x] Update `improvementplans.md`

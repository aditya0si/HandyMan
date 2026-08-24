# JARVIS Phase 1 Plan: Daily Briefing

## A — Goal & Acceptance Criteria
**Goal:** Replace the existing static demo boot triad (News, Weather, Markets) with a calm, purposeful `Briefing` app that composes these widgets together, includes a first-run setup flow for personalization, introduces workspace modes (Briefing, Focus, Present), adds a first-use help overlay for gestures, and improves gesture safety and power efficiency (hand-tracking idling).

**Acceptance Criteria:**
- First-time user can reach a useful briefing in under 90 seconds without a webcam.
- All three modes (Briefing, Focus, Present) work via mouse/keyboard alone.
- With webcam, user can select, scroll, move, and release cards with clear feedback, with no accidental actions when hovering empty space.
- Existing demo cards (Weather, News, Markets) remain usable offline.

**Out of Scope:**
- Tasks and Calendar integrations are explicitly deferred to Phase 3.
- SaaS authentication and backend persistence (Phase 5).

## B — Tech Stack & Constraints
- **Stack:** React, TypeScript, Three.js, MediaPipe (existing stack).
- **Constraints:** Keep the Obsidian visual design intact (black void, neutral glass, specific colors). Fallback data must be provided when providers are unavailable. Local storage first (`localStorage`).

## C — Blocking Questions & Assumptions
**Blocking Questions:** None (0) - using defaults based on existing patterns.

**Assumptions:**
1. *Data:* LocalStorage is sufficient for saving user preferences and workspace layout for now.
2. *Environment:* Running locally in the browser with/without a webcam.
3. *Testing:* Component-level unit tests for state logic and manual visual tests in the browser for interactions.
4. *Boundaries:* `Briefing` card uses internal components or calls to existing stores rather than external APIs for the composed data.

## D — Session Modularization
**Session 1: The Briefing App & Setup Flow**
- Objective: Create the `Briefing` app, the first-run setup UI, and register it.
- Scope: `Briefing.tsx`, `apps/index.ts`, `bootScene.ts`, `storage.ts`.
- Output: A registered Briefing card that prompts for setup and displays mock/composed data.

**Session 2: Workspace Modes & Layout Controls**
- Objective: Implement Briefing, Focus, and Present modes + Save/Reset layout.
- Scope: `App.tsx`, `WindowManager.ts`.
- Output: UI controls and hotkeys to switch modes and persist layout state.

**Session 3: First-use Help & Gesture Refinement**
- Objective: Add the dismissible help overlay, strict scroll scoping, and hand-tracking idle.
- Scope: `App.tsx`, `spatialScroll.ts`, `HandTracker.tsx`.
- Output: Gesture instructions shown on first run, scroll only fires when pointer is over the card, camera reduces polling when hands are gone.

## E — Progress Checklist
- [ ] Session 1: The Briefing App & Setup Flow
  - [ ] Create `Briefing.tsx` with setup flow
  - [ ] Register in `index.ts` and set as `BOOT_APP_IDS`
- [ ] Session 2: Workspace Modes & Layout Controls
  - [ ] Add mode state to `App.tsx`
  - [ ] Implement layout Save/Reset
- [ ] Session 3: First-use Help & Gesture Refinement
  - [ ] Create `HelpOverlay.tsx`
  - [ ] Scope spatial scroll to hover targets
  - [ ] Add idle detection to `HandTracker.tsx`

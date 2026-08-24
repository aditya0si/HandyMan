# ORCHESTRATOR BRIEF: Pearl Orb, Single News Node & Hand-Controlled Spatial Cursor

**Date:** 2026-08-18  
**Author:** Orchestrator Agent (Gemini 3.7 Flash High)  
**Target:** Coder Agent & Reviewer Agent  
**Goal:** Implement Sessions 1 through 5 of `PLAN_pearl_orb_news_and_hand_cursor.md`.

---

## 1. System Architecture & Decisions

### Decision 1: Pearl-Like Orb (Central Landmark)
- **Geometry**: `THREE.SphereGeometry(0.75, 64, 64)` located at `(0, 0, 0)`.
- **Material**: `THREE.MeshPhysicalMaterial` with:
  - `color: 0xf5f8ff` (pearly iridescent white)
  - `roughness: 0.12`
  - `metalness: 0.05`
  - `transmission: 0.15`
  - `clearcoat: 1.0`
  - `clearcoatRoughness: 0.08`
  - `iridescence: 0.95`
  - `iridescenceIOR: 1.33`
  - `iridescenceThicknessRange: [100, 400]`
  - `emissive: 0x1a2e4c`
  - `emissiveIntensity: 0.25`
- **Animation**: In `App.tsx` rAF / `handleFrame`, rotate the orb gently (`rotation.y += 0.002`, `rotation.x = Math.sin(now * 0.0005) * 0.05`).

### Decision 2: Spoke Origin Update
- Update `HOLO_HUB_POINT` in `holoDecor.ts` from `(0, -1.2, 0)` to `(0, 0, 0)` so the energy connector lines emerge directly from the pearl orb's center.

### Decision 3: Single News Node Boot & Application
- Create `apps/frontend/src/utils/news.ts` with 5 curated news articles in the tech/AI/spatial domain:
  1. *Apple Vision Pro Spatial Computing Horizon*: Next-gen spatial audio and hand occlusion.
  2. *Next-Gen WebXR & Three.js Frameworks*: Browser-based spatial computing advances.
  3. *AI Vision Models for Gesture Recognition*: Real-time sub-millisecond edge ML.
  4. *Neural Holography & Photonic Displays*: Light-field spatial computing breakthrough.
  5. *Autonomous Spatial Interfaces*: Adaptive glassmorphic window managers in 3D.
- Navigation helpers: `getNewsItems()`, `getNextIndex(current, total)`, `getPrevIndex(current, total)`.
- Component `apps/frontend/src/components/apps/News.tsx`:
  - 5-slide carousel with slide animations (translateX transitions).
  - Headline, category pill, source + timestamp, summary text, and a prominent "Read Article" link (`target="_blank" rel="noopener noreferrer"`).
  - Dots indicator (1 to 5) and `<` `>` navigation buttons.
  - Listens to `appBus` for `'swipe'` events (`{ direction: 'left' | 'right' }`).
- Register `news` in `appRegistry` via `components/apps/index.ts`.
- Update `bootScene.ts` so `BOOT_APP_IDS = ['news']` and spawn `news-1` at `(1.4, 0.1, 0.4)` (depth 4.6), leaving the pearl orb visible on the left/center.

### Decision 4: Hand-Controlled Visual Screen Cursor Overlay
- Create `apps/frontend/src/utils/cursorTracking.ts`:
  - Maps index fingertip landmark (Landmark 8) or palm center to 2D screen coordinates `(screenX, screenY)`.
  - Normalizes coordinates with exponential smoothing factor `ALPHA = 0.35` to eliminate jitter while maintaining high responsiveness.
- Component `apps/frontend/src/components/HandCursor.tsx`:
  - Fixed DOM overlay with `pointer-events: none` and `zIndex: 99`.
  - Visuals: Outer glowing cyan ring (size 28px, pulsing subtly) with a solid glowing center dot (size 8px).
  - Visual states: `idle`, `hovering` (expands to 36px with brighter glow when over a window/news card), and `pinching` (contracts with active cyan glow).

### Decision 5: Gesture Refinement — Disable Global Swipe & Wire News Hover-Swipe
- In `App.tsx`:
  - Remove camera rig pan on `SWIPE` gestures.
  - When `gesture.type === 'swipe'` arrives:
    - Check if a window is currently hovered (`hoveredByHandRef.current.get(hand)`).
    - If the hovered window is a news window (or active window), dispatch `{ type: 'swipe', direction: gesture.swipeDirection }` via `appBusRef.current.emit(windowId, event)`.
- In `News.tsx`:
  - Subscribe to window bus events on mount; when a `'swipe'` event with `direction === 'left'` is received, advance to the next slide; on `'right'`, return to previous slide.

---

## 2. Reviewer Evaluation Checklist

1. [ ] **Pearl Orb**: Blue test box is replaced with a luminous pearl-like sphere at `(0, 0, 0)`.
2. [ ] **Connector Line**: Single holographic line connects from `(0, 0, 0)` directly to `news-1`.
3. [ ] **Boot Scene**: Scene boots with exactly 1 window (`news-1`). Other apps remain registered.
4. [ ] **News Slideshow**: Card displays 5 news items with carousel navigation (buttons, dots, links).
5. [ ] **Hand Cursor**: Visual reticle tracks user's hand smoothly on screen with zero jitter.
6. [ ] **Swipe Gesture**: Camera does not pan on swipe. Swiping over the News card flips slides.
7. [ ] **Test Suite Integrity**: All Vitest suites pass (`npm test`) with zero failures.

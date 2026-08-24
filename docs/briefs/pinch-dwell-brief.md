# ORCHESTRATOR BRIEF: Single-Hand Pinch Zoom & Hover Dwell-to-Grab

**Date:** 2026-08-19  
**Author:** Orchestrator Agent (Gemini 3.7 Flash High)  
**Target:** Coder Agent & Reviewer Agent  
**Goal:** Implement Sessions 1 through 5 of `PLAN_pinch_zoom_and_dwell_grab.md`.

---

## 1. Interaction Models & Mathematical Decisions

### Decision 1: Single-Hand Pinch-and-Spread Dynamic Zoom (`pinchZoom.ts`)
- Landmark 4 (Thumb tip) and Landmark 8 (Index tip).
- Euclidean distance: $d = \sqrt{(x_8 - x_4)^2 + (y_8 - y_4)^2 + (z_8 - z_4)^2}$.
- When $d \le 0.055$: Pinch initiates; cache anchor distance $d_{\text{anchor}} = d$.
- When fingers separate ($d > d_{\text{anchor}}$): Calculate scale factor $f = 1 + (d - d_{\text{anchor}}) \times 2.0$.
- Smooth with exponential factor $\alpha = 0.4$.
- When $d > 0.14$: Reset pinch anchor.

### Decision 2: 2-Second Hover Dwell Tracker (`dwellGrab.ts`)
- Track continuous cursor dwell on the active/hovered card.
- Dwell target: $2000\text{ms}$.
- Progress: $p = \min(1.0, t_{\text{dwell}} / 2000)$.
- State transition: `isLocked = true` when $p = 1.0$.

### Decision 3: Stylized Holographic Charging Border in `FloatingWindow.tsx`
- Render SVG perimeter contour overlay:
  - `strokeDasharray = perimeter`, `strokeDashoffset = perimeter * (1 - progress)`.
  - Luminous gradient stroke (`#00e5ff` $\to$ `#9df5ff` $\to$ `#a855f7`).
- When `isLocked === true`:
  - Pulsating electric blue frame (`box-shadow: 0 0 35px rgba(0, 229, 255, 0.85)`).
  - Floating badge: `◈ ATTACHED / GRABBED`.

### Decision 4: Hand Cursor Attached 3D Translation
- When `isLocked === true`, translate the window mesh in 3D world space following hand cursor movement.
- On `OPEN` gesture or hand departure, smoothly release and settle the window.

---

## 2. Reviewer Evaluation Checklist

1. [ ] **Pinch Zoom Math**: `pinchZoom.ts` computes distance and scale multipliers accurately with unit test coverage.
2. [ ] **Dwell Tracker**: `dwellGrab.ts` tracks 2000ms duration, progress $0 \to 1$, and lock transitions.
3. [ ] **Stylized Holographic Border**: `FloatingWindow.tsx` renders animated SVG charging stroke and glowing locked state.
4. [ ] **Attached 3D Movement**: Card follows hand position in 3D space when 2s dwell lock is active.
5. [ ] **Open Palm Release**: Hand open gesture releases grab cleanly.
6. [ ] **Zero Regressions**: All 389+ Vitest tests pass across frontend and backend.

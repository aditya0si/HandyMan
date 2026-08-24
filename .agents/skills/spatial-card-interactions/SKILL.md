---
name: spatial-card-interactions
description: Guidelines and algorithms for spatial card gestures in WebXR / Three.js, including single-hand pinch-and-spread dynamic zooming and hover dwell-to-grab holographic locking.
---

# Spatial Card Interactions Skill

This skill defines interaction models, state machines, and visual styling rules for webcam-driven spatial computing cards.

## 1. Single-Hand Pinch-and-Spread Dynamic Zoom
- **Landmarks**: Thumb Tip (Landmark 4) and Index Tip (Landmark 8).
- **Euclidean Distance**:
  $$d = \sqrt{(x_8 - x_4)^2 + (y_8 - y_4)^2 + (z_8 - z_4)^2}$$
- **State Machine**:
  1. `IDLE`: Hand is open or pointing ($d > 0.08$).
  2. `PINCH_INIT`: When $d \le 0.05$, pinch begins. Record baseline anchor distance $d_0 = d$.
  3. `SPREAD_ZOOMING`: As fingers spread apart ($d > d_0$), calculate zoom delta $\Delta d = (d - d_0) \times \text{sensitivity}$. Apply scale multiplier $1 + \Delta d$ clamped to safe bounds `[0.4, 8.0]`.
  4. `PINCH_RELEASE`: When hand returns to open ($d > 0.15$), lock the final scale and reset anchor.

## 2. Hover Dwell-to-Grab & Holographic Lock Border
- **Dwell Timer**:
  - Dwell threshold: $2000\text{ms}$ continuous hover over a card.
  - Progress ratio: $p = \min(1.0, \Delta t / 2000\text{ms})$.
- **Visual Feedback**:
  - $0 \le p < 1.0$: Luminous holographic charging contour around the card border (SVG stroke-dashoffset tracing the perimeter with electric cyan glow).
  - $p = 1.0$: "LOCKED / ATTACHED" state:
    - Glowing neon cyan & purple pulsating border (`box-shadow: 0 0 30px rgba(0, 229, 255, 0.8)`).
    - Card enters attached drag mode, smoothly translating with hand position in 3D world space.
- **Detachment / Release**:
  - Fast hand flick, open palm gesture, or manual release cleanly detaches the card and settles it at its new 3D coordinates with momentum damping.

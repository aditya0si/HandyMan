---
name: interaction-tuning-preferences
description: User skews responsive/fast for gesture/interaction tuning and likes
  deciding via concrete options
metadata:
  node_type: memory
  type: feedback
  originSessionId: sess_4920ca28-145c-451d-b61f-c8c3d07abffd
---

When tuning JARVIS interaction feel (2026-08-22 gesture session), the user called the original deliberate settings "pretty ass" and chose every responsive option offered: 0.7s dwell over 2.0s, pinch-click select, two-finger scroll, skip depth. They also explicitly asked to "discuss with me" how gestures should work rather than having the design chosen for them.

**Why:** default-safe interaction budgets (long dwells, wide deadbands) read as sluggish to this user; they'd rather tolerate occasional accidental triggers than feel delay.

**How to apply:** when tuning gesture thresholds, timeouts, or smoothing, bias toward responsiveness (shorter dwell/deadband, snappier cursor) and present trade-offs as concrete options via AskUserQuestion — they engage well with that format and decide quickly. See [[jarvis-project]] for the implemented vocabulary.

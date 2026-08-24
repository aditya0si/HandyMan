# ORCHESTRATOR BRIEF: Real-Time Google-Style News Carousel & Two-Finger Panel Zoom

**Date:** 2026-08-19  
**Author:** Orchestrator Agent (Gemini 3.7 Flash High)  
**Target:** Coder Agent & Reviewer Agent  
**Goal:** Implement Sessions 1 through 5 of `PLAN_realtime_news_google_style_zoom.md`.

---

## 1. System Architecture & Decisions

### Decision 1: Workspace Purge & Window Scale Boost
- Purge `apps/backend/data/workspace.json` so it only contains `news-1` at `position: [1.6, 0.0, 0.4]` with clean initial scale.
- In `windowManager.ts`, set `WINDOW_BASE_WIDTH = 3.2` and default window aspect to `16 / 10` for generous, readable layout.
- In `windowManager.ts`, implement scale clamping in `resizeWindow`:
  - `const MIN_SCALE = 0.5; const MAX_SCALE = 3.5;`
  - Clamping formula: clamp `scale.x` to `[WINDOW_BASE_WIDTH * MIN_SCALE, WINDOW_BASE_WIDTH * MAX_SCALE]`.

### Decision 2: Backend Live News API (`GET /api/news`)
- In `apps/backend/src/api/http.ts`, add `GET /api/news` route:
  - Fetches `https://news.google.com/rss/headlines/section/topic/TECHNOLOGY?hl=en-US&gl=US&ceid=US:en` with a 5-second timeout.
  - Extracts `<item>` elements (title, link, pubDate, source, description).
  - Pairs with high-resolution tech imagery and neon category badges.
  - Returns array of `{ id, title, source, timeAgo, category, summary, url, imageUrl, badgeColor }`.
  - Fallback: If network is unavailable or times out, returns 5 rich pre-seeded spatial computing / AI stories with working external URLs and high-res images.

### Decision 3: Google News-Style Visual UI in `News.tsx`
- Build a Top Stories visual card:
  - High-res cover image header with dark gradient overlay (`height: 140px`, `objectFit: cover`).
  - Floating source pill (*The Verge*, *MIT Tech Review*, *Wired*, *TechCrunch*) with source badge.
  - Large headline with crisp typography and text drop shadow.
  - Time elapsed pill and article summary.
  - Working "Read Full Story ↗" external button (`target="_blank" rel="noopener noreferrer"`).
  - Previous / Next carousel navigation and pagination indicator dots.
  - Auto-fetches live news on mount from `/api/news` with immediate rich fallback.

### Decision 4: Two-Finger Spatial Panel Zoom
- In `App.tsx`:
  - In `handleGesturesDetected`: When `gesture.type === GestureType.PINCH_ZOOM`:
    - Find target window: `hoveredByHandRef.current.get(gesture.handedness) ?? (windows.length > 0 ? windows[0].id : null)`.
    - If target window exists:
      - Calculate zoom factor: `dir === 'out' ? 1.03 + gesture.intensity * 0.04 : 0.97 - gesture.intensity * 0.04`.
      - Call `wm.resizeWindow(targetId, zoomFactor)`.
  - Spreading fingers scales the card up; pinching fingers scales the card down.

---

## 2. Reviewer Evaluation Checklist

1. [ ] **State Cleanliness**: Backend `workspace.json` contains only `news-1`. No old `dashboard`/`notes`/`chat` nodes appear on startup.
2. [ ] **Window Dimensions**: News card is scaled generously (~500–600px projected DOM footprint) with high legibility.
3. [ ] **Backend `/api/news`**: Returns valid JSON array of articles with real titles, links, publishers, and images.
4. [ ] **Google News Visual Layout**: `News.tsx` renders large cover images, publisher badges, headlines, and working "Read Full Story" links.
5. [ ] **Two-Finger Zoom**: Spreading or closing two fingers over the card resizes the window panel smoothly in real time.
6. [ ] **Card Swipe Navigation**: Hand swipe gesture continues to navigate news slides seamlessly.
7. [ ] **Zero Regressions**: All Vitest test suites pass (`npm test` in frontend and backend).

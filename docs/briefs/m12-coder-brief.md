# M12 Coder Brief — Holographic Restyle (Part A) + Multi-user Hands & Ownership (Part B)

Self-authored by the main session (user directive 2026-08-17: the
orchestrator/coder/reviewer loop is retired; the main session self-instructs,
implements, and self-reviews). Scope sources, in priority order:

1. User's reference image + "we are trying to have a holographic 3d effect in
   our space which is controlled by hand gestures. keep the ui like this" → Part A.
2. The M12 milestone prompt (multi-user hand visibility + ownership-based
   conflict resolution) → Part B.

Standing constraints: NOT a git repo (no init/commit); no new npm deps;
API keys only via VITE env; M13 (persistence, API proxy) NOT started; all
existing tests keep passing; verifiers v1–v11 keep passing (title lockstep
excepted); zero console errors with the backend down (M11 probe gate intact).

---

## Part A — Holographic restyle (user image → JARVIS look)

The reference: deep-navy space with a soft radial glow, cyan floor grid,
frosted-glass panels with thin cyan borders and glow arranged around a center,
glowing connector spokes, mono uppercase type, orange as the secondary accent.
The existing app already has the right bones (3D window planes + DOM overlay +
mono type); Part A is a palette/material/atmosphere pass, not a layout change.

- **A1 Palette** (mechanical literal swap, no contract text/testid changes):
  primary accent `#0084ff`/`rgba(0,132,255,*)` → cyan `#00e5ff`/`rgba(0,229,255,*)`;
  panel backgrounds `rgba(10,14,39,*)` → `rgba(6,13,31,*)`; HUD value green
  `#00ff88` → light cyan `#9df5ff`; scene/css background `#0a0e27` → `#060d1f`;
  orange secondary `#ff9f43` introduced ONLY for the remote-owner badge (B/D10).
  Files: App.tsx, FloatingWindow.tsx, GestureDebug.tsx, HandTracker.tsx,
  ErrorBanner.tsx, apps/{Dashboard,Notes,Chat,Search}.tsx, index.css,
  Scene3D.tsx, windowManager.ts (mesh material).
- **A2 Backdrop vignette**: a CSS radial-gradient overlay div INSIDE Scene3D's
  fixed container (after the canvas, `pointer-events:none`) — the App overlay
  stack (canvas zIndex 0, windows 1+, HUD 20) is untouched.
- **A3 Floor + depth**: GridHelper re-tinted cyan and moved to y=−1.6 (below
  the window band — it used to slice through the windows); `THREE.Fog`
  (bg color, 8→18) fades the grid rim and adds depth on window planes.
- **A4 HoloDecor** (`utils/holoDecor.ts`): center rings (2 additive
  `RingGeometry` circles at floor level, slow counter-rotation in
  `update(now)`) + one connector line per window from the low hub point to the
  window center (`sync(windows)` reads live mesh positions). Driven from App's
  existing rAF (`handleFrame`); never in `getGrabbableMeshes()` and the engine
  raycasts non-recursive (proven `intersectObjects(meshes, false)`), so it can
  never intercept interaction rays.
- **A5 Window meshes**: emissive → cyan; each window mesh gains an
  `EdgesGeometry` cyan `LineSegments` child (the glowing wireframe frame;
  non-recursive raycast keeps it invisible to the engine); disposed on close.
- **A6 DOM chrome**: frosted translucent (`rgba(6,13,31,0.55)` +
  `backdropFilter: blur(8px)`), cyan 1px border + soft glow boxShadow,
  uppercase letterspaced titles, owner badge in the title bar (see D10).
  HUD/Reset view/GestureDebug adopt the same language. Every data-testid,
  every console line, every pinned text stays byte-identical.
- **A7 Verifier safety**: v1–v11 pin no colors; the only cross-verifier change
  is the title lockstep (D16). Boot line, HUD rows, window counts, PERF line,
  FPS logs, probe gate — all untouched.

## Part B — M12 proper

### The load-bearing discovery (D1)

`apps/backend/src/websocket/server.ts` broadcasts `windowUpsert`/`windowClose`
**excluding the sender** (`broadcast(msg, userId)`), pinned by the existing
M11 integration tests. Therefore a client NEVER receives its own window
mutations back: everything arriving via `windowSync`/`stateSnapshot` is, by
construction, **not the local user's window**. Consequences:

- The client needs **no self identity** — the prompt's anticipated "client
  can't know its userId" gap does not exist, so the **backend stays
  byte-identical** (constraint honored; the close-broadcast test already
  exists: `windowClose: others receive a stateSnapshot WITHOUT the window`).
- The server does not enforce ownership (any client could upsert any window;
  no auth exists). OWNER-MUTATES is client-enforced in M12; server-side
  enforcement is post-M13 work. Documented trust model.

### Decisions

- **D1 Ownership model**: OWNER-MUTATES. Owner = the server-stamped creator
  (M11 preserves owner on upsert). Only the owner's gestures mutate a window.
- **D2 Registry**: App-owned `remoteOwnedIdsRef: Set<string>` — ids
  materialized from remote state. `isEditable(id) = !remoteOwnedIdsRef.has(id)`.
  Injected into the engine; default `() => true` keeps all existing tests green.
- **D3 Engine gates** (constructor option `isEditable`):
  new-grab raycast hit on a non-editable window → silent `[]`; `joinRotation`
  on non-editable → `[]` (defensive); a continuation frame whose grab target
  became non-editable → drop the grab + clear the rotation slot, no events
  (mirrors closed-window hygiene). Mid-grab flips are unreachable in practice
  (a locally-grabbed id can never enter the registry) — the drop is defensive
  and unit-pinned. **Hover is NOT gated**: it is read-only highlight feedback;
  the strictest reading of "no events" would forbid it, but the enumerated
  tests gate grab start + continuation only — documented deviation.
- **D4 remoteApply** (`utils/remoteApply.ts`, pure module over a
  WindowManager-like):
  `applyRemoteWindow(state, wm, remoteIds)` →
  - id in registry → apply move (absolute), rotate (absolute), resize
    (factor = wire.scale / current scale.x — WM resize is compound), zIndex;
    if the local window vanished, recreate it. Returns `'updated'`.
  - id exists locally but NOT in registry (snapshot collision with boot ids —
    the server's first-creator-wins keeps the OLD owner, e.g. a previous
    session's) → **skip** (`'skipped-local'`): the local fresh view wins and
    the bridge's next diff overwrites the server copy. No duplicates, no throw.
  - unknown id → create + apply rotation/scale/zIndex + registry add
    (`'created'`).
  `applyRemoteClose(id, wm, remoteIds)` → `'closed' | 'skipped-local' | 'unknown'`.
  `reconcileSnapshot(windows, wm, remoteIds)` → applies all + closes registry
  ids absent from the snapshot (owner-close propagates as a snapshot, M11 D8).
- **D5 WindowManager addition**: `setZIndex(id, zIndex)` — absolute write,
  `nextZIndex = max(nextZIndex, zIndex + 1)` keeps allocation monotonic,
  notifies. The ONLY WM behavioral change.
- **D6 Bridge filter**: App passes
  `wm.getAllWindows().filter(w => !remoteOwnedIdsRef.current.has(w.id))` to
  `createWindowSyncBridge` — remote materializations are never re-upserted
  (kills the echo-churn feedback loop); they never enter the bridge snapshot,
  so no phantom `windowClose`s either.
- **D7 RemoteHandsManager** (`utils/remoteHands.ts`):
  `REMOTE_HAND_COLORS` (5 entries) + `colorForUser(userId)` (stable 32-bit
  hash → palette index; deterministic across reconnects). Per-user
  `THREE.Group`; one small sphere per landmark (shared `SphereGeometry`,
  per-user `MeshBasicMaterial` — flat unlit holo look); positions via the
  EXISTING `landmarkToVector3` (same world convention as local gestures;
  landmark z stays wrist-relative — same caveat as M4/M7, documented).
  `update(userId, hands)` REPLACES the user's set (never accumulates);
  `removeUser` (userLeft — hands go, windows persist per M11 D7); `clear` +
  `dispose` (per-scene replacement). Updates ONLY on handSync (~20 Hz max),
  never per rAF (cost guard). Counts exposed for the HUD.
- **D8 HUD Remote row**: "Remote" row = total remote hands, written
  imperatively ONLY-ON-CHANGE (a ref into the Hud subtree; zero React
  re-renders at handSync rate). `data-testid="remote-hands"`. This is the
  documented verifier hook (with the `[Sync] handSync` log line).
- **D9 App wiring** (per scene, inside `handleSceneReady`): dispose old
  RemoteHandsManager + HoloDecor; reset registry/remote refs; engine gets
  `isEditable`; RemoteHandsManager + HoloDecor groups added; the message
  handler's `stateSnapshot` arm RECONCILES (D4) instead of store-only;
  `windowSync` applies; `handSync` updates the manager + indicator;
  `userLeft` removes hands. Title → "JARVIS · Milestone 12".
- **D10 Owner badge**: FloatingWindow gains `isRemote?: boolean`; title bar
  shows `◈ YOU` (cyan) or `◈ REMOTE` (orange). Conveys D1 at a glance; new
  span only, no pinned text touched.
- **D11 sync.ts**: UNCHANGED. Deviation from prompt item 3 ("expose remote
  users in sync.ts"): remote state stays in App refs — the M11
  single-source-of-truth pattern; colors come from `colorForUser` at
  consumption. Duplicating state into the transport would create drift risk
  for zero benefit. Documented here.
- **D12 Backend**: ZERO changes (see D1). Verified by grepping the existing
  suite for the close-broadcast test instead of adding one.

### Tests (enumerated)

- `remoteHands.test.ts` (7): color determinism/stability/distinctness for
  distinct users; sphere count 21/hand + positions equal
  `landmarkToVector3(landmark)` for quantized wire tuples; replace-not-
  accumulate; removeUser; clear; counts; dispose removes the group.
- `interactionEngine.test.ts` ADDITIONS (2, new describe only): non-editable
  rejects grab start AND continuation (no state — subsequent frames silent);
  mid-grab flip drops the grab silently (no move events).
- `remoteApply.test.ts` (9): create (registry add + all fields applied);
  update move; update rotate; update resize factor math (wire 2.0 from base
  1.5); setZIndex absolute + monotonic allocation; skipped-local;
  applyRemoteClose closed/skipped-local/unknown; reconcileSnapshot closes a
  missing registry id; hovered remote window closed by owner → next POINT
  frame emits hover-null (real engine + camera — the M6 eviction path).
- `windowManager.test.ts` ADDITION (1): setZIndex write + monotonic
  `nextZIndex` (bringToFront after a remote zIndex stays above it).
- `holoDecor.test.ts` (3): rings present + update rotates them; connectors
  follow window positions on sync; dispose cleans the scene.
- Totals: frontend 263 + 22 = 285; backend 20 unchanged.

### Verifier (verify_milestone12.py) — owns the exact "JARVIS · Milestone 12" pin

Backend lifecycle as v11 (dist precondition, Popen, health poll ≤15 s).
Playwright launches with TWO browser contexts (staggered boots to keep page
A's latency band honest) + a python ws client ("C"):

- a) Page A boots: exact M12 title, Camera active, MediaPipe ready, Windows
  row = 4, Sync connected, Users = 1, boot ids {dashboard-1, notes-1, chat-1,
  search-1}, PERF line, latency band 150–260 ms.
- b) Page B boots (second context): both pages Sync connected; B materializes
  A's 4 windows from the snapshot (DOM floating windows present on B);
  Users = 2 on A.
- c) A opens notes-2 via the launcher (native-click idiom) → B's DOM gains
  `data-window-id="notes-2"` (cross-page collaboration proof).
- d) C (ws) sends handUpdate with 1 hand × 21 landmarks → A's
  `remote-hands` indicator reads ≥1 hand + `[Sync] handSync` log present.
- e) C upserts window `holo-1` twice (two positions) → A's `holo-1` DOM
  left/top CHANGES between the two (remote apply proof).
- f) C leaves → A's Users row drops to 2 and remote-hands returns to 0.
- g) Zero console/page errors on BOTH pages (KNOWN_OFFLINE_NOISE filter
  inherited; backend up so nothing is expected).
- h) Screenshots m12-page-a.png / m12-page-b.png + evidence m12-*.txt.

Offline behavior (probe gate) stays v11's tier-1 property — v12 does not
re-pin it.

### Title lockstep (D16, same change)

- App.tsx HUD title → `JARVIS · Milestone 12` (+ comment names v12 as the
  pin owner).
- verify_milestone11.py: line-212 finder + line-490 assertion + the docstring
  item downgrade to the tolerant `JARVIS · Milestone` lookup (D15 policy).
- v2–v10 already tolerant; v1 pins no title; v12 owns the exact pin.
- All twelve verifiers re-run; hash table recomputed (v11's hash changes —
  forced by the lockstep edit, expected).

### README

M11 section is still owed (written in this same change) + the M12 section:
what was built (Parts A and B), how to run two pages + backend, the D1
echo-exclusion insight, the trust model, deviations digest (D3 hover, D11
sync.ts, A-part as user-directed scope), evidence hashes, honest acceptance
mapping + the user's live two-browser spot-check list.

### Out of scope (hard)

M13 persistence + API proxy; ownership transfer; inter-user chat; two users
grabbing the same window (unreachable by the owner-only rule — documented);
scene-root scaling; backend protocol changes.

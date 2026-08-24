import * as THREE from 'three';

/**
 * M8 app boot scene + spawn table (replaces the M7 demoScene — sanctioned
 * amendment): windows are now APP windows created through the registry,
 * with ids allocated per app ('<appId>-<n>', D3).
 *
 * D2 margin table (camera (0, 0, 5), fov 75 — the M7 NDC-margin
 * discipline; every |ndc| <= 0.3158 < 0.9 at BOTH aspect 16:9 and 16:10
 * (search-1 @16:10; still far below the 0.9 gate), huge margin against
 * App's |ndc| > 1 off-screen cull). Depths are
 * deliberately closer than the M7 demo so real app content gets a larger
 * projected area (the M3 window scale constants are frozen):
 *
 *   dashboard-1  (-1.6,  0.75, 0.4)  depth 4.6   max |ndc| 0.2833
 *   notes-1      ( 1.6, -0.65, 0.2)  depth 4.8   max |ndc| 0.2715
 *   chat-1       ( 0.0,  0.0, 0.25)  depth 4.75  max |ndc| 0.0000
 *   search-1     (-1.9, -0.85, 0.1)  depth 4.9   max |ndc| 0.3158
 *                (chat-1 is 0.0 at both aspects; the boot-pair bound of
 *                0.3158 is unchanged — the all-apps worst incl. cascade
 *                instances 2-4 stays 0.3988, notes-4 at 16:10; search's
 *                worst cascade is 0.3856, search-4, y at both aspects)
 *
 * Projected rects at the 1280x800 verifier viewport: Dashboard
 * ~(373.7, 267.2)-(543.7, 362.8), Notes ~(732.3, 424.8)-(895.2, 516.4),
 * Chat ~(557.7, 353.7)-(722.3, 446.3), Search ~(358.1, 445.5)-(517.7,
 * 535.3) — fully on screen, disjoint (Chat is dead-center: 14.0 px clear
 * of Dashboard's right edge, 10.0 px clear of Notes' left edge; Search
 * sits bottom-left: 40.0 px clear of Chat's left edge, 82.7 px below
 * Dashboard's bottom edge, 214.7 px clear of Notes' left edge, 264.7 px
 * bottom margin), clear of the HUD (top-left), GestureDebug
 * (top-right), and the reset button (top-center); boot depths 4.6 / 4.75 /
 * 4.8 / 4.9 pairwise distinct, distinct lefts (min gap 15.6 px) / tops
 * (min gap 20.7 px). Unit-pinned by bootScene.test.ts (incl.
 * cascade instances 2-4, worst |ndc| 0.3988); v10 additionally asserts
 * full viewport containment for the boot quad. Accepted cascade note
 * (M9 D11): launcher-opened chat-2 may slightly overlap notes-1's rect —
 * pre-accepted M8 behavior (notes-2 overlaps notes-1 identically); boot
 * windows are the no-overlap contract. Search cascades stay clear of all
 * boot windows through instance 4 (search-2 rect (384.7, 466.8)-
 * (544.3, 556.6), 13.4 px clear of Chat).
 *
 * Launcher-opened instances cascade by SPAWN_CASCADE_STEP (0.25, -0.2, 0)
 * per instance number so successive windows of one app do not spawn
 * perfectly stacked (margin-verified for instances 1-4; the |ndc| > 1
 * cull remains the backstop beyond that).
 */

/** One margin-verified home position per registered boot app.
 *  Obsidian boot triad: the big news card right-of-center, weather above
 *  the left edge, markets below it — all clear of the HUD (top-left),
 *  GestureDebug (top-right) and each other at 16:9 and 16:10 (worst
 *  |ndc| ≈ 0.33 for the left pair, news ≈ 0.53 at its outer edge). */
const SPAWN_POSITIONS: Record<string, THREE.Vector3> = {
  news: new THREE.Vector3(1.6, 0.0, 0.4),
  weather: new THREE.Vector3(-1.95, 0.72, 0.35),
  markets: new THREE.Vector3(-1.95, -0.62, 0.2),
  briefing: new THREE.Vector3(0, 0, 0.4),
  dashboard: new THREE.Vector3(-1.6, 0.75, 0.4),
  notes: new THREE.Vector3(1.6, -0.65, 0.2),
  chat: new THREE.Vector3(0, 0, 0.25),
  search: new THREE.Vector3(-1.9, -0.85, 0.1),
  // Widget dashboard — tidy grid alongside briefing, all |ndc| < 0.65
  'widget-weather': new THREE.Vector3(-1.85, 0.9, 0.45),
  'widget-markets': new THREE.Vector3(-1.85, -0.9, 0.3),
  'widget-news': new THREE.Vector3(1.75, 0.9, 0.4),
  'widget-clock': new THREE.Vector3(1.75, -0.85, 0.32),
  'widget-system': new THREE.Vector3(0, -1.05, 0.28),
};

/** Apps opened at boot. Phase 1 introduces the unified Briefing card. */
export const BOOT_APP_IDS: readonly string[] = ['briefing'];

/** Widget dashboard — spawned alongside BOOT_APP_IDS in App.handleSceneReady. */
export const WIDGET_IDS: readonly string[] = [
  'widget-weather',
  'widget-markets',
  'widget-news',
  'widget-clock',
  'widget-system',
];

/** Deterministic boot window count — v10 pins exactly this (D14 tier 1). */
export const BOOT_WINDOW_COUNT: number = BOOT_APP_IDS.length;

/** Per-instance spawn cascade (see module docblock). */
export const SPAWN_CASCADE_STEP: THREE.Vector3 = new THREE.Vector3(0.25, -0.2, 0);

/** Center spawn for apps without a table entry (future apps): |ndc| = 0
 *  at the boot pose, on screen by construction. */
export const DEFAULT_SPAWN_POSITION: THREE.Vector3 = new THREE.Vector3(0, 0, 0.3);

/** Default widget window sizes (world width). Clocks are narrower, news wider. */
export const WIDGET_DEFAULT_WIDTHS: Record<string, number> = {
  'widget-weather': 1.35,
  'widget-markets': 1.35,
  'widget-news': 1.55,
  'widget-clock': 1.35,
  'widget-system': 1.35,
};

/**
 * Spawn position for instance `instance` (1-based; clamped to >= 1) of an
 * app: the table position (or the default for unknown apps) plus the
 * cascade offset for instances past the first. ALWAYS returns a fresh
 * clone — callers may mutate the result freely.
 */
export function getSpawnPosition(appId: string, instance = 1): THREE.Vector3 {
  const base = SPAWN_POSITIONS[appId] ?? DEFAULT_SPAWN_POSITION;
  const n = Math.max(1, instance);
  if (n === 1) return base.clone();
  return base
    .clone()
    .add(SPAWN_CASCADE_STEP.clone().multiplyScalar(n - 1));
}

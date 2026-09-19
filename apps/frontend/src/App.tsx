import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode, RefObject } from 'react';
import * as THREE from 'three';
import type { CameraState, Hand, Handedness, MediaPipeState, ServerMessage, WindowState } from '@jarvis/shared';
import type { Gesture } from './utils/gestures';
import { GestureType } from './utils/gestures';
import type { FloatingWindow } from './utils/windowManager';
import { WindowManager, resolveHighlightLevel, WINDOW_BASE_WIDTH } from './utils/windowManager';
import { CameraRig } from './utils/cameraRig';
import { InteractionEngine } from './utils/interactionEngine';
import type { InteractionEvent } from './utils/interactionEngine';
import { RemoteHandsManager } from './utils/remoteHands';
import { applyRemoteWindow, applyWindowStateFields, reconcileSnapshot } from './utils/remoteApply';
import { HoloDecor } from './utils/holoDecor';
import type { WorkspaceResult } from './utils/appRegistry';
import {
  loadWorkspace as loadWorkspaceFromServer,
  saveWorkspace as saveWorkspaceToServer,
} from './utils/workspace';
import { DEFAULT_PROXY_URL } from './utils/apiProxy';
import { BOOT_APP_IDS, BOOT_WINDOW_COUNT, WIDGET_DEFAULT_WIDTHS, WIDGET_IDS, getSpawnPosition } from './utils/bootScene';
import { buildLayoutFromWindows, loadWidgetLayout, saveWidgetLayout } from './utils/widgets/widgetLayout';
import {
  DEFAULT_SYNC_URL,
  SyncManager,
  createWindowSyncBridge,
  deriveHealthUrl,
  toWindowState,
} from './utils/sync';
import type { SyncStatus, WindowSyncBridge } from './utils/sync';
import { appIdFromWindowId, createAppBus, getApp, getTitle } from './utils/appRegistry';
import type { AppBus } from './utils/appRegistry';
import './components/apps';
import {
  AnimationController,
  PositionSmoother,
  VelocityTracker,
  buildMomentumSpec,
} from './utils/animation';
import { PerformanceLogger, SUMMARY_INTERVAL_MS } from './utils/logger';
import { recordPerf } from './utils/perfDebug';
import { errorCollector } from './utils/errors';
import { friendlyErrorText } from './utils/errorMessages';
import { FloatingWindow as FloatingWindowView } from './components/FloatingWindow';
import type { WindowProjection } from './components/FloatingWindow';
import { Scene3D } from './components/Scene3D';
import { CameraCapture } from './components/CameraCapture';
import { HandTracker } from './components/HandTracker';
import { GestureDebug } from './components/GestureDebug';
import { HandCursor } from './components/HandCursor';
import { HelpOverlay } from './components/HelpOverlay';
import { getPointerLandmark, landmarkToScreen, smoothCursor } from './utils/cursorTracking';
import type { CursorPosition, HandCursorData } from './utils/cursorTracking';
import { useInputSettings } from './utils/settings';
import { Calibration } from './components/Calibration';
import { PinchSpreadZoomTracker } from './utils/pinchZoom';
import { DwellGrabTracker } from './utils/dwellGrab';
import { PinchClickTracker } from './utils/pinchClick';
import { scrollAtPoint } from './utils/spatialScroll';
import { EyeAttentionTracker } from './components/EyeAttentionTracker';
import type { EyeAttentionState } from '@jarvis/shared';
import { setStoredInputSettings } from './utils/settings';
import { telemetry } from './utils/telemetry';
import { OnboardingFlow } from './components/OnboardingFlow';

/** M11 sync endpoints (D11): env is read HERE only — utils/sync.ts is
 *  node-pure. VITE_HEALTH_URL is optional (derived from VITE_SYNC_URL by
 *  default: ws->http, port -> 4000, /api/health). */
const SYNC_URL: string = import.meta.env.VITE_SYNC_URL ?? DEFAULT_SYNC_URL;
const SYNC_HEALTH_URL: string = deriveHealthUrl(
  SYNC_URL,
  import.meta.env.VITE_HEALTH_URL,
);
/** M13 (D13): workspace REST base — same env knob as the API proxy. */
const WORKSPACE_API_BASE: string =
  import.meta.env.VITE_API_PROXY_URL ?? DEFAULT_PROXY_URL;

interface HudProps {
  cameraState: CameraState;
  mediaPipeState: MediaPipeState;
  handsCount: number;
  windowsCount: number;
  gestureSummary: string;
  fps: number;
  latencyMs: number;
  syncStatus: SyncStatus;
  syncUsers: number;
  /** M15 (D6): distinct uncaught errors seen this session (0 on the healthy path). */
  errorCount: number;
  /** M12 (D8): the "Remote" row's value span — written imperatively
   *  ONLY-ON-CHANGE from the handSync handler (zero React re-renders at
   *  sync rate). */
  remoteIndicatorRef: RefObject<HTMLSpanElement | null>;
  isAuthenticated: boolean;
  eyeState: EyeAttentionState | null;
  onToggleEyeAttention: () => void;
}

function StatusRow({
  label,
  value,
  valueTestId,
}: {
  label: string;
  value: string;
  /** Optional hook on the VALUE span only (label + value share one row, so a
   *  row-level testid cannot assert the value alone). Mirrors the existing
   *  hud-errors / remote-hands pattern. */
  valueTestId?: string;
}) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 16 }}>
      <span style={{ color: '#8b8f98' }}>{label}</span>
      <span
        data-testid={valueTestId}
        style={{ color: '#e8eaed', fontWeight: 500, fontVariantNumeric: 'tabular-nums' }}
      >
        {value}
      </span>
    </div>
  );
}

function Hud({
  cameraState,
  mediaPipeState,
  handsCount,
  windowsCount,
  gestureSummary,
  fps,
  latencyMs,
  syncStatus,
  syncUsers,
  errorCount,
  remoteIndicatorRef,
  isAuthenticated,
  eyeState,
  onToggleEyeAttention,
}: HudProps) {
  return (
    <div
      style={{
        position: 'fixed',
        top: 16,
        left: 16,
        zIndex: 20,
        minWidth: 250,
        background: 'rgba(10, 11, 13, 0.72)',
        backdropFilter: 'blur(18px)',
        border: '1px solid rgba(255, 255, 255, 0.1)',
        borderRadius: 12,
        padding: '11px 14px',
        color: '#f4f5f7',
        fontFamily:
          'Inter, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif',
        fontSize: 12,
        lineHeight: 1.7,
        userSelect: 'none',
      }}
    >
      <div
        style={{
          fontWeight: 600,
          marginBottom: 6,
          color: '#f4f5f7',
          letterSpacing: '0.12em',
          display: 'flex',
          alignItems: 'center',
          gap: 7,
        }}
      >
        {/* HUD title bumps per milestone (now "JARVIS · Milestone 15").
            verify_milestone15.py owns the exact pin (introspection finder +
            HUD check); every older verifier uses the version-tolerant
            'JARVIS · Milestone' lookup (v14's exact pin was made tolerant
            in the M15 lockstep — two-tier title policy). */}
        <span
          aria-hidden="true"
          style={{
            width: 5,
            height: 5,
            borderRadius: '50%',
            backgroundColor: '#00e5ff',
            boxShadow: '0 0 6px rgba(0, 229, 255, 0.8)',
            flexShrink: 0,
          }}
        />
        JARVIS · Milestone 15
      </div>
      <StatusRow label="Camera" value={cameraState} valueTestId="hud-camera" />
      <StatusRow label="MediaPipe" value={mediaPipeState} />
      <StatusRow label="Hands" value={String(handsCount)} />
      <StatusRow label="Windows" value={String(windowsCount)} />
      <StatusRow label="Gestures" value={gestureSummary} />
      <StatusRow label="FPS" value={`${fps}`} />
      <StatusRow label="Latency" value={`${latencyMs} ms`} />
      <StatusRow label="Sync" value={syncStatus === 'disconnected' || syncStatus === 'offline' ? 'offline' : syncStatus} />
      <StatusRow label="Auth" value={isAuthenticated ? 'pro' : 'guest'} />
      <StatusRow label="Users" value={String(syncUsers)} />
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 16 }}>
        <span style={{ color: '#8b8f98' }}>Eye Attention</span>
        <button
          onClick={onToggleEyeAttention}
          style={{
            background: eyeState?.enabled ? 'rgba(0, 229, 255, 0.15)' : 'rgba(255, 255, 255, 0.05)',
            border: eyeState?.enabled ? '1px solid rgba(0, 229, 255, 0.4)' : '1px solid rgba(255, 255, 255, 0.1)',
            borderRadius: 4,
            color: eyeState?.enabled ? '#00e5ff' : '#8b8f98',
            fontSize: 11,
            padding: '1px 6px',
            cursor: 'pointer',
          }}
          title="Toggle Eye & Face Attention (Opt-in local research feature)"
        >
          {eyeState?.enabled ? (eyeState.gazeZone ? `on (${eyeState.gazeZone})` : 'on') : 'off'}
        </button>
      </div>
      {/* M15 (D6): the error counter row. Only a NON-ZERO count stands out
          (red); the healthy path renders a dim '0'. The span is keyed for
          the verifier (data-testid="hud-errors"). */}
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 16 }}>
        <span style={{ color: '#8b8f98' }}>Errors</span>
        <span
          data-testid="hud-errors"
          style={{
            color: errorCount === 0 ? '#e8eaed' : '#ff5a5a',
            fontWeight: 500,
            fontVariantNumeric: 'tabular-nums',
          }}
        >
          {errorCount}
        </span>
      </div>
      {/* M12 (D8): remote hands count — the span is written imperatively
          on-change-only; React never re-renders at handSync rate. */}
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 16 }}>
        <span style={{ color: '#8b8f98' }}>Remote</span>
        <span
          ref={remoteIndicatorRef}
          data-testid="remote-hands"
          style={{ color: '#e8eaed', fontWeight: 500, fontVariantNumeric: 'tabular-nums' }}
        >
          0
        </span>
      </div>
    </div>
  );
}

/** Compact per-hand gesture summary for the HUD, e.g. "R:pinch L:open".
 *  M5: bimanual PINCH_ZOOM entries render as `zoom-in`/`zoom-out` tokens
 *  (no hand prefix — it is two hands). */
function summarizeGestures(gestures: Gesture[]): string {
  if (gestures.length === 0) return '—';
  return gestures
    .map((g) =>
      g.type === GestureType.PINCH_ZOOM
        ? `zoom-${g.zoomDirection}`
        : `${g.handedness[0]}:${g.type}`,
    )
    .join(' ');
}

/**
 * React-safe snapshot of a manager window: clones the mutable vectors so
 * React state never aliases the live manager objects.
 */
function snapshotWindow(window: FloatingWindow): FloatingWindow {
  return {
    ...window,
    position: window.position.clone(),
    scale: window.scale.clone(),
    rotation: window.rotation.clone(),
  };
}

/**
 * Milestone 4 wiring (guide steps 4.1/4.2, M4 brief sections 2-7) on top of
 * the Milestone 3 wiring (guide step 3.4). Key constraints:
 *
 * - onSceneReady fires once per scene — under StrictMode the scene effect
 *   double-mounts, so EVERY call creates a FRESH WindowManager +
 *   InteractionEngine + AnimationController + PositionSmoother (held in refs)
 *   plus the two test windows. Managers built for a disposed scene are never
 *   reused; the dead controller's closures die with the old manager and
 *   nothing ticks them (the old Scene3D rAF is cancelled).
 * - Gestures are processed at full inference rate (~30 Hz) through the
 *   engine (grabbing must be responsive); only React state syncs are
 *   throttled (~10 Hz). The DOM windows follow the meshes via the
 *   projection rAF loop instead of React state.
 * - Momentum (D1/D2): on `release` the window glides in the hand's direction
 *   for 0.5 s with an ease-out curve. The ONLY writer is WindowManager
 *   moveWindow (apply callback), so state and mesh stay in lockstep by
 *   construction; a new grab cancels any in-flight animation.
 * - Smooth follow (D1 layer 2): getWindowProjection lerps a per-window
 *   presentation vector toward the live mesh (factor 0.3) — read-side only,
 *   so it can never desync state from mesh.
 * - Metrics (D3/D4/D5): PerformanceLogger aggregates the EXISTING per-second
 *   measurements (Scene3D FPS, HandTracker latency) via logMetric, plus raw
 *   per-frame samples (gesture recognition cost, processGesture loop cost)
 *   via recordSample. A single `[Performance]` console line prints every ~5 s
 *   — gated by the rAF frame callback, no timers anywhere.
 * - The guide's step 3.4 sketch (canvasRef as HandTracker videoElement) is
 *   a known guide bug; the M1 fix stands — the real <video> element from
 *   CameraCapture drives the tracker.
 * - M5 (Phase 2 part 1): GRAB/SWIPE/PINCH_ZOOM flow through to the engine
 *   inertly until M6 — processGesture's default branch returns [] for every
 *   type it does not handle (proven by the 16 engine tests, zero engine
 *   changes); nothing here wires them to interactions yet.
 * - M6 (Phase 2 part 2): interaction wiring. SWIPE and PINCH_ZOOM are
 *   routed to the CameraRig (App-constructed per scene, D1): swipeToPan
 *   then rig.pan — camera pan direction = on-screen content direction =
 *   hand direction on both axes (orbit sign convention, see cameraRig.ts
 *   and the README M6 D7 correction); zoomToStep then rig.zoom. Everything
 *   else — PINCH, GRAB, OPEN, POINT and NOW NONE — reaches the engine:
 *   GRAB grabs/drags through the shared grab path, releases fire on strong
 *   OPEN (release-all) and on NONE/POINT (per-hand, D3), and POINT hovers
 *   emit 'hover' events (~15 Hz) that drive WindowManager highlights.
 *   Highlight priority is App policy (D6): grabbed wins over hover; every
 *   grab/release/hover event recomputes the level, so releasing a
 *   still-hovered window restores 0.5 automatically. NONE frames now run
 *   the engine loop by design (release-on-NONE + hover clearing), which
 *   also keeps interactionLatency honest about the loop's real cost.
 * - M7 (Phase 2 close): the boot scene is the 4-window DEMO_WINDOWS layout
 *   (demoScene.ts — single source of titles/positions). Two-hand twist
 *   rotation flows through the engine ('rotate' events are an explicit
 *   no-op here: rotation state already rode WindowManager.rotateWindow ->
 *   notifyChanged -> the throttled React snapshot; momentum is position-only
 *   by design, and the DOM overlay does not visually rotate — the mesh's
 *   yaw under the unrotated projected rect is the visible cue, accepted
 *   simplification, D9). The "Reset view" button (top center) restores the
 *   camera to the boot pose via CameraRig.reset() — it touches nothing else.
 * - M8 (Phase 3 part 1): window content is now APP content through the
 *   AppRegistry (D1-D5): every window's id encodes its app id
 *   ('<appId>-<n>', D3); the boot scene is Dashboard + Notes (D2, 2
 *   windows); the Dashboard launcher calls openApp (D4); maximize is
 *   restore-if-minimized + bring-to-front (D12); sendMessage rides the
 *   per-scene app bus (D5). The M7 demo windows 1-4 are retired.
 * - M9 (Phase 3 part 2): the LLM Chat app registers through the same
 *   registry ('chat', D13) and joins the boot scene at the
 *   margin-verified center position (D11); its Gemini client, demo-mode
 *   state, and persistence live entirely inside the app + the node-pure
 *   utils/gemini.ts + utils/chat.ts (D2).
 * - M10 (Phase 3 close): the Web Search app registers through the same
 *   registry ('search', Google Custom Search client in the node-pure
 *   utils/search.ts, D2) and joins the boot scene in the
 *   margin-verified bottom-left (D9) — four apps, BOOT_WINDOW_COUNT
 *   derived = 4. Phase 3 is complete.
 * - M11 (Phase 4 part 1): the real-time core. A per-scene SyncManager
 *   (node-pure utils/sync.ts) silently health-probes the backend and only
 *   then opens the ws://…:4001 connection (the failed-handshake native
 *   console error is unsuppressible — the probe gate keeps every
 *   zero-error verifier honest, D4); hands ride the 50 ms quantized
 *   throttle, window mutations ride the onChange bridge diff (D10), the
 *   HUD gains Sync/Users rows (D18), and remote state is stored + logged.
 * - M12 (Phase 4 part 2): multi-user rendering + OWNER-MUTATES. The
 *   holographic restyle (user reference image: deep-navy glow, cyan floor
 *   grid below the window band, wireframe-edge window panes, HoloDecor
 *   rings + connector spokes, frosted DOM chrome) is Part A; Part B wires
 *   the M11 stores to the scene — remote hands render as per-user colored
 *   landmark spheres (RemoteHandsManager), remote windows MATERIALIZED
 *   through remoteApply (reconcile on snapshot, apply on windowSync), the
 *   InteractionEngine rejects grabs on remote-owned windows (isEditable,
 *   brief D2/D3), the bridge never re-upserts remote windows (D6), and the
 *   HUD gains a Remote hands row written imperatively on-change-only (D8).
 *   The server never echoes a client's own mutations, so inbound sync
 *   windows are definitionally remote — no self-identity needed (D1).
 */
export default function App() {
  const [video, setVideo] = useState<HTMLVideoElement | null>(null);
  const [cameraState, setCameraState] = useState<CameraState>('starting');
  const [mediaPipeState, setMediaPipeState] = useState<MediaPipeState>('loading');
  const [handsCount, setHandsCount] = useState(0);
  const [gestures, setGestures] = useState<Gesture[]>([]);
  const [windows, setWindows] = useState<FloatingWindow[]>([]);
  const [workspaceMode, setWorkspaceMode] = useState<'Briefing' | 'Focus' | 'Present'>('Briefing');
  const [fps, setFps] = useState(0);
  const [latencyMs, setLatencyMs] = useState(0);
  // M15 (D6): distinct uncaught errors seen this session — the HUD
  // "Errors" row's source. Subscribes to the window error collector
  // (installed once in main.tsx); unsubscribe rides the effect cleanup.
  const [errorCount, setErrorCount] = useState(() => errorCollector.getCount());
  const [showOnboarding, setShowOnboarding] = useState(() => !localStorage.getItem('jarvis_onboarded'));
  
  const settings = useInputSettings();
  const [token] = useState<string | null>(() => localStorage.getItem('jarvis_token'));

  useEffect(
    () => errorCollector.subscribe(() => {
      setErrorCount(errorCollector.getCount());
      telemetry.track('client_crash', { workspaceId: 'default' });
    }),
    [],
  );

  // Engine/manager instances live in refs, never state and never effect
  // deps: each onSceneReady call replaces them wholesale.
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null);
  const windowManagerRef = useRef<WindowManager | null>(null);
  const interactionEngineRef = useRef<InteractionEngine | null>(null);

  // M6 (D1): the CameraRig is App-constructed from the camera Scene3D
  // already hands us — Scene3D needs zero changes (its render loop draws
  // whatever pose the camera has). Per-scene highlight state (D6):
  // hoveredByHandRef tracks the current hover target per handedness,
  // grabbedIdsRef the grabbed window ids; both reset with the scene.
  const cameraRigRef = useRef<CameraRig | null>(null);
  const hoveredByHandRef = useRef<Map<Handedness, string | null>>(new Map());
  const grabbedIdsRef = useRef<Set<string>>(new Set());
  const isPresentingRef = useRef<boolean>(false);
  const lastPresenterSyncRef = useRef<number>(0);
  const [eyeAttentionState, setEyeAttentionState] = useState<EyeAttentionState | null>(null);
  const eyeAttentionRef = useRef<EyeAttentionState | null>(null);
  eyeAttentionRef.current = eyeAttentionState;

  useEffect(() => {
    const togglePresentMode = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      isPresentingRef.current = detail;
      if (!detail) {
        syncManagerRef.current?.sendPresenterSync(null);
      }
    };
    window.addEventListener('jarvis-present-toggle', togglePresentMode);
    return () => window.removeEventListener('jarvis-present-toggle', togglePresentMode);
  }, []);

  // M8 app-framework state (fresh per scene — StrictMode pattern): the
  // app message bus (D5) and the per-app window instance counters (D3,
  // monotonic; ids are never reused within a scene, even after closes).
  const appBusRef = useRef<AppBus | null>(null);
  const windowCountersRef = useRef<Map<string, number>>(new Map());

  // M11 sync state (D18): DISCRETE transitions only — connect/drop/join/
  // leave; inbound handSync/windowSync NEVER setState (refs + logs).
  const [syncStatus, setSyncStatus] = useState<SyncStatus>('disconnected');
  const [syncUsers, setSyncUsers] = useState(0);
  const syncManagerRef = useRef<SyncManager | null>(null);
  const windowSyncBridgeRef = useRef<WindowSyncBridge | null>(null);
  // Remote state (M11 stored + logged; M12 renders + applies).
  const remoteHandsRef = useRef<Map<string, Hand[]>>(new Map());
  const remoteWindowsRef = useRef<Map<string, WindowState>>(new Map());
  // 1 s-throttle timestamp shared by the inbound [Sync] logs (D6).
  const lastSyncLogRef = useRef(0);
  // M12 (D2): the ownership oracle — ids materialized from remote sync
  // streams. Everything NOT in this set is locally-owned (editable); the
  // server never echoes our own mutations, so membership == remote-owned.
  const remoteOwnedIdsRef = useRef<Set<string>>(new Set());
  // M12 (D7/D8): remote hand rendering + the HUD Remote row's live span.
  const remoteHandsManagerRef = useRef<RemoteHandsManager | null>(null);
  const remoteHandsIndicatorRef = useRef<HTMLSpanElement | null>(null);
  const lastRemoteHandsCountRef = useRef(0);
  // M12 Part A (A4): scene dressing + its WindowManager-version gate.
  const holoDecorRef = useRef<HoloDecor | null>(null);
  const decorVersionRef = useRef(0);

  // Pearl Orb mesh ref
  const pearlOrbRef = useRef<THREE.Mesh | null>(null);

  // Hand-controlled screen cursor state and smoothed position ref
  const [cursorData, setCursorData] = useState<HandCursorData | null>(null);
  const smoothedCursorPosRef = useRef<CursorPosition | null>(null);

  // Single-hand pinch-spread dynamic zoom and hover dwell-to-grab trackers
  const pinchZoomTrackerRef = useRef(new PinchSpreadZoomTracker());
  const dwellGrabTrackerRef = useRef(new DwellGrabTracker());
  // Quick-pinch click tracker + two-finger scroll cursor memory
  const pinchClickTrackerRef = useRef(new PinchClickTracker());
  const lastScrollYRef = useRef<number | null>(null);
  const lastHandPosRef = useRef<{ x: number; y: number } | null>(null);
  const lastFrameTimeRef = useRef(performance.now());

  // M4 scene-scoped animation/smoothing state (replaced per scene, see
  // component docblock). The logger is pure data — lazy-initialized once per
  // component instance, StrictMode-safe.
  const loggerRef = useRef<PerformanceLogger | null>(null);
  if (!loggerRef.current) loggerRef.current = new PerformanceLogger();
  const animationControllerRef = useRef<AnimationController | null>(null);
  const smootherRef = useRef<PositionSmoother | null>(null);
  const velocityTrackersRef = useRef<Map<string, VelocityTracker>>(new Map());
  // Last [Performance] summary time; the ~5 s cadence rides the render frame
  // gate (D4) so no setInterval can outlive the rAF loop.
  const lastPerfSummaryRef = useRef(0);

  // Throttle console/HUD hand updates so 30 Hz inference does not re-render
  // the whole tree (or spam the console) at inference rate.
  const lastHandsLogRef = useRef(0);
  const lastHandsHudRef = useRef(0);
  // GestureDebug/HUD gesture updates at ~10 Hz (same throttling pattern).
  const lastGesturesHudRef = useRef(0);
  // Window list/flags sync at ~10 Hz; live position comes from the rAF loop.
  const lastWindowsSyncRef = useRef(0);

  const syncWindows = useCallback(() => {
    const wm = windowManagerRef.current;
    if (!wm) return;
    setWindows(wm.getAllWindows().map(snapshotWindow));
  }, []);

  // Stable identity for the spatial window list passed to EyeAttentionTracker:
  // windows.map() in JSX created a fresh array every render, which re-triggered
  // the tracker's effect each frame (setState inside it → infinite update loop).
  const spatialWindows = useMemo(
    () =>
      windows.map((w) => ({
        id: w.id,
        positionX: w.position.x,
        positionY: w.position.y,
      })),
    [windows],
  );

  const syncWindowsThrottled = useCallback(() => {
    const now = performance.now();
    if (now - lastWindowsSyncRef.current < 100) return;
    lastWindowsSyncRef.current = now;
    syncWindows();
  }, [syncWindows]);

  /** Allocates the next 1-based instance number for an app (D3). */
  const nextInstance = useCallback((appId: string): number => {
    const next = (windowCountersRef.current.get(appId) ?? 0) + 1;
    windowCountersRef.current.set(appId, next);
    return next;
  }, []);

  /**
   * M8: opens a new app window (any app can call this via AppProps —
   * the Dashboard launcher is the first consumer). Window id is
   * '<appId>-<n>' (D3); the title comes from the registry; the position
   * from the margin-verified spawn table with the per-instance cascade
   * (D2). Unknown app ids resolve to the safe fallback definition —
   * unreachable from the launcher (it lists registered apps only).
   */
  const openApp = useCallback(
    (appId: string) => {
      const wm = windowManagerRef.current;
      if (!wm) return;
      const instance = nextInstance(appId);
      wm.createWindow(
        `${appId}-${instance}`,
        getTitle(appId),
        getSpawnPosition(appId, instance),
        appId === 'news' ? 3.4 : WINDOW_BASE_WIDTH,
      );
      syncWindows();
    },
    [nextInstance, syncWindows],
  );

  /**
   * M8 (D12): AppContext.maximize — interim semantics: restore the window
   * if minimized, then bring it to front. True maximize (fullscreen
   * sizing) is future work; the M3 chrome buttons are unchanged.
   */
  const handleMaximizeWindow = useCallback(
    (id: string) => {
      const wm = windowManagerRef.current;
      if (!wm) return;
      if (wm.getWindow(id)?.isMinimized) wm.restoreWindow(id);
      wm.bringToFront(id);
      syncWindows();
    },
    [syncWindows],
  );

  /**
   * M6 (D6): recompute one window's highlight level from App-owned state —
   * grabbed wins over hover (resolveHighlightLevel), none -> resting. The
   * manager's setWindowHighlight is idempotent (no notify on the same
   * level), so the ~15 Hz hover stream and the release-recompute cannot
   * churn the throttled React snapshot.
   */
  const applyHighlight = useCallback((id: string) => {
    const wm = windowManagerRef.current;
    if (!wm) return;
    const grabbed = grabbedIdsRef.current.has(id);
    const hovered = [...hoveredByHandRef.current.values()].includes(id);
    wm.setWindowHighlight(id, resolveHighlightLevel(grabbed, hovered));
  }, []);

  /** M11 (D18): status transitions are rare; 'connected' also flushes the
   *  local window set so late joiners see it (D10). */
  const handleSyncStatus = useCallback((status: SyncStatus) => {
    setSyncStatus(status);
    if (status === 'connected') windowSyncBridgeRef.current?.flushAll();
  }, []);

  /** M11 inbound messages → M12: store + LOG + APPLY. windowSync/snapshot
   *  windows are by definition OTHER users' (the server never echoes the
   *  sender's own mutations, brief D1) — they materialize as read-only
   *  remote windows through remoteApply. */
  const handleServerMessage = useCallback((message: ServerMessage) => {
    const now = performance.now();
    const logThrottled = (line: string): void => {
      if (now - lastSyncLogRef.current < 1000) return;
      lastSyncLogRef.current = now;
      console.log(line);
    };
    // HUD Remote row: write the DOM directly, ONLY on count change (D8) —
    // no setState at sync rate. Called after EVERY remote-hands mutation
    // (handSync, userLeft, snapshot clear).
    const syncRemoteIndicator = (): void => {
      const manager = remoteHandsManagerRef.current;
      if (!manager) return;
      const count = manager.handsCount;
      if (count !== lastRemoteHandsCountRef.current) {
        lastRemoteHandsCountRef.current = count;
        const el = remoteHandsIndicatorRef.current;
        if (el) el.textContent = String(count);
      }
    };
    switch (message.type) {
      case 'stateSnapshot': {
        // Full reconcile (M12 D4): apply every wire window, close remote
        // windows the owner removed (closes propagate as snapshots, D8-M11).
        const wm = windowManagerRef.current;
        if (wm) {
          reconcileSnapshot(message.data.windows, wm, remoteOwnedIdsRef.current);
        }
        remoteWindowsRef.current = new Map(
          message.data.windows.map((w) => [w.id, w]),
        );
        // Snapshot users are presence-only (no hands) — reset the remote
        // hand layer; live handSync refreshes it within ~50 ms.
        remoteHandsRef.current = new Map();
        remoteHandsManagerRef.current?.clear();
        syncRemoteIndicator();
        setSyncUsers(message.data.users.length);
        return;
      }
      case 'userJoined':
        setSyncUsers((count) => count + 1);
        logThrottled(`[Sync] userJoined userId=${message.data.userId}`);
        return;
      case 'userLeft':
        setSyncUsers((count) => Math.max(0, count - 1));
        remoteHandsRef.current.delete(message.data.userId);
        remoteHandsManagerRef.current?.removeUser(message.data.userId);
        syncRemoteIndicator();
        logThrottled(`[Sync] userLeft userId=${message.data.userId}`);
        return;
      case 'handSync': {
        remoteHandsRef.current.set(message.data.userId, message.data.hands);
        remoteHandsManagerRef.current?.update(
          message.data.userId,
          message.data.hands,
        );
        syncRemoteIndicator();
        logThrottled(
          `[Sync] handSync userId=${message.data.userId} hands=${message.data.hands.length}`,
        );
        return;
      }
      case 'windowSync': {
        const wm = windowManagerRef.current;
        if (wm) applyRemoteWindow(message.data, wm, remoteOwnedIdsRef.current);
        remoteWindowsRef.current.set(message.data.id, message.data);
        logThrottled(`[Sync] windowSync id=${message.data.id}`);
        return;
      }
      case 'presenterSync': {
        const isViewer = !token;
        if (message.data && isViewer) {
          cameraRigRef.current?.setPose(
            new THREE.Vector3(...message.data.position),
            new THREE.Euler(...message.data.rotation),
            message.data.fov
          );
        }
        return;
      }
      case 'error':
        logThrottled(`[Sync] server error: ${message.data.message}`);
        return;
    }
  }, []);

  const handleSceneReady = useCallback(
    (scene: THREE.Scene, camera: THREE.PerspectiveCamera) => {
      // M11 (D12): replace the previous scene's SyncManager explicitly —
      // its probe/timer loops never tick again. No unmount effect needed
      // (the wm/engine/rig pattern: refs replaced wholesale per scene).
      syncManagerRef.current?.close();
      syncManagerRef.current = null;
      windowSyncBridgeRef.current = null;
      // M12: replace the previous scene's remote layer + dressing the same
      // way (dispose frees GPU resources; fresh instances below).
      remoteHandsManagerRef.current?.dispose();
      remoteHandsManagerRef.current = null;
      holoDecorRef.current?.dispose();
      holoDecorRef.current = null;
      lastRemoteHandsCountRef.current = 0;

      cameraRef.current = camera;

      // Fresh manager + engine per scene (see component docblock).
      const wm = new WindowManager(scene);
      // M12 (D2): fresh ownership registry + remote stores per scene.
      remoteOwnedIdsRef.current = new Set();
      remoteWindowsRef.current = new Map();
      remoteHandsRef.current = new Map();
      // M12 Part A (A4): floor rings + window connector spokes.
      holoDecorRef.current = new HoloDecor(scene);
      decorVersionRef.current = wm.version;
      // M12 (D7): remote hand landmark spheres.
      remoteHandsManagerRef.current = new RemoteHandsManager(scene);
      // M11: per-scene SyncManager (fresh, D12) + the window-sync bridge
      // (D10) riding the SAME onChange notification as the React snapshot.
      // M12 (D6): the bridge's window source FILTERS OUT remote-owned ids —
      // materialized remote windows are never re-upserted by this client.
      const sync = new SyncManager({
        socketUrl: SYNC_URL,
        healthUrl: SYNC_HEALTH_URL,
        token: token || undefined,
        onStatus: handleSyncStatus,
      });
      syncManagerRef.current = sync;
      windowSyncBridgeRef.current = createWindowSyncBridge(
        () =>
          wm
            .getAllWindows()
            .filter((w) => !remoteOwnedIdsRef.current.has(w.id)),
        sync,
      );
      wm.setOnChange(() => {
        syncWindowsThrottled();
        windowSyncBridgeRef.current?.sync();
        // Widget layout persistence — save only widget windows, throttled via rAF already
        try {
          const layout = buildLayoutFromWindows(wm.getAllWindows());
          if (Object.keys(layout).length > 0) saveWidgetLayout(layout);
        } catch {
          // never breaks workspace on storage failure
        }
      });
      sync.subscribe(handleServerMessage);
      windowManagerRef.current = wm;
      // M12 (D3): OWNER-MUTATES — the engine rejects grabs on remote-owned
      // windows (default () => true keeps the pre-M12 contract everywhere
      // else, e.g. every existing engine unit test).
      // Phase 6: Viewers (guests without tokens) cannot edit any layout.
      const isViewer = !token;
      interactionEngineRef.current = new InteractionEngine(camera, wm, {
        isEditable: (id) => !isViewer && !remoteOwnedIdsRef.current.has(id),
        gazeTargetId: () =>
          settings.eyeAttentionEnabled && settings.eyeAssistedTargeting
            ? eyeAttentionRef.current?.targetWindowId ?? null
            : null,
      });
      // M6 (D1): fresh rig + highlight state per scene (StrictMode pattern).
      cameraRigRef.current = new CameraRig(camera);
      hoveredByHandRef.current = new Map();
      grabbedIdsRef.current = new Set();
      // M8: fresh app bus + per-app window instance counters per scene.
      appBusRef.current = createAppBus();
      windowCountersRef.current = new Map();

      // Fresh animation/smoothing state per scene: the dead controller's
      // closures die with the old manager and nothing ticks them.
      animationControllerRef.current = new AnimationController();
      smootherRef.current = new PositionSmoother();
      velocityTrackersRef.current = new Map();

      // Obsidian core landmark (replacing the bright pearl orb): a dark
      // glass sphere with a faint teal inner glow — the void's anchor point
      // the HoloDecor spokes converge on. Reads as presence, not object.
      const pearlOrbGeometry = new THREE.SphereGeometry(0.75, 64, 64);
      const pearlOrbMaterial = new THREE.MeshPhysicalMaterial({
        color: 0x0a0c10,
        roughness: 0.28,
        metalness: 0.4,
        clearcoat: 0.6,
        clearcoatRoughness: 0.25,
        iridescence: 0.9,
        iridescenceIOR: 1.33,
        iridescenceThicknessRange: [100, 400],
        emissive: 0x062a33,
        emissiveIntensity: 0.5,
      });
      const pearlOrb = new THREE.Mesh(pearlOrbGeometry, pearlOrbMaterial);
      pearlOrb.position.set(0, 0, 0);
      scene.add(pearlOrb);
      pearlOrbRef.current = pearlOrb;
      console.log('[App] obsidian core added to scene');

      // Boot scene — single news card connected to the pearl orb.
      for (const appId of BOOT_APP_IDS) {
        const instance = nextInstance(appId);
        wm.createWindow(
          `${appId}-${instance}`,
          getTitle(appId),
          getSpawnPosition(appId, instance),
          appId === 'news' ? 3.4 : WINDOW_BASE_WIDTH,
        );
      }
      // Widget dashboard — tidy grid alongside briefing, with persisted layout restore
      const persisted = loadWidgetLayout();
      for (const widgetId of WIDGET_IDS) {
        const width = WIDGET_DEFAULT_WIDTHS[widgetId] ?? WINDOW_BASE_WIDTH;
        const windowId = `${widgetId}-1`;
        const entry = persisted?.[windowId];
        const spawnPos = entry
          ? new THREE.Vector3(entry.position.x, entry.position.y, entry.position.z)
          : getSpawnPosition(widgetId, 1);
        wm.createWindow(windowId, getTitle(widgetId), spawnPos, width);
        // Restore persisted scale / zIndex if present
        if (entry?.scale) {
          const win = wm.getWindow(windowId);
          const mesh = wm.getWindowMesh(windowId);
          if (win && mesh) {
            win.scale.set(entry.scale.x, entry.scale.y, entry.scale.z);
            mesh.scale.copy(win.scale);
          }
        }
        if (typeof entry?.zIndex === 'number') {
          wm.setZIndex(windowId, entry.zIndex);
        }
      }
      const totalWindows = BOOT_WINDOW_COUNT + WIDGET_IDS.length;
      console.log(`[App] app scene ready: ${totalWindows} windows created (${BOOT_WINDOW_COUNT} boot + ${WIDGET_IDS.length} widgets)`);
      syncWindows();
      telemetry.track('workspace_opened', { windowCount: totalWindows });
      // M11: connect AFTER the boot windows exist so the bridge's onChange
      // diffs have already recorded them (sends no-op until connected).
      sync.connect();
    },
    [syncWindows, syncWindowsThrottled, nextInstance, handleSyncStatus, handleServerMessage, token],
  );

  const handleHandsDetected = useCallback(
    (hands: Hand[]) => {
      // M11: outbound hand sync rides the manager's internal 50 ms throttle
      syncManagerRef.current?.sendHands(hands);
      const now = performance.now();

      if (!settings.gesturesEnabled) {
        setCursorData(null);
        return;
      }

      // Hand Cursor tracking + Dwell-to-Grab + Single-Hand Pinch Zoom
      if (hands.length > 0) {
        const primaryHand =
          (settings.dominantHand !== 'auto'
            ? hands.find((h) => h.handedness === settings.dominantHand)
            : null) ?? hands[0];
        const pointer = getPointerLandmark(primaryHand);
        if (pointer) {
          const rawScreen = landmarkToScreen(pointer, window.innerWidth, window.innerHeight);
          const smoothed = smoothCursor(smoothedCursorPosRef.current, rawScreen, 0.35);
          smoothedCursorPosRef.current = smoothed;

          // STRICT targeting: gestures act only on a card the pointer is
          // actually hovering (engine POINT raycasts). The old fallback to
          // windows[0] made dwell/swipe/zoom hit the news card even while
          // pointing at empty space — removed.
          const hoveredId = hoveredByHandRef.current.get(primaryHand.handedness) ?? null;
          const isPinching = gestures.some(
            (g) =>
              g.handedness === primaryHand.handedness &&
              (g.type === GestureType.PINCH || g.type === GestureType.GRAB),
          );
          const isPointing = gestures.some(
            (g) => g.handedness === primaryHand.handedness && g.type === GestureType.POINT,
          );
          const isOpen = gestures.some(
            (g) => g.handedness === primaryHand.handedness && g.type === GestureType.OPEN,
          );
          const isTwoFinger = gestures.some(
            (g) => g.handedness === primaryHand.handedness && g.type === GestureType.TWO_FINGER,
          );

          setCursorData({
            x: smoothed.x,
            y: smoothed.y,
            visible: true,
            handedness: primaryHand.handedness,
            isPointing,
            isPinching,
            isHovering: !!hoveredId,
            targetId: hoveredId,
          });

          // Dwell-to-Grab Tracking
          const dwell = dwellGrabTrackerRef.current;
          dwell.setTargetMs(settings.dwellDurationMs || 700);
          const dt = Math.min(100, Math.max(16, now - (lastFrameTimeRef.current || now)));

          if (isOpen) {
            // Open palm releases the dwell lock
            dwell.unlock();
            if (hoveredId) {
              window.dispatchEvent(
                new CustomEvent('jarvis-dwell-update', {
                  detail: { windowId: hoveredId, progress: 0, isLocked: false },
                }),
              );
            }
          } else if (hoveredId && !isTwoFinger) {
            // Charge dwell — EXCEPT while two-finger scrolling (the pose
            // suppresses locking so a scroll can't accidentally attach the
            // card to the hand).
            const dwellState = dwell.update(true, dt);
            window.dispatchEvent(
              new CustomEvent('jarvis-dwell-update', {
                detail: {
                  windowId: hoveredId,
                  progress: dwellState.progress,
                  isLocked: dwellState.isLocked,
                },
              }),
            );

            // If locked, translate window in 3D world space following hand movement
            if (dwellState.isLocked && lastHandPosRef.current) {
              const wm = windowManagerRef.current;
              const win = wm?.getWindow(hoveredId);
              if (win) {
                const dx = (pointer.x - lastHandPosRef.current.x) * 4.2;
                const dy = -(pointer.y - lastHandPosRef.current.y) * 4.2;
                if (Math.abs(dx) > 0.0005 || Math.abs(dy) > 0.0005) {
                  wm?.moveWindow(
                    hoveredId,
                    new THREE.Vector3(win.position.x - dx, win.position.y + dy, win.position.z),
                  );
                }
              }
            }
          } else {
            // Hover lost: decay dwell progress
            const dwellState = dwell.update(false, dt);
            windows.forEach((w) => {
              window.dispatchEvent(
                new CustomEvent('jarvis-dwell-update', {
                  detail: {
                    windowId: w.id,
                    progress: dwellState.progress,
                    isLocked: dwellState.isLocked,
                  },
                }),
              );
            });
          }

          lastHandPosRef.current = { x: pointer.x, y: pointer.y };

          // Two-finger spatial scroll: vertical cursor movement scrolls the
          // content under the cursor, content-follows-hand (touch metaphor).
          if (isTwoFinger && hoveredId) {
            if (lastScrollYRef.current !== null) {
              scrollAtPoint(
                smoothed.x,
                smoothed.y,
                lastScrollYRef.current - smoothed.y,
              );
            }
            lastScrollYRef.current = smoothed.y;
          } else {
            lastScrollYRef.current = null;
          }

          // Single-Hand 2-Finger Pinch-and-Spread Dynamic Zoom
          const thumb = primaryHand.landmarks[4];
          const index = primaryHand.landmarks[8];
          if (thumb && index && hoveredId) {
            const pinchRes = pinchZoomTrackerRef.current.update(thumb, index);
            if (pinchRes.isPinching && pinchRes.isSpreading && pinchRes.scaleFactor !== 1.0) {
              windowManagerRef.current?.resizeWindow(hoveredId, pinchRes.scaleFactor);
            }
          }
        }
      } else {
        smoothedCursorPosRef.current = null;
        lastHandPosRef.current = null;
        lastScrollYRef.current = null;
        pinchZoomTrackerRef.current.reset();
        dwellGrabTrackerRef.current.reset();
        pinchClickTrackerRef.current.reset();
        setCursorData(null);
      }
      lastFrameTimeRef.current = now;

      if (now - lastHandsLogRef.current >= 1000) {
        lastHandsLogRef.current = now;
        console.log(
          `[App] Hands detected: ${hands.length} (${hands.map((h) => h.handedness).join(', ') || 'none'})`,
        );
      }
      if (now - lastHandsHudRef.current >= 250) {
        lastHandsHudRef.current = now;
        setHandsCount(hands.length);
      }
    },
    [gestures, windows],
  );

  /** M4: advances momentum animations and gates the ~5 s [Performance] summary
   *  on the render frame (D4) — no timers; rAF is cancelled on unmount.
   *  M12 Part A: also ticks the holo dressing — rings rotate every frame
   *  (deterministic from the timestamp); connector spokes re-sync ONLY when
   *  the WindowManager version changed (cost guard, brief A4/D11). */
  const handleFrame = useCallback((now: number) => {
    animationControllerRef.current?.update(now);

    // Gently rotate the Pearl Orb
    if (pearlOrbRef.current) {
      pearlOrbRef.current.rotation.y = now * 0.0003;
      pearlOrbRef.current.rotation.x = Math.sin(now * 0.0002) * 0.08;
    }

    const decor = holoDecorRef.current;
    const wm = windowManagerRef.current;
    if (decor) {
      decor.update(now);
      if (wm && wm.version !== decorVersionRef.current) {
        decorVersionRef.current = wm.version;
        decor.sync(
          wm.getAllWindows().map((w) => ({ id: w.id, position: w.position })),
        );
      }
    }

    // Phase 6: Broadcast Presenter pose
    if (isPresentingRef.current && cameraRef.current) {
      if (now - lastPresenterSyncRef.current > 100) { // Throttle to 10fps
        lastPresenterSyncRef.current = now;
        syncManagerRef.current?.sendPresenterSync({
          position: cameraRef.current.position.toArray(),
          rotation: cameraRef.current.rotation.toArray() as [number, number, number],
          fov: cameraRef.current.fov
        });
      }
    }
    const logger = loggerRef.current;
    if (
      logger &&
      now - lastPerfSummaryRef.current >= SUMMARY_INTERVAL_MS &&
      logger.hasData()
    ) {
      lastPerfSummaryRef.current = now;
      logger.logToConsole();
    }
  }, []);

  /**
   * M4 event wiring (D1/D2/D6): grab cancels in-flight momentum and resets
   * the velocity tracker; move feeds the tracker; release starts the
   * momentum animation THROUGH WindowManager.moveWindow (lockstep by
   * construction, clamped end, min-speed gate); resize does nothing (scale
   * is not animated).
   * M6 (D6): grab/release also update grabbedIdsRef and recompute the
   * highlight; hover updates the per-hand hover slot and applies the
   * priority on the hand's previous and new targets.
   */
  const handleInteractionEvent = useCallback(
    (event: InteractionEvent) => {
      const controller = animationControllerRef.current;
      const wm = windowManagerRef.current;
      if (!controller || !wm) return;

      if (event.type === 'grab') {
        // A new grab kills any in-flight momentum animation.
        controller.cancelAnimation(event.targetId);
        velocityTrackersRef.current.set(event.targetId, new VelocityTracker());
        grabbedIdsRef.current.add(event.targetId);
        applyHighlight(event.targetId);
        return;
      }
      if (event.type === 'move') {
        let tracker = velocityTrackersRef.current.get(event.targetId);
        if (!tracker) {
          tracker = new VelocityTracker();
          velocityTrackersRef.current.set(event.targetId, tracker);
        }
        tracker.push(event.newPosition!, event.gesture.timestamp);
        return;
      }
      if (event.type === 'release') {
        // The grab is gone: recompute the highlight — a window that is
        // still hovered lands back on the hover level (the honest fix for
        // "the engine never re-emits the same target").
        grabbedIdsRef.current.delete(event.targetId);
        applyHighlight(event.targetId);
        const tracker = velocityTrackersRef.current.get(event.targetId);
        velocityTrackersRef.current.delete(event.targetId);
        const win = wm.getWindow(event.targetId);
        if (!win) return;
        const velocity = tracker?.getVelocity() ?? new THREE.Vector3();
        const spec = buildMomentumSpec(win.position, velocity);
        if (!spec) return; // still release: below the min speed, no drift
        controller.addAnimation(event.targetId, {
          from: win.position,
          to: spec.to,
          duration: spec.duration,
          // Closure captures the CURRENT scene's manager: momentum writes go
          // through moveWindow so state and mesh stay in lockstep.
          apply: (p) => wm.moveWindow(event.targetId, p),
        });
      }
      if (event.type === 'hover') {
        // Keyed on handedness ONLY (eviction events reuse the hand's stored
        // POINT gesture — the engine contract: read nothing else from
        // hover-event gestures).
        const hand = event.gesture.handedness;
        const previous = hoveredByHandRef.current.get(hand) ?? null;
        hoveredByHandRef.current.set(hand, event.targetId);
        if (previous !== event.targetId) {
          if (previous) applyHighlight(previous);
          if (event.targetId) applyHighlight(event.targetId);
        }
        return;
      }
      if (event.type === 'rotate') {
        // M7 (D9): rotation state already rode WindowManager.rotateWindow ->
        // notifyChanged -> the throttled React snapshot. Momentum is
        // position-only by design; the DOM overlay does not visually rotate
        // (accepted simplification — the mesh's yaw is the visible cue).
        return;
      }
      if (event.type === 'resize' && typeof event.scaleChange === 'number') {
        wm.resizeWindow(event.targetId, event.scaleChange);
        return;
      }
    },
    [applyHighlight],
  );

  const handleGesturesDetected = useCallback(
    (detected: Gesture[]) => {
      if (!settings.gesturesEnabled) {
        setGestures([]);
        return;
      }
      // Full-rate interaction: the engine mutates meshes at inference rate;
      // only React state syncs are throttled below.
      const engine = interactionEngineRef.current;
      const wm = windowManagerRef.current;
      let processedAny = false;
      const t0 = performance.now();
      for (const gesture of detected) {
        // Pinch-click: a quick pinch (<= 400ms) on the card hovered at
        // pinch START selects it — bring-to-front + activation event. A
        // longer pinch stays a drag (engine grab path, untouched below).
        const clicked = pinchClickTrackerRef.current.update(
          gesture.handedness,
          gesture.type === GestureType.PINCH,
          hoveredByHandRef.current.get(gesture.handedness) ?? null,
          gesture.timestamp,
        );
        if (clicked && wm) {
          wm.bringToFront(clicked);
          window.dispatchEvent(
            new CustomEvent('jarvis-spatial-activate', { detail: { windowId: clicked } }),
          );
        }
        if (gesture.type === GestureType.SWIPE) {
          // Card-targeted swipe (strict: only when a card is genuinely
          // hovered — no fallback target). Dispatches the spatial swipe
          // event consumed by carousels (News) and city cycling (Weather).
          const dir = gesture.swipeDirection;
          const hoveredId = hoveredByHandRef.current.get(gesture.handedness) ?? null;
          if (dir && (dir === 'left' || dir === 'right') && hoveredId) {
            window.dispatchEvent(
              new CustomEvent('jarvis-spatial-swipe', {
                detail: { windowId: hoveredId, direction: dir },
              }),
            );
          }
          processedAny = true;
        } else if (gesture.type === GestureType.PINCH_ZOOM) {
          // Two-finger / bimanual zoom: resizes the hovered window panel
          // in 3D space (strict — never a fallback target).
          const dir = gesture.zoomDirection;
          const targetId = hoveredByHandRef.current.get(gesture.handedness) ?? null;
          if (dir && targetId && wm) {
            const zoomDelta =
              dir === 'out'
                ? 1.02 + (gesture.intensity ?? 0.5) * 0.03
                : 0.98 - (gesture.intensity ?? 0.5) * 0.03;
            wm.resizeWindow(targetId, zoomDelta);
          }
          processedAny = true;
        } else if (gesture.type === GestureType.TWO_FINGER) {
          // Two-finger scroll: the pose reaches App only — never the
          // engine. The scrolling itself runs in handleHandsDetected at
          // cursor rate (smoothed pointer deltas drive the content).
          processedAny = true;
        } else {
          // PINCH/GRAB/OPEN/POINT/NONE all reach the engine. NONE is
          // REQUIRED for release-on-NONE (D3) and hover clearing (D5).
          processedAny = true;
          if (engine) {
            for (const event of engine.processGesture(gesture)) {
              handleInteractionEvent(event);
            }
          }
        }
      }
      // interactionLatency = wall-clock cost of the per-frame interaction
      // loop (D5). M6 (D9): EVERY routed gesture counts — NONE frames run
      // the engine loop by design (release + hover-clear semantics) and
      // SWIPE/PINCH_ZOOM route through the rig, so sampling them keeps the
      // metric honest about the loop's real cost.
      if (processedAny) {
        const loopCost = performance.now() - t0;
        loggerRef.current?.recordSample('interactionLatency', loopCost);
        recordPerf('interaction', loopCost); // M14 (D5)
      }

      const now = performance.now();
      if (now - lastGesturesHudRef.current >= 100) {
        lastGesturesHudRef.current = now;
        setGestures(detected);
      }
      syncWindowsThrottled();
    },
    [handleInteractionEvent, syncWindowsThrottled],
  );

  // Window controls. Buttons are low-frequency events, so they sync React
  // state immediately (no throttle lag on close/minimize/bring-to-front);
  // the manager's onChange -> throttled sync covers everything else.
  // M4: closing/minimizing also cancels animations and drops smoother/tracker
  // state so no zombie momentum keeps writing a gone/hidden window.
  const handleCloseWindow = useCallback(
    (id: string) => {
      animationControllerRef.current?.cancelAnimation(id);
      smootherRef.current?.forget(id);
      velocityTrackersRef.current.delete(id);
      // M6 (D6) hygiene: a closed window can no longer be grabbed or
      // hovered — drop it from both highlight structures.
      grabbedIdsRef.current.delete(id);
      hoveredByHandRef.current.forEach((target, hand) => {
        if (target === id) hoveredByHandRef.current.delete(hand);
      });
      windowManagerRef.current?.closeWindow(id);
      syncWindows();
    },
    [syncWindows],
  );
  const handleMinimizeWindow = useCallback(
    (id: string) => {
      animationControllerRef.current?.cancelAnimation(id);
      velocityTrackersRef.current.delete(id);
      windowManagerRef.current?.minimizeWindow(id);
      syncWindows();
    },
    [syncWindows],
  );
  const handleBringToFront = useCallback(
    (id: string) => {
      windowManagerRef.current?.bringToFront(id);
      syncWindows();
    },
    [syncWindows],
  );

  /**
   * M13 (D13): Save = PUT the live WindowManager set (remote-owned windows
   * serialize with owner ''; the saved snapshot becomes the CURRENT user's
   * on load — documented). Failures return inline (never console.error).
   */
  const handleSaveWorkspace = useCallback(async (): Promise<WorkspaceResult> => {
    const wm = windowManagerRef.current;
    if (!wm) return { ok: false, error: 'scene not ready' };
    const windows = wm.getAllWindows().map((w) => toWindowState(w, Date.now()));
    try {
      const count = await saveWorkspaceToServer(WORKSPACE_API_BASE, windows);
      console.log(`[Workspace] saved ${count} windows`);
      return { ok: true, count };
    } catch (error) {
      // M15 (D8): centralized typed-error text (never String(error)).
      return { ok: false, error: friendlyErrorText(error) };
    }
  }, []);

  /**
   * M13 (D13): Load = GET the persisted workspace, REPLACE every local
   * window (full M12 hygiene per window: animation, smoother, tracker,
   * grab/hover slots; the remote registry resets), then recreate the
   * saved windows as LOCALLY-OWNED (applyWindowStateFields — no registry
   * semantics). Mid-grab safety: the engine's closed-window hygiene
   * drops any grab whose window was removed (pinned by an M13 test).
   */
  const handleLoadWorkspace = useCallback(async (): Promise<WorkspaceResult> => {
    const wm = windowManagerRef.current;
    if (!wm) return { ok: false, error: 'scene not ready' };
    let saved: WindowState[];
    try {
      saved = await loadWorkspaceFromServer(WORKSPACE_API_BASE);
    } catch (error) {
      return { ok: false, error: friendlyErrorText(error) };
    }
    for (const win of wm.getAllWindows()) {
      animationControllerRef.current?.cancelAnimation(win.id);
      smootherRef.current?.forget(win.id);
      velocityTrackersRef.current.delete(win.id);
      grabbedIdsRef.current.delete(win.id);
      hoveredByHandRef.current.forEach((target, hand) => {
        if (target === win.id) hoveredByHandRef.current.delete(hand);
      });
      wm.closeWindow(win.id);
    }
    remoteOwnedIdsRef.current = new Set();
    for (const state of saved) applyWindowStateFields(wm, state);
    console.log(`[Workspace] loaded ${saved.length} windows`);
    syncWindows();
    windowSyncBridgeRef.current?.flushAll();
    return { ok: true, count: saved.length };
  }, [syncWindows]);

  // Keyboard shortcuts for Modes and Save/Reset layout
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Don't trigger if user is typing in an input
      if (document.activeElement?.tagName === 'INPUT' || document.activeElement?.tagName === 'TEXTAREA') return;

      if (e.shiftKey) {
        if (e.key === 'B' || e.key === 'b') {
          setWorkspaceMode('Briefing');
        } else if (e.key === 'F' || e.key === 'f') {
          setWorkspaceMode('Focus');
        } else if (e.key === 'P' || e.key === 'p') {
          setWorkspaceMode('Present');
        } else if (e.key === 'S' || e.key === 's') {
          void handleSaveWorkspace();
        } else if (e.key === 'R' || e.key === 'r') {
          cameraRigRef.current?.reset();
        }
      } else if (e.key === ' ' || e.key === 'Enter') {
        // Phase 7: Gaze + keyboard confirmation focuses target window
        const targetId = eyeAttentionRef.current?.targetWindowId;
        if (targetId && settings.eyeAttentionEnabled) {
          handleBringToFront(targetId);
        }
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handleBringToFront, handleSaveWorkspace, settings.eyeAttentionEnabled]);

  /**
   * M8: renders a window's app content through the AppRegistry. The
   * window id encodes the app id ('<appId>-<n>', D3); unknown apps
   * resolve to the safe fallback. AppContext (spec §2.3 five fields)
   * plus openApp are EXPLICIT props (D4); sendMessage rides the
   * per-scene app bus (D5). Called per window during render — app
   * state lives inside each Component, so re-renders are safe.
   */
  const renderAppContent = (windowId: string): ReactNode => {
    const AppComponent = getApp(appIdFromWindowId(windowId)).Component;
    return (
      <AppComponent
        windowId={windowId}
        sendMessage={(type, payload) =>
          appBusRef.current?.emit({ from: windowId, type, payload })
        }
        maximize={() => handleMaximizeWindow(windowId)}
        minimize={() => handleMinimizeWindow(windowId)}
        close={() => handleCloseWindow(windowId)}
        openApp={openApp}
        saveWorkspace={handleSaveWorkspace}
        loadWorkspace={handleLoadWorkspace}
      />
    );
  };

  // Live mesh -> screen projection for the DOM windows. Reads the manager's
  // meshes every rAF tick (React state is throttled and would lag the hand).
  // M4 layer 2 (D1): the presentation vector lerps toward the live mesh
  // position each tick (factor 0.3, see PositionSmoother) — read-side only,
  // so it denoises landmark jitter without ever writing to the manager.
  const getWindowProjection = useCallback((windowId: string): WindowProjection | null => {
    const wm = windowManagerRef.current;
    const camera = cameraRef.current;
    if (!wm || !camera) return null;
    const win = wm.getWindow(windowId);
    const mesh = wm.getWindowMesh(windowId);
    if (!win || !mesh) {
      // Window closed entirely: drop its smoother state (state hygiene).
      smootherRef.current?.forget(windowId);
      return null;
    }
    if (!mesh.visible) return null;

    const presented = smootherRef.current?.sample(windowId, mesh.position) ?? mesh.position;

    const depth = camera.position.distanceTo(presented);
    if (depth < 0.1) return null;

    const ndc = presented.clone().project(camera);
    if (Math.abs(ndc.x) > 1 || Math.abs(ndc.y) > 1) return null; // off-screen

    // Perspective size: world footprint * focal / depth, focal derived from
    // the vertical fov so it is independent of window aspect. Size derives
    // from the UNSMOOTHED mesh scale (scale is not smoothed).
    const focalPx =
      window.innerHeight / 2 / Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
    // PlaneGeometry(1, 1/aspect): world width = scale.x, height = scale.y/aspect.
    const worldWidth = mesh.scale.x;
    const worldHeight = mesh.scale.y / win.aspect;
    const width = (worldWidth * focalPx) / depth;
    const height = (worldHeight * focalPx) / depth;
    const centerX = ((ndc.x + 1) / 2) * window.innerWidth;
    const centerY = ((1 - ndc.y) / 2) * window.innerHeight;
    return { left: centerX - width / 2, top: centerY - height / 2, width, height };
  }, []);

  return (
    <div style={{ position: 'relative', width: '100vw', height: '100vh', overflow: 'hidden' }}>
      {/* Site header: "Aditya's Dream" — consistent with the dark/glass
          cyber aesthetic (cyan accent, Inter, frosted bar). */}
      <header
        data-testid="site-header"
        style={{
          position: 'fixed',
          top: 0,
          left: 0,
          right: 0,
          zIndex: 100,
          height: 48,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 10,
          background: 'rgba(10, 11, 13, 0.72)',
          backdropFilter: 'blur(18px)',
          borderBottom: '1px solid rgba(255, 255, 255, 0.1)',
          color: '#f4f5f7',
          fontFamily: 'Inter, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif',
          letterSpacing: '0.14em',
          textTransform: 'uppercase',
          userSelect: 'none',
        }}
      >
        <span
          aria-hidden="true"
          style={{
            width: 7,
            height: 7,
            borderRadius: '50%',
            backgroundColor: '#00e5ff',
            boxShadow: '0 0 8px rgba(0, 229, 255, 0.8)',
            flexShrink: 0,
          }}
        />
        <span style={{ fontSize: 15, fontWeight: 700 }}>Aditya's Dream</span>
      </header>
      <Scene3D
        onSceneReady={handleSceneReady}
        onFpsUpdate={(fps) => {
          setFps(fps);
          loggerRef.current?.logMetric('renderFPS', fps);
        }}
        onFrame={handleFrame}
      />
      <CameraCapture onVideoReady={setVideo} onStateChange={setCameraState} />
      {video && (
        <HandTracker
          videoElement={video}
          onHandsDetected={handleHandsDetected}
          onGesturesDetected={handleGesturesDetected}
          onStateChange={setMediaPipeState}
          onLatencyUpdate={(ms) => {
            setLatencyMs(ms);
            loggerRef.current?.logMetric('handDetectionLatency', ms);
            recordPerf('inference', ms); // M14 (D5): the tracker's own avg
          }}
          onGestureLatencyUpdate={(ms) =>
            loggerRef.current?.recordSample('gestureRecognitionLatency', ms)
          }
        />
      )}
      {windows.map((win) => (
        <FloatingWindowView
          key={win.id}
          window={win}
          content={renderAppContent(win.id)}
          isRemote={remoteOwnedIdsRef.current.has(win.id)}
          onClose={handleCloseWindow}
          onMinimize={handleMinimizeWindow}
          onBringToFront={handleBringToFront}
          getProjection={getWindowProjection}
        />
      ))}
      <HandCursor cursor={cursorData} />
      <GestureDebug gestures={gestures} />
      <HelpOverlay />
      <Calibration />
      <EyeAttentionTracker
        videoElement={video}
        enabled={settings.eyeAttentionEnabled}
        activeWindows={spatialWindows}
        onAttentionUpdate={setEyeAttentionState}
      />
      
      {/* Workspace Controls Overlay */}
      <div
          data-testid="workspace-controls"
          style={{
            position: 'fixed',
            top: 64,
            left: '50%',
          transform: 'translateX(-50%)',
          zIndex: 20,
          display: 'flex',
          gap: 8,
          background: 'rgba(10, 11, 13, 0.72)',
          backdropFilter: 'blur(18px)',
          border: '1px solid rgba(255, 255, 255, 0.12)',
          borderRadius: 12,
          padding: '6px 12px',
          color: '#e8eaed',
          fontFamily: 'Inter, system-ui, sans-serif',
          fontSize: 12,
        }}
      >
        {['Briefing', 'Focus', 'Present'].map((mode) => (
          <button
            key={mode}
            data-testid={`mode-${mode.toLowerCase()}`}
            title={`${mode} (Shift+${mode[0]})`}
            onClick={() => setWorkspaceMode(mode as any)}
            style={{
              background: workspaceMode === mode ? 'rgba(0, 229, 255, 0.2)' : 'transparent',
              border: workspaceMode === mode ? '1px solid rgba(0, 229, 255, 0.4)' : '1px solid transparent',
              borderRadius: 6,
              color: workspaceMode === mode ? '#00e5ff' : '#8b8f98',
              padding: '4px 10px',
              cursor: 'pointer',
              fontWeight: workspaceMode === mode ? 600 : 400,
              transition: 'all 0.2s',
            }}
          >
            {mode}
          </button>
        ))}
        <div style={{ width: 1, background: 'rgba(255, 255, 255, 0.2)', margin: '0 4px' }} />
        <button
          onClick={() => void handleSaveWorkspace()}
          style={{ background: 'transparent', border: 'none', color: '#8b8f98', cursor: 'pointer', padding: '4px 8px' }}
          title="Save Layout (Shift+S)"
        >
          Save
        </button>
        <button
          onClick={() => { cameraRigRef.current?.reset(); }}
          style={{ background: 'transparent', border: 'none', color: '#8b8f98', cursor: 'pointer', padding: '4px 8px' }}
          title="Reset View (Shift+R)"
        >
          Reset
        </button>
        <button
          onClick={() => window.dispatchEvent(new CustomEvent('jarvis-toggle-help'))}
          style={{ background: 'transparent', border: 'none', color: '#8b8f98', cursor: 'pointer', padding: '4px 8px' }}
          title="Help (Shift+?)"
        >
          Help (?)
        </button>
      </div>

      <Hud
        cameraState={cameraState}
        mediaPipeState={mediaPipeState}
        handsCount={handsCount}
        windowsCount={windows.length}
        gestureSummary={summarizeGestures(gestures)}
        fps={fps}
        latencyMs={latencyMs}
        syncStatus={syncStatus}
        syncUsers={syncUsers}
        errorCount={errorCount}
        remoteIndicatorRef={remoteHandsIndicatorRef}
        isAuthenticated={!!token}
        eyeState={eyeAttentionState}
        onToggleEyeAttention={() =>
          setStoredInputSettings({
            ...settings,
            eyeAttentionEnabled: !settings.eyeAttentionEnabled,
          })
        }
      />
      {showOnboarding && (
        <div style={{ zIndex: 9999, position: 'absolute', inset: 0 }}>
          <OnboardingFlow onComplete={() => {
            localStorage.setItem('jarvis_onboarded', '1');
            setShowOnboarding(false);
          }} />
        </div>
      )}
    </div>
  );
}

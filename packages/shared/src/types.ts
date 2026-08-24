/**
 * Shared data types used across JARVIS frontend and backend.
 *
 * These mirror the MediaPipe Hands result shape so the frontend can hand
 * `Hand[]` to any consumer (gesture recognizer, WebSocket sync, HUD)
 * without leaking MediaPipe-specific types.
 */

/** Label assigned by MediaPipe handedness classification. */
export type Handedness = 'Left' | 'Right';

/** A single normalized 2D/3D landmark. x/y are normalized to the image
 * dimensions (0..1), z encodes depth relative to the wrist. */
export interface Landmark {
  x: number;
  y: number;
  z: number;
}

/** One detected hand: 21 landmarks plus classification confidence. */
export interface Hand {
  handedness: Handedness;
  landmarks: Landmark[];
  confidence: number;
}

/** Result of one hand-tracking inference pass. */
export interface HandDetectionResult {
  /** Zero, one, or two hands (maxNumHands = 2). */
  hands: Hand[];
  /** Wall-clock time the detection took from frame submit to results, ms. */
  latencyMs: number;
  /** performance.now() when the results arrived. */
  timestamp: number;
}

/** Lifecycle state of the webcam capture pipeline. */
export type CameraState = 'starting' | 'active' | 'error' | 'unsupported';

/** Lifecycle state of the MediaPipe Hands model. */
export type MediaPipeState = 'loading' | 'ready' | 'error';

/** Backend health payload, shared so the frontend can type the /api/health call. */
export interface HealthResponse {
  status: 'ok';
  uptimeSec: number;
  wsPort: number;
}

// ---------------------------------------------------------------------------
// M11 real-time sync protocol (wire shapes — additive).
// ---------------------------------------------------------------------------

/** Presence record in stateSnapshot (spec §3.2, wire shape). Hands travel
 *  via handSync messages, never in the snapshot. */
export interface UserInfo {
  id: string;
  lastUpdate: number;
}

/**
 * Window state as it travels the wire (spec §3.2, wire shape, D1/M11):
 * tuples and scalars only — Vector3/Euler are not JSON-stable and the
 * client converts. `scale` is the scalar window WIDTH (scale.x; the 16:9
 * aspect derives the height). `owner` is STAMPED BY THE SERVER on create
 * (first creator wins, D7) — clients send '' and never learn their own id.
 */
export interface WindowState {
  id: string;
  title: string;
  owner: string;
  position: [number, number, number];
  rotationY: number;
  scale: number;
  zIndex: number;
  lastModified: number;
}

/** Client -> server messages (M11 protocol). */
export type ClientMessage =
  | { type: 'handUpdate'; data: { hands: Hand[] } }
  | { type: 'windowUpsert'; data: WindowState }
  | { type: 'windowClose'; data: { id: string } }
  | { type: 'presenterSync'; data: { position: [number, number, number], rotation: [number, number, number], fov: number } | null };

/** Server -> client messages (M11 protocol). windowClose propagates via
 *  stateSnapshot (the protocol has no removal delta — D8, M12 may add one). */
export type ServerMessage =
  | { type: 'userJoined'; data: { userId: string } }
  | { type: 'userLeft'; data: { userId: string } }
  | { type: 'handSync'; data: { userId: string; hands: Hand[] } }
  | { type: 'windowSync'; data: WindowState }
  | { type: 'stateSnapshot'; data: { users: UserInfo[]; windows: WindowState[] } }
  | { type: 'presenterSync'; data: { presenterId: string, position: [number, number, number], rotation: [number, number, number], fov: number } | null }
  | { type: 'error'; data: { message: string } };

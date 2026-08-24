# JARVIS: Technical Specification
## Detailed Architecture & Implementation Guide

---

## 1. System Architecture Overview

```
┌─────────────────────────────────────────────────────────────────────┐
│                         USER BROWSER (TypeScript)                   │
├─────────────────────────────────────────────────────────────────────┤
│                                                                       │
│  ┌──────────────────┐  ┌──────────────────┐  ┌──────────────────┐  │
│  │ Camera Capture   │  │ Hand Tracking    │  │ Gesture Engine   │  │
│  │ (getUserMedia)   │  │ (MediaPipe)      │  │ (Recognition)    │  │
│  └────────┬─────────┘  └────────┬─────────┘  └────────┬─────────┘  │
│           │                      │                     │             │
│           └──────────┬───────────┴─────────────────────┘             │
│                      ▼                                                │
│           ┌──────────────────────┐                                   │
│           │  Interaction Engine  │                                   │
│           │  (Hit Testing)       │                                   │
│           └──────────┬───────────┘                                   │
│                      │                                                │
│           ┌──────────▼───────────┐                                   │
│           │  Scene Manager       │                                   │
│           │  (Three.js)          │                                   │
│           └──────────┬───────────┘                                   │
│                      │                                                │
│           ┌──────────▼───────────┐                                   │
│           │  Window Manager      │                                   │
│           │  (Floating Windows)  │                                   │
│           └──────────┬───────────┘                                   │
│                      │                                                │
│           ┌──────────▼───────────┐                                   │
│           │  App Layer           │                                   │
│           │  (LLM, Search, etc)  │                                   │
│           └──────────┬───────────┘                                   │
│                      │                                                │
│           ┌──────────▼───────────┐                                   │
│           │  Sync Manager        │                                   │
│           │  (WebSocket Client)  │                                   │
│           └──────────┬───────────┘                                   │
│                      │                                                │
└──────────────────────┼──────────────────────────────────────────────┘
                       │ WebSocket (Real-time)
                       │
┌──────────────────────▼──────────────────────────────────────────────┐
│                    BACKEND (Node.js/Go)                              │
├──────────────────────────────────────────────────────────────────────┤
│                                                                       │
│  ┌────────────────────────────────────────────────────────────┐    │
│  │  WebSocket Server (ws or Socket.io)                       │    │
│  │  - Handle connections/disconnections                      │    │
│  │  - Route messages to handlers                             │    │
│  └────────────────┬───────────────────────────────────────────┘    │
│                   │                                                  │
│  ┌────────────────▼───────────────────────────────────────────┐    │
│  │  State Manager                                             │    │
│  │  - Track active users + their hand positions              │    │
│  │  - Track windows + their positions/states                 │    │
│  │  - Conflict resolution (two users moving same object)     │    │
│  └────────────────┬───────────────────────────────────────────┘    │
│                   │                                                  │
│  ┌────────────────▼───────────────────────────────────────────┐    │
│  │  Cache Layer (Redis)                                       │    │
│  │  - Hot state (user positions, window transforms)          │    │
│  │  - API response caching (LLM, Search)                     │    │
│  └────────────────┬───────────────────────────────────────────┘    │
│                   │                                                  │
│  ┌────────────────▼───────────────────────────────────────────┐    │
│  │  API Router                                                │    │
│  │  - Google API (LLM, Search, etc)                          │    │
│  │  - Rate limiting + auth                                   │    │
│  └────────────────┬───────────────────────────────────────────┘    │
│                   │                                                  │
│  ┌────────────────▼───────────────────────────────────────────┐    │
│  │  Persistence Layer (PostgreSQL)                            │    │
│  │  - User workspaces (save/load)                            │    │
│  │  - Chat history                                           │    │
│  │  - Notes                                                  │    │
│  └────────────────────────────────────────────────────────────┘    │
│                                                                       │
└──────────────────────────────────────────────────────────────────────┘
```

---

## 2. Frontend Architecture

### 2.1 Data Flow & State Management

```
Camera Feed (30fps)
    ↓
MediaPipe Hand Tracker
    ↓ Hand Landmarks (21 points per hand)
    ↓
Gesture Recognizer
    ↓ {gestureType, confidence, position, intensity}
    ↓
Interaction Engine
    ↓ {eventType, targetObject, position, delta}
    ↓
Scene Manager / App Handler
    ↓ Update 3D state
    ↓
Sync Manager (broadcast to backend + other users)
    ↓
Render Loop (Three.js)
    ↓ 60fps
    ↓
Canvas → Screen
```

### 2.2 Core Components

#### **CameraCapture.ts**
```typescript
export interface CameraState {
  stream: MediaStream | null;
  canvas: HTMLCanvasElement;
  context: CanvasRenderingContext2D;
  frameRate: number;
  isActive: boolean;
}

export class CameraCapture {
  async initialize(
    videoElement: HTMLVideoElement,
    canvasElement: HTMLCanvasElement,
    targetFPS: number = 30
  ): Promise<void>;
  
  getFrame(): ImageData; // For hand tracking
  shutdown(): void;
}
```

**Implementation Notes:**
- Use `navigator.mediaDevices.getUserMedia()`
- Handle permissions (show UI if denied)
- Request `{ video: { width: 1280, height: 720 } }` for good hand tracking
- Off-screen canvas for efficient frame extraction
- Implement frame skipping if GPU can't keep up

---

#### **HandTracker.ts**
```typescript
export interface Hand {
  handedness: 'Left' | 'Right';
  landmarks: Landmark[]; // 21 landmarks per hand
  confidence: number; // 0-1
  position: Vector3; // Center of palm
  orientation: Quaternion; // Hand rotation
}

export interface Landmark {
  x: number; // 0-1 (normalized to image width)
  y: number; // 0-1 (normalized to image height)
  z: number; // depth relative to wrist
  confidence: number;
}

export class HandTracker {
  private mediapipe: MediaPipeHands;
  
  async initialize(): Promise<void>;
  
  track(frame: ImageData): Hand[];
  
  // Helper methods
  private denormalize(landmark: Landmark, imageSize: {w, h}): {x, y, z};
  private calculateHandCenter(landmarks: Landmark[]): Vector3;
  private estimateHandOrientation(landmarks: Landmark[]): Quaternion;
}
```

**Implementation Notes:**
- Use MediaPipe Hands (pre-trained, well-optimized)
- Run at 30fps (adequate for gestures)
- Cache model in IndexedDB for faster loads
- Handle multi-hand tracking natively
- Landmarks: wrist (0), fingers (1-4 per finger), palm
- Confidence scoring helps detect occlusions/poor tracking

---

#### **GestureRecognizer.ts**
```typescript
export enum GestureType {
  PINCH = 'pinch',
  GRAB = 'grab',
  POINT = 'point',
  OPEN = 'open',
  SWIPE = 'swipe',
  NONE = 'none'
}

export interface Gesture {
  type: GestureType;
  confidence: number; // 0-1
  intensity: number; // 0-1 (how "strong" is the gesture)
  position: Vector3; // Position of pinch/point
  handedness: 'Left' | 'Right';
  timestamp: number;
}

export class GestureRecognizer {
  private gestureDuration: number = 5; // frames
  private pinchThreshold: number = 0.03; // meters
  private gestureHistory: Gesture[] = [];
  
  recognize(hands: Hand[]): Gesture[] {
    // For each hand, determine what gesture is being made
    return hands.map(hand => this.classifyHand(hand));
  }
  
  private classifyHand(hand: Hand): Gesture {
    // Calculate distances between finger tips
    const thumbTipIndex = this.getLandmark(hand, 4);
    const indexTipIndex = this.getLandmark(hand, 8);
    const midTipIndex = this.getLandmark(hand, 12);
    
    const thumbIndexDist = this.distance(thumbTipIndex, indexTipIndex);
    const thumbMiddleDist = this.distance(thumbTipIndex, midTipIndex);
    
    // Pinch: thumb + index close, other fingers open
    if (thumbIndexDist < this.pinchThreshold) {
      return {
        type: GestureType.PINCH,
        intensity: 1 - (thumbIndexDist / this.pinchThreshold),
        position: this.midpoint(thumbTipIndex, indexTipIndex),
        // ...
      };
    }
    
    // Open: all fingers spread, palm facing camera
    if (this.isHandOpen(hand)) {
      return {
        type: GestureType.OPEN,
        // ...
      };
    }
    
    // Point: index extended, other fingers closed
    if (this.isPointing(hand)) {
      return {
        type: GestureType.POINT,
        position: this.getLandmark(hand, 8), // index tip
        // ...
      };
    }
    
    // ... more gestures
  }
  
  private isHandOpen(hand: Hand): boolean {
    // All finger tips should be far from palm center
    const palmCenter = hand.position;
    const fingerTips = [4, 8, 12, 16, 20]; // thumb, index, middle, ring, pinky
    
    return fingerTips.every(tip => {
      const dist = this.distance(palmCenter, this.getLandmark(hand, tip));
      return dist > 0.08; // 8cm from palm
    });
  }
  
  private isPointing(hand: Hand): boolean {
    // Index extended, other fingers close to palm
    const indexTip = this.getLandmark(hand, 8);
    const middleTip = this.getLandmark(hand, 12);
    const palmCenter = hand.position;
    
    const indexExtended = this.distance(palmCenter, indexTip) > 0.12;
    const othersClose = this.distance(palmCenter, middleTip) < 0.08;
    
    return indexExtended && othersClose;
  }
}
```

**Gesture Definitions:**

| Gesture | Conditions | CV | Use Case |
|---------|-----------|-----|----------|
| **PINCH** | Thumb + index <3cm, other fingers open | 0.95 | Grab/interact objects |
| **GRAB** | All fingers curled, hand stable | 0.90 | Hold/drag objects |
| **POINT** | Index extended, others curled, steady | 0.92 | Select/target objects |
| **OPEN** | All fingers spread >8cm from palm | 0.95 | Neutral/idle state |
| **SWIPE** | Open hand moving >20cm in 200ms | 0.88 | Pan/navigate space |
| **PINCH_ZOOM** | Both hands pinching (distance changing) | 0.85 | Scale entire scene |

---

#### **InteractionEngine.ts**
```typescript
export interface InteractionEvent {
  type: 'grab' | 'release' | 'move' | 'hover';
  target: string; // object ID in 3D scene
  position: Vector3; // world position
  delta: Vector3; // change from last frame
  gesture: Gesture;
  timestamp: number;
}

export class InteractionEngine {
  private raycaster: THREE.Raycaster;
  private scene: THREE.Scene;
  private camera: THREE.Camera;
  private grabbedObjects: Map<string, GrabbedObject> = new Map();
  
  processGesture(gesture: Gesture): InteractionEvent[] {
    const events: InteractionEvent[] = [];
    
    // Raycast from camera through hand position
    const ray = this.raycastFromHandPosition(gesture.position);
    const intersects = this.raycaster.intersectObjects(this.scene.children);
    
    if (gesture.type === GestureType.PINCH) {
      if (intersects.length > 0) {
        const targetObject = intersects[0].object;
        
        if (!this.grabbedObjects.has(targetObject.id)) {
          // Start grab
          events.push({
            type: 'grab',
            target: targetObject.id,
            position: targetObject.position,
            gesture,
            // ...
          });
          
          this.grabbedObjects.set(targetObject.id, {
            object: targetObject,
            grabOffset: gesture.position.clone().sub(targetObject.position),
            startTime: Date.now(),
          });
        } else {
          // Continue drag
          const grabbed = this.grabbedObjects.get(targetObject.id)!;
          const newPosition = gesture.position.clone().sub(grabbed.grabOffset);
          
          events.push({
            type: 'move',
            target: targetObject.id,
            position: newPosition,
            delta: newPosition.clone().sub(grabbed.object.position),
            gesture,
            // ...
          });
          
          grabbed.object.position.copy(newPosition);
        }
      }
    }
    
    if (gesture.type === GestureType.OPEN && gesture.confidence > 0.8) {
      // Release all grabbed objects
      this.grabbedObjects.forEach(grabbed => {
        events.push({
          type: 'release',
          target: grabbed.object.id,
          position: grabbed.object.position,
          gesture,
          // ...
        });
      });
      this.grabbedObjects.clear();
    }
    
    return events;
  }
  
  private raycastFromHandPosition(handPos: Vector3): THREE.Ray {
    // Convert hand position (normalized 0-1) to NDC (-1 to 1)
    const x = (handPos.x * 2) - 1;
    const y = -(handPos.y * 2) + 1;
    
    this.raycaster.setFromCamera({ x, y }, this.camera);
    return this.raycaster.ray;
  }
}

interface GrabbedObject {
  object: THREE.Object3D;
  grabOffset: Vector3; // where hand grabbed relative to object center
  startTime: number;
}
```

**Key Interaction Patterns:**
- Pinch to grab, open hand to release
- Move hand = move object (smooth following)
- Pinch intensity affects operation (e.g., pinch strength = zoom amount)
- Visual feedback: highlight grabbable objects, show grab points
- Momentum: when releasing, object continues in hand's direction for 0.5s

---

#### **Scene3D.ts**
```typescript
export interface SceneConfig {
  width: number;
  height: number;
  backgroundColor: number;
  gridSize: number;
  cameraFOV: number;
}

export class Scene3D {
  private scene: THREE.Scene;
  private camera: THREE.PerspectiveCamera;
  private renderer: THREE.WebGLRenderer;
  private clock: THREE.Clock;
  
  constructor(container: HTMLElement, config: SceneConfig) {
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(config.backgroundColor);
    
    // Camera positioned to look at scene from user's perspective
    this.camera = new THREE.PerspectiveCamera(
      config.cameraFOV,
      config.width / config.height,
      0.1,
      1000
    );
    this.camera.position.set(0, 0, 5);
    this.camera.lookAt(0, 0, 0);
    
    // Renderer
    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    this.renderer.setSize(config.width, config.height);
    this.renderer.setPixelRatio(window.devicePixelRatio);
    container.appendChild(this.renderer.domElement);
    
    // Lighting
    this.setupLighting();
    
    // Grid for spatial reference
    this.addGrid(config.gridSize);
    
    // Start render loop
    this.startRenderLoop();
  }
  
  private setupLighting(): void {
    // Ambient light (general illumination)
    const ambientLight = new THREE.AmbientLight(0xffffff, 0.6);
    this.scene.add(ambientLight);
    
    // Directional light (sun-like)
    const directionalLight = new THREE.DirectionalLight(0xffffff, 0.8);
    directionalLight.position.set(5, 10, 7);
    directionalLight.castShadow = true;
    this.scene.add(directionalLight);
  }
  
  private addGrid(size: number): void {
    const gridHelper = new THREE.GridHelper(size, size);
    this.scene.add(gridHelper);
  }
  
  addObject(object: THREE.Object3D): void {
    this.scene.add(object);
  }
  
  removeObject(object: THREE.Object3D): void {
    this.scene.remove(object);
  }
  
  private startRenderLoop(): void {
    const render = () => {
      requestAnimationFrame(render);
      
      const delta = this.clock.getDelta();
      // Update animations, physics, etc.
      // ...
      
      this.renderer.render(this.scene, this.camera);
    };
    
    render();
  }
  
  // Camera controls for navigation
  panCamera(delta: Vector3): void {
    this.camera.position.add(delta.multiplyScalar(0.01));
  }
  
  zoomCamera(intensity: number): void {
    // Intensity: 0-1 (0 = zoom out, 1 = zoom in)
    const zoomSpeed = 5;
    this.camera.position.z -= (intensity - 0.5) * zoomSpeed;
  }
  
  rotateCamera(rotation: Euler): void {
    // For advanced interactions
  }
}
```

**Scene Setup:**
- Fixed camera viewing from front (adjustable)
- Ambient + directional lighting for 3D appearance
- Grid floor for spatial reference
- Coordinate system: X (left-right), Y (up-down), Z (toward-away)

---

#### **WindowManager.ts**
```typescript
export interface FloatingWindow {
  id: string;
  position: Vector3;
  scale: Vector3;
  rotation: Euler;
  content: React.ReactNode; // App content
  title: string;
  isMinimized: boolean;
  zIndex: number; // For layering
  aspect: number; // width/height
}

export class WindowManager {
  private windows: Map<string, FloatingWindow> = new Map();
  private nextZIndex: number = 1;
  private windowMesh: Map<string, THREE.Mesh> = new Map();
  
  createWindow(
    id: string,
    title: string,
    content: React.ReactNode,
    initialPos: Vector3 = new THREE.Vector3(0, 0, 0)
  ): FloatingWindow {
    const window: FloatingWindow = {
      id,
      title,
      content,
      position: initialPos,
      scale: new THREE.Vector3(1, 1, 0.1), // Thin for 3D card look
      rotation: new THREE.Euler(),
      zIndex: this.nextZIndex++,
      isMinimized: false,
      aspect: 16 / 9, // Default aspect ratio
    };
    
    this.windows.set(id, window);
    
    // Create 3D mesh for window
    const mesh = this.createWindowMesh(window);
    this.windowMesh.set(id, mesh);
    
    return window;
  }
  
  private createWindowMesh(window: FloatingWindow): THREE.Mesh {
    // Create plane geometry for window
    const width = 3; // World units
    const height = width / window.aspect;
    
    const geometry = new THREE.PlaneGeometry(width, height);
    const material = new THREE.MeshPhongMaterial({
      color: 0x1a1a2e,
      side: THREE.DoubleSide,
    });
    
    const mesh = new THREE.Mesh(geometry, material);
    mesh.position.copy(window.position);
    mesh.scale.copy(window.scale);
    mesh.userData.windowId = window.id;
    
    return mesh;
  }
  
  moveWindow(id: string, newPosition: Vector3): void {
    const window = this.windows.get(id);
    if (window) {
      window.position.copy(newPosition);
      const mesh = this.windowMesh.get(id);
      if (mesh) mesh.position.copy(newPosition);
    }
  }
  
  resizeWindow(id: string, newScale: Vector3): void {
    const window = this.windows.get(id);
    if (window) {
      window.scale.copy(newScale);
      const mesh = this.windowMesh.get(id);
      if (mesh) mesh.scale.copy(newScale);
    }
  }
  
  bringToFront(id: string): void {
    const window = this.windows.get(id);
    if (window) {
      window.zIndex = this.nextZIndex++;
    }
  }
  
  minimizeWindow(id: string): void {
    const window = this.windows.get(id);
    if (window) {
      window.isMinimized = true;
      const mesh = this.windowMesh.get(id);
      if (mesh) mesh.visible = false;
    }
  }
  
  closeWindow(id: string): void {
    this.windows.delete(id);
    const mesh = this.windowMesh.get(id);
    if (mesh) mesh.parent?.remove(mesh);
    this.windowMesh.delete(id);
  }
}
```

**Window Features:**
- 3D floating cards in space
- Depth positioning (closer/farther)
- Resizable (pinch + spread hands)
- Minimize/maximize (gestures or buttons)
- Z-ordering (bring to front when interacting)
- Smooth animations (easing on move/resize)

---

### 2.3 App Framework

```typescript
export interface AppContext {
  windowId: string;
  sendMessage: (msg: any) => void;
  maximize: () => void;
  minimize: () => void;
  close: () => void;
}

export abstract class App {
  abstract render(context: AppContext): React.ReactNode;
}

export class LLMChatApp extends App {
  private messages: Message[] = [];
  private apiKey: string = '';
  
  render(context: AppContext): React.ReactNode {
    return (
      <div className="llm-chat">
        <div className="messages">
          {this.messages.map(msg => (
            <div key={msg.id} className={`message ${msg.role}`}>
              {msg.content}
            </div>
          ))}
        </div>
        <input
          type="text"
          placeholder="Ask me anything..."
          onKeyPress={(e) => this.onSendMessage(e, context)}
        />
      </div>
    );
  }
  
  private async onSendMessage(e: KeyboardEvent, context: AppContext) {
    if (e.key !== 'Enter') return;
    
    const message = e.currentTarget.value;
    e.currentTarget.value = '';
    
    this.messages.push({ role: 'user', content: message });
    
    // Call Google API (or OpenAI)
    const response = await fetch('https://api.google.com/generativelanguage', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-goog-api-key': this.apiKey,
      },
      body: JSON.stringify({
        contents: [{ parts: [{ text: message }] }],
      }),
    });
    
    const data = await response.json();
    this.messages.push({
      role: 'assistant',
      content: data.candidates[0].content.parts[0].text,
    });
    
    context.sendMessage({ type: 'update' });
  }
}

export class WebSearchApp extends App {
  // Similar structure
}

export class NotesApp extends App {
  // Similar structure
}

export class DashboardApp extends App {
  // Similar structure
}
```

---

## 3. Backend Architecture (Node.js)

### 3.1 WebSocket Server

```typescript
import WebSocket from 'ws';
import { Server } from 'http';

interface ClientMessage {
  type: 'handUpdate' | 'interaction' | 'windowUpdate' | 'apiCall';
  userId: string;
  data: any;
}

interface ServerMessage {
  type: 'handSync' | 'windowSync' | 'apiResponse' | 'userJoined' | 'userLeft';
  data: any;
}

export class JARVISServer {
  private wss: WebSocket.Server;
  private clients: Map<string, WebSocket> = new Map();
  private stateManager: StateManager;
  private apiRouter: APIRouter;
  
  constructor(server: Server) {
    this.wss = new WebSocket.Server({ server });
    this.stateManager = new StateManager();
    this.apiRouter = new APIRouter();
    
    this.wss.on('connection', (ws) => this.handleConnection(ws));
  }
  
  private handleConnection(ws: WebSocket): void {
    const userId = this.generateUserId();
    this.clients.set(userId, ws);
    
    // Notify others
    this.broadcast({
      type: 'userJoined',
      data: { userId },
    });
    
    ws.on('message', (data) => this.handleMessage(userId, JSON.parse(data.toString())));
    ws.on('close', () => this.handleDisconnect(userId));
  }
  
  private handleMessage(userId: string, msg: ClientMessage): void {
    switch (msg.type) {
      case 'handUpdate':
        // Broadcast hand position to other users
        this.broadcast({
          type: 'handSync',
          data: {
            userId,
            hands: msg.data,
          },
        }, userId); // Exclude sender
        
        this.stateManager.updateUserHands(userId, msg.data);
        break;
        
      case 'interaction':
        // User interacted with object
        this.stateManager.applyInteraction(userId, msg.data);
        
        // Broadcast new state to all
        this.broadcast({
          type: 'windowSync',
          data: this.stateManager.getFullState(),
        });
        break;
        
      case 'apiCall':
        // Route to external API
        this.apiRouter.handle(msg.data).then(response => {
          const client = this.clients.get(userId);
          if (client) {
            client.send(JSON.stringify({
              type: 'apiResponse',
              data: response,
            }));
          }
        });
        break;
    }
  }
  
  private handleDisconnect(userId: string): void {
    this.clients.delete(userId);
    this.stateManager.removeUser(userId);
    
    this.broadcast({
      type: 'userLeft',
      data: { userId },
    });
  }
  
  private broadcast(msg: ServerMessage, excludeUserId?: string): void {
    const payload = JSON.stringify(msg);
    
    this.clients.forEach((ws, userId) => {
      if (excludeUserId && userId === excludeUserId) return;
      ws.send(payload);
    });
  }
  
  private generateUserId(): string {
    return `user-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  }
}
```

### 3.2 State Manager

```typescript
export interface UserState {
  id: string;
  hands: Hand[];
  lastUpdate: number;
}

export interface WindowState {
  id: string;
  position: [number, number, number];
  scale: [number, number, number];
  title: string;
  owner: string; // Which user created it
  lastModified: number;
}

export interface SceneState {
  users: Map<string, UserState>;
  windows: Map<string, WindowState>;
  interactions: Interaction[];
}

export class StateManager {
  private state: SceneState = {
    users: new Map(),
    windows: new Map(),
    interactions: [],
  };
  
  private db: Database; // PostgreSQL
  
  updateUserHands(userId: string, hands: Hand[]): void {
    if (!this.state.users.has(userId)) {
      this.state.users.set(userId, {
        id: userId,
        hands: [],
        lastUpdate: Date.now(),
      });
    }
    
    const user = this.state.users.get(userId)!;
    user.hands = hands;
    user.lastUpdate = Date.now();
    
    // Cache in Redis for fast access
    this.cache.set(`user:${userId}`, user, 3600);
  }
  
  applyInteraction(userId: string, interaction: Interaction): void {
    const { targetWindowId, type, data } = interaction;
    
    const window = this.state.windows.get(targetWindowId);
    if (!window) return;
    
    switch (type) {
      case 'move':
        window.position = data.newPosition;
        break;
      case 'resize':
        window.scale = data.newScale;
        break;
      case 'close':
        this.state.windows.delete(targetWindowId);
        break;
    }
    
    window.lastModified = Date.now();
    
    // Persist to DB
    this.db.updateWindow(window);
  }
  
  getFullState(): SceneState {
    return this.state;
  }
  
  removeUser(userId: string): void {
    this.state.users.delete(userId);
    this.cache.delete(`user:${userId}`);
  }
}
```

### 3.3 API Router

```typescript
export class APIRouter {
  private googleApiKey: string;
  private rateLimiter: RateLimiter;
  
  async handle(request: APIRequest): Promise<APIResponse> {
    const { type, payload, userId } = request;
    
    // Rate limit
    if (!this.rateLimiter.allow(userId)) {
      return { success: false, error: 'Rate limit exceeded' };
    }
    
    switch (type) {
      case 'llm':
        return this.handleLLM(payload);
      case 'search':
        return this.handleSearch(payload);
      case 'vision':
        return this.handleVision(payload);
      default:
        return { success: false, error: 'Unknown API type' };
    }
  }
  
  private async handleLLM(payload: LLMRequest): Promise<APIResponse> {
    const cacheKey = `llm:${payload.prompt}`;
    const cached = this.cache.get(cacheKey);
    if (cached) return cached;
    
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-pro:generateContent`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-goog-api-key': this.googleApiKey,
        },
        body: JSON.stringify({
          contents: [{ parts: [{ text: payload.prompt }] }],
        }),
      }
    );
    
    const data = await response.json();
    const result = {
      success: true,
      data: data.candidates[0].content.parts[0].text,
    };
    
    this.cache.set(cacheKey, result, 3600); // Cache 1 hour
    return result;
  }
  
  private async handleSearch(payload: SearchRequest): Promise<APIResponse> {
    // Google Custom Search API
    const response = await fetch(
      `https://www.googleapis.com/customsearch/v1`,
      {
        method: 'GET',
        headers: {
          'x-goog-api-key': this.googleApiKey,
        },
      }
    );
    
    const data = await response.json();
    return {
      success: true,
      data: data.items,
    };
  }
  
  private async handleVision(payload: VisionRequest): Promise<APIResponse> {
    // Google Vision API for image understanding
    // ...
  }
}
```

---

## 4. Implementation Phases

### Phase 1: Foundation (Weeks 1-4)
**Deliverable:** Hand tracking + 1 window + basic 3D rendering

**Checklist:**
- [ ] Set up Three.js scene
- [ ] Integrate MediaPipe Hands
- [ ] Render hand skeleton
- [ ] Create 1 floating window mesh
- [ ] Test end-to-end latency (<200ms)

**Tech to Learn:**
- Three.js basics (geometry, materials, lighting)
- MediaPipe setup + inference
- Basic React + TypeScript

---

### Phase 2: Gestures (Weeks 5-7)
**Deliverable:** Full gesture recognition + window manipulation

**Checklist:**
- [ ] Implement pinch detection
- [ ] Implement grab + drag
- [ ] Implement release
- [ ] Hit testing (raycast)
- [ ] Smooth animations

---

### Phase 3: Apps (Weeks 8-10)
**Deliverable:** 4 functional apps

**Checklist:**
- [ ] LLM Chat App
- [ ] Web Search App
- [ ] Notes App
- [ ] Dashboard App
- [ ] App framework/API

---

### Phase 4: Backend (Weeks 11-13)
**Deliverable:** Multi-user collaboration

**Checklist:**
- [ ] WebSocket server
- [ ] State synchronization
- [ ] User session management
- [ ] Persistence layer

---

### Phase 5: Polish (Weeks 14-16)
**Deliverable:** Production-ready

**Checklist:**
- [ ] Performance optimization
- [ ] Edge case handling
- [ ] Comprehensive testing
- [ ] Documentation
- [ ] Demo video

---

## 5. Performance Targets

| Metric | Target | Why |
|--------|--------|-----|
| Hand Detection Latency | <100ms | Must feel responsive |
| Gesture Recognition | 95%+ accuracy | Avoid false positives |
| Rendering FPS | 60fps | Smooth interactions |
| WebSocket RTT | <200ms | Multi-user feels instant |
| Server Latency | <50ms | API calls should be snappy |

---

## 6. Technology Decisions

### Frontend
- **Three.js** (not Babylon.js) - Better ecosystem, more examples
- **React** (not Vue/Svelte) - App framework for UI components
- **MediaPipe** (not custom ML) - Pre-trained, optimized for browser
- **TypeScript** - Type safety for complex interactions
- **Vite** (not Webpack) - Fast dev experience

### Backend
- **Node.js + Express** (not Go) - Easier JSON/WebSocket handling
- **WebSocket** (not HTTP polling) - Real-time requirements
- **Redis** - State caching
- **PostgreSQL** - Persistence
- **Docker** - Deployment

### Deployment
- **AWS EC2** or **Vercel** for backend
- **Vercel** for frontend (CDN, fast)
- **Docker Compose** for local development

---

## 7. Testing Strategy

### Unit Tests
- Gesture recognition (pinch, grab, swipe)
- Math utilities (distance, angles, etc.)
- State management (add/remove windows, users)

### Integration Tests
- Hand tracking → gesture recognition → interaction
- Multi-user state sync
- API routing + caching

### E2E Tests
- Full flow: camera → hand tracking → gesture → window move → sync to other users

### Performance Tests
- 60fps rendering with 10+ objects
- Sub-100ms hand detection
- Sub-200ms WebSocket round-trip

---

**Next Steps:**
1. Review this spec
2. Ask clarifying questions
3. Set up project structure
4. Start Phase 1

Let's build this.

# JARVIS: Step-by-Step Implementation Guide

---

## Phase 1: Foundation (Weeks 1-4)
### Goal: Get hand tracking + basic 3D scene working

---

## Week 1: Project Setup & 3D Basics

### Step 1.1: Initialize Project

```bash
# Create project directory
mkdir jarvis
cd jarvis

# Initialize monorepo structure
mkdir -p apps/{frontend,backend} packages/{shared}

# Frontend setup
cd apps/frontend
npm create vite@latest . -- --template react-ts

# Install dependencies
npm install three @react-three/fiber @react-three/drei
npm install typescript eslint prettier
npm install -D tailwindcss postcss autoprefixer

# Backend setup
cd ../backend
npm init -y
npm install express ws cors dotenv
npm install -D typescript @types/node nodemon
npm install redis ioredis pg

# Shared types
cd ../../packages/shared
npm init -y
npm install typescript
```

### Step 1.2: Project Structure

```
jarvis/
├── apps/
│   ├── frontend/
│   │   ├── src/
│   │   │   ├── components/
│   │   │   │   ├── CameraCapture.tsx
│   │   │   │   ├── HandTracker.tsx
│   │   │   │   ├── Scene3D.tsx
│   │   │   │   ├── WindowManager.tsx
│   │   │   │   └── GestureRecognizer.tsx
│   │   │   ├── apps/
│   │   │   │   ├── LLMChat.tsx
│   │   │   │   ├── WebSearch.tsx
│   │   │   │   ├── Notes.tsx
│   │   │   │   └── Dashboard.tsx
│   │   │   ├── utils/
│   │   │   │   ├── math.ts
│   │   │   │   ├── gestures.ts
│   │   │   │   └── sync.ts
│   │   │   ├── App.tsx
│   │   │   └── main.tsx
│   │   ├── vite.config.ts
│   │   └── package.json
│   │
│   └── backend/
│       ├── src/
│       │   ├── server.ts
│       │   ├── websocket/
│       │   │   ├── server.ts
│       │   │   └── handlers.ts
│       │   ├── state/
│       │   │   ├── manager.ts
│       │   │   └── storage.ts
│       │   ├── api/
│       │   │   ├── google.ts
│       │   │   ├── router.ts
│       │   │   └── rate-limiter.ts
│       │   └── config.ts
│       ├── tsconfig.json
│       └── package.json
│
├── packages/
│   └── shared/
│       ├── src/
│       │   ├── types.ts
│       │   └── constants.ts
│       └── package.json
│
└── README.md
```

### Step 1.3: Create Basic Three.js Scene

**apps/frontend/src/components/Scene3D.tsx:**

```typescript
import React, { useEffect, useRef } from 'react';
import * as THREE from 'three';

interface Scene3DProps {
  onSceneReady: (scene: THREE.Scene, camera: THREE.Camera) => void;
}

export const Scene3D: React.FC<Scene3DProps> = ({ onSceneReady }) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const sceneRef = useRef<THREE.Scene | null>(null);
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null);
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null);

  useEffect(() => {
    if (!containerRef.current) return;

    // Scene setup
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x0a0e27);
    sceneRef.current = scene;

    // Camera
    const camera = new THREE.PerspectiveCamera(
      75,
      window.innerWidth / window.innerHeight,
      0.1,
      1000
    );
    camera.position.z = 5;
    cameraRef.current = camera;

    // Renderer
    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.setPixelRatio(window.devicePixelRatio);
    containerRef.current.appendChild(renderer.domElement);
    rendererRef.current = renderer;

    // Lighting
    const ambientLight = new THREE.AmbientLight(0xffffff, 0.6);
    scene.add(ambientLight);

    const directionalLight = new THREE.DirectionalLight(0xffffff, 0.8);
    directionalLight.position.set(5, 10, 7);
    scene.add(directionalLight);

    // Grid
    const gridHelper = new THREE.GridHelper(10, 10, 0x444444, 0x222222);
    scene.add(gridHelper);

    // Notify parent that scene is ready
    onSceneReady(scene, camera);

    // Render loop
    const animate = () => {
      requestAnimationFrame(animate);
      renderer.render(scene, camera);
    };
    animate();

    // Handle resize
    const handleResize = () => {
      camera.aspect = window.innerWidth / window.innerHeight;
      camera.updateProjectionMatrix();
      renderer.setSize(window.innerWidth, window.innerHeight);
    };
    window.addEventListener('resize', handleResize);

    return () => {
      window.removeEventListener('resize', handleResize);
      renderer.dispose();
      containerRef.current?.removeChild(renderer.domElement);
    };
  }, [onSceneReady]);

  return <div ref={containerRef} style={{ width: '100vw', height: '100vh' }} />;
};
```

### Step 1.4: Camera Capture Component

**apps/frontend/src/components/CameraCapture.tsx:**

```typescript
import React, { useEffect, useRef } from 'react';

interface CameraCaptureProps {
  onFrameAvailable: (canvas: HTMLCanvasElement) => void;
  targetFPS?: number;
}

export const CameraCapture: React.FC<CameraCaptureProps> = ({
  onFrameAvailable,
  targetFPS = 30,
}) => {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const animationIdRef = useRef<number>();

  useEffect(() => {
    const startCamera = async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: {
            width: { ideal: 1280 },
            height: { ideal: 720 },
          },
        });

        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          videoRef.current.play();
        }

        // Start capture loop
        const frameInterval = 1000 / targetFPS;
        let lastFrameTime = Date.now();

        const captureFrame = () => {
          const now = Date.now();
          
          if (now - lastFrameTime >= frameInterval) {
            if (videoRef.current && canvasRef.current) {
              const ctx = canvasRef.current.getContext('2d');
              if (ctx) {
                ctx.drawImage(
                  videoRef.current,
                  0,
                  0,
                  canvasRef.current.width,
                  canvasRef.current.height
                );
                onFrameAvailable(canvasRef.current);
              }
            }
            lastFrameTime = now;
          }

          animationIdRef.current = requestAnimationFrame(captureFrame);
        };

        animationIdRef.current = requestAnimationFrame(captureFrame);
      } catch (error) {
        console.error('Camera access denied:', error);
        alert('Please allow camera access to use JARVIS');
      }
    };

    startCamera();

    return () => {
      if (animationIdRef.current) {
        cancelAnimationFrame(animationIdRef.current);
      }
      if (videoRef.current?.srcObject) {
        const tracks = (videoRef.current.srcObject as MediaStream).getTracks();
        tracks.forEach((track) => track.stop());
      }
    };
  }, [onFrameAvailable, targetFPS]);

  return (
    <>
      <video
        ref={videoRef}
        style={{ display: 'none' }}
        width={1280}
        height={720}
      />
      <canvas
        ref={canvasRef}
        width={1280}
        height={720}
        style={{ display: 'none' }}
      />
    </>
  );
};
```

### Step 1.5: Hand Tracking with MediaPipe

**apps/frontend/src/components/HandTracker.tsx:**

```typescript
import React, { useEffect, useRef } from 'react';
import { Hands, Results } from '@mediapipe/hands';
import { Camera } from '@mediapipe/camera_utils';
import * as THREE from 'three';

export interface Hand {
  handedness: 'Left' | 'Right';
  landmarks: Array<{ x: number; y: number; z: number }>;
  confidence: number;
}

interface HandTrackerProps {
  videoElement: HTMLVideoElement;
  canvasElement: HTMLCanvasElement;
  onHandsDetected: (hands: Hand[]) => void;
}

export const HandTracker: React.FC<HandTrackerProps> = ({
  videoElement,
  canvasElement,
  onHandsDetected,
}) => {
  const handsRef = useRef<Hands | null>(null);
  const cameraRef = useRef<Camera | null>(null);

  useEffect(() => {
    // Load MediaPipe Hands model
    const hands = new Hands({
      locateFile: (file) =>
        `https://cdn.jsdelivr.net/npm/@mediapipe/hands/${file}`,
    });

    hands.setOptions({
      maxNumHands: 2,
      modelComplexity: 1, // 0 = light, 1 = full
      minDetectionConfidence: 0.5,
      minTrackingConfidence: 0.5,
    });

    hands.onResults((results: Results) => {
      const detectedHands: Hand[] = [];

      if (results.multiHandLandmarks && results.multiHandedness) {
        results.multiHandLandmarks.forEach((landmarks, index) => {
          const handedness = results.multiHandedness[index].label as
            | 'Left'
            | 'Right';
          const confidence = results.multiHandedness[index].score;

          detectedHands.push({
            handedness,
            landmarks: landmarks.map((lm) => ({
              x: lm.x,
              y: lm.y,
              z: lm.z,
            })),
            confidence,
          });
        });
      }

      onHandsDetected(detectedHands);

      // Draw hand skeleton (optional, for debugging)
      drawHandSkeleton(canvasElement, results);
    });

    handsRef.current = hands;

    // Initialize camera
    const camera = new Camera(videoElement, {
      onFrame: async () => {
        await hands.send({ image: videoElement });
      },
      width: 1280,
      height: 720,
    });

    cameraRef.current = camera;
    camera.start();

    return () => {
      camera.stop();
      hands.close();
    };
  }, [videoElement, canvasElement, onHandsDetected]);

  return null;
};

function drawHandSkeleton(canvas: HTMLCanvasElement, results: Results) {
  const ctx = canvas.getContext('2d');
  if (!ctx) return;

  // Draw landmarks
  if (results.multiHandLandmarks) {
    results.multiHandLandmarks.forEach((landmarks) => {
      landmarks.forEach((lm) => {
        ctx.fillStyle = '#00ff00';
        ctx.fillRect(lm.x * canvas.width - 2, lm.y * canvas.height - 2, 4, 4);
      });

      // Draw connections
      const connections = [
        [0, 1],
        [1, 2],
        [2, 3],
        [3, 4],
        [0, 5],
        [5, 6],
        [6, 7],
        [7, 8],
        // ... all finger connections
      ];

      ctx.strokeStyle = '#00ff00';
      ctx.lineWidth = 2;
      connections.forEach(([start, end]) => {
        ctx.beginPath();
        ctx.moveTo(
          landmarks[start].x * canvas.width,
          landmarks[start].y * canvas.height
        );
        ctx.lineTo(
          landmarks[end].x * canvas.width,
          landmarks[end].y * canvas.height
        );
        ctx.stroke();
      });
    });
  }
}
```

### Step 1.6: Main App Component

**apps/frontend/src/App.tsx:**

```typescript
import React, { useState, useRef } from 'react';
import * as THREE from 'three';
import { Scene3D } from './components/Scene3D';
import { CameraCapture } from './components/CameraCapture';
import { HandTracker, Hand } from './components/HandTracker';

export const App: React.FC = () => {
  const [scene, setScene] = useState<THREE.Scene | null>(null);
  const [camera, setCamera] = useState<THREE.Camera | null>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  const handleSceneReady = (scene: THREE.Scene, camera: THREE.Camera) => {
    setScene(scene);
    setCamera(camera);

    // Add a test cube
    const geometry = new THREE.BoxGeometry();
    const material = new THREE.MeshPhongMaterial({ color: 0x0084ff });
    const cube = new THREE.Mesh(geometry, material);
    scene.add(cube);
  };

  const handleFrameAvailable = (canvas: HTMLCanvasElement) => {
    // Frame available for hand tracking
    if (canvasRef.current) {
      const ctx = canvasRef.current.getContext('2d');
      if (ctx) {
        ctx.drawImage(canvas, 0, 0);
      }
    }
  };

  const handleHandsDetected = (hands: Hand[]) => {
    console.log('Hands detected:', hands);
    // Process hand positions
  };

  return (
    <>
      <Scene3D onSceneReady={handleSceneReady} />
      <CameraCapture onFrameAvailable={handleFrameAvailable} />
      <canvas
        ref={canvasRef}
        width={1280}
        height={720}
        style={{ display: 'none' }}
      />
      {canvasRef.current && (
        <HandTracker
          videoElement={canvasRef as any}
          canvasElement={canvasRef.current}
          onHandsDetected={handleHandsDetected}
        />
      )}
    </>
  );
};
```

### Step 1.7: Testing

**Run the app:**
```bash
cd apps/frontend
npm run dev
```

**Checklist for Week 1:**
- [ ] Three.js scene renders with grid and cube
- [ ] Camera feed is captured
- [ ] MediaPipe loads without errors
- [ ] Hand landmarks are detected and logged
- [ ] FPS is 30+ in console
- [ ] Latency from camera to detection is <300ms

---

## Week 2: Gesture Recognition

### Step 2.1: Gesture Types & Utilities

**apps/frontend/src/utils/gestures.ts:**

```typescript
import * as THREE from 'three';

export enum GestureType {
  PINCH = 'pinch',
  GRAB = 'grab',
  POINT = 'point',
  OPEN = 'open',
  SWIPE = 'swipe',
  NONE = 'none',
}

export interface Gesture {
  type: GestureType;
  confidence: number;
  intensity: number;
  position: THREE.Vector3;
  handedness: 'Left' | 'Right';
  timestamp: number;
}

export interface Landmark {
  x: number;
  y: number;
  z: number;
}

export class GestureRecognizer {
  private pinchThreshold = 0.03; // 3cm in meters
  private pinchConfidenceThreshold = 0.7;

  recognizeGestures(hands: Array<any>): Gesture[] {
    return hands.map((hand) => this.classifyHand(hand));
  }

  private classifyHand(hand: any): Gesture {
    const landmarks = hand.landmarks;
    const handedness = hand.handedness;

    // Landmark indices
    const WRIST = 0;
    const THUMB_TIP = 4;
    const INDEX_TIP = 8;
    const MIDDLE_TIP = 12;
    const RING_TIP = 16;
    const PINKY_TIP = 20;
    const PALM_CENTER = 9; // Middle of palm

    // Calculate distances
    const thumbIndexDist = this.distance(
      landmarks[THUMB_TIP],
      landmarks[INDEX_TIP]
    );
    
    const thumbMiddleDist = this.distance(
      landmarks[THUMB_TIP],
      landmarks[MIDDLE_TIP]
    );

    const palmCenter = this.midpoint(landmarks[WRIST], landmarks[PALM_CENTER]);

    // Pinch gesture
    if (thumbIndexDist < this.pinchThreshold) {
      return {
        type: GestureType.PINCH,
        confidence: Math.max(0, 1 - thumbIndexDist / this.pinchThreshold),
        intensity: 1 - thumbIndexDist / this.pinchThreshold,
        position: this.landmarkToVector3(
          this.midpoint(landmarks[THUMB_TIP], landmarks[INDEX_TIP])
        ),
        handedness,
        timestamp: Date.now(),
      };
    }

    // Open hand gesture
    if (this.isHandOpen(landmarks, palmCenter)) {
      return {
        type: GestureType.OPEN,
        confidence: 0.9,
        intensity: 1,
        position: this.landmarkToVector3(palmCenter),
        handedness,
        timestamp: Date.now(),
      };
    }

    // Point gesture
    if (this.isPointing(landmarks, palmCenter)) {
      return {
        type: GestureType.POINT,
        confidence: 0.85,
        intensity: 0.5,
        position: this.landmarkToVector3(landmarks[INDEX_TIP]),
        handedness,
        timestamp: Date.now(),
      };
    }

    return {
      type: GestureType.NONE,
      confidence: 0,
      intensity: 0,
      position: this.landmarkToVector3(palmCenter),
      handedness,
      timestamp: Date.now(),
    };
  }

  private isHandOpen(landmarks: Landmark[], palmCenter: Landmark): boolean {
    const fingerTips = [4, 8, 12, 16, 20];
    const openThreshold = 0.08; // 8cm

    return fingerTips.every((tipIdx) => {
      return this.distance(palmCenter, landmarks[tipIdx]) > openThreshold;
    });
  }

  private isPointing(landmarks: Landmark[], palmCenter: Landmark): boolean {
    const indexTip = landmarks[8];
    const middleTip = landmarks[12];

    const indexExtended = this.distance(palmCenter, indexTip) > 0.12;
    const othersClose = this.distance(palmCenter, middleTip) < 0.08;

    return indexExtended && othersClose;
  }

  private distance(a: Landmark, b: Landmark): number {
    return Math.sqrt(
      Math.pow(a.x - b.x, 2) +
      Math.pow(a.y - b.y, 2) +
      Math.pow(a.z - b.z, 2)
    );
  }

  private midpoint(a: Landmark, b: Landmark): Landmark {
    return {
      x: (a.x + b.x) / 2,
      y: (a.y + b.y) / 2,
      z: (a.z + b.z) / 2,
    };
  }

  private landmarkToVector3(landmark: Landmark): THREE.Vector3 {
    // Convert from normalized coordinates to 3D space
    // Assuming camera is looking down Z axis
    // X: -1 to 1 (left to right)
    // Y: -1 to 1 (bottom to top)
    // Z: distance from camera

    return new THREE.Vector3(
      (landmark.x - 0.5) * 10, // Scale to world coordinates
      -(landmark.y - 0.5) * 10,
      landmark.z * 10
    );
  }
}
```

### Step 2.2: Update HandTracker to use GestureRecognizer

**apps/frontend/src/components/HandTracker.tsx:**

```typescript
import { GestureRecognizer, Gesture } from '../utils/gestures';

interface HandTrackerProps {
  videoElement: HTMLVideoElement;
  canvasElement: HTMLCanvasElement;
  onHandsDetected: (hands: Hand[]) => void;
  onGesturesDetected: (gestures: Gesture[]) => void; // New
}

export const HandTracker: React.FC<HandTrackerProps> = ({
  videoElement,
  canvasElement,
  onHandsDetected,
  onGesturesDetected,
}) => {
  const gestureRecognizerRef = useRef(new GestureRecognizer());

  useEffect(() => {
    // ... existing MediaPipe setup ...

    hands.onResults((results: Results) => {
      const detectedHands: Hand[] = [];

      if (results.multiHandLandmarks && results.multiHandedness) {
        results.multiHandLandmarks.forEach((landmarks, index) => {
          const handedness = results.multiHandedness[index].label as
            | 'Left'
            | 'Right';
          const confidence = results.multiHandedness[index].score;

          detectedHands.push({
            handedness,
            landmarks: landmarks.map((lm) => ({
              x: lm.x,
              y: lm.y,
              z: lm.z,
            })),
            confidence,
          });
        });

        // Recognize gestures
        const gestures = gestureRecognizerRef.current.recognizeGestures(
          detectedHands
        );
        onGesturesDetected(gestures);
      }

      onHandsDetected(detectedHands);
    });

    // ... rest of setup ...
  }, []);

  return null;
};
```

### Step 2.3: Gesture Visualization

Add gesture debugging UI to see what's being detected:

**apps/frontend/src/components/GestureDebug.tsx:**

```typescript
import React from 'react';
import { Gesture, GestureType } from '../utils/gestures';

interface GestureDebugProps {
  gestures: Gesture[];
}

export const GestureDebug: React.FC<GestureDebugProps> = ({ gestures }) => {
  return (
    <div
      style={{
        position: 'fixed',
        top: 20,
        right: 20,
        background: 'rgba(0,0,0,0.8)',
        color: '#0f0',
        padding: '15px',
        fontFamily: 'monospace',
        fontSize: '12px',
        zIndex: 1000,
      }}
    >
      <div>Detected Gestures: {gestures.length}</div>
      {gestures.map((gesture, idx) => (
        <div key={idx}>
          {gesture.handedness} {gesture.type} (conf: {gesture.confidence.toFixed(2)})
        </div>
      ))}
    </div>
  );
};
```

**Update App.tsx:**

```typescript
const [gestures, setGestures] = useState<Gesture[]>([]);

return (
  <>
    <Scene3D onSceneReady={handleSceneReady} />
    <CameraCapture onFrameAvailable={handleFrameAvailable} />
    <GestureDebug gestures={gestures} />
    {canvasRef.current && (
      <HandTracker
        videoElement={canvasRef as any}
        canvasElement={canvasRef.current}
        onHandsDetected={handleHandsDetected}
        onGesturesDetected={setGestures}
      />
    )}
  </>
);
```

### Step 2.4: Testing

**Checklist for Week 2:**
- [ ] Pinch gesture is detected consistently
- [ ] Open hand gesture is detected
- [ ] Point gesture is detected
- [ ] Confidence scores make sense
- [ ] Gesture debug UI shows changes in real-time
- [ ] No lag between hand movement and gesture update

---

## Week 3: Interaction Engine & Window Creation

### Step 3.1: Floating Window Component

**apps/frontend/src/components/FloatingWindow.tsx:**

```typescript
import React, { useState } from 'react';
import * as THREE from 'three';

export interface FloatingWindowState {
  id: string;
  position: THREE.Vector3;
  scale: THREE.Vector3;
  title: string;
  content: React.ReactNode;
  isMinimized: boolean;
  zIndex: number;
}

interface FloatingWindowProps {
  window: FloatingWindowState;
  onClose: (id: string) => void;
  onMinimize: (id: string) => void;
  onBringToFront: (id: string) => void;
}

export const FloatingWindow: React.FC<FloatingWindowProps> = ({
  window,
  onClose,
  onMinimize,
  onBringToFront,
}) => {
  return (
    <div
      onClick={() => onBringToFront(window.id)}
      style={{
        position: 'fixed',
        width: '400px',
        background: '#1a1a2e',
        border: '2px solid #0084ff',
        borderRadius: '8px',
        padding: '15px',
        color: '#fff',
        zIndex: window.zIndex,
        boxShadow: '0 0 20px rgba(0,132,255,0.3)',
      }}
    >
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginBottom: '10px',
          borderBottom: '1px solid #0084ff',
          paddingBottom: '10px',
        }}
      >
        <span style={{ fontWeight: 'bold' }}>{window.title}</span>
        <div>
          <button
            onClick={() => onMinimize(window.id)}
            style={{
              background: 'none',
              border: 'none',
              color: '#0084ff',
              cursor: 'pointer',
              marginRight: '10px',
            }}
          >
            −
          </button>
          <button
            onClick={() => onClose(window.id)}
            style={{
              background: 'none',
              border: 'none',
              color: '#0084ff',
              cursor: 'pointer',
            }}
          >
            ✕
          </button>
        </div>
      </div>
      <div>{window.content}</div>
    </div>
  );
};
```

### Step 3.2: Window Manager (State Management)

**apps/frontend/src/utils/windowManager.ts:**

```typescript
import * as THREE from 'three';

export interface FloatingWindow {
  id: string;
  position: THREE.Vector3;
  scale: THREE.Vector3;
  rotation: THREE.Euler;
  title: string;
  content: React.ReactNode;
  isMinimized: boolean;
  zIndex: number;
  aspect: number; // width/height
}

export class WindowManager {
  private windows: Map<string, FloatingWindow> = new Map();
  private nextZIndex: number = 1;
  private scene: THREE.Scene;
  private windowMeshes: Map<string, THREE.Mesh> = new Map();

  constructor(scene: THREE.Scene) {
    this.scene = scene;
  }

  createWindow(
    id: string,
    title: string,
    content: React.ReactNode,
    initialPos: THREE.Vector3 = new THREE.Vector3(0, 0, 0)
  ): FloatingWindow {
    const window: FloatingWindow = {
      id,
      title,
      content,
      position: initialPos.clone(),
      scale: new THREE.Vector3(1.5, 0.844, 0.1), // 16:9 aspect
      rotation: new THREE.Euler(),
      zIndex: this.nextZIndex++,
      isMinimized: false,
      aspect: 16 / 9,
    };

    this.windows.set(id, window);

    // Create 3D mesh for window
    const mesh = this.createWindowMesh(window);
    this.windowMeshes.set(id, mesh);
    this.scene.add(mesh);

    return window;
  }

  private createWindowMesh(window: FloatingWindow): THREE.Mesh {
    const geometry = new THREE.PlaneGeometry(1, 1 / window.aspect);
    const material = new THREE.MeshPhongMaterial({
      color: 0x1a1a2e,
      emissive: 0x0084ff,
      emissiveIntensity: 0.1,
      side: THREE.DoubleSide,
    });

    const mesh = new THREE.Mesh(geometry, material);
    mesh.position.copy(window.position);
    mesh.scale.copy(window.scale);
    mesh.userData.windowId = window.id;
    mesh.userData.isGrabbable = true;

    return mesh;
  }

  moveWindow(id: string, newPosition: THREE.Vector3): void {
    const window = this.windows.get(id);
    if (window) {
      window.position.copy(newPosition);
      const mesh = this.windowMeshes.get(id);
      if (mesh) {
        mesh.position.copy(newPosition);
      }
    }
  }

  resizeWindow(id: string, scale: number): void {
    const window = this.windows.get(id);
    if (window) {
      window.scale.multiplyScalar(scale);
      const mesh = this.windowMeshes.get(id);
      if (mesh) {
        mesh.scale.copy(window.scale);
      }
    }
  }

  getWindow(id: string): FloatingWindow | undefined {
    return this.windows.get(id);
  }

  getAllWindows(): FloatingWindow[] {
    return Array.from(this.windows.values());
  }

  closeWindow(id: string): void {
    this.windows.delete(id);
    const mesh = this.windowMeshes.get(id);
    if (mesh) {
      this.scene.remove(mesh);
    }
    this.windowMeshes.delete(id);
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
      const mesh = this.windowMeshes.get(id);
      if (mesh) {
        mesh.visible = false;
      }
    }
  }

  restoreWindow(id: string): void {
    const window = this.windows.get(id);
    if (window) {
      window.isMinimized = false;
      const mesh = this.windowMeshes.get(id);
      if (mesh) {
        mesh.visible = true;
      }
    }
  }
}
```

### Step 3.3: Interaction Engine

**apps/frontend/src/utils/interactionEngine.ts:**

```typescript
import * as THREE from 'three';
import { Gesture, GestureType } from './gestures';
import { WindowManager } from './windowManager';

export interface InteractionEvent {
  type: 'grab' | 'release' | 'move' | 'resize';
  targetId: string;
  gesture: Gesture;
  newPosition?: THREE.Vector3;
  scaleChange?: number;
}

export class InteractionEngine {
  private raycaster: THREE.Raycaster = new THREE.Raycaster();
  private camera: THREE.Camera;
  private scene: THREE.Scene;
  private windowManager: WindowManager;
  private grabbedObjects: Map<
    string,
    {
      object: THREE.Object3D;
      grabOffset: THREE.Vector3;
      lastIntensity: number;
    }
  > = new Map();

  constructor(
    scene: THREE.Scene,
    camera: THREE.Camera,
    windowManager: WindowManager
  ) {
    this.scene = scene;
    this.camera = camera;
    this.windowManager = windowManager;
  }

  processGesture(gesture: Gesture): InteractionEvent[] {
    const events: InteractionEvent[] = [];

    // Convert hand position to NDC (normalized device coordinates)
    const ndc = new THREE.Vector2(gesture.position.x / 5, gesture.position.y / 5);

    // Raycast
    this.raycaster.setFromCamera(ndc, this.camera);
    const intersects = this.raycaster.intersectObjects(this.scene.children);

    if (gesture.type === GestureType.PINCH) {
      const interactiveObjects = intersects.filter(
        (obj) => obj.object.userData.isGrabbable
      );

      if (interactiveObjects.length > 0) {
        const targetObject = interactiveObjects[0].object;
        const windowId = targetObject.userData.windowId;

        if (!this.grabbedObjects.has(windowId)) {
          // Start grab
          this.grabbedObjects.set(windowId, {
            object: targetObject,
            grabOffset: gesture.position
              .clone()
              .sub(targetObject.position),
            lastIntensity: gesture.intensity,
          });

          events.push({
            type: 'grab',
            targetId: windowId,
            gesture,
          });
        } else {
          // Continue grab or resize
          const grabbed = this.grabbedObjects.get(windowId)!;
          const newPosition = gesture.position
            .clone()
            .sub(grabbed.grabOffset);

          // Check if pinch intensity changed (resize)
          const intensityDelta =
            gesture.intensity - grabbed.lastIntensity;
          if (Math.abs(intensityDelta) > 0.05) {
            events.push({
              type: 'resize',
              targetId: windowId,
              gesture,
              scaleChange: 1 + intensityDelta,
            });

            this.windowManager.resizeWindow(windowId, 1 + intensityDelta);
            grabbed.lastIntensity = gesture.intensity;
          } else {
            // Move window
            events.push({
              type: 'move',
              targetId: windowId,
              gesture,
              newPosition,
            });

            this.windowManager.moveWindow(windowId, newPosition);
            grabbed.object.position.copy(newPosition);
          }
        }
      }
    }

    if (gesture.type === GestureType.OPEN && gesture.confidence > 0.8) {
      // Release all grabbed objects
      this.grabbedObjects.forEach((grabbed, windowId) => {
        events.push({
          type: 'release',
          targetId: windowId,
          gesture,
        });
      });
      this.grabbedObjects.clear();
    }

    return events;
  }
}
```

### Step 3.4: Update App Component

**apps/frontend/src/App.tsx:**

Update to integrate WindowManager and InteractionEngine:

```typescript
import { WindowManager } from './utils/windowManager';
import { InteractionEngine } from './utils/interactionEngine';

export const App: React.FC = () => {
  const [scene, setScene] = useState<THREE.Scene | null>(null);
  const [camera, setCamera] = useState<THREE.Camera | null>(null);
  const [windowManager, setWindowManager] = useState<WindowManager | null>(null);
  const [interactionEngine, setInteractionEngine] = useState<InteractionEngine | null>(null);
  const [windows, setWindows] = useState<FloatingWindowState[]>([]);

  const handleSceneReady = (scene: THREE.Scene, camera: THREE.Camera) => {
    setScene(scene);
    setCamera(camera);

    // Create window manager
    const wm = new WindowManager(scene);
    setWindowManager(wm);

    // Create interaction engine
    const ie = new InteractionEngine(scene, camera, wm);
    setInteractionEngine(ie);

    // Create initial window
    const window = wm.createWindow(
      'window-1',
      'Test Window',
      <div>Hello 3D World!</div>,
      new THREE.Vector3(0, 0, -3)
    );

    setWindows([window]);
  };

  const handleGesturesDetected = (gestures: Gesture[]) => {
    if (!interactionEngine) return;

    gestures.forEach((gesture) => {
      if (gesture.type !== GestureType.NONE) {
        const events = interactionEngine.processGesture(gesture);

        // Handle events (update UI, sync to backend, etc.)
        events.forEach((event) => {
          if (event.type === 'move' && event.newPosition && windowManager) {
            const window = windowManager.getWindow(event.targetId);
            if (window) {
              const updatedWindow = { ...window, position: event.newPosition };
              setWindows((prev) =>
                prev.map((w) => (w.id === event.targetId ? updatedWindow : w))
              );
            }
          }
        });
      }
    });
  };

  return (
    <>
      <Scene3D onSceneReady={handleSceneReady} />
      <CameraCapture onFrameAvailable={handleFrameAvailable} />
      <GestureDebug gestures={gestures} />
      
      {/* Render floating windows */}
      {windows.map((window) => (
        <FloatingWindow
          key={window.id}
          window={window}
          onClose={(id) => {
            windowManager?.closeWindow(id);
            setWindows((prev) => prev.filter((w) => w.id !== id));
          }}
          onMinimize={(id) => {
            windowManager?.minimizeWindow(id);
          }}
          onBringToFront={(id) => {
            windowManager?.bringToFront(id);
          }}
        />
      ))}

      {canvasRef.current && (
        <HandTracker
          videoElement={canvasRef as any}
          canvasElement={canvasRef.current}
          onHandsDetected={handleHandsDetected}
          onGesturesDetected={handleGesturesDetected}
        />
      )}
    </>
  );
};
```

### Step 3.5: Testing

**Checklist for Week 3:**
- [ ] Floating window renders in 3D space
- [ ] Pinch gesture grabs window
- [ ] Open hand releases window
- [ ] Window follows hand position when grabbed
- [ ] Multiple windows can be created
- [ ] Windows can be brought to front

---

## Week 4: Polish & Prepare for Apps

### Step 4.1: Animation & Smoothing

Add smooth animations to window movements:

**apps/frontend/src/utils/animation.ts:**

```typescript
import * as THREE from 'three';

export class AnimationController {
  private animations: Map<
    string,
    {
      start: THREE.Vector3;
      end: THREE.Vector3;
      duration: number;
      startTime: number;
      object: THREE.Object3D;
      onComplete?: () => void;
    }
  > = new Map();

  addAnimation(
    id: string,
    object: THREE.Object3D,
    endPosition: THREE.Vector3,
    duration: number = 0.3,
    onComplete?: () => void
  ): void {
    this.animations.set(id, {
      start: object.position.clone(),
      end: endPosition,
      duration,
      startTime: Date.now(),
      object,
      onComplete,
    });
  }

  update(): void {
    const now = Date.now();

    this.animations.forEach((anim, id) => {
      const elapsed = (now - anim.startTime) / 1000;
      const progress = Math.min(elapsed / anim.duration, 1);

      // Easing function (ease-out cubic)
      const eased = 1 - Math.pow(1 - progress, 3);

      anim.object.position.lerpVectors(anim.start, anim.end, eased);

      if (progress >= 1) {
        anim.object.position.copy(anim.end);
        anim.onComplete?.();
        this.animations.delete(id);
      }
    });
  }
}
```

### Step 4.2: Logging & Debugging

**apps/frontend/src/utils/logger.ts:**

```typescript
export interface PerformanceMetrics {
  handDetectionLatency: number;
  renderFPS: number;
  gestureRecognitionLatency: number;
  interactionLatency: number;
}

export class PerformanceLogger {
  private metrics: PerformanceMetrics = {
    handDetectionLatency: 0,
    renderFPS: 60,
    gestureRecognitionLatency: 0,
    interactionLatency: 0,
  };

  private frameCount = 0;
  private lastFrameTime = Date.now();

  logMetric(key: keyof PerformanceMetrics, value: number): void {
    this.metrics[key] = value;
  }

  getMetrics(): PerformanceMetrics {
    return { ...this.metrics };
  }

  updateFPS(): void {
    this.frameCount++;
    const now = Date.now();
    if (now - this.lastFrameTime >= 1000) {
      this.metrics.renderFPS = this.frameCount;
      this.frameCount = 0;
      this.lastFrameTime = now;
    }
  }

  logToConsole(): void {
    console.table(this.metrics);
  }
}
```

### Step 4.3: Testing Checklist

Complete testing before moving to Phase 2:

- [ ] Hand detection works in various lighting conditions
- [ ] Gesture recognition accuracy > 90%
- [ ] Window interactions feel responsive (<100ms latency)
- [ ] 60fps rendering with multiple windows
- [ ] No memory leaks over 10-minute sessions
- [ ] Code is organized and documented

---

## Next Steps: Phase 2+

Once Phase 1 is complete, proceed with:

**Phase 2 (Weeks 5-7): Advanced Gestures**
- Multi-hand gestures (two-hand pinch/zoom)
- Swipe gesture for panning
- More complex interactions

**Phase 3 (Weeks 8-10): Applications**
- LLM Chat App with Google API integration
- Web Search App
- Notes App with persistence
- Dashboard App with system stats

**Phase 4 (Weeks 11-13): Backend & Multi-User**
- WebSocket server for real-time sync
- User session management
- Window state persistence
- Multi-user hand visibility

**Phase 5 (Weeks 14-16): Optimization & Polish**
- Performance optimization
- Edge case handling
- Comprehensive testing
- Documentation
- Demo video

---

**You've got this. Start coding!**

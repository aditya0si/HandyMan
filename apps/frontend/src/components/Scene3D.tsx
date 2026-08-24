import { useEffect, useRef } from 'react';
import * as THREE from 'three';
import { dumpPerf, recordPerf } from '../utils/perfDebug';

/** M14 (D3): pixel-ratio cap — a 3x hidpi screen renders 2.25x the pixels
 *  of 2x for no visual gain in a debug-overlay app (documented tradeoff). */
export const MAX_PIXEL_RATIO = 2;

export interface Scene3DProps {
  /** Called once the scene, camera and renderer are set up (used to add objects). */
  onSceneReady?: (scene: THREE.Scene, camera: THREE.PerspectiveCamera) => void;
  /** Called roughly once per second with the measured render FPS. */
  onFpsUpdate?: (fps: number) => void;
  /** Called every render frame with the rAF timestamp (animation + metrics ticks). */
  onFrame?: (nowMs: number) => void;
}

/**
 * Vanilla Three.js scene (guide step 1.3):
 * pure-black void, perspective camera at z=5, dim ambient + directional
 * light, resize handling, rAF render loop with per-second FPS logging,
 * and full cleanup on unmount (StrictMode-safe).
 */
export function Scene3D({ onSceneReady, onFpsUpdate, onFrame }: Scene3DProps) {
  const containerRef = useRef<HTMLDivElement>(null);

  // Keep latest callbacks in refs so the effect runs exactly once and is not
  // restarted by parent re-renders.
  const onSceneReadyRef = useRef(onSceneReady);
  const onFpsUpdateRef = useRef(onFpsUpdate);
  const onFrameRef = useRef(onFrame);
  onSceneReadyRef.current = onSceneReady;
  onFpsUpdateRef.current = onFpsUpdate;
  onFrameRef.current = onFrame;

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const scene = new THREE.Scene();
    // Obsidian restyle: pure-black void + black fog. The fog (8→18) keeps a
    // soft depth cue — far window panes recede into the void instead of
    // crisply floating — with no colored haze in the read.
    scene.background = new THREE.Color(0x000000);
    scene.fog = new THREE.Fog(0x000000, 8, 18);

    const camera = new THREE.PerspectiveCamera(
      75,
      window.innerWidth / window.innerHeight,
      0.1,
      1000,
    );
    camera.position.z = 5;

    // M14 (D3): high-performance hint (dual-GPU laptops pick the discrete
    // card) + the pixel-ratio cap.
    const renderer = new THREE.WebGLRenderer({
      antialias: true,
      powerPreference: 'high-performance',
    });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, MAX_PIXEL_RATIO));
    renderer.setSize(window.innerWidth, window.innerHeight);
    container.appendChild(renderer.domElement);

    // Lighting — Obsidian restyle: dim neutral key so the void stays black;
    // cards carry their own emissive/interaction glow, not scene light.
    const ambientLight = new THREE.AmbientLight(0xffffff, 0.3);
    scene.add(ambientLight);

    const directionalLight = new THREE.DirectionalLight(0xdfe8ff, 0.5);
    directionalLight.position.set(5, 10, 7);
    scene.add(directionalLight);

    // Obsidian restyle: the cyan floor grid is GONE — the requested look is
    // a pure black void. Spatial grounding comes from the cards, the obsidian
    // core orb and the whisper-thin HoloDecor rings/spokes instead.

    onSceneReadyRef.current?.(scene, camera);

    // Render loop with FPS accounting (logged once per second). The rAF
    // timestamp doubles as the animation/metrics tick clock (same timebase
    // as performance.now()), so onFrame fires BEFORE render — animation
    // writes land in the same frame they are drawn.
    let frames = 0;
    let lastFpsLog = performance.now();
    let rafId = 0;

    const animate = (now: number) => {
      rafId = requestAnimationFrame(animate);
      onFrameRef.current?.(now);
      const renderStart = performance.now();
      renderer.render(scene, camera);
      recordPerf('render', performance.now() - renderStart); // M14 (D5)

      frames += 1;
      const elapsed = now - lastFpsLog;
      if (elapsed >= 1000) {
        const fps = Math.round((frames * 1000) / elapsed);
        console.log(`[Scene3D] FPS: ${fps}`);
        onFpsUpdateRef.current?.(fps);
        dumpPerf(now); // M14 (D4): rides the same 1 s gate, no-op unless ?perf=1
        frames = 0;
        lastFpsLog = now;
      }
    };
    // Kick off the loop; the first timestamp mirrors the rAF clock base.
    animate(performance.now());

    const handleResize = () => {
      camera.aspect = window.innerWidth / window.innerHeight;
      camera.updateProjectionMatrix();
      renderer.setSize(window.innerWidth, window.innerHeight);
    };
    window.addEventListener('resize', handleResize);

    return () => {
      window.removeEventListener('resize', handleResize);
      cancelAnimationFrame(rafId);

      // Dispose GPU resources (geometries, materials) added to the scene.
      scene.traverse((obj) => {
        const mesh = obj as THREE.Mesh;
        if (mesh.geometry) mesh.geometry.dispose();
        if (mesh.material) {
          if (Array.isArray(mesh.material)) {
            mesh.material.forEach((m) => m.dispose());
          } else {
            mesh.material.dispose();
          }
        }
      });

      renderer.dispose();
      if (renderer.domElement.parentNode === container) {
        container.removeChild(renderer.domElement);
      }
    };
  }, []);

  return (
    <div
      ref={containerRef}
      style={{ position: 'fixed', inset: 0, zIndex: 0, overflow: 'hidden' }}
    />
  );
}

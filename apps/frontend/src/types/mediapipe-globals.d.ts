/**
 * Typings for the legacy MediaPipe solution scripts (@mediapipe/hands,
 * @mediapipe/camera_utils). Those packages are Closure-compiled bundles that
 * expose their classes on `window` when imported for side effects; they do
 * not provide real ESM exports.
 */
import type { Hands } from '@mediapipe/hands';
import type { Camera } from '@mediapipe/camera_utils';

declare global {
  interface Window {
    Hands: typeof Hands;
    Camera: typeof Camera;
  }
}

export {};

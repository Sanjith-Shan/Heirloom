/* face-api.js wrapper — extract a 128-d face descriptor client-side and
 * compare against a stored reference. Models load lazily from /models/.
 *
 * Note: this is identity *matching*, not anti-spoofing. Holding up a photo of
 * the user would still pass. Production would layer a real liveness SDK on top
 * (IDLive Face, Facia, etc.). For Demo Day this is sufficient — the visible
 * "Identity confirmed ✓" moment is the point.
 */

import * as faceapi from "face-api.js";

let modelsLoaded = false;
let loadingPromise: Promise<void> | null = null;

export const FACE_MATCH_THRESHOLD = 0.6;

export async function loadFaceModels(): Promise<void> {
  if (modelsLoaded) return;
  if (loadingPromise) return loadingPromise;
  loadingPromise = (async () => {
    await Promise.all([
      faceapi.nets.ssdMobilenetv1.loadFromUri("/models"),
      faceapi.nets.faceLandmark68Net.loadFromUri("/models"),
      faceapi.nets.faceRecognitionNet.loadFromUri("/models"),
    ]);
    modelsLoaded = true;
  })();
  return loadingPromise;
}

export async function getFaceDescriptor(
  input: HTMLVideoElement | HTMLCanvasElement | HTMLImageElement,
): Promise<Float32Array | null> {
  await loadFaceModels();
  const detection = await faceapi
    .detectSingleFace(input)
    .withFaceLandmarks()
    .withFaceDescriptor();
  return detection?.descriptor ?? null;
}

export function descriptorDistance(a: Float32Array | number[], b: Float32Array | number[]): number {
  const ax = a instanceof Float32Array ? a : Float32Array.from(a);
  const bx = b instanceof Float32Array ? b : Float32Array.from(b);
  return faceapi.euclideanDistance(ax, bx);
}

export function isMatch(distance: number, threshold = FACE_MATCH_THRESHOLD): boolean {
  return distance < threshold;
}

export function descriptorToArray(d: Float32Array): number[] {
  return Array.from(d);
}

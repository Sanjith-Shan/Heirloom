import { useEffect, useRef, useState } from "react";
import { sha256Hex } from "@/lib/crypto";
import { getFaceDescriptor, loadFaceModels } from "@/lib/faceMatch";

interface CaptureResult {
  hash: string;
  canvas: HTMLCanvasElement;
  descriptor: Float32Array | null;
  faceDetected: boolean;
}

interface Props {
  onCapture: (info: CaptureResult) => void;
  /** When true, the component runs face-api.js after capture and includes the descriptor. */
  extractDescriptor?: boolean;
}

export default function CameraCapture({ onCapture, extractDescriptor = true }: Props) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [modelStatus, setModelStatus] = useState<"idle" | "loading" | "ready">("idle");
  const [working, setWorking] = useState(false);

  useEffect(() => {
    if (!extractDescriptor) return;
    setModelStatus("loading");
    loadFaceModels()
      .then(() => setModelStatus("ready"))
      .catch((e) => setError("face-api models failed to load: " + (e?.message ?? e)));
  }, [extractDescriptor]);

  useEffect(() => {
    return () => {
      stream?.getTracks().forEach((t) => t.stop());
    };
  }, [stream]);

  async function start() {
    setError(null);
    if (!navigator.mediaDevices?.getUserMedia) {
      setError("This browser doesn't expose getUserMedia. Try a different browser.");
      return;
    }
    // Progressive fallback. Macbook built-in cams often aren't tagged as
    // 'user'-facing, so the strict constraint throws NotFoundError. Each
    // attempt is more permissive than the last.
    const attempts: MediaStreamConstraints[] = [
      { video: { facingMode: "user", width: { ideal: 640 }, height: { ideal: 480 } }, audio: false },
      { video: { facingMode: { ideal: "user" } }, audio: false },
      { video: true, audio: false },
    ];
    let lastErr: any = null;
    for (const constraints of attempts) {
      try {
        const m = await navigator.mediaDevices.getUserMedia(constraints);
        if (videoRef.current) {
          videoRef.current.srcObject = m;
          await videoRef.current.play();
        }
        setStream(m);
        return;
      } catch (e: any) {
        lastErr = e;
        // Permission denial / dismissed prompt — no point trying other constraints.
        if (e?.name === "NotAllowedError" || e?.name === "SecurityError") break;
      }
    }
    const name = lastErr?.name || "Error";
    const msg = lastErr?.message || String(lastErr);
    if (name === "NotAllowedError") {
      setError("Camera permission denied. On macOS: System Settings → Privacy & Security → Camera, then enable your browser. Reload the page after.");
    } else if (name === "NotFoundError" || name === "OverconstrainedError") {
      setError("No camera found. Check that one is connected and not in use by another app.");
    } else if (name === "NotReadableError") {
      setError("Camera is in use by another app (Zoom / FaceTime / Photo Booth?). Close it and retry.");
    } else {
      setError(`${name}: ${msg}`);
    }
  }

  async function capture() {
    if (!videoRef.current) return;
    setWorking(true);
    try {
      const v = videoRef.current;
      const canvas = document.createElement("canvas");
      canvas.width = v.videoWidth || 640;
      canvas.height = v.videoHeight || 480;
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      // Mirror so the user sees themselves in the right orientation
      ctx.translate(canvas.width, 0);
      ctx.scale(-1, 1);
      ctx.drawImage(v, 0, 0, canvas.width, canvas.height);

      // Extract descriptor BEFORE stopping the stream (canvas works either way,
      // but we want to surface "face not detected" with the camera still running
      // so the user can re-try).
      let descriptor: Float32Array | null = null;
      if (extractDescriptor) {
        descriptor = await getFaceDescriptor(canvas);
      }

      const blob = await new Promise<Blob>((resolve) =>
        canvas.toBlob((b) => resolve(b!), "image/jpeg", 0.7),
      );
      const buf = await blob.arrayBuffer();
      const hash = await sha256Hex(buf);

      stream?.getTracks().forEach((t) => t.stop());
      setStream(null);

      onCapture({
        hash,
        canvas,
        descriptor,
        faceDetected: extractDescriptor ? descriptor !== null : true,
      });
    } finally {
      setWorking(false);
    }
  }

  const showLoadingHint = extractDescriptor && modelStatus !== "ready" && !error;

  return (
    <div className="flex flex-col items-center gap-4">
      <div className="relative w-full max-w-sm aspect-[4/3] rounded-2xl border border-neutral-800 bg-neutral-950 overflow-hidden">
        {!stream && (
          <div className="absolute inset-0 grid place-items-center text-neutral-500 text-sm text-center px-6">
            Tap "Open camera" to start.<br />
            <span className="text-xs">
              The photo never leaves your device — only its hash and a face descriptor are sent.
            </span>
          </div>
        )}
        <video
          ref={videoRef}
          autoPlay
          playsInline
          muted
          className={"w-full h-full object-cover scale-x-[-1] " + (stream ? "" : "hidden")}
        />
      </div>

      {showLoadingHint && (
        <div className="text-xs text-neutral-500">
          {modelStatus === "loading" ? "Loading face-recognition models (~12 MB, one-time)…" : ""}
        </div>
      )}
      {error && <div className="text-sm text-red-400">{error}</div>}

      {!stream ? (
        <button
          onClick={start}
          className="btn-primary"
          disabled={extractDescriptor && modelStatus === "loading"}
        >
          Open camera
        </button>
      ) : (
        <button onClick={capture} className="btn-primary" disabled={working}>
          {working ? "Analyzing…" : "Take selfie"}
        </button>
      )}
    </div>
  );
}

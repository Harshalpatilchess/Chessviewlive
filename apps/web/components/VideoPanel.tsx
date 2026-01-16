"use client";

import { useCallback, useEffect, useRef, useState } from "react";

const videoConstraints: MediaTrackConstraints = {
  width: { ideal: 1920 },
  height: { ideal: 1080 },
  frameRate: { ideal: 30, max: 30 },
  facingMode: "environment",
};

const audioConstraints: MediaTrackConstraints = {
  echoCancellation: true,
  noiseSuppression: true,
  autoGainControl: true,
};

const constraints: MediaStreamConstraints = {
  video: videoConstraints,
  audio: audioConstraints,
};

const VideoPanel = () => {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [isStarting, setIsStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const startPreview = useCallback(async () => {
    if (isStarting || stream) {
      return;
    }

    setError(null);

    if (typeof navigator === "undefined" || !navigator.mediaDevices?.getUserMedia) {
      setError("Camera preview is only available in supported browsers.");
      return;
    }

    try {
      setIsStarting(true);
      const nextStream = await navigator.mediaDevices.getUserMedia(constraints);
      setStream(nextStream);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unable to access camera.";
      setError(message);
    } finally {
      setIsStarting(false);
    }
  }, [isStarting, stream]);

  useEffect(() => {
    const videoEl = videoRef.current;

    if (!videoEl) {
      return;
    }

    if (stream && videoEl) {
      videoEl.srcObject = stream;
      videoEl.play().catch(() => {
        /* Autoplay policies may block play until user interaction. */
      });
    }

    if (!stream && videoEl && videoEl.srcObject) {
      videoEl.srcObject = null;
    }

    return () => {
      if (videoEl && videoEl.srcObject === stream) {
        videoEl.srcObject = null;
      }
      stream?.getTracks().forEach((track) => track.stop());
    };
  }, [stream]);

  return (
    <div className="flex h-full w-full flex-col gap-2">
      <button type="button" onClick={startPreview} disabled={isStarting}>
        Go live (preview)
      </button>
      <div className="relative flex-1">
        <video
          id="preview"
          ref={videoRef}
          playsInline
          autoPlay
          muted
          controls={false}
          style={{ width: "100%", height: "100%", objectFit: "cover" }}
        />
      </div>
      {error ? <p className="text-xs text-red-400">{error}</p> : null}
    </div>
  );
};

export default VideoPanel;

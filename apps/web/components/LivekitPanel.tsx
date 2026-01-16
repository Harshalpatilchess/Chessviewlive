"use client";

import { useEffect, useRef, useState } from "react";
import {
  Track,
  createLocalTracks,
  Room,
  RoomEvent,
  type LocalTrack,
  type RemoteTrack,
} from "livekit-client";

const LK_URL = process.env.NEXT_PUBLIC_LIVEKIT_URL;

type RoomEventHandlers = {
  trackSubscribed?: (track: RemoteTrack) => void;
  trackUnsubscribed?: (track: RemoteTrack) => void;
  disconnected?: () => void;
};

function attach(
  track: import("livekit-client").RemoteTrack | import("livekit-client").LocalTrack,
  refs: { video: HTMLVideoElement | null; audio: HTMLAudioElement | null }
) {
  if (track.kind === Track.Kind.Video && refs.video) track.attach(refs.video);
  if (track.kind === Track.Kind.Audio && refs.audio) track.attach(refs.audio);
}

export default function LivekitPanel() {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const roomRef = useRef<Room | null>(null);
  const handlersRef = useRef<RoomEventHandlers>({});
  const localTracksRef = useRef<LocalTrack[]>([]);
  const attachedRemoteTracksRef = useRef<Set<RemoteTrack>>(new Set());
  const isMountedRef = useRef(true);

  const [isPublisher, setIsPublisher] = useState(false);
  const [roomName, setRoomName] = useState<string>("cv-live-test");
  const [publishing, setPublishing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [viewerMuted, setViewerMuted] = useState(true);
  const [live, setLive] = useState(false);
  const [publishSecret, setPublishSecret] = useState("");
  const [paramsReady, setParamsReady] = useState(false);

  useEffect(() => {
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }
    const qp = new URLSearchParams(window.location.search);
    const r = qp.get("room") || process.env.NEXT_PUBLIC_LIVEKIT_ROOM || "cv-live-test";
    setRoomName(r);
    const isPub = qp.get("publish") === "1";
    const secret = qp.get("secret") || "";
    setIsPublisher(isPub);
    setPublishSecret(secret);
    setParamsReady(true);
  }, []);

  useEffect(() => {
    if (!paramsReady) {
      return;
    }

    let disposed = false;

    async function run() {
      if (!LK_URL) {
        if (!disposed && isMountedRef.current) {
          setError("Missing NEXT_PUBLIC_LIVEKIT_URL");
        }
        return;
      }

      if (!disposed && isMountedRef.current) {
        setError(null);
      }

      // build headers for publish
      const headers: HeadersInit = {};
      if (isPublisher && publishSecret) {
        headers["x-publish-password"] = publishSecret;
      }

      const identity = `web-${Math.random().toString(36).slice(2, 8)}`;
      const url = `/api/token?room=${encodeURIComponent(roomName)}&identity=${identity}${isPublisher ? "&publish=1" : ""}`;
      const tokenRes = await fetch(url, { headers });
      if (!tokenRes.ok) throw new Error("token fetch failed");
      const { token } = await tokenRes.json();
      if (typeof token !== "string") {
        throw new Error("Token missing in response");
      }

      try {
        const nextRoom = new Room();
        await nextRoom.connect(LK_URL!, token);
        if (disposed) {
          await nextRoom.disconnect();
          return;
        }

        roomRef.current = nextRoom;

        nextRoom.remoteParticipants.forEach((participant) => {
          participant.trackPublications.forEach((publication) => {
            const remoteTrack = publication.track;
            if (remoteTrack) {
              attach(remoteTrack, {
                video: videoRef.current,
                audio: audioRef.current,
              });
              attachedRemoteTracksRef.current.add(remoteTrack);
            }
          });
        });

        const handleTrackSubscribed = (track: RemoteTrack) => {
          attach(track, { video: videoRef.current, audio: audioRef.current });
          attachedRemoteTracksRef.current.add(track);
        };

        const handleTrackUnsubscribed = (track: RemoteTrack) => {
          if (videoRef.current) {
            track.detach(videoRef.current);
          }
          if (audioRef.current) {
            track.detach(audioRef.current);
          }
          attachedRemoteTracksRef.current.delete(track);
        };

        const handleDisconnected = () => {
          attachedRemoteTracksRef.current.forEach((remoteTrack) => {
            remoteTrack.detach();
          });
          attachedRemoteTracksRef.current.clear();
          roomRef.current = null;
          if (isMountedRef.current) {
            setLive(false);
          }
        };

        handlersRef.current = {
          trackSubscribed: handleTrackSubscribed,
          trackUnsubscribed: handleTrackUnsubscribed,
          disconnected: handleDisconnected,
        };

        nextRoom.on(RoomEvent.TrackSubscribed, handleTrackSubscribed);
        nextRoom.on(RoomEvent.TrackUnsubscribed, handleTrackUnsubscribed);
        nextRoom.on(RoomEvent.Disconnected, handleDisconnected);
      } catch (e) {
        const message = e instanceof Error ? e.message : "connect failed";
        if (!disposed && isMountedRef.current) {
          setError(message);
        }
      }
    }

    run();

    const attachedRemoteTracks = attachedRemoteTracksRef.current;

    return () => {
      disposed = true;

      localTracksRef.current.forEach((track) => {
        try {
          track.detach();
          track.stop();
        } catch {
          // ignore cleanup errors
        }
      });
      localTracksRef.current = [];

      if (isMountedRef.current) {
        setLive(false);
      }

      attachedRemoteTracks.forEach((remoteTrack) => {
        try {
          remoteTrack.detach();
        } catch {
          // ignore cleanup errors
        }
      });
      attachedRemoteTracks.clear();

      const currentRoom = roomRef.current;
      if (currentRoom) {
        const { trackSubscribed, trackUnsubscribed, disconnected } = handlersRef.current;
        if (trackSubscribed) {
          currentRoom.off(RoomEvent.TrackSubscribed, trackSubscribed);
        }
        if (trackUnsubscribed) {
          currentRoom.off(RoomEvent.TrackUnsubscribed, trackUnsubscribed);
        }
        if (disconnected) {
          currentRoom.off(RoomEvent.Disconnected, disconnected);
        }
        currentRoom.disconnect();
      }
      roomRef.current = null;
      handlersRef.current = {};
    };
  }, [isPublisher, publishSecret, roomName, paramsReady]);


  async function startBroadcast() {
    if (!roomRef.current || publishing || localTracksRef.current.length > 0) {
      return;
    }

    setPublishing(true);
    if (isMountedRef.current) {
      setError(null);
      setLive(false);
    }

    try {
      const tracks = await createLocalTracks({
        video: {
          facingMode: "environment",
          frameRate: { ideal: 30, max: 30 },
          resolution: { width: 1920, height: 1080 },
        },
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      });

      localTracksRef.current = tracks;

      await Promise.all(
        tracks.map(async (track) => {
          await roomRef.current?.localParticipant.publishTrack(track);
          attach(track, { video: videoRef.current, audio: audioRef.current });
          if (isMountedRef.current) {
            setLive(true);
          }
        })
      );
    } catch (e) {
      const message = e instanceof Error ? e.message : "publish failed";
      if (isMountedRef.current) {
        setError(message);
        setLive(false);
      }
      localTracksRef.current.forEach((track) => {
        try {
          track.detach();
          track.stop();
        } catch {
          // ignore cleanup errors
        }
      });
      localTracksRef.current = [];
    } finally {
      if (isMountedRef.current) {
        setPublishing(false);
      }
    }
  }

  return (
    <div className="relative h-full w-full">
      <video ref={videoRef} playsInline autoPlay muted className="h-full w-full object-cover" />
      <audio ref={audioRef} autoPlay muted={viewerMuted} />
      {isPublisher ? (
        <div className="absolute left-3 top-3 z-10">
          <button
            onClick={startBroadcast}
            disabled={publishing}
            className="rounded-lg bg-emerald-600 px-3 py-1 text-sm text-white"
          >
            {publishing ? "Starting…" : "Start broadcast"}
          </button>
        </div>
      ) : (
        <div className="absolute left-3 top-3 z-10">
          <button
            onClick={() => setViewerMuted(false)}
            className="rounded-lg bg-slate-700 px-3 py-1 text-sm text-white"
          >
            Unmute
          </button>
        </div>
      )}
      {live && (
        <div className="absolute right-3 top-3 rounded bg-red-600 px-2 py-0.5 text-xs text-white">
          LIVE
        </div>
      )}
      {error && (
        <div className="absolute bottom-3 left-3 right-3 z-10 rounded bg-red-900/60 p-2 text-xs text-red-100">
          {error}
        </div>
      )}
      {roomName && (
        <div className="absolute right-3 top-3 rounded bg-slate-800 px-2 py-0.5 text-xs text-white">
          room: {roomName}
        </div>
      )}
    </div>
  );
}

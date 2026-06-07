import { useCallback, useEffect, useRef, useState } from "react";
import {
  PipecatClient,
  RTVIEvent,
  type BotLLMTextData,
  type TranscriptData,
} from "@pipecat-ai/client-js";
import { SmallWebRTCTransport } from "@pipecat-ai/small-webrtc-transport";

export type ConnState = "idle" | "connecting" | "connected" | "error";

export interface ThreadMessage {
  id: string;
  role: "user" | "bot";
  text: string;
  ts: number;
  final: boolean;
}

interface Options {
  userId: string;
  personaId: string;
}

export function useVoiceClient({ userId, personaId }: Options) {
  const clientRef = useRef<PipecatClient | null>(null);
  const audioElRef = useRef<HTMLAudioElement | null>(null);
  const [state, setState] = useState<ConnState>("idle");
  const [error, setError] = useState<string | null>(null);
  const [thread, setThread] = useState<ThreadMessage[]>([]);
  const [botSpeaking, setBotSpeaking] = useState(false);
  const [userSpeaking, setUserSpeaking] = useState(false);
  const [botLevel, setBotLevel] = useState(0); // 0..1, drives the orb
  const [userLevel, setUserLevel] = useState(0);

  // A persistent, hidden <audio> element that we attach the bot's remote track
  // to. Without this, the track exists in JS but the browser has no sink to
  // play it through, and you hear nothing.
  const ensureAudioEl = useCallback(() => {
    if (audioElRef.current) return audioElRef.current;
    const el = document.createElement("audio");
    el.autoplay = true;
    el.setAttribute("playsinline", "true"); // mobile Safari hint
    // Keep it in the DOM but invisible — some browsers won't play
    // detached <audio> elements reliably.
    el.style.position = "fixed";
    el.style.width = "1px";
    el.style.height = "1px";
    el.style.opacity = "0";
    el.style.pointerEvents = "none";
    document.body.appendChild(el);
    audioElRef.current = el;
    return el;
  }, []);

  const attachBotTrack = useCallback(
    (track: MediaStreamTrack) => {
      if (track.kind !== "audio") return;
      const el = ensureAudioEl();
      el.srcObject = new MediaStream([track]);
      el.play().catch((err) => {
        // Autoplay can be blocked if connect() somehow ran without a user
        // gesture. Surface it so we can offer a "tap to play" fallback.
        console.warn("[audio] play() blocked:", err);
      });
    },
    [ensureAudioEl]
  );

  // We stitch streaming partials into one bubble per turn, keyed by role+turn.
  const turnRef = useRef({ user: 0, bot: 0 });

  const appendOrUpdate = useCallback(
    (role: "user" | "bot", text: string, final: boolean) => {
      setThread((prev) => {
        const turn = turnRef.current[role];
        const id = `${role}-${turn}`;
        const idx = prev.findIndex((m) => m.id === id);
        if (idx === -1) {
          return [...prev, { id, role, text, ts: Date.now(), final }];
        }
        const next = prev.slice();
        next[idx] = { ...next[idx], text, final };
        return next;
      });
      if (final) {
        turnRef.current[role] += 1;
      }
    },
    []
  );

  const connect = useCallback(async () => {
    if (clientRef.current) return;
    setError(null);
    setState("connecting");

    try {
      const transport = new SmallWebRTCTransport({
        webrtcRequestParams: {
          endpoint: "/api/connect",
          requestData: { user_id: userId, persona_id: personaId },
        },
      });

      const client = new PipecatClient({
        transport,
        enableMic: true,
        enableCam: false,
        callbacks: {
          onConnected: () => setState("connected"),
          onDisconnected: () => {
            setState("idle");
            setBotSpeaking(false);
            setUserSpeaking(false);
            setBotLevel(0);
            setUserLevel(0);
          },
          onError: (msg) => {
            console.error("[pipecat]", msg);
            setError(typeof msg === "string" ? msg : JSON.stringify(msg));
            setState("error");
          },
          onBotStartedSpeaking: () => setBotSpeaking(true),
          onBotStoppedSpeaking: () => {
            setBotSpeaking(false);
            setBotLevel(0);
          },
          onUserStartedSpeaking: () => setUserSpeaking(true),
          onUserStoppedSpeaking: () => {
            setUserSpeaking(false);
            setUserLevel(0);
          },
          // The remote (bot) audio track arrives here. We pipe it into a
          // hidden <audio> element so the browser actually plays it.
          //
          // The SmallWebRTC transport calls onTrackStarted for *remote*
          // tracks with `participant === undefined`, and for local tracks
          // with `participant.local === true`. So a track is the bot's when
          // there's either no participant or its `local` flag is falsy.
          onTrackStarted: (track, participant) => {
            const isLocal = participant?.local === true;
            if (!isLocal && track.kind === "audio") {
              console.debug("[audio] attaching bot track", track.id);
              attachBotTrack(track);
            }
          },
        },
      });

      // Streaming text events for the conversation thread.
      client.on(RTVIEvent.UserTranscript, (data: TranscriptData) => {
        if (!data.text) return;
        appendOrUpdate("user", data.text, !!data.final);
      });
      client.on(RTVIEvent.BotTranscript, (data: BotLLMTextData) => {
        if (!data.text) return;
        // Bot transcripts often arrive as completed sentences, treat as final.
        appendOrUpdate("bot", data.text, true);
      });

      // Audio level events drive the aura orb.
      // Some Pipecat builds expose RTVIEvent.RemoteAudioLevel / LocalAudioLevel.
      const anyClient = client as unknown as {
        on: (ev: string, cb: (lvl: number) => void) => void;
      };
      anyClient.on("RemoteAudioLevel", (lvl) => setBotLevel(clamp01(lvl)));
      anyClient.on("LocalAudioLevel", (lvl) => setUserLevel(clamp01(lvl)));

      clientRef.current = client;

      // Connection params already live on the transport — connect() picks them up.
      await client.connect();
    } catch (e) {
      console.error(e);
      setError(e instanceof Error ? e.message : String(e));
      setState("error");
      clientRef.current = null;
    }
  }, [userId, personaId, appendOrUpdate]);

  const disconnect = useCallback(async () => {
    const c = clientRef.current;
    clientRef.current = null;
    if (c) {
      try {
        await c.disconnect();
      } catch (e) {
        console.warn("disconnect error", e);
      }
    }
    if (audioElRef.current) {
      audioElRef.current.srcObject = null;
      audioElRef.current.remove();
      audioElRef.current = null;
    }
    setState("idle");
  }, []);

  const clearThread = useCallback(() => {
    setThread([]);
    turnRef.current = { user: 0, bot: 0 };
  }, []);

  useEffect(() => {
    return () => {
      void disconnect();
    };
  }, [disconnect]);

  return {
    state,
    error,
    thread,
    botSpeaking,
    userSpeaking,
    botLevel,
    userLevel,
    connect,
    disconnect,
    clearThread,
  };
}

function clamp01(n: number): number {
  if (Number.isNaN(n)) return 0;
  return Math.max(0, Math.min(1, n));
}

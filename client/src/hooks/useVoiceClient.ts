import { useCallback, useEffect, useRef, useState } from "react";
import {
  PipecatClient,
  RTVIEvent,
  type BotLLMTextData,
  type TranscriptData,
} from "@pipecat-ai/client-js";
import { DailyTransport } from "@pipecat-ai/daily-transport";
import { apiUrl } from "../config";

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
  // Web Audio analyser used to detect the agent's FIRST real audio directly
  // from the bot's media stream — independent of (unreliable) RTVI speaking
  // events. This is the authoritative "first audio from the agent" signal.
  const audioCtxRef = useRef<AudioContext | null>(null);
  const detectRafRef = useRef<number | null>(null);
  const [state, setState] = useState<ConnState>("idle");
  const [error, setError] = useState<string | null>(null);
  const [thread, setThread] = useState<ThreadMessage[]>([]);
  // True once the agent has produced its FIRST audio (first onBotStartedSpeaking).
  // The transport reports "connected" several seconds before the model finishes
  // warming up and speaks, so we use this to show a distinct "preparing" phase.
  const [agentReady, setAgentReady] = useState(false);
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

  const stopFirstAudioWatch = useCallback(() => {
    if (detectRafRef.current != null) {
      cancelAnimationFrame(detectRafRef.current);
      detectRafRef.current = null;
    }
    if (audioCtxRef.current) {
      void audioCtxRef.current.close().catch(() => {});
      audioCtxRef.current = null;
    }
  }, []);

  // Poll the bot stream's amplitude; the first time it carries real energy,
  // the agent's audio is actually playing -> flip agentReady and stop watching.
  const watchForFirstAudio = useCallback(
    (stream: MediaStream) => {
      try {
        const AC =
          window.AudioContext ||
          (window as unknown as { webkitAudioContext?: typeof AudioContext })
            .webkitAudioContext;
        if (!AC) return;
        stopFirstAudioWatch();
        const ctx = new AC();
        audioCtxRef.current = ctx;
        // The context may start suspended; resume so the analyser actually
        // processes samples (otherwise it reads silence forever).
        if (ctx.state === "suspended") void ctx.resume().catch(() => {});
        const source = ctx.createMediaStreamSource(stream);
        const analyser = ctx.createAnalyser();
        analyser.fftSize = 512;
        // Connect to the analyser only (NOT to destination) — the hidden
        // <audio> element handles playback, so this avoids double audio.
        source.connect(analyser);
        const buf = new Uint8Array(analyser.fftSize);
        const tick = () => {
          analyser.getByteTimeDomainData(buf);
          let sum = 0;
          for (let i = 0; i < buf.length; i++) {
            const v = (buf[i] - 128) / 128;
            sum += v * v;
          }
          const rms = Math.sqrt(sum / buf.length);
          if (rms > 0.015) {
            setAgentReady(true);
            stopFirstAudioWatch();
            return;
          }
          detectRafRef.current = requestAnimationFrame(tick);
        };
        detectRafRef.current = requestAnimationFrame(tick);
      } catch (e) {
        console.warn("[audio] first-audio analyser failed", e);
      }
    },
    [stopFirstAudioWatch]
  );

  const attachBotTrack = useCallback(
    (track: MediaStreamTrack) => {
      if (track.kind !== "audio") return;
      const el = ensureAudioEl();
      const stream = new MediaStream([track]);
      el.srcObject = stream;
      el.play().catch((err) => {
        // Autoplay can be blocked if connect() somehow ran without a user
        // gesture. Surface it so we can offer a "tap to play" fallback.
        console.warn("[audio] play() blocked:", err);
      });
      // Start listening for the agent's first audio on this stream.
      watchForFirstAudio(stream);
    },
    [ensureAudioEl, watchForFirstAudio]
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
    setAgentReady(false);
    setState("connecting");

    try {
      // Daily hosts the WebRTC media (TURN included). The server creates a
      // room on /api/connect and returns { room_url, token }; the transport
      // joins it.
      const transport = new DailyTransport();

      const client = new PipecatClient({
        transport,
        enableMic: true,
        enableCam: false,
        callbacks: {
          onConnected: () => setState("connected"),
          onDisconnected: () => {
            setState("idle");
            setAgentReady(false);
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
          onBotStartedSpeaking: () => {
            // First audio from the agent — the "preparing" phase is over.
            // NOTE: Gemini Live over SmallWebRTC doesn't always emit this RTVI
            // event, so readiness is ALSO flipped by real bot audio level and
            // the first bot transcript below — whichever fires first.
            setAgentReady(true);
            setBotSpeaking(true);
          },
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
        // First bot message also ends the "preparing" phase (fallback in case
        // the bot-started-speaking / audio-level events don't fire).
        setAgentReady(true);
        // Bot transcripts often arrive as completed sentences, treat as final.
        appendOrUpdate("bot", data.text, true);
      });

      // Audio level events drive the aura orb.
      // Some Pipecat builds expose RTVIEvent.RemoteAudioLevel / LocalAudioLevel.
      const anyClient = client as unknown as {
        on: (ev: string, cb: (lvl: number) => void) => void;
      };
      anyClient.on("RemoteAudioLevel", (lvl) => {
        const v = clamp01(lvl);
        setBotLevel(v);
        // Real audio energy from the agent == its first audio is playing.
        // This is the truest "first audio" signal and the most reliable one.
        if (v > 0.01) setAgentReady(true);
      });
      anyClient.on("LocalAudioLevel", (lvl) => setUserLevel(clamp01(lvl)));

      clientRef.current = client;

      // Posts to /api/connect, receives { room_url, token }, joins the room.
      await client.connect({
        endpoint: apiUrl("/api/connect"),
        requestData: { user_id: userId, persona_id: personaId },
      });
    } catch (e) {
      console.error(e);
      setError(e instanceof Error ? e.message : String(e));
      setState("error");
      clientRef.current = null;
    }
  }, [userId, personaId, appendOrUpdate]);

  const disconnect = useCallback(async () => {
    stopFirstAudioWatch();
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
    setAgentReady(false);
    setState("idle");
  }, [stopFirstAudioWatch]);

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
    agentReady,
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

import { useEffect, useRef } from "react";
import type { ThreadMessage } from "../hooks/useVoiceClient";

interface Props {
  messages: ThreadMessage[];
  botName: string;
  accent: string;
  botSpeaking: boolean;
  userSpeaking: boolean;
}

/**
 * Audio-message style thread. Each turn renders as a chat bubble with a
 * miniature waveform on the left so it looks like a voice-note conversation.
 * The bubble for the currently-speaking party gets a live animated waveform.
 */
export default function ConversationThread({
  messages,
  botName,
  accent,
  botSpeaking,
  userSpeaking,
}: Props) {
  const endRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages.length, messages[messages.length - 1]?.text]);

  if (messages.length === 0) {
    return (
      <div className="thread thread--empty">
        <p>{botName} is listening — start talking when you’re ready.</p>
      </div>
    );
  }

  return (
    <div className="thread">
      {messages.map((m, idx) => {
        const isLatest = idx === messages.length - 1;
        const live =
          (m.role === "bot" && isLatest && botSpeaking) ||
          (m.role === "user" && isLatest && userSpeaking);
        return (
          <div
            key={m.id}
            className={`audio-msg audio-msg--${m.role} ${live ? "audio-msg--live" : ""}`}
            style={
              m.role === "bot" ? { ["--accent" as string]: accent } : undefined
            }
          >
            <Waveform live={live} bars={18} />
            <div className="audio-msg__body">
              <div className="audio-msg__who">
                {m.role === "user" ? "You" : botName}
              </div>
              <div className="audio-msg__text">
                {m.text}
                {!m.final && <span className="audio-msg__cursor">▍</span>}
              </div>
            </div>
          </div>
        );
      })}
      <div ref={endRef} />
    </div>
  );
}

/**
 * Tiny pseudo-waveform. When `live`, bars animate; otherwise they show a
 * frozen, deterministic shape (so each bubble has its own visual signature
 * but doesn't reflow on re-render).
 */
function Waveform({ live, bars }: { live: boolean; bars: number }) {
  // Deterministic heights derived from bar index — same bubble always looks the same.
  const heights = Array.from({ length: bars }, (_, i) => {
    const t = i / bars;
    return 0.35 + 0.65 * Math.abs(Math.sin(t * Math.PI * 2.4 + 1.7));
  });

  return (
    <div className={`waveform ${live ? "waveform--live" : ""}`}>
      {heights.map((h, i) => (
        <span
          key={i}
          className="waveform__bar"
          style={{
            height: `${Math.round(h * 100)}%`,
            animationDelay: live ? `${(i % 6) * 0.08}s` : undefined,
          }}
        />
      ))}
    </div>
  );
}

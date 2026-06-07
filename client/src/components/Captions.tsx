import { useEffect, useRef } from "react";
import type { ThreadMessage } from "../hooks/useVoiceClient";

interface Props {
  messages: ThreadMessage[];
  botName: string;
  accent: string;
}

/**
 * Bottom-overlay captions, Apple-TV-subtitle style. Only the most recent
 * exchange is visible — older turns fade out. The whole thing is hidden
 * if there's nothing yet.
 */
export default function Captions({ messages, botName, accent }: Props) {
  const lastUser = [...messages].reverse().find((m) => m.role === "user");
  const lastBot = [...messages].reverse().find((m) => m.role === "bot");

  const wrapRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    wrapRef.current?.scrollTo({ top: 0, behavior: "smooth" });
  }, [lastUser?.text, lastBot?.text]);

  if (!lastUser && !lastBot) return null;

  return (
    <div className="captions" ref={wrapRef}>
      {lastUser && (
        <div className="captions__line captions__line--user">
          <span className="captions__who">You</span>
          <span className="captions__text">
            {lastUser.text}
            {!lastUser.final && <span className="captions__cursor">▍</span>}
          </span>
        </div>
      )}
      {lastBot && (
        <div
          className="captions__line captions__line--bot"
          style={{ ["--accent" as string]: accent }}
        >
          <span className="captions__who">{botName}</span>
          <span className="captions__text">
            {lastBot.text}
            {!lastBot.final && <span className="captions__cursor">▍</span>}
          </span>
        </div>
      )}
    </div>
  );
}

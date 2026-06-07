import { useEffect, useMemo, useState } from "react";
import AuraOrb from "./components/AuraOrb";
import PersonaSelector from "./components/PersonaSelector";
import Captions from "./components/Captions";
import ConversationThread from "./components/ConversationThread";
import MemoryPanel from "./components/MemoryPanel";
import { DEFAULT_PERSONAS, type Persona } from "./personas";
import { useVoiceClient } from "./hooks/useVoiceClient";
import { apiUrl } from "./config";

const USER_ID_KEY = "aura.userId";
const PERSONA_KEY = "aura.persona";

function getOrMakeUserId(): string {
  let id = localStorage.getItem(USER_ID_KEY);
  if (!id) {
    id = "u-" + crypto.randomUUID();
    localStorage.setItem(USER_ID_KEY, id);
  }
  return id;
}

type DrawerTab = null | "personas" | "memory" | "thread";

export default function App() {
  const [personas, setPersonas] = useState<Persona[]>(DEFAULT_PERSONAS);
  const [personaId, setPersonaId] = useState<string>(
    () => localStorage.getItem(PERSONA_KEY) || "aura"
  );
  const [drawer, setDrawer] = useState<DrawerTab>(null);
  const [memoryRefresh, setMemoryRefresh] = useState(0);
  const userId = useMemo(getOrMakeUserId, []);

  useEffect(() => {
    fetch(apiUrl("/api/personas"))
      .then((r) => r.json())
      .then((data: Persona[]) => {
        if (Array.isArray(data) && data.length) setPersonas(data);
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    localStorage.setItem(PERSONA_KEY, personaId);
  }, [personaId]);

  const persona = personas.find((p) => p.id === personaId) ?? personas[0];

  const {
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
  } = useVoiceClient({ userId, personaId });

  const isConnected = state === "connected";
  const isBusy = state === "connecting";
  // Transport is up but the agent hasn't spoken its first audio yet — the model
  // is still warming up. Show a distinct "preparing" state so the gap between
  // "connected" and the first greeting doesn't feel like a dead connection.
  const isPreparing = isConnected && !agentReady;

  // If preparing drags on (cold model / slow start), soften the message so it
  // never looks frozen.
  const [slowStart, setSlowStart] = useState(false);
  useEffect(() => {
    if (!isPreparing) {
      setSlowStart(false);
      return;
    }
    const t = setTimeout(() => setSlowStart(true), 18000);
    return () => clearTimeout(t);
  }, [isPreparing]);

  const handleEnd = async () => {
    await disconnect();
    setMemoryRefresh((n) => n + 1);
  };

  const handleOrbTap = () => {
    if (isBusy) return;
    if (isConnected) handleEnd();
    else connect();
  };

  const orbLevel = botSpeaking ? botLevel : userSpeaking ? userLevel : 0;
  const toggleDrawer = (tab: DrawerTab) =>
    setDrawer((cur) => (cur === tab ? null : tab));

  return (
    <div
      className="ambient"
      style={{ ["--accent" as string]: persona.accent }}
    >
      <BackgroundFX accent={persona.accent} />

      {/* Top-left brand + persona name */}
      <div className="overlay overlay--top-left">
        <div className="brand">
          <div className="brand__dot" />
          <div className="brand__name">{persona.name}</div>
        </div>
        <div className="brand__tag">{persona.tagline}</div>
      </div>

      {/* Top-right status + drawer toggles */}
      <div className="overlay overlay--top-right">
        <Status state={state} preparing={isPreparing} />
        <div className="iconbar">
          <IconButton
            label="Buddy"
            active={drawer === "personas"}
            onClick={() => toggleDrawer("personas")}
          >
            <Icon name="personas" />
          </IconButton>
          <IconButton
            label="Thread"
            active={drawer === "thread"}
            onClick={() => toggleDrawer("thread")}
          >
            <Icon name="thread" />
          </IconButton>
          <IconButton
            label="Memory"
            active={drawer === "memory"}
            onClick={() => toggleDrawer("memory")}
          >
            <Icon name="memory" />
          </IconButton>
        </div>
      </div>

      {/* Centered orb */}
      <main className="ambient__main">
        <AuraOrb
          accent={persona.accent}
          level={orbLevel}
          speaking={botSpeaking}
          listening={userSpeaking}
          connected={isConnected}
          preparing={isPreparing}
          onTap={handleOrbTap}
        />
        <p className="ambient__hint">
          {isBusy
            ? "जुड़ रहा है… (Connecting…)"
            : isPreparing
            ? slowStart
              ? `${persona.name} अभी भी तैयार हो रहा है… (still getting ready)`
              : `${persona.name} तैयार हो रहा है… (getting ready)`
            : isConnected
            ? "बस बात करो — मैं सुन रहा हूँ"
            : "Tap the orb to talk"}
        </p>

        {error && <div className="error error--floating">{error}</div>}
      </main>

      {/* Bottom captions */}
      <Captions
        messages={thread}
        botName={persona.name}
        accent={persona.accent}
      />

      {/* Slide-in drawer */}
      {drawer && (
        <aside className="drawer">
          <button
            className="drawer__close"
            onClick={() => setDrawer(null)}
            aria-label="Close panel"
          >
            ×
          </button>

          {drawer === "personas" && (
            <>
              <h2 className="drawer__heading">Pick a buddy</h2>
              <PersonaSelector
                personas={personas}
                selected={personaId}
                onSelect={setPersonaId}
                disabled={isConnected || isBusy}
              />
              {(isConnected || isBusy) && (
                <p className="drawer__hint">
                  End the session to switch buddies.
                </p>
              )}
            </>
          )}

          {drawer === "thread" && (
            <>
              <div className="drawer__head-row">
                <h2 className="drawer__heading">Today’s thread</h2>
                {thread.length > 0 && !isConnected && (
                  <button className="link-btn" onClick={clearThread}>
                    Clear
                  </button>
                )}
              </div>
              <ConversationThread
                messages={thread}
                botName={persona.name}
                accent={persona.accent}
                botSpeaking={botSpeaking}
                userSpeaking={userSpeaking}
              />
            </>
          )}

          {drawer === "memory" && (
            <>
              <h2 className="drawer__heading">What I remember about you</h2>
              <MemoryPanel userId={userId} refreshKey={memoryRefresh} />
            </>
          )}
        </aside>
      )}
    </div>
  );
}

function Status({ state, preparing }: { state: string; preparing?: boolean }) {
  // "preparing" is a sub-state of connected — transport up, agent warming up.
  const effective = preparing ? "preparing" : state;
  const labels: Record<string, string> = {
    idle: "Ready",
    connecting: "Connecting…",
    preparing: "Preparing…",
    connected: "Live",
    error: "Error",
  };
  return (
    <div className={`status status--${effective}`}>
      <span className="status__dot" />
      <span className="status__label">{labels[effective] ?? effective}</span>
    </div>
  );
}

function IconButton({
  label,
  active,
  onClick,
  children,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      className={`icon-btn ${active ? "icon-btn--active" : ""}`}
      onClick={onClick}
      title={label}
      aria-label={label}
    >
      {children}
    </button>
  );
}

function Icon({ name }: { name: "personas" | "thread" | "memory" }) {
  if (name === "personas")
    return (
      <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.6">
        <circle cx="9" cy="9" r="3.5" />
        <circle cx="17" cy="11" r="2.5" />
        <path d="M3 19c0-3 3-5 6-5s6 2 6 5" />
        <path d="M14.5 19c0.4-2 2-3.3 4-3.3s3.5 1 4 3" />
      </svg>
    );
  if (name === "thread")
    return (
      <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.6">
        <path d="M4 7h16M4 12h10M4 17h16" strokeLinecap="round" />
      </svg>
    );
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.6">
      <path d="M9 4h6a3 3 0 013 3v3a3 3 0 01-3 3h-1l-3 3v-3H9a3 3 0 01-3-3V7a3 3 0 013-3z" />
      <circle cx="10" cy="9" r="0.8" fill="currentColor" />
      <circle cx="14" cy="9" r="0.8" fill="currentColor" />
    </svg>
  );
}

/** Slow-drifting color blobs in the background — sets the ambient vibe. */
function BackgroundFX({ accent }: { accent: string }) {
  return (
    <div className="bg-fx" aria-hidden style={{ ["--accent" as string]: accent }}>
      <div className="bg-fx__blob bg-fx__blob--1" />
      <div className="bg-fx__blob bg-fx__blob--2" />
      <div className="bg-fx__blob bg-fx__blob--3" />
      <div className="bg-fx__noise" />
    </div>
  );
}

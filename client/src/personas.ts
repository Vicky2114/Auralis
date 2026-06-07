export interface Persona {
  id: string;
  name: string;
  tagline: string;
  accent: string;
}

// Fallback / initial render before /api/personas resolves.
export const DEFAULT_PERSONAS: Persona[] = [
  { id: "aura",  name: "Aura",  tagline: "Daily therapist — calm, reflective, here to listen", accent: "#a78bfa" },
  { id: "sage",  name: "Sage",  tagline: "Mentor — thoughtful, wise, helps you think it through", accent: "#60a5fa" },
  { id: "spark", name: "Spark", tagline: "Best-friend energy — playful, hype, makes the day lighter", accent: "#f472b6" },
  { id: "coach", name: "Coach", tagline: "Accountability buddy — focused, motivating, action-oriented", accent: "#34d399" },
  { id: "echo",  name: "Echo",  tagline: "Quiet listener — reflects back, rarely advises", accent: "#fbbf24" },
];

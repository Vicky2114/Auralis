// Runtime config for API base + WebRTC ICE servers.
//
// Dev: VITE_API_BASE unset -> calls go to "/api/*" through the Vite proxy.
// Prod (Vercel): set VITE_API_BASE to the backend origin, e.g.
//   https://auralis-api.fly.dev
// and VITE_TURN_* to your TURN credentials.

const API_BASE = (import.meta.env.VITE_API_BASE ?? "").replace(/\/+$/, "");

/** Build a full URL for an "/api/..." path (absolute in prod, relative in dev). */
export function apiUrl(path: string): string {
  return `${API_BASE}${path}`;
}

/** Split a comma/space-separated env value into a clean list of URLs. */
function urlList(value: string | undefined): string[] {
  return (value ?? "")
    .split(/[,\s]+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

/** STUN/TURN servers for WebRTC. STUN is free; TURN relays media through NATs.
 *  VITE_TURN_URL may hold MULTIPLE comma-separated URLs (udp/tcp/tls) for the
 *  best chance of connecting through strict firewalls. */
export function iceServers(): RTCIceServer[] {
  const servers: RTCIceServer[] = [];

  const stun = urlList(import.meta.env.VITE_STUN_URL ?? "stun:stun.l.google.com:19302");
  if (stun.length) servers.push({ urls: stun });

  const turn = urlList(import.meta.env.VITE_TURN_URL);
  if (turn.length) {
    servers.push({
      urls: turn,
      username: import.meta.env.VITE_TURN_USERNAME,
      credential: import.meta.env.VITE_TURN_CREDENTIAL,
    });
  }
  return servers;
}

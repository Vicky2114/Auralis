import { useEffect, useState } from "react";

interface Fact {
  fact: string;
  category: string;
  ts: string;
}

interface Props {
  userId: string;
  /** Bumped when the user finishes a session — refetch then. */
  refreshKey: number;
}

export default function MemoryPanel({ userId, refreshKey }: Props) {
  const [facts, setFacts] = useState<Fact[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    fetch(`/api/memory/${encodeURIComponent(userId)}`)
      .then((r) => r.json())
      .then((d) => {
        if (!cancelled) setFacts(d.facts ?? []);
      })
      .catch(() => {})
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [userId, refreshKey]);

  const clearAll = async () => {
    if (!confirm("Erase everything your buddy remembers about you?")) return;
    await fetch(`/api/memory/${encodeURIComponent(userId)}`, { method: "DELETE" });
    setFacts([]);
  };

  if (loading) return <p className="memory__hint">Loading…</p>;

  if (facts.length === 0) {
    return (
      <p className="memory__hint">
        Nothing yet. As you chat, your buddy will save things worth remembering.
      </p>
    );
  }

  return (
    <>
      <ul className="memory__list">
        {facts.map((f, i) => (
          <li key={i} className="memory__item">
            <span className="memory__cat">{f.category}</span>
            <span className="memory__fact">{f.fact}</span>
          </li>
        ))}
      </ul>
      <button className="memory__clear" onClick={clearAll}>
        Forget everything
      </button>
    </>
  );
}

import type { Persona } from "../personas";

interface Props {
  personas: Persona[];
  selected: string;
  onSelect: (id: string) => void;
  disabled?: boolean;
}

export default function PersonaSelector({
  personas,
  selected,
  onSelect,
  disabled,
}: Props) {
  return (
    <div className="persona-grid" role="radiogroup" aria-label="Choose a buddy">
      {personas.map((p) => {
        const active = p.id === selected;
        return (
          <button
            key={p.id}
            role="radio"
            aria-checked={active}
            disabled={disabled}
            onClick={() => onSelect(p.id)}
            className={`persona-card ${active ? "persona-card--active" : ""}`}
            style={{ ["--accent" as string]: p.accent }}
          >
            <div className="persona-card__dot" />
            <div className="persona-card__body">
              <div className="persona-card__name">{p.name}</div>
              <div className="persona-card__tagline">{p.tagline}</div>
            </div>
          </button>
        );
      })}
    </div>
  );
}

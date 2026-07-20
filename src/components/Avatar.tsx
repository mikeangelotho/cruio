const PALETTE = [
  "bg-sky-500",
  "bg-emerald-500",
  "bg-amber-500",
  "bg-rose-500",
  "bg-violet-500",
  "bg-teal-500",
  "bg-orange-500",
  "bg-indigo-500",
];

export function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

function colorFor(name: string): string {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) | 0;
  return PALETTE[Math.abs(h) % PALETTE.length];
}

/** Deterministic initials avatar; same name always gets the same color. */
export function Avatar(props: { name: string; size?: number }) {
  const size = () => props.size ?? 18;
  return (
    <span
      class={`inline-flex items-center justify-center rounded-full text-white font-semibold shrink-0 ${colorFor(props.name)}`}
      style={{
        width: `${size()}px`,
        height: `${size()}px`,
        "font-size": `${Math.round(size() * 0.42)}px`,
      }}
      title={props.name}
    >
      {initials(props.name)}
    </span>
  );
}

export function SquareAvatar(props: { name: string; size?: number }) {
  const size = () => props.size ?? 18;
  return (
    <span
      class={`inline-flex items-center justify-center rounded-sm text-white font-semibold shrink-0 ${colorFor(props.name)}`}
      style={{
        width: `${size()}px`,
        height: `${size()}px`,
        "font-size": `${Math.round(size() * 0.42)}px`,
      }}
      title={props.name}
    >
      {initials(props.name)}
    </span>
  );
}

export function EntityAvatar(props: { name: string; size?: number }) {
  const size = () => props.size ?? 18;
  return (
    <span
      class={`
        inline-flex items-center justify-center rotate-45 rounded-md text-white font-semibold shrink-0 ${colorFor(props.name)}`}
      style={{
        width: `${size() - 2}px`,
        height: `${size() - 2}px`,
        "font-size": `${Math.round(size() * 0.42)}px`,
      }}
      title={props.name}
    >
      <span class="-rotate-45">{initials(props.name)}</span>
    </span>
  );
}

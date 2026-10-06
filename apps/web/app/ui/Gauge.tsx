/** Half-circle score dial, 0–1000. */
export function Gauge({ score }: { score: number }) {
  const r = 46;
  const c = Math.PI * r;
  const filled = (Math.min(Math.max(score, 0), 1000) / 1000) * c;
  return (
    <svg width="120" height="70" viewBox="0 0 120 70" aria-hidden="true">
      <path d="M14,62 A46,46 0 0 1 106,62" fill="none" stroke="var(--paper-2)" strokeWidth="10" strokeLinecap="round" />
      <path d="M14,62 A46,46 0 0 1 106,62" fill="none" stroke="var(--accent)" strokeWidth="10" strokeLinecap="round" strokeDasharray={`${filled} ${c}`} />
      <text x="60" y="60" textAnchor="middle" style={{ fontFamily: "var(--font-serif), Georgia, serif", fontSize: 26, fill: "var(--ink)" }}>
        {score}
      </text>
    </svg>
  );
}

export function gradeOf(score: number): string {
  if (score >= 800) return "Strong";
  if (score >= 600) return "Solid";
  if (score >= 300) return "Building a record";
  return "Unproven";
}

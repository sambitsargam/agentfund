import { tusdm } from "../../lib/present";

interface Props {
  fromAgents: bigint;
  fromTeams: bigint;
  toInvestor: bigint;
  toAtlas: bigint;
  waiting: bigint;
  investorName: string;
  investorPct: number;
}

/** Money in → investor contract → investor and Atlas, with stream widths in proportion to real amounts. */
export function Flow({ fromAgents, fromTeams, toInvestor, toAtlas, waiting, investorName, investorPct }: Props) {
  const total = fromAgents + fromTeams;
  const max = total > 0n ? total : 1n;
  const width = (x: bigint) => (x === 0n ? 1.5 : Math.max(3, Number((x * 34n) / max)));

  const W = 900;
  const H = 300;
  const hub = { x: 450, y: 150 };
  const left = [
    { y: 92, label: "Other AI agents", sub: "pay per report over x402", amount: fromAgents },
    { y: 208, label: "Teams on Sokosumi", sub: "hire Atlas, paid via Masumi escrow", amount: fromTeams },
  ];
  const right = [
    { y: 72, label: `${investorName} · ${investorPct}%`, sub: "repaid automatically", amount: toInvestor, color: "var(--accent)" },
    { y: 150, label: `Atlas · ${100 - investorPct}%`, sub: "keeps the rest", amount: toAtlas, color: "var(--ink)" },
    { y: 228, label: "Waiting for the next split", sub: "held by the contract", amount: waiting, color: "var(--amber)" },
  ];
  const curve = (x1: number, y1: number, x2: number, y2: number) => {
    const mx = (x1 + x2) / 2;
    return `M${x1},${y1} C${mx},${y1} ${mx},${y2} ${x2},${y2}`;
  };

  return (
    <figure className="flow-wrap" style={{ margin: 0 }}>
      <svg className="flow" viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Where Atlas's earnings come from and where they go">
        {left.map((n) => (
          <g key={n.label}>
            <path className="stream" d={curve(210, n.y, hub.x - 70, hub.y)} stroke="var(--hair)" strokeWidth={width(n.amount)} />
            {n.amount > 0n && (
              <path className="stream moving" d={curve(210, n.y, hub.x - 70, hub.y)} stroke="var(--ink-3)" strokeWidth={Math.min(2.5, width(n.amount))} />
            )}
            <text className="amount" x={0} y={n.y - 4}>
              {tusdm(n.amount)}
            </text>
            <text className="label" x={0} y={n.y + 16}>
              {n.label}
            </text>
            <text className="sub" x={0} y={n.y + 32}>
              {n.sub}
            </text>
          </g>
        ))}

        {right.map((n) => (
          <g key={n.label}>
            <path className="stream" d={curve(hub.x + 70, hub.y, 680, n.y)} stroke={n.color} strokeOpacity={n.amount > 0n ? 0.85 : 0.2} strokeWidth={width(n.amount)} />
            <text className="amount" x={698} y={n.y - 4}>
              {tusdm(n.amount)}
            </text>
            <text className="label" x={698} y={n.y + 16}>
              {n.label}
            </text>
            <text className="sub" x={698} y={n.y + 32}>
              {n.sub}
            </text>
          </g>
        ))}

        <rect x={hub.x - 72} y={hub.y - 48} width={144} height={96} rx={4} fill="var(--sheet)" stroke="var(--ink)" />
        <text className="label" x={hub.x} y={hub.y - 16} textAnchor="middle" style={{ fontWeight: 600 }}>
          Investor contract
        </text>
        <text className="sub" x={hub.x} y={hub.y + 2} textAnchor="middle">
          on Cardano
        </text>
        <text className="amount" x={hub.x} y={hub.y + 32} textAnchor="middle">
          {tusdm(total)}
        </text>
      </svg>
      <figcaption className="flow-caption">
        Amounts in tUSDM, the test version of a US-dollar stablecoin. Every payment to Atlas goes into the contract first; the contract only releases it
        by paying the investor their share.
      </figcaption>
    </figure>
  );
}

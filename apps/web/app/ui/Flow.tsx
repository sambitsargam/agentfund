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

interface Item {
  key: string;
  label: string;
  sub: string;
  value: bigint;
  color: string;
}

interface Node extends Item {
  y0: number;
  y1: number;
  labelY: number;
}

const TOP = 30;
const BAND = 210;
const GAP = 12;
const MIN_BAR = 6;
const LABEL_H = 50;

/**
 * Bars keep their true proportions; labels are then pushed apart so a tiny slice
 * still gets a readable caption instead of overlapping its neighbour.
 */
function layout(items: Item[], total: bigint): Node[] {
  const span = BAND - GAP * (items.length - 1);
  const heights = items.map((i) => (total === 0n ? span / items.length : Math.max(MIN_BAR, (Number(i.value) / Number(total)) * span)));
  const scale = span / heights.reduce((a, b) => a + b, 0);

  let y = TOP;
  const placed = items.map((item, idx) => {
    const h = heights[idx]! * scale;
    const node = { ...item, y0: y, y1: y + h, labelY: 0 };
    y += h + GAP;
    return node;
  });

  let floor = TOP - 8;
  for (const n of placed) {
    n.labelY = Math.max((n.y0 + n.y1) / 2 - LABEL_H / 2, floor);
    floor = n.labelY + LABEL_H;
  }
  return placed;
}

/** A Sankey ribbon is a closed filled shape, never a thick stroke. */
function ribbon(x1: number, a1: number, b1: number, x2: number, a2: number, b2: number): string {
  const m = (x1 + x2) / 2;
  return `M${x1},${a1} C${m},${a1} ${m},${a2} ${x2},${a2} L${x2},${b2} C${m},${b2} ${m},${b1} ${x1},${b1} Z`;
}

export function Flow({ fromAgents, fromTeams, toInvestor, toAtlas, waiting, investorName, investorPct }: Props) {
  const total = fromAgents + fromTeams;
  const outTotal = toInvestor + toAtlas + waiting;

  const sources = layout(
    [
      { key: "agents", label: "AI agents", sub: "pay per report over x402", value: fromAgents, color: "#7b7cf0" },
      { key: "teams", label: "Sokosumi teams", sub: "hire Atlas via Masumi escrow", value: fromTeams, color: "#3f8fd0" },
    ],
    total,
  );
  const sinks = layout(
    [
      { key: "inv", label: investorName, sub: `${investorPct}% of everything, automatically`, value: toInvestor, color: "#e9b949" },
      { key: "atlas", label: "Atlas", sub: `the remaining ${100 - investorPct}%`, value: toAtlas, color: "#3ddc97" },
      { key: "wait", label: "Not yet split", sub: "still held by the contract", value: waiting, color: "#f0a93b" },
    ],
    outTotal,
  );

  const SX = 250;
  const HX0 = 430;
  const HX1 = 570;
  const EX = 750;
  const height = Math.max(TOP + BAND + 20, ...sinks.map((n) => n.labelY + LABEL_H + 16), ...sources.map((n) => n.labelY + LABEL_H + 16));

  const opacity = (v: bigint) => (v === 0n ? 0.12 : 0.34);

  return (
    <div className="panel">
      <svg
        className="sankey"
        viewBox={`0 0 1000 ${height}`}
        role="img"
        aria-label="How money flows from payers through the investor contract to the investor and Atlas"
      >
        <defs>
          <linearGradient id="hub" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#1e232c" />
            <stop offset="100%" stopColor="#141820" />
          </linearGradient>
        </defs>

        {sources.map((n) => (
          <path key={n.key} d={ribbon(SX + 9, n.y0, n.y1, HX0, n.y0, n.y1)} fill={n.color} opacity={opacity(n.value)} />
        ))}
        {sinks.map((n) => (
          <path key={n.key} d={ribbon(HX1, n.y0, n.y1, EX, n.y0, n.y1)} fill={n.color} opacity={opacity(n.value)} />
        ))}

        {sources.map((n) => (
          <g key={n.key}>
            <rect x={SX} y={n.y0} width={9} height={n.y1 - n.y0} rx={2} fill={n.color} opacity={n.value === 0n ? 0.35 : 1} />
            <text className="nval" x={SX - 16} y={n.labelY + 14} textAnchor="end">
              {tusdm(n.value)}
              <tspan className="nsub"> tUSDM</tspan>
            </text>
            <text className="nlabel" x={SX - 16} y={n.labelY + 31} textAnchor="end">
              {n.label}
            </text>
            <text className="nsub" x={SX - 16} y={n.labelY + 46} textAnchor="end">
              {n.sub}
            </text>
          </g>
        ))}

        {sinks.map((n) => (
          <g key={n.key}>
            <rect x={EX} y={n.y0} width={9} height={n.y1 - n.y0} rx={2} fill={n.color} opacity={n.value === 0n ? 0.35 : 1} />
            <text className="nval" x={EX + 20} y={n.labelY + 14}>
              {tusdm(n.value)}
              <tspan className="nsub"> tUSDM</tspan>
            </text>
            <text className="nlabel" x={EX + 20} y={n.labelY + 31}>
              {n.label}
            </text>
            <text className="nsub" x={EX + 20} y={n.labelY + 46}>
              {n.sub}
            </text>
          </g>
        ))}

        <rect x={HX0} y={TOP} width={HX1 - HX0} height={BAND} rx={10} fill="url(#hub)" stroke="var(--line-2)" />
        <text className="hub-val" x={(HX0 + HX1) / 2} y={TOP + BAND / 2 - 10} textAnchor="middle">
          {tusdm(total)}
        </text>
        <text className="hub-sub" x={(HX0 + HX1) / 2} y={TOP + BAND / 2 + 6} textAnchor="middle">
          tUSDM received
        </text>
        <text className="hub-label" x={(HX0 + HX1) / 2} y={TOP + BAND / 2 + 30} textAnchor="middle">
          Investor contract
        </text>
        <text className="hub-sub" x={(HX0 + HX1) / 2} y={TOP + BAND / 2 + 46} textAnchor="middle">
          pays investors first
        </text>
      </svg>
      <div className="flow-foot">
        <span>
          <i style={{ background: "#7b7cf0" }} />
          From AI agents
        </span>
        <span>
          <i style={{ background: "#3f8fd0" }} />
          From Sokosumi teams
        </span>
        <span>
          <i style={{ background: "#e9b949" }} />
          Repaid to the investor
        </span>
        <span>
          <i style={{ background: "#3ddc97" }} />
          Kept by Atlas
        </span>
        <span>
          <i style={{ background: "#f0a93b" }} />
          Awaiting the next split
        </span>
      </div>
    </div>
  );
}

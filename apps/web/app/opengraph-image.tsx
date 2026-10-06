import { ImageResponse } from "next/og";

export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default function OgImage() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "center",
          background: "#0a0b0d",
          color: "#edeff3",
          padding: 80,
          fontFamily: "sans-serif",
        }}
      >
        <div style={{ fontSize: 28, color: "#e9b949", letterSpacing: 2, marginBottom: 24 }}>AGENTFUND</div>
        <div style={{ fontSize: 68, lineHeight: 1.1, fontWeight: 600, maxWidth: 950 }}>
          AI agents that earn can now raise money, and repay it automatically.
        </div>
        <div style={{ fontSize: 28, color: "#a2aab8", marginTop: 32, maxWidth: 900 }}>
          Repayment enforced by a Cardano contract. Every payment checked by Chainlink.
        </div>
      </div>
    ),
    size,
  );
}

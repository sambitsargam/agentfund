"use client";
import { useEffect, useState } from "react";
import type {
  FundingAction,
  FundingTicket,
  FundingView,
} from "../../lib/funding-types";
import {
  submitFunding,
  type FundingWallet as Wallet,
  type PendingFunding as Pending,
} from "../../lib/funding-wallet";
interface Extension {
  name?: string;
  enable(): Promise<Wallet>;
}
const KEY = "agentfund-funding-pending-v1";
const amount = (value: string) =>
  (Number(value) / 1e6).toLocaleString(undefined, { maximumFractionDigits: 6 });
function atomic(value: string) {
  if (!/^\d+(\.\d{1,6})?$/.test(value))
    throw new Error("Use a positive amount with up to six decimal places");
  const [whole, part = ""] = value.split(".");
  return (BigInt(whole!) * 1000000n + BigInt(part.padEnd(6, "0"))).toString();
}
async function api(body?: unknown) {
  const r = await fetch(
    "/api/funding",
    body
      ? {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        }
      : { cache: "no-store" },
  );
  const data = await r.json();
  if (!r.ok) throw new Error(data.error ?? "Funding is unavailable");
  return data;
}
export function FundAgent() {
  const [loading, setLoading] = useState(true);
  const [rounds, setRounds] = useState<FundingView[]>([]),
    [operator, setOperator] = useState("");
  const [wallets, setWallets] = useState<[string, Extension][]>([]),
    [walletName, setWalletName] = useState("");
  const [wallet, setWallet] = useState<Wallet | null>(null),
    [address, setAddress] = useState("");
  const [pending, setPending] = useState<Pending | null>(null),
    [busy, setBusy] = useState(false),
    [message, setMessage] = useState("");
  const [capital, setCapital] = useState("0.20"),
    [share, setShare] = useState("50"),
    [cap, setCap] = useState("0.30");
  const persist = (p: Pending | null) => {
    if (p) localStorage.setItem(KEY, JSON.stringify(p));
    else localStorage.removeItem(KEY);
    setPending(p);
  };
  async function refresh() {
    try {
      const d = await api();
      setRounds(d.rounds);
      setOperator(d.operator);
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => {
    const extensions =
      (window as Window & { cardano?: Record<string, Extension> }).cardano ??
      {};
    const installed = Object.entries(extensions).filter(
      ([, x]) => typeof x?.enable === "function",
    );
    setWallets(installed);
    setWalletName(installed[0]?.[0] ?? "");
    try {
      const raw = localStorage.getItem(KEY);
      if (raw) setPending(JSON.parse(raw));
    } catch {
      setMessage(
        "Could not restore the previous proposal. Inspect your wallet history before starting again.",
      );
    }
    void refresh().catch((e) => setMessage(e.message));
  }, []);
  async function run(work: () => Promise<void>) {
    setBusy(true);
    setMessage("");
    try {
      await work();
    } catch (e) {
      setMessage(
        e instanceof Error
          ? e.message
          : "Wallet request failed. Check the wallet before retrying.",
      );
    } finally {
      setBusy(false);
    }
  }
  async function connect() {
    const extension = wallets.find(([id]) => id === walletName)?.[1];
    if (!extension)
      throw new Error(
        "Install a Cardano browser wallet and select preprod, then reload this page",
      );
    const w = await extension.enable();
    if ((await w.getNetworkId()) !== 0)
      throw new Error("Switch your wallet to Cardano preprod");
    const d = await api({
      action: "connect",
      address: await w.getChangeAddress(),
    });
    setWallet(w);
    setAddress(d.address);
  }
  async function prepare(action: FundingAction, roundId?: string) {
    if (!wallet || !address)
      throw new Error("Connect your preprod wallet first");
    const t = await api({
      action,
      address,
      roundId,
      capital: atomic(capital),
      bps: Number(share) * 100,
      cap: atomic(cap),
    });
    persist(t);
    setMessage(t.proposalState === "unsigned" ? "Review the proposal below. No payment has been made through this proposal." : "Existing proposal restored. Check confirmation before retrying the same transaction.");
  }
  async function discardProposal() {
    if (!pending || pending.signedCbor) throw new Error("A signed payment must be confirmed or expire before replacing it");
    await api({ action: "discard", id: pending.id });
    persist(null);
    setMessage("Unsigned proposal cancelled. No payment was made; you can review funding again.");
  }
  async function signAndSubmit() {
    if (!wallet || !pending)
      throw new Error("Connect the wallet used for this proposal");
    await submitFunding(pending, wallet, api, persist);
    setMessage(
      "Submitted. Confirmation usually takes 20–60 seconds. Check confirmation below; do not create a replacement.",
    );
  }
  async function confirm() {
    if (!pending) return;
    const d = await api({ action: "confirm", id: pending.id });
    if (!d.confirmed) {
      setMessage(d.message);
      return;
    }
    persist(null);
    await refresh();
    setMessage(
      "Confirmed on Cardano. The round status below is read from its authenticated state.",
    );
  }
  return (
    <section className="sec funding-product" aria-labelledby="fund-title">
      <div className="sec-head">
        <h2 id="fund-title">Fund Atlas</h2>
        <p>Cardano preprod · test money only</p>
      </div>
      <p>
        Choose an open round. Your share starts only when funding confirms and
        stops when the repayment cap is reached. Only purchases through that
        round’s paid endpoint contribute to it. Earnings and repayment are not
        guaranteed.
      </p>
      <div className="fund-wallet">
        {!wallet ? (
          <>
            <label htmlFor="fund-wallet">Your wallet</label>
            <select
              id="fund-wallet"
              value={walletName}
              onChange={(e) => setWalletName(e.target.value)}
              disabled={busy}
            >
              {wallets.length ? (
                wallets.map(([id, w]) => (
                  <option value={id} key={id}>
                    {w.name ?? id}
                  </option>
                ))
              ) : (
                <option value="">No wallet detected</option>
              )}
            </select>
            <button
              className={walletName ? "btn primary" : "btn"}
              disabled={busy || !walletName}
              onClick={() => void run(connect)}
            >
              Connect wallet
            </button>
          </>
        ) : (
          <>
            <span className="fund-connected">
              <i aria-hidden />
              {address.slice(0, 16)}…{address.slice(-8)}
            </span>
            <button
              className="btn"
              disabled={busy}
              onClick={() => {
                setWallet(null);
                setAddress("");
              }}
            >
              Disconnect
            </button>
          </>
        )}
        <button
          className="btn spacer"
          disabled={busy}
          onClick={() => void run(refresh)}
        >
          Refresh rounds
        </button>
      </div>
      {!wallets.length && (
        <p className="muted small">
          Use this page in a browser with Eternl, Lace or another Cardano wallet
          installed. Select the preprod network. You need test tUSDM, test ADA
          for fees, and collateral for contract transactions.
        </p>
      )}
      {message && (
        <p className="fund-message" role="status">
          {message}
        </p>
      )}
      {pending && (
        <div className="panel fund-review">
          <h3>
            Review:{" "}
            {pending.action === "open"
              ? "offer a round"
              : pending.action === "fund"
                ? "fund this round"
                : pending.action === "cancel"
                  ? "cancel the unfunded offer"
                  : "release round earnings"}
          </h3>
          <p>
            Capital: {amount(pending.terms.capital)} tUSDM · investor share:{" "}
            {pending.terms.bps / 100}% · repayment cap:{" "}
            {amount(pending.terms.cap)} tUSDM.
          </p>
          <p>
            Estimated network fee: {amount(pending.fee)} test ADA. Your wallet
            shows the full outputs and any ADA needed with tokens.
          </p>
          <p className="mono">
            Round {pending.roundId.slice(0, 16)}… · transaction{" "}
            <a
              href={`https://preprod.cardanoscan.io/transaction/${pending.txHash}`}
              target="_blank"
              rel="noreferrer"
            >
              {pending.txHash.slice(0, 16)}… ↗
            </a>
          </p>
          <p>
            {pending.signedCbor
              ? "A signed transaction is saved. A retry submits exactly the same transaction, never a new payment."
              : "The operator receives capital only if the same transaction activates your investor share. Review all terms in your wallet before approving."}
          </p>
          <div className="fund-buttons">
            <button
              className="btn primary"
              disabled={busy || !wallet}
              onClick={() => void run(signAndSubmit)}
            >
              {pending.signedCbor
                ? "Resubmit saved transaction"
                : "Approve in wallet"}
            </button>
            <button
              className="btn"
              disabled={busy}
              onClick={() => void run(confirm)}
            >
              Check confirmation
            </button>
            {!pending.signedCbor && (
              <button
                className="btn"
                disabled={busy}
                onClick={() => void run(discardProposal)}
              >
                Cancel unsigned proposal
              </button>
            )}
          </div>
        </div>
      )}
      {loading && <p role="status">Reading funding rounds from Cardano…</p>}
      {!loading && !rounds.length && (
        <p className="panel">
          No rounds have been offered yet. Atlas’s operator can connect its
          wallet to create one.
        </p>
      )}
      <div className="fund-cards">
        {rounds.map((r) => (
          <article className="panel" key={r.id}>
            <div className="sec-head">
              <h3>Atlas · {r.id.slice(0, 8)}</h3>
              <span className="round-badge">
                {r.stage === "offered" ? "Open for funding" : r.stage}
              </span>
            </div>
            <dl className="fund-facts">
              <div>
                <dt>Capital</dt>
                <dd>{amount(r.capital)} tUSDM</dd>
              </div>
              <div>
                <dt>Revenue share</dt>
                <dd>{r.bps / 100}%</dd>
              </div>
              <div>
                <dt>Repayment cap</dt>
                <dd>{amount(r.cap)} tUSDM</dd>
              </div>
              <div>
                <dt>Repaid</dt>
                <dd>{amount(r.paid)} tUSDM</dd>
              </div>
              <div>
                <dt>Awaiting release</dt>
                <dd>{amount(r.waiting)} tUSDM</dd>
              </div>
            </dl>
            {r.error && <p role="status">{r.error}</p>}
            <p className="muted small">
              {r.stage === "offered"
                ? "Unfunded: the investor share is inactive."
                : r.stage === "closed"
                  ? "Cap reached: future deposits go entirely to Atlas."
                  : r.stage === "active"
                    ? "Funded: the contract enforces the share on each release."
                    : r.stage === "cancelled"
                      ? "Cancelled: this offer cannot be funded."
                      : "Waiting for a verified chain state."}
            </p>
            {r.investor && (
              <p className="muted small">
                Investor: {r.investor.slice(0, 18)}…{r.investor.slice(-8)}
              </p>
            )}
            <div className="fund-buttons">
              {r.stage === "offered" && (
                <button
                  className="btn primary"
                  disabled={
                    busy || !!pending || !wallet || address === r.operator
                  }
                  onClick={() => void run(() => prepare("fund", r.id))}
                >
                  Review funding · {amount(r.capital)} tUSDM
                </button>
              )}
              {r.stage === "offered" && address === r.operator && (
                <button
                  className="btn"
                  disabled={busy || !!pending}
                  onClick={() => void run(() => prepare("cancel", r.id))}
                >
                  Cancel offer
                </button>
              )}
              {["active", "closed", "cancelled"].includes(r.stage) &&
                BigInt(r.waiting) > 0n && (
                  <button
                    className="btn"
                    disabled={busy || !!pending || !wallet}
                    onClick={() => void run(() => prepare("distribute", r.id))}
                  >
                    Review earnings release
                  </button>
                )}
              <a
                href={`https://preprod.cardanoscan.io/address/${r.address}`}
                target="_blank"
                rel="noreferrer"
              >
                Inspect contract ↗
              </a>
            </div>
            {["active", "closed"].includes(r.stage) && (
              <details>
                <summary>Paid endpoint for this round</summary>
                <p>
                  Agent clients pay 0.50 tUSDM per report through x402. Payments
                  go directly to this round. This route does not currently use
                  the separate Chainlink demo gate.
                </p>
                <code className="fund-url">
                  {r.serviceUrl}?address=&lt;Cardano address&gt;
                </code>
              </details>
            )}
          </article>
        ))}
      </div>
      {address && address === operator && (
        <details className="panel">
          <summary>Offer a new Atlas round</summary>
          <p>
            This offer assigns a share of purchases through its dedicated
            endpoint. It does not redirect existing deals or Masumi earnings.
          </p>
          <div className="fund-fields">
            <label>
              Capital (tUSDM)
              <input
                inputMode="decimal"
                value={capital}
                onChange={(e) => setCapital(e.target.value)}
              />
            </label>
            <label>
              Investor share (%)
              <input
                inputMode="decimal"
                value={share}
                onChange={(e) => setShare(e.target.value)}
              />
            </label>
            <label>
              Repayment cap (tUSDM)
              <input
                inputMode="decimal"
                value={cap}
                onChange={(e) => setCap(e.target.value)}
              />
            </label>
          </div>
          <p className="muted small">
            Opening locks 5 test ADA in the round’s state coin, plus the network
            fee. The current contract keeps that state coin after closure.
          </p>
          <button
            className="btn"
            disabled={busy || !!pending}
            onClick={() => void run(() => prepare("open"))}
          >
            Review new offer
          </button>
        </details>
      )}
    </section>
  );
}

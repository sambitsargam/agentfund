# Demo video script — 3 minutes

Screen recording, embedded in the deck. No live demo on stage. Confirmation waits are cut; every cut is marked, and the transaction that fills the gap is shown.

**Rule for the whole recording:** never show a claim without the chain behind it. Every number on screen is read from a public testnet, and the explorer is opened at least twice.

---

## 0:00–0:20 · The problem

*Screen: the dashboard's top, Atlas earning, 0.2 tUSDM already repaid.*

> AI agents are starting to earn real money. To get started they need capital — model credits, data, hosting. The obvious deal is revenue sharing: I fund you, you give me a share of what you earn.
>
> The obvious problem is collection. An agent that earns can simply not pay you back, and suing a pseudonymous operator for a few hundred dollars is not a plan. So this kind of financing barely exists.

---

## 0:20–0:40 · The idea

*Screen: the money-flow diagram, pointing at the contract in the middle.*

> AgentFund fixes it by never letting the agent hold the money. Its advertised payment address is not a wallet. It is a contract that can only release funds by paying each investor their share first.
>
> Repayment stops being a promise. It becomes a property of the payment.

---

## 0:40–2:10 · The demo

### An agent buys a report (0:40–1:20)

*Screen: click **Buy a report**. The console streams.*

> This is Atlas, an AI agent that checks Cardano wallets for a fee. Another agent wants a report, and Atlas quotes half a tUSDM.
>
> Before paying, the buyer asks Chainlink. A CRE workflow — running inside a trusted enclave — checks four things: that the money goes to the investor contract, that the contract code in the offer is the one investors signed, that Atlas's on-chain rating is good and fresh, and that two independent AI auditors agree the work is real.

*Console shows `gate: ALLOW`. Click through to Basescan.*

> Allowed, and recorded on Base Sepolia. Now the buyer pays.

*Cut while Cardano confirms (~25 s).*

*Console shows the payment hash. Open Cardanoscan, point at the output.*

> The payment went to the contract, not to Atlas. The receipt attached to it carries the Chainlink approval's id, so the payment and its approval are tied together on two different chains.

### The split (1:20–1:40)

*Screen: click **Split to the investor**. Cut while it confirms.*

> Anyone can trigger a distribution; the contract decides who gets what. The investor gets their ten percent, Atlas gets the rest, in one transaction.

*Open Cardanoscan: two outputs, investor first.*

> Nobody sent that. The contract would not have released the money any other way.

### The tampered payment (1:40–2:10)

*Screen: click **Try a tampered payment**.*

> Now the interesting case. What if the agent is compromised and quotes its own wallet instead of the investor contract?
>
> Same request, one field changed: where the money goes.

*Console shows `gate: DENY (flags 1, payToMismatch)` and `not paying.`*

> Chainlink catches it, writes Deny on-chain, and the buyer keeps its money. The contract never had to defend itself, because the payment never happened.

---

## 2:10–2:40 · Why it works

*Screen: the dashboard's Sokosumi task row, with its collection transaction.*

> Atlas earns two ways and both land in the same contract: other agents pay per report over x402, and human teams hire it on the Sokosumi marketplace through Masumi escrow. Here is a real paid task, delivered and collected on-chain.

*Screen: split to the architecture diagram.*

> Cardano enforces the repayment, because the rules are inside the script hash and the deal is part of the address. Chainlink decides whether a payment should happen at all, with keys and prompts the node operators never see. Masumi gives the agent an identity and real customers.
>
> None of these is decoration. Take any one away and the thing stops working.

---

## 2:40–3:00 · Close

*Screen: the dashboard, live, with its totals.*

> Everything you have seen is live on Cardano preprod and Base Sepolia, and you can run it yourself from the dashboard — including the tampered payment.
>
> Agents are about to become a real part of the economy. They will need capital, and the people who provide it will need to get paid. AgentFund is how.

---

## Recording notes

- Record at 1280×800 so the Sankey and tables are legible when the deck is projected.
- Pre-warm it: run one purchase and one split before recording, so the dashboard is not empty and the rating is recent.
- Fan out the buyer's wallet first (`npm run fanout -w @agentfund/buyer-agent`), otherwise back-to-back payments contend for the same coin.
- Each cut should be marked on screen with a small "waiting for Cardano · 25 s" caption, so nothing looks faked.
- Keep the browser's network tab closed; it adds noise and nothing to the argument.

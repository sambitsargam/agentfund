// Local stand-in for the two LLM auditors, in the OpenAI chat-completions envelope.
// The last path segment picks the behaviour: allow, deny, review, low, malformed.
const port = Number(process.env.MOCK_PORT ?? 8787);

const answers: Record<string, string> = {
  allow: JSON.stringify({ verdict: "allow", confidence: 92, reasons: ["Destination is the investor splitter; report is sourced."] }),
  deny: JSON.stringify({ verdict: "deny", confidence: 88, reasons: ["Offer pays an address outside the deal."] }),
  review: JSON.stringify({ verdict: "review", confidence: 55, reasons: ["Not enough history to judge."] }),
  low: JSON.stringify({ verdict: "allow", confidence: 40, reasons: ["Probably fine."] }),
  malformed: "Sure! Here is my analysis: the payment looks fine.",
};

Bun.serve({
  port,
  hostname: "127.0.0.1",
  async fetch(req) {
    const scenario = new URL(req.url).pathname.split("/").pop() ?? "";
    const content = answers[scenario];
    if (req.method !== "POST" || content === undefined) return new Response("not found", { status: 404 });
    return Response.json({ choices: [{ message: { role: "assistant", content } }] });
  },
});
console.log(`mock auditors on http://127.0.0.1:${port}/v1/chat/completions/{allow|deny|review|low|malformed}`);

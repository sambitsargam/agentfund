import { BLOCKFROST_PREPROD_URL, KOIOS_PREPROD_URL } from "./assets.js";

export type Fetch = (input: string, init?: RequestInit) => Promise<Response>;

export interface SourceRecord {
  provider: "blockfrost" | "koios";
  endpoint: string;
  txHashes?: string[];
}

export class UpstreamError extends Error {
  constructor(
    message: string,
    readonly provider: SourceRecord["provider"],
    readonly status?: number,
  ) {
    super(message);
    this.name = "UpstreamError";
  }
}

export interface ChainClientOptions {
  blockfrostProjectId: string;
  fetch?: Fetch;
  blockfrostUrl?: string;
  koiosUrl?: string;
  timeoutMs?: number;
}

/**
 * Thin Blockfrost/Koios client that remembers every call it made, so a report
 * can list exactly which endpoints it relied on.
 */
export class ChainClient {
  readonly sources: SourceRecord[] = [];
  private readonly fetchImpl: Fetch;
  private readonly blockfrostUrl: string;
  private readonly koiosUrl: string;
  private readonly timeoutMs: number;

  constructor(private readonly options: ChainClientOptions) {
    this.fetchImpl = options.fetch ?? ((input, init) => fetch(input, init));
    this.blockfrostUrl = options.blockfrostUrl ?? BLOCKFROST_PREPROD_URL;
    this.koiosUrl = options.koiosUrl ?? KOIOS_PREPROD_URL;
    this.timeoutMs = options.timeoutMs ?? 15_000;
  }

  /** Returns null on 404, which Blockfrost uses for "never seen on chain". */
  async blockfrost<T>(path: string, txHashes?: string[]): Promise<T | null> {
    const res = await this.request(
      "blockfrost",
      this.blockfrostUrl + path,
      { headers: { project_id: this.options.blockfrostProjectId } },
    );
    this.sources.push({ provider: "blockfrost", endpoint: path, ...(txHashes ? { txHashes } : {}) });
    if (res.status === 404) return null;
    if (!res.ok) throw new UpstreamError(`Blockfrost ${path} returned ${res.status}`, "blockfrost", res.status);
    return (await res.json()) as T;
  }

  async koios<T>(path: string, body: unknown): Promise<T> {
    const res = await this.request("koios", this.koiosUrl + path, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify(body),
    });
    this.sources.push({ provider: "koios", endpoint: path });
    if (!res.ok) throw new UpstreamError(`Koios ${path} returned ${res.status}`, "koios", res.status);
    return (await res.json()) as T;
  }

  private async request(provider: SourceRecord["provider"], url: string, init: RequestInit): Promise<Response> {
    // One retry for rate limits and transient 5xx; anything else surfaces immediately.
    for (let attempt = 0; ; attempt++) {
      let res: Response;
      try {
        res = await this.fetchImpl(url, { ...init, signal: AbortSignal.timeout(this.timeoutMs) });
      } catch (err) {
        if (attempt === 0) continue;
        throw new UpstreamError(`${provider} unreachable: ${(err as Error).message}`, provider);
      }
      if ((res.status === 429 || res.status >= 500) && attempt === 0) {
        await new Promise((r) => setTimeout(r, 1_000));
        continue;
      }
      return res;
    }
  }
}

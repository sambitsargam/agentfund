/** Sokosumi Core, authenticated as the Coworker with its runtime key. */
export class CoreClient {
  constructor(
    private readonly apiKey: string,
    private readonly baseUrl = "https://api.preprod.sokosumi.com",
  ) {
    if (!/^coworker_[A-Za-z0-9_-]+$/.test(apiKey)) throw new Error("Coworker runtime key has the wrong shape");
  }

  async get<T>(path: string): Promise<T> {
    return this.request<T>("GET", path);
  }

  async post<T>(path: string, body: unknown): Promise<T> {
    return this.request<T>("POST", path, body);
  }

  private async request<T>(method: string, path: string, body?: unknown): Promise<T> {
    const res = await fetch(this.baseUrl + path, {
      method,
      redirect: "error",
      signal: AbortSignal.timeout(30_000),
      headers: {
        Accept: "application/json",
        Authorization: `Bearer ${this.apiKey}`,
        ...(body === undefined ? {} : { "Content-Type": "application/json" }),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await res.text();
    if (!res.ok) throw new HttpError(`Core ${method} ${path} → ${res.status}`, res.status, text.slice(0, 500));
    const json = JSON.parse(text) as { data?: T };
    return (json.data ?? json) as T;
  }
}

/** Masumi Payment Service, authenticated with a scoped runtime token (never the admin key). */
export class MpsClient {
  constructor(
    private readonly baseUrl: string,
    private readonly token: string,
  ) {}

  async post<T>(path: string, body: unknown): Promise<T> {
    const res = await fetch(`${this.baseUrl.replace(/\/$/, "")}${path}`, {
      method: "POST",
      redirect: "error",
      signal: AbortSignal.timeout(30_000),
      headers: { "Content-Type": "application/json", token: this.token },
      body: JSON.stringify(body),
    });
    const text = await res.text();
    let json: { status?: string; data?: T } = {};
    try {
      json = JSON.parse(text);
    } catch {
      // fall through to the error below
    }
    if (!res.ok || json.status !== "success") {
      throw new HttpError(`MPS ${path} → ${res.status}`, res.status, text.slice(0, 500));
    }
    return json.data as T;
  }
}

export class HttpError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly body: string,
  ) {
    super(message);
    this.name = "HttpError";
  }
}

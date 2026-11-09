/** Every endpoint failed: timeouts, HTTP errors, unexpected node errors or malformed responses. Retryable. */
export class RpcTransportError extends Error {
  readonly attempts: { url: string; error: string }[];
  constructor(what: string, attempts: { url: string; error: string }[]) {
    super(`${what}: every RPC endpoint failed — ${attempts.map((a) => `${a.url}: ${a.error}`).join("; ")}`);
    this.name = "RpcTransportError";
    this.attempts = attempts;
  }
}

/** The request itself is invalid (for example a malformed account id). Retrying elsewhere cannot help. */
export class RpcRequestError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RpcRequestError";
  }
}

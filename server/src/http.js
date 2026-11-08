// The timeout and error mapping every outbound client shares: a request that
// runs too long becomes a 504 and any other failure to get an answer a 502,
// both as the caller's own error type. `run` gets the abort signal to hand to
// fetch and may read the body too, so the timeout covers the whole exchange.

export async function withTimeout(timeoutMs, ErrorType, run) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    return await run(controller.signal);
  } catch (err) {
    if (err.name === "AbortError") throw new ErrorType(`Timed out after ${timeoutMs}ms`, 504);
    if (err instanceof ErrorType) throw err;
    throw new ErrorType(err.message || "Request failed", 502);
  } finally {
    clearTimeout(timer);
  }
}

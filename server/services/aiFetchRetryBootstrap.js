require("dotenv").config();

const originalFetch = globalThis.fetch?.bind(globalThis);

if (typeof originalFetch === "function" && !globalThis.__aiTestPilotAiFetchRetryInstalled) {
  globalThis.__aiTestPilotAiFetchRetryInstalled = true;

  const baseUrl = String(process.env.QWEN_BASE_URL || "").replace(/\/$/, "");
  const configuredRetries = Number(process.env.QWEN_MAX_RETRIES ?? 1);
  const maxRetries = Math.max(0, Math.min(Number.isFinite(configuredRetries) ? Math.trunc(configuredRetries) : 1, 3));
  const retryDelayMs = Math.max(100, Math.min(Number(process.env.QWEN_RETRY_DELAY_MS || 500) || 500, 5000));

  function requestUrl(input) {
    if (typeof input === "string") return input;
    if (input instanceof URL) return input.toString();
    return String(input?.url || "");
  }

  function isAiRequest(input) {
    if (!baseUrl) return false;
    return requestUrl(input).startsWith(baseUrl);
  }

  function transportCause(err) {
    const cause = err?.cause || null;
    const code = String(cause?.code || err?.code || "").trim();
    const syscall = String(cause?.syscall || "").trim();
    const hostname = String(cause?.hostname || "").trim();
    const message = String(cause?.message || err?.message || "fetch failed").trim();
    return { code, syscall, hostname, message };
  }

  function isRetryableTransportError(err) {
    if (!err || err.name === "AbortError") return false;
    const { code } = transportCause(err);
    if (["ECONNRESET", "ECONNREFUSED", "ETIMEDOUT", "EAI_AGAIN", "ENETUNREACH", "EHOSTUNREACH", "UND_ERR_CONNECT_TIMEOUT", "UND_ERR_SOCKET"].includes(code)) return true;
    return err instanceof TypeError && /fetch failed/i.test(String(err.message || ""));
  }

  function wait(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  globalThis.fetch = async function aiProviderResilientFetch(input, init) {
    if (!isAiRequest(input)) return originalFetch(input, init);

    let attempt = 0;
    while (true) {
      try {
        return await originalFetch(input, init);
      } catch (err) {
        if (!isRetryableTransportError(err)) throw err;

        const details = transportCause(err);
        const label = details.code || "FETCH_FAILED";
        if (attempt >= maxRetries) {
          const location = details.hostname ? ` host=${details.hostname}` : "";
          const error = new Error(`AI provider transport failed after ${attempt + 1} attempt(s): ${label}${location}. ${details.message}`);
          error.code = label;
          error.cause = err;
          throw error;
        }

        attempt += 1;
        const delay = retryDelayMs * attempt;
        console.warn(`[ai-transport] transient ${label}; retry ${attempt}/${maxRetries} in ${delay}ms`);
        await wait(delay);
      }
    }
  };
}

import network from '../config/network.json';

/** Preserves caller cancellation and bounds network waits; never retries a mutation. */
export async function fetchWithDeadline(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const controller = new AbortController();
  const caller = init?.signal ?? (typeof Request !== 'undefined' && input instanceof Request ? input.signal : undefined);
  const abort = () => controller.abort();
  if (caller?.aborted) abort(); else caller?.addEventListener('abort', abort, { once: true });
  let timedOut = false;
  const timer = setTimeout(() => { timedOut = true; abort(); }, network.requestTimeoutMs);
  try {
    const response = await fetch(input, { ...init, signal: controller.signal });
    await response.clone().text();
    return response;
  }
  catch (error) {
    if (timedOut && !caller?.aborted) {
      const timeout = new Error('Network request deadline exceeded');
      timeout.name = 'TimeoutError';
      throw timeout;
    }
    throw error;
  }
  finally { clearTimeout(timer); caller?.removeEventListener('abort', abort); }
}

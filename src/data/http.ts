/** HTTP helper. Throttles requests per host so no API blocks us, and caches responses. v0.2.0 - Returns parsed JSON, or plain text for web pages. */
export type HttpGet = (url: string) => Promise<unknown>;

export class HttpError extends Error {
  constructor(
    readonly status: number,
    readonly url: string,
  ) {
    super(`HTTP ${status} for ${url}`);
  }
}

export type FetchLike = (url: string) => Promise<{ ok: boolean; status: number; text(): Promise<string> }>;

export interface HttpOptions {
  minIntervalMs?: Record<string, number>;
  cacheSize?: number;
}

export function createHttpGet(fetchFn: FetchLike, options: HttpOptions = {}): HttpGet {
  const intervals = options.minIntervalMs ?? {};
  const cacheSize = options.cacheSize ?? 500;
  const cache = new Map<string, Promise<unknown>>();
  const queues = new Map<string, Promise<void>>();

  const wait = (host: string): Promise<void> => {
    const gap = intervals[host] ?? 0;
    const previous = queues.get(host) ?? Promise.resolve();
    const next = previous.then(() => new Promise<void>((resolve) => setTimeout(resolve, gap)));
    queues.set(host, next);
    return previous;
  };

  return (url: string) => {
    const cached = cache.get(url);
    if (cached) return cached;
    const host = new URL(url).host;
    const request = wait(host).then(async () => {
      const response = await fetchFn(url);
      if (!response.ok) throw new HttpError(response.status, url);
      const body = await response.text();
      try {
        return JSON.parse(body) as unknown;
      } catch {
        return body;
      }
    });
    request.catch(() => cache.delete(url));
    cache.set(url, request);
    if (cache.size > cacheSize) {
      const oldest = cache.keys().next().value;
      if (oldest !== undefined) cache.delete(oldest);
    }
    return request;
  };
}

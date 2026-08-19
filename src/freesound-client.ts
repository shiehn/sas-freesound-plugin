/**
 * Thin typed client over host.httpRequest for the Freesound REST API.
 *
 * - Token auth (`Authorization: Token <api_key>`) for search.
 * - Politeness throttle: one request at a time, minimum spacing between
 *   requests (Freesound's per-key quota is modest — historically ~60/min).
 * - Errors are mapped to a small typed vocabulary the panel can render
 *   (401 → 'auth' → re-check credentials; 429 → 'rate-limit' → back off).
 */

import type { PluginHost } from '@signalsandsorcery/plugin-sdk';
import { SEARCH_URL, type FreesoundSearchPage } from './freesound-api';

export type FreesoundErrorKind = 'auth' | 'rate-limit' | 'http' | 'network' | 'parse';

export class FreesoundApiError extends Error {
  readonly kind: FreesoundErrorKind;
  readonly status?: number;

  constructor(kind: FreesoundErrorKind, message: string, status?: number) {
    super(message);
    this.name = 'FreesoundApiError';
    this.kind = kind;
    this.status = status;
  }
}

const DEFAULT_MIN_INTERVAL_MS = 1100;

export class FreesoundClient {
  private readonly host: PluginHost;
  private readonly minIntervalMs: number;
  /** Serialization tail — every request queues behind the previous one. */
  private tail: Promise<void> = Promise.resolve();
  private lastRequestAt = 0;
  private readonly now: () => number;
  private readonly sleep: (ms: number) => Promise<void>;

  constructor(
    host: PluginHost,
    options?: {
      minIntervalMs?: number;
      /** Injectable for tests. */
      now?: () => number;
      sleep?: (ms: number) => Promise<void>;
    }
  ) {
    this.host = host;
    this.minIntervalMs = options?.minIntervalMs ?? DEFAULT_MIN_INTERVAL_MS;
    this.now = options?.now ?? (() => Date.now());
    this.sleep = options?.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
  }

  /** Text search. `params` from query-builder; `apiKey` from the credential profile. */
  async search(params: Record<string, string>, apiKey: string): Promise<FreesoundSearchPage> {
    const qs = new URLSearchParams(params).toString();
    return this.requestJson<FreesoundSearchPage>(`${SEARCH_URL}?${qs}`, apiKey);
  }

  /** Follow a pagination URL (`next` / `previous` from a search page). */
  async getPage(url: string, apiKey: string): Promise<FreesoundSearchPage> {
    return this.requestJson<FreesoundSearchPage>(url, apiKey);
  }

  private async requestJson<T>(url: string, apiKey: string): Promise<T> {
    if (!apiKey) {
      throw new FreesoundApiError('auth', 'No Freesound API key configured.');
    }

    // Queue behind the previous request and enforce spacing.
    const run = this.tail.then(async (): Promise<T> => {
      const wait = this.lastRequestAt + this.minIntervalMs - this.now();
      if (wait > 0) await this.sleep(wait);
      this.lastRequestAt = this.now();

      let status: number;
      let body: string;
      try {
        const response = await this.host.httpRequest({
          url,
          method: 'GET',
          headers: { Authorization: `Token ${apiKey}` },
        });
        status = response.status;
        body = response.body;
      } catch (error: unknown) {
        const msg = error instanceof Error ? error.message : String(error);
        throw new FreesoundApiError('network', msg);
      }

      if (status === 401 || status === 403) {
        throw new FreesoundApiError('auth', `Freesound rejected the API key (${status}).`, status);
      }
      if (status === 429) {
        throw new FreesoundApiError('rate-limit', 'Freesound rate limit hit — slow down a moment.', 429);
      }
      if (status < 200 || status >= 300) {
        throw new FreesoundApiError('http', `Freesound returned HTTP ${status}.`, status);
      }

      try {
        return JSON.parse(body) as T;
      } catch {
        throw new FreesoundApiError('parse', 'Freesound returned an unparseable response.');
      }
    });

    // Keep the tail alive regardless of this request's outcome.
    this.tail = run.then(
      () => undefined,
      () => undefined
    );
    return run;
  }
}

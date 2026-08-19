import type { PluginHost } from '@signalsandsorcery/plugin-sdk';
import { FreesoundApiError, FreesoundClient } from '../freesound-client';

interface FakeResponse {
  status: number;
  body: string;
}

function hostWith(responses: FakeResponse[]): { host: PluginHost; calls: Array<Record<string, unknown>> } {
  const calls: Array<Record<string, unknown>> = [];
  let i = 0;
  const host = {
    httpRequest: jest.fn(async (options: Record<string, unknown>) => {
      calls.push(options);
      const r = responses[Math.min(i, responses.length - 1)];
      i += 1;
      return { status: r.status, statusText: '', headers: {}, body: r.body };
    }),
  } as unknown as PluginHost;
  return { host, calls };
}

const page = JSON.stringify({ count: 1, next: null, previous: null, results: [] });

describe('FreesoundClient', () => {
  it('sends Token auth and parses the page', async () => {
    const { host, calls } = hostWith([{ status: 200, body: page }]);
    const client = new FreesoundClient(host, { minIntervalMs: 0 });

    const result = await client.search({ query: 'kick' }, 'KEY');
    expect(result.count).toBe(1);
    expect(calls[0].url).toContain('https://freesound.org/apiv2/search/?query=kick');
    expect(calls[0].headers).toEqual({ Authorization: 'Token KEY' });
  });

  it('maps 401/403 → auth, 429 → rate-limit, 500 → http, bad JSON → parse', async () => {
    const cases: Array<[number, string, string]> = [
      [401, page, 'auth'],
      [403, page, 'auth'],
      [429, page, 'rate-limit'],
      [500, page, 'http'],
      [200, 'not json', 'parse'],
    ];
    for (const [status, body, kind] of cases) {
      const { host } = hostWith([{ status, body }]);
      const client = new FreesoundClient(host, { minIntervalMs: 0 });
      await expect(client.search({ query: 'x' }, 'KEY')).rejects.toMatchObject({ kind });
    }
  });

  it('throws auth immediately with no key (no request made)', async () => {
    const { host, calls } = hostWith([{ status: 200, body: page }]);
    const client = new FreesoundClient(host, { minIntervalMs: 0 });
    await expect(client.search({ query: 'x' }, '')).rejects.toBeInstanceOf(FreesoundApiError);
    expect(calls.length).toBe(0);
  });

  it('network failures from httpRequest map to network errors', async () => {
    const host = {
      httpRequest: jest.fn(async () => {
        throw new Error('boom');
      }),
    } as unknown as PluginHost;
    const client = new FreesoundClient(host, { minIntervalMs: 0 });
    await expect(client.search({ query: 'x' }, 'KEY')).rejects.toMatchObject({ kind: 'network' });
  });

  it('throttles: spaces consecutive requests by minIntervalMs', async () => {
    const { host } = hostWith([{ status: 200, body: page }]);
    // Start well past 0 so the first request (lastRequestAt=0) doesn't wait.
    let clock = 10_000;
    const sleeps: number[] = [];
    const client = new FreesoundClient(host, {
      minIntervalMs: 1000,
      now: () => clock,
      sleep: async (ms) => {
        sleeps.push(ms);
        clock += ms;
      },
    });

    await client.search({ query: 'a' }, 'KEY'); // t=0, no wait
    await client.search({ query: 'b' }, 'KEY'); // needs 1000ms spacing
    expect(sleeps).toEqual([1000]);
  });

  it('a failed request does not poison the queue', async () => {
    const { host } = hostWith([
      { status: 500, body: page },
      { status: 200, body: page },
    ]);
    const client = new FreesoundClient(host, { minIntervalMs: 0 });
    await expect(client.search({ query: 'a' }, 'KEY')).rejects.toMatchObject({ kind: 'http' });
    await expect(client.search({ query: 'b' }, 'KEY')).resolves.toMatchObject({ count: 1 });
  });
});

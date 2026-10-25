import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { OpenRouteServiceProvider, parseRetryAfter } from '../src/generator/routing/openrouteservice.ts';
import { RoutingError } from '../src/generator/routing/types.ts';

const FIXTURE = readFileSync(new URL('./fixtures/ors-directions-geojson.synthetic.json', import.meta.url), 'utf8');
const REQUEST = { from: [34.2203, 134.4127] as [number, number], to: [34.2095, 134.4311] as [number, number], via: [], profile: 'foot-walking' };

function setup(responses: Array<() => Response>) {
  const requests: { url: string; init: RequestInit }[] = [];
  const sleeps: number[] = [];
  const provider = new OpenRouteServiceProvider({
    apiKey: 'test-key',
    minIntervalMs: 0,
    fetch: async (url, init) => {
      requests.push({ url: String(url), init: init! });
      const next = responses.shift();
      if (!next) throw new Error('予期しない追加リクエスト');
      return next();
    },
    sleep: async (ms) => {
      sleeps.push(ms);
    },
  });
  return { provider, requests, sleeps };
}

const ok = () => new Response(FIXTURE, { status: 200, headers: { 'Content-Type': 'application/geo+json' } });

describe('OpenRouteServiceProvider', () => {
  it('[経度,緯度]でPOSTし、GeoJSONから距離・時間・スナップ端点を取り出す', async () => {
    const { provider, requests } = setup([ok]);
    const result = await provider.route(REQUEST);
    expect(requests[0]!.url).toBe('https://api.openrouteservice.org/v2/directions/foot-walking/geojson');
    expect((requests[0]!.init.headers as Record<string, string>).Authorization).toBe('test-key');
    expect(JSON.parse(requests[0]!.init.body as string).coordinates).toEqual([
      [134.4127, 34.2203],
      [134.4311, 34.2095],
    ]);
    expect(result.distanceMeters).toBe(2184.6);
    expect(result.estimatedDurationSeconds).toBe(1572.9);
    expect(result.snappedFrom).toEqual([134.412701, 34.220318]);
    expect(result.snappedTo).toEqual([134.431107, 34.209458]);
  });

  it('429ではRetry-Afterを尊重して再試行する', async () => {
    const { provider, sleeps } = setup([() => new Response('rate limited', { status: 429, headers: { 'Retry-After': '7' } }), ok]);
    await provider.route(REQUEST);
    expect(sleeps).toEqual([7000]);
  });

  it('一時的な5xxは回数上限付きで再試行する', async () => {
    const unavailable = () => new Response('busy', { status: 503 });
    const { provider, requests } = setup([unavailable, unavailable, unavailable, unavailable]);
    await expect(provider.route(REQUEST)).rejects.toThrow(/503/);
    expect(requests).toHaveLength(4);
  });

  it('通信エラー後に成功すれば結果を返す', async () => {
    const { provider } = setup([
      () => {
        throw new TypeError('fetch failed');
      },
      ok,
    ]);
    await expect(provider.route(REQUEST)).resolves.toMatchObject({ distanceMeters: 2184.6 });
  });

  it.each([
    [401, /認証/],
    [403, /403/],
    [400, /400/],
    [404, /404/],
  ])('%i は再試行しない', async (status, message) => {
    const { provider, requests } = setup([() => new Response('{"error":"x"}', { status })]);
    await expect(provider.route(REQUEST)).rejects.toThrow(message);
    expect(requests).toHaveLength(1);
  });

  it('応答形式が異なればエラー', async () => {
    const { provider } = setup([() => new Response('{"features":[]}', { status: 200 })]);
    await expect(provider.route(REQUEST)).rejects.toBeInstanceOf(RoutingError);
  });

  it('APIキーがなければ作れない', () => {
    expect(() => new OpenRouteServiceProvider({ apiKey: '' })).toThrow(/ROUTING_API_KEY/);
  });

  it('分間上限を超えないよう呼び出し間隔を空ける', async () => {
    let now = 0;
    const sleeps: number[] = [];
    const provider = new OpenRouteServiceProvider({
      apiKey: 'k',
      minIntervalMs: 1600,
      fetch: async () => ok(),
      sleep: async (ms) => {
        sleeps.push(ms);
        now += ms;
      },
      now: () => now,
    });
    await provider.route(REQUEST);
    now += 100;
    await provider.route(REQUEST);
    expect(sleeps).toEqual([1500]);
  });
});

describe('parseRetryAfter', () => {
  it('秒数とHTTP日付を解釈する', () => {
    expect(parseRetryAfter('3', 0)).toBe(3000);
    expect(parseRetryAfter('Thu, 01 Jan 1970 00:00:10 GMT', 4000)).toBe(6000);
    expect(parseRetryAfter(null, 0)).toBeNull();
    expect(parseRetryAfter('soon', 0)).toBeNull();
  });
});

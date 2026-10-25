import { mkdtemp, readdir, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import { runUpdate, type UpdateOptions } from '../src/generator/update.ts';
import { DataStore } from '../src/generator/store.ts';
import { articleHtml, FakeProvider, TRIP, type LogEntry } from './helpers.ts';

const OTHER_TRIP = { ...TRIP, tripId: 'other-trip', articleUrl: 'https://example.hatenablog.com/entry/2026/03/14/060000' };
const LOG: LogEntry[] = [
  { time: '07:00', lat: 34.1, lng: 134.1 },
  { time: '08:00', lat: 34.2, lng: 134.2 },
  { time: '09:00', lat: 34.3, lng: 134.3 },
];

let dir: string;
let dataDir: string;
let htmlFile: string;

beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), 'toho-plot-test-'));
  dataDir = path.join(dir, 'data');
  htmlFile = path.join(dir, 'article.html');
});

async function update(log: LogEntry[], options: Partial<UpdateOptions> & { provider?: FakeProvider } = {}) {
  await writeFile(htmlFile, articleHtml(log));
  const provider = options.provider ?? new FakeProvider();
  const result = await runUpdate({
    tripId: TRIP.tripId,
    dataDir,
    htmlFile,
    trips: [TRIP, OTHER_TRIP],
    overridesDir: path.join(dir, 'overrides'),
    createProvider: () => provider,
    ...options,
  });
  return { result, provider };
}

const readTripFile = (tripId = TRIP.tripId) => readFile(path.join(dataDir, 'trips', tripId, 'trip.json'), 'utf8');
const routeFiles = async () => (await readdir(path.join(dataDir, 'routes'))).sort();

describe('runUpdate', () => {
  it('trip.jsonとルートキャッシュを保存し、変更なしの再実行ではファイルを書き換えない', async () => {
    await update(LOG);
    const first = await readTripFile();
    expect(await routeFiles()).toHaveLength(2);

    const { result, provider } = await update(LOG);
    expect(provider.calls).toHaveLength(0);
    expect(result.changed).toBe(false);
    expect(await readTripFile()).toBe(first);
  });

  it('途中のAPI失敗では公開用trip.jsonを変更せず、取得済みルートだけ保存して再実行で再利用する', async () => {
    await update(LOG);
    const before = await readTripFile();

    const appended = [...LOG, { time: '10:00', lat: 34.4, lng: 134.4 }, { time: '11:00', lat: 34.5, lng: 134.5 }];
    const failing = Object.assign(new FakeProvider(), { failAt: 2 });
    await expect(update(appended, { provider: failing })).rejects.toThrow(/ルート取得に失敗/);
    expect(await readTripFile()).toBe(before);
    expect(await routeFiles()).toHaveLength(3);

    const { provider, result } = await update(appended);
    expect(provider.calls).toHaveLength(1);
    expect(result.trip.points).toHaveLength(5);
  });

  it('APIキーがなくても変更がなければ成功する', async () => {
    await update(LOG);
    await expect(
      update(LOG, { createProvider: () => { throw new Error('ROUTING_API_KEY が設定されていません'); } }),
    ).resolves.toBeTruthy();
  });

  it('別の旅のデータとそのルートキャッシュを消さない', async () => {
    await update(LOG, { tripId: OTHER_TRIP.tripId });
    const other = await readTripFile(OTHER_TRIP.tripId);
    const otherRoutes = await routeFiles();

    await update([{ time: '07:00', lat: 35.1, lng: 135.1 }, { time: '08:00', lat: 35.2, lng: 135.2 }]);
    expect(await readTripFile(OTHER_TRIP.tripId)).toBe(other);
    expect(await routeFiles()).toEqual(expect.arrayContaining(otherRoutes));
  });

  it('座標修正で不要になったルートキャッシュは削除する', async () => {
    await update(LOG);
    const moved = LOG.map((e, i) => (i === 2 ? { ...e, lat: 34.35 } : e));
    const { result } = await update(moved);
    expect(result.prunedRoutes).toHaveLength(1);
    const trip = await new DataStore(dataDir).readTrip(TRIP.tripId);
    expect((await routeFiles()).map((f) => f.replace('.json', ''))).toEqual(
      trip!.segments.map((s) => s.routeCacheKey).sort(),
    );
  });

  it('dry-runでは何も保存しない', async () => {
    await update(LOG, { dryRun: true });
    await expect(readdir(dataDir)).rejects.toThrow();
  });

  it('未登録のtripIdは拒否する', async () => {
    await expect(update(LOG, { tripId: '../../etc' })).rejects.toThrow(/未登録/);
  });
});

describe('fetchArticle', () => {
  it('未登録ホストへの転送は、articleUrlの更新を促すエラーにする', async () => {
    const { fetchArticle } = await import('../src/generator/fetch.ts');
    const fakeFetch = (async () =>
      Object.defineProperty(new Response('<html></html>', { headers: { 'Content-Type': 'text/html' } }), 'url', {
        value: 'https://blog.example.org/entry/1',
      })) as typeof fetch;
    await expect(
      fetchArticle('https://example.hatenablog.com/entry/1', { allowedHosts: new Set(['example.hatenablog.com']), fetch: fakeFetch }),
    ).rejects.toThrow(/trips\.json の articleUrl を転送先/);
  });
});

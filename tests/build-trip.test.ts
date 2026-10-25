import { describe, expect, it } from 'vitest';
import { BuildTripError, buildTrip, routeCacheKey, type BuildTripInput } from '../src/generator/build-trip.ts';
import { ORS_SPEC } from '../src/generator/routing/openrouteservice.ts';
import type { OverridesFile, Point, RouteCacheEntry, TripData } from '../src/shared/schema.ts';
import { FakeProvider, TRIP } from './helpers.ts';

function point(i: number, overrides: Partial<Point> = {}): Point {
  const hh = (7 + i).toString().padStart(2, '0');
  return {
    id: `a-${hh}00-1`,
    order: i,
    recordedAt: `2026-03-15T${hh}:00:00+09:00`,
    lat: 34 + i * 0.01,
    lng: 134 + i * 0.01,
    photos: [],
    comment: `地点${i}`,
    originalMapUrl: `https://www.google.com/maps?q=${34 + i * 0.01},${134 + i * 0.01}`,
    ...overrides,
  };
}

const points = (n: number) => Array.from({ length: n }, (_, i) => point(i));

/** 1回分の更新を実行し、生成ルートをキャッシュへ反映する（実際の保存処理の代わり） */
class Harness {
  cache = new Map<string, RouteCacheEntry>();
  previous: TripData | null = null;
  provider = new FakeProvider();
  clock = 0;

  async run(pts: Point[], extra: Partial<BuildTripInput> = {}, overrides: OverridesFile = { segments: [] }) {
    this.provider = new FakeProvider();
    const result = await buildTrip({
      trip: TRIP,
      points: pts,
      previous: this.previous,
      overrides,
      spec: ORS_SPEC,
      getProvider: () => this.provider,
      cache: { readRoute: async (key) => this.cache.get(key) ?? null },
      now: () => new Date(Date.UTC(2026, 9, 25, 0, 0, this.clock++)),
      ...extra,
    });
    for (const route of result.newRoutes) this.cache.set(route.cacheKey, route);
    if (result.changed) this.previous = result.trip;
    return result;
  }
}

describe('buildTrip', () => {
  it('N地点からN-1区間を作り、GeoJSONは[経度,緯度]で保存する', async () => {
    const h = new Harness();
    const { trip, stats } = await h.run(points(3));
    expect(trip.segments).toHaveLength(2);
    expect(stats).toMatchObject({ routedSegments: 2, reusedSegments: 0 });
    expect(trip.segments[0]!.geometry.coordinates[0]).toEqual([134, 34]);
    expect(trip.estimatedTotalDistanceMeters).toBe(2000);
    expect(trip.attribution).toEqual([ORS_SPEC.attribution]);
  });

  it('1地点はピンだけの有効な地図になり、APIを呼ばない', async () => {
    const h = new Harness();
    const { trip } = await h.run(points(1), { getProvider: () => { throw new Error('APIキーなし'); } });
    expect(trip.segments).toEqual([]);
  });

  it('変更なしではルーティング呼び出し0、generatedAtも変えない', async () => {
    const h = new Harness();
    const first = await h.run(points(4));
    const second = await h.run(points(4), { getProvider: () => { throw new Error('呼ばれないはず'); } });
    expect(second.stats.routedSegments).toBe(0);
    expect(second.changed).toBe(false);
    expect(second.trip.generatedAt).toBe(first.trip.generatedAt);
  });

  it('末尾に1地点追加すると新しい1区間だけ計算する', async () => {
    const h = new Harness();
    await h.run(points(4));
    const result = await h.run(points(5));
    expect(h.provider.calls).toHaveLength(1);
    expect(h.provider.calls[0]!.from).toEqual([34.03, 134.03]);
    expect(result.stats).toMatchObject({ reusedSegments: 3, routedSegments: 1 });
    expect(result.changed).toBe(true);
  });

  it('中間地点の座標修正では隣接2区間だけ再計算し、旧座標のルートを流用しない', async () => {
    const h = new Harness();
    await h.run(points(5));
    const moved = points(5);
    moved[2] = { ...moved[2]!, lat: 34.025, lng: 134.021 };
    const result = await h.run(moved);
    expect(h.provider.calls.map((c) => [c.from, c.to])).toEqual([
      [[34.01, 134.01], [34.025, 134.021]],
      [[34.025, 134.021], [34.03, 134.03]],
    ]);
    expect(result.trip.segments[1]!.geometry.coordinates.at(-1)).toEqual([134.021, 34.025]);
  });

  it('写真・コメント・時刻だけの修正ではルートを再利用する', async () => {
    const h = new Harness();
    await h.run(points(3));
    const edited = points(3).map((p) => ({ ...p, comment: `${p.comment}（追記）`, photos: [{ url: 'https://example.com/a.jpg', alt: '' }] }));
    const result = await h.run(edited);
    expect(h.provider.calls).toHaveLength(0);
    expect(result.changed).toBe(true);
    expect(result.trip.points[0]!.comment).toBe('地点0（追記）');
  });

  it('補助経由点の変更では対象区間だけ再計算する', async () => {
    const h = new Harness();
    const pts = points(4);
    await h.run(pts);
    const overrides = { segments: [{ fromPointId: pts[1]!.id, toPointId: pts[2]!.id, via: [[34.5, 134.5]] as [number, number][] }] };
    const result = await h.run(pts, {}, overrides);
    expect(h.provider.calls).toHaveLength(1);
    expect(h.provider.calls[0]!.via).toEqual([[34.5, 134.5]]);
    expect(result.trip.segments[1]!.distanceMeters).toBe(2000);

    // 同じ補助経由点ならキャッシュを使う
    await h.run(pts, {}, overrides);
    expect(h.provider.calls).toHaveLength(0);
  });

  it('使われない補助経由点は警告する', async () => {
    const h = new Harness();
    const result = await h.run(points(3), {}, { segments: [{ fromPointId: 'x', toPointId: 'y', via: [[1, 1]] }] });
    expect(result.warnings.some((w) => w.includes('x → y'))).toBe(true);
  });

  it('force-rerouteで全区間を再計算する', async () => {
    const h = new Harness();
    await h.run(points(4));
    await h.run(points(4), { forceReroute: true });
    expect(h.provider.calls).toHaveLength(3);
  });

  it('完全に同一の連続座標はAPIを呼ばず距離0', async () => {
    const h = new Harness();
    const pts = points(3);
    pts[2] = { ...pts[2]!, lat: pts[1]!.lat, lng: pts[1]!.lng };
    const { trip, stats } = await h.run(pts);
    expect(h.provider.calls).toHaveLength(1);
    expect(stats.identicalPointSegments).toBe(1);
    expect(trip.segments[1]).toMatchObject({ method: 'identical-points', distanceMeters: 0, routeCacheKey: null });
  });

  it('地点数が減ったらallow-removalなしでは停止する', async () => {
    const h = new Harness();
    await h.run(points(4));
    await expect(h.run(points(3))).rejects.toThrow(/allow_removal/);
    const result = await h.run(points(3), { allowRemoval: true });
    expect(result.trip.points).toHaveLength(3);
  });

  it('0地点は失敗', async () => {
    await expect(new Harness().run([])).rejects.toThrow(/0件/);
  });

  it('途中のAPI失敗では取得済みルートを添えて失敗し、直線で代用しない', async () => {
    const promise = buildTrip({
      trip: TRIP,
      points: points(4),
      previous: null,
      overrides: { segments: [] },
      spec: ORS_SPEC,
      getProvider: () => Object.assign(new FakeProvider(), { failAt: 2 }),
      cache: { readRoute: async () => null },
    });
    const error = await promise.catch((e: unknown) => e);
    expect(error).toBeInstanceOf(BuildTripError);
    expect((error as BuildTripError).completedRoutes).toHaveLength(1);
  });

  it('時刻の逆転は自動補正せず警告する', async () => {
    const pts = points(2);
    pts[1] = { ...pts[1]!, recordedAt: '2026-03-15T06:00:00+09:00' };
    const result = await new Harness().run(pts);
    expect(result.trip.points[1]!.recordedAt).toBe('2026-03-15T06:00:00+09:00');
    expect(result.warnings.some((w) => w.includes('dateOverrides'))).toBe(true);
  });
});

describe('routeCacheKey', () => {
  it('座標・経由点・プロファイル・オプション版で変わる', () => {
    const base = routeCacheKey(ORS_SPEC, 'foot-walking', [34, 134], [35, 135], []);
    expect(routeCacheKey(ORS_SPEC, 'foot-walking', [34, 134], [35, 135], [])).toBe(base);
    expect(routeCacheKey(ORS_SPEC, 'foot-walking', [34, 134], [35, 135.0001], [])).not.toBe(base);
    expect(routeCacheKey(ORS_SPEC, 'foot-hiking', [34, 134], [35, 135], [])).not.toBe(base);
    expect(routeCacheKey(ORS_SPEC, 'foot-walking', [34, 134], [35, 135], [[34.5, 134.5]])).not.toBe(base);
    expect(routeCacheKey({ ...ORS_SPEC, optionsVersion: 'x' }, 'foot-walking', [34, 134], [35, 135], [])).not.toBe(base);
    expect(base).toMatch(/^[0-9a-f]{64}$/);
  });
});

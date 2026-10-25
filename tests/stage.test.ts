import { mkdtemp, readdir, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { expect, it } from 'vitest';
import { buildTrip } from '../src/generator/build-trip.ts';
import { ORS_SPEC } from '../src/generator/routing/openrouteservice.ts';
import { stageData } from '../src/generator/stage.ts';
import { DataStore } from '../src/generator/store.ts';
import { siteIndexSchema } from '../src/shared/schema.ts';
import { FakeProvider, TRIP } from './helpers.ts';

it('登録済みの全旅を配置し、ルートキャッシュは含めない', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'toho-plot-stage-'));
  const store = new DataStore(path.join(dir, 'data'));
  const trips = [TRIP, { ...TRIP, tripId: 'second' }, { ...TRIP, tripId: 'not-generated-yet' }];
  for (const trip of trips.slice(0, 2)) {
    const { trip: data, newRoutes } = await buildTrip({
      trip,
      points: [0, 1].map((i) => ({
        id: `p${i}`, order: i, recordedAt: `2026-03-15T0${i}:00:00+09:00`, lat: 34 + i, lng: 134, photos: [], comment: '',
        originalMapUrl: 'https://www.google.com/maps?q=34,134',
      })),
      previous: null,
      overrides: { segments: [] },
      spec: ORS_SPEC,
      getProvider: () => new FakeProvider(),
      cache: store,
    });
    for (const r of newRoutes) await store.writeRoute(r);
    await store.writeTrip(data);
  }

  const outDir = path.join(dir, 'out');
  const result = await stageData({ dataDir: store.dir, outDir, trips });
  expect(result).toEqual({ published: ['test-trip', 'second'], missing: ['not-generated-yet'] });
  expect((await readdir(outDir)).sort()).toEqual(['index.json', 'trips']);
  expect((await readdir(path.join(outDir, 'trips'))).sort()).toEqual(['second.json', 'test-trip.json']);
  const index = siteIndexSchema.parse(JSON.parse(await readFile(path.join(outDir, 'index.json'), 'utf8')));
  expect(index.trips.map((t) => t.pointCount)).toEqual([2, 2]);
});

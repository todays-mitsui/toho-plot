// generated-dataから公開用のJSONだけを取り出してビューアのビルド入力に配置する。
// ルートキャッシュや記事HTMLは公開物に含めない。
import { rm } from 'node:fs/promises';
import path from 'node:path';
import { SCHEMA_VERSION, siteIndexSchema, type SiteIndex, type TripConfig } from '../shared/schema.ts';
import { DataStore, writeJsonAtomic } from './store.ts';

export async function stageData({ dataDir, outDir, trips }: { dataDir: string; outDir: string; trips: TripConfig[] }) {
  const store = new DataStore(dataDir);
  await rm(outDir, { recursive: true, force: true });

  const index: SiteIndex = { schemaVersion: SCHEMA_VERSION, trips: [] };
  const missing: string[] = [];
  // 公開対象は trips.json に登録された旅だけ。対象外の旅も含めてサイト全体を毎回組み立てる
  for (const config of trips) {
    const trip = await store.readTrip(config.tripId);
    if (!trip) {
      missing.push(config.tripId);
      continue;
    }
    await writeJsonAtomic(path.join(outDir, 'trips', `${trip.tripId}.json`), trip);
    index.trips.push({
      tripId: trip.tripId,
      title: trip.title,
      articleUrl: trip.articleUrl,
      journeyDate: trip.journeyDate,
      generatedAt: trip.generatedAt,
      pointCount: trip.points.length,
    });
  }
  await writeJsonAtomic(path.join(outDir, 'index.json'), siteIndexSchema.parse(index));
  return { published: index.trips.map((t) => t.tripId), missing };
}

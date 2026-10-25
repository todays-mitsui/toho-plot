// 1つの旅の更新: 記事取得 → 解析 → 差分ルート計算 → 保存
import { readFile } from 'node:fs/promises';
import type { TripConfig } from '../shared/schema.ts';
import { BuildTripError, buildTrip, type BuildTripResult } from './build-trip.ts';
import { findTrip, loadOverrides, loadTrips } from './config.ts';
import { fetchArticle } from './fetch.ts';
import { parseArticle } from './parse.ts';
import { OpenRouteServiceProvider, ORS_SPEC } from './routing/openrouteservice.ts';
import type { RoutingProvider } from './routing/types.ts';
import { DataStore } from './store.ts';

export interface UpdateOptions {
  tripId: string;
  dataDir: string;
  forceReroute?: boolean;
  allowRemoval?: boolean;
  /** 記事を取得せずにローカルのHTMLを使う（開発・テスト用） */
  htmlFile?: string;
  /** 結果を保存しない */
  dryRun?: boolean;
  env?: NodeJS.ProcessEnv;
  trips?: TripConfig[];
  overridesDir?: string;
  createProvider?: () => RoutingProvider;
}

export interface UpdateResult extends BuildTripResult {
  tripConfig: TripConfig;
  prunedRoutes: string[];
}

export async function runUpdate(options: UpdateOptions): Promise<UpdateResult> {
  const env = options.env ?? process.env;
  const trips = options.trips ?? (await loadTrips());
  const tripConfig = findTrip(trips, options.tripId);
  const store = new DataStore(options.dataDir);

  let html: string;
  if (options.htmlFile) {
    html = await readFile(options.htmlFile, 'utf8');
  } else {
    console.log(`記事を取得: ${tripConfig.articleUrl} (${new Date().toISOString()})`);
    html = await fetchArticle(tripConfig.articleUrl, {
      allowedHosts: new Set(trips.map((t) => new URL(t.articleUrl).hostname)),
    });
  }

  const points = parseArticle(html, { trip: tripConfig });
  console.log(`地点を${points.length}件抽出しました`);

  const createProvider =
    options.createProvider ??
    (() =>
      new OpenRouteServiceProvider({
        apiKey: env.ROUTING_API_KEY ?? '',
        baseUrl: env.ROUTING_API_BASE_URL || undefined,
      }));

  let result: BuildTripResult;
  try {
    result = await buildTrip({
      trip: tripConfig,
      points,
      previous: await store.readTrip(tripConfig.tripId),
      overrides: await loadOverrides(tripConfig.tripId, options.overridesDir),
      spec: ORS_SPEC,
      getProvider: createProvider,
      cache: store,
      forceReroute: options.forceReroute,
      allowRemoval: options.allowRemoval,
    });
  } catch (error) {
    // 取得済みのルートだけ保存し、次回の再実行で再利用する。trip.json（公開データ）は変更しない
    if (error instanceof BuildTripError && !options.dryRun) {
      for (const route of error.completedRoutes) await store.writeRoute(route);
      if (error.completedRoutes.length > 0) {
        console.error(`失敗前に取得した${error.completedRoutes.length}区間のルートをキャッシュに保存しました`);
      }
    }
    throw error;
  }

  let prunedRoutes: string[] = [];
  if (!options.dryRun) {
    for (const route of result.newRoutes) await store.writeRoute(route);
    if (result.changed) await store.writeTrip(result.trip);
    prunedRoutes = await store.pruneRoutes();
  }
  return { ...result, tripConfig, prunedRoutes };
}

export function formatSummary(result: UpdateResult, siteUrl?: string): string {
  const { stats, trip, tripConfig } = result;
  const lines = [
    `## 地図更新: ${tripConfig.title}`,
    '',
    `| 項目 | 値 |`,
    `| --- | --- |`,
    `| tripId | \`${tripConfig.tripId}\` |`,
    `| 地点数 | ${stats.points} |`,
    `| 区間数 | ${stats.segments} |`,
    `| 再利用した区間 | ${stats.reusedSegments} |`,
    `| APIで計算した区間 | ${stats.routedSegments} |`,
    `| 同一座標の区間 | ${stats.identicalPointSegments} |`,
    `| 推定徒歩距離 | ${(trip.estimatedTotalDistanceMeters / 1000).toFixed(1)} km |`,
    `| 内容の変更 | ${result.changed ? 'あり' : 'なし'} |`,
    `| 地図データ更新日時 | ${trip.generatedAt} |`,
  ];
  if (siteUrl) lines.push(`| 公開URL | ${siteUrl}?trip=${encodeURIComponent(tripConfig.tripId)} |`);
  if (result.warnings.length > 0) {
    lines.push('', '### 確認が必要な箇所', '', ...result.warnings.map((w) => `- ${w}`));
  }
  return `${lines.join('\n')}\n`;
}

// 解析済み地点と前回データ・ルートキャッシュから、新しい旅データを組み立てる。
// ファイルへの書き込みは行わない（呼び出し側が全成功後にまとめて保存する）。
import { haversineMeters, lngLatToLatLng, pointLatLng } from '../shared/geo.ts';
import {
  SCHEMA_VERSION,
  tripDataSchema,
  type LatLng,
  type OverridesFile,
  type Point,
  type RouteCacheEntry,
  type Segment,
  type TripConfig,
  type TripData,
} from '../shared/schema.ts';
import { canonicalJson, sha256Hex } from './canonical.ts';
import type { RoutingProvider, RoutingSpec } from './routing/types.ts';

/** 迂回・スナップ距離の警告閾値。実際の道を断定するものではない */
const DETOUR_RATIO_WARN = 3;
const DETOUR_MIN_METERS = 1_000;
const SNAP_DISTANCE_WARN_METERS = 100;

export interface RouteCache {
  readRoute(cacheKey: string): Promise<RouteCacheEntry | null>;
}

export interface BuildTripInput {
  trip: TripConfig;
  points: Point[];
  previous: TripData | null;
  overrides: OverridesFile;
  spec: RoutingSpec;
  /** API呼び出しが必要になった時点で初めて作る（変更なしならAPIキー不要） */
  getProvider: () => RoutingProvider;
  cache: RouteCache;
  forceReroute?: boolean;
  allowRemoval?: boolean;
  now?: () => Date;
}

export interface BuildStats {
  points: number;
  segments: number;
  reusedSegments: number;
  routedSegments: number;
  identicalPointSegments: number;
}

export interface BuildTripResult {
  trip: TripData;
  /** 新たにAPIで計算したルート（保存対象） */
  newRoutes: RouteCacheEntry[];
  stats: BuildStats;
  warnings: string[];
  /** generatedAt以外の内容が前回から変わったか */
  changed: boolean;
}

export class BuildTripError extends Error {
  override name = 'BuildTripError';
  /** 失敗前に計算できたルート。次回の再実行で再利用できるよう保存してよい */
  readonly completedRoutes: RouteCacheEntry[];

  constructor(message: string, completedRoutes: RouteCacheEntry[] = [], options?: ErrorOptions) {
    super(message, options);
    this.completedRoutes = completedRoutes;
  }
}

export function routeCacheKey(spec: RoutingSpec, profile: string, from: LatLng, to: LatLng, via: LatLng[]): string {
  return sha256Hex(
    canonicalJson({
      provider: spec.name,
      optionsVersion: spec.optionsVersion,
      profile,
      from,
      to,
      via,
      options: spec.routingOptions,
    }),
  );
}

export async function buildTrip(input: BuildTripInput): Promise<BuildTripResult> {
  const { trip, points, previous, overrides, spec, cache } = input;
  const now = input.now ?? (() => new Date());
  const warnings: string[] = [];

  if (points.length === 0) throw new BuildTripError('地点が0件のため公開できません');
  if (previous && points.length < previous.points.length && !input.allowRemoval) {
    throw new BuildTripError(
      `地点数が前回の${previous.points.length}件から${points.length}件に減りました。誤解析の可能性があるため停止します。` +
        '意図した削除なら allow_removal を有効にして再実行してください',
    );
  }
  warnings.push(...checkTimeOrder(points));

  const viaByPair = new Map(overrides.segments.map((o) => [`${o.fromPointId}\n${o.toPointId}`, o.via]));
  const usedOverrides = new Set<string>();

  const stats: BuildStats = { points: points.length, segments: 0, reusedSegments: 0, routedSegments: 0, identicalPointSegments: 0 };
  const newRoutes: RouteCacheEntry[] = [];
  const segments: Segment[] = [];
  let provider: RoutingProvider | null = null;

  for (let i = 0; i + 1 < points.length; i++) {
    const from = points[i]!;
    const to = points[i + 1]!;
    const pairKey = `${from.id}\n${to.id}`;
    const via = viaByPair.get(pairKey) ?? [];
    if (viaByPair.has(pairKey)) usedOverrides.add(pairKey);
    const fromLatLng = pointLatLng(from);
    const toLatLng = pointLatLng(to);
    stats.segments++;

    if (via.length === 0 && from.lat === to.lat && from.lng === to.lng) {
      stats.identicalPointSegments++;
      segments.push(identicalPointSegment(from, to));
      continue;
    }

    const cacheKey = routeCacheKey(spec, trip.routingProfile, fromLatLng, toLatLng, via);
    let entry = input.forceReroute ? null : await cache.readRoute(cacheKey);
    if (entry) {
      stats.reusedSegments++;
    } else {
      provider ??= input.getProvider();
      try {
        const result = await provider.route({ from: fromLatLng, to: toLatLng, via, profile: trip.routingProfile });
        entry = {
          cacheKey,
          provider: spec.name,
          profile: trip.routingProfile,
          routingOptionsVersion: spec.optionsVersion,
          request: { from: fromLatLng, to: toLatLng, via },
          geometry: result.geometry,
          distanceMeters: result.distanceMeters,
          estimatedDurationSeconds: result.estimatedDurationSeconds,
          routedAt: now().toISOString(),
          attribution: spec.attribution,
          snappedFrom: result.snappedFrom,
          snappedTo: result.snappedTo,
        };
      } catch (error) {
        throw new BuildTripError(
          `区間 ${i + 1}/${points.length - 1} (${from.id} → ${to.id}) のルート取得に失敗: ${(error as Error).message}`,
          newRoutes,
          { cause: error },
        );
      }
      newRoutes.push(entry);
      stats.routedSegments++;
    }

    segments.push(segmentFromEntry(from, to, entry));
    warnings.push(...checkSegment(i, from, to, entry));
  }

  for (const key of viaByPair.keys()) {
    if (!usedOverrides.has(key)) {
      warnings.push(`補助経由点 ${key.replace('\n', ' → ')} は隣接する地点の組ではないため使われていません`);
    }
  }

  const attribution = [...new Set(segments.flatMap((s) => (s.attribution ? [s.attribution] : [])))];
  const draft = {
    schemaVersion: SCHEMA_VERSION,
    tripId: trip.tripId,
    title: trip.title,
    articleUrl: trip.articleUrl,
    journeyDate: trip.journeyDate,
    timeZone: trip.timeZone,
    sourceContentHash: sha256Hex(canonicalJson(points)),
    points,
    segments,
    estimatedTotalDistanceMeters: Math.round(segments.reduce((sum, s) => sum + s.distanceMeters, 0)),
    attribution,
  };

  const changed = !previous || canonicalJson(withoutGeneratedAt(previous)) !== canonicalJson(draft);
  const tripData = tripDataSchema.parse({
    ...draft,
    generatedAt: changed || !previous ? now().toISOString() : previous.generatedAt,
  });

  return { trip: tripData, newRoutes, stats, warnings, changed };
}

function withoutGeneratedAt({ generatedAt: _generatedAt, ...rest }: TripData) {
  return rest;
}

function identicalPointSegment(from: Point, to: Point): Segment {
  return {
    fromPointId: from.id,
    toPointId: to.id,
    method: 'identical-points',
    routeCacheKey: null,
    geometry: {
      type: 'LineString',
      coordinates: [
        [from.lng, from.lat],
        [to.lng, to.lat],
      ],
    },
    distanceMeters: 0,
    estimatedDurationSeconds: null,
    routedAt: null,
    provider: null,
    profile: null,
    attribution: null,
    routingOptionsVersion: null,
    snappedFrom: null,
    snappedTo: null,
  };
}

function segmentFromEntry(from: Point, to: Point, entry: RouteCacheEntry): Segment {
  return {
    fromPointId: from.id,
    toPointId: to.id,
    method: 'routed',
    routeCacheKey: entry.cacheKey,
    geometry: entry.geometry,
    distanceMeters: entry.distanceMeters,
    estimatedDurationSeconds: entry.estimatedDurationSeconds,
    routedAt: entry.routedAt,
    provider: entry.provider,
    profile: entry.profile,
    attribution: entry.attribution,
    routingOptionsVersion: entry.routingOptionsVersion,
    snappedFrom: entry.snappedFrom,
    snappedTo: entry.snappedTo,
  };
}

function checkSegment(index: number, from: Point, to: Point, entry: RouteCacheEntry): string[] {
  const warnings: string[] = [];
  const label = `区間 ${index + 1} (${from.id} → ${to.id})`;
  const straight = haversineMeters(pointLatLng(from), pointLatLng(to));
  if (entry.distanceMeters > DETOUR_MIN_METERS && entry.distanceMeters > straight * DETOUR_RATIO_WARN) {
    warnings.push(
      `${label}: 推定距離 ${Math.round(entry.distanceMeters)}m が直線距離 ${Math.round(straight)}m の${DETOUR_RATIO_WARN}倍超。迂回していないか確認してください`,
    );
  }
  for (const [name, original, snapped] of [
    ['始点', from, entry.snappedFrom],
    ['終点', to, entry.snappedTo],
  ] as const) {
    if (!snapped) continue;
    const d = haversineMeters(pointLatLng(original), lngLatToLatLng(snapped));
    if (d > SNAP_DISTANCE_WARN_METERS) {
      warnings.push(`${label}: ${name}が記録地点から${Math.round(d)}m離れた道路にスナップされました`);
    }
  }
  return warnings;
}

function checkTimeOrder(points: Point[]): string[] {
  const warnings: string[] = [];
  for (let i = 1; i < points.length; i++) {
    if (Date.parse(points[i]!.recordedAt) < Date.parse(points[i - 1]!.recordedAt)) {
      warnings.push(
        `地点 ${points[i]!.id} の時刻が前の地点より早くなっています。日付をまたいだ場合は trips.json の dateOverrides で日付を指定してください`,
      );
    }
  }
  return warnings;
}

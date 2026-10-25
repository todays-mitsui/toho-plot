// generatorとviewerの両方で使うデータ形式。generated-dataブランチの互換性はSCHEMA_VERSIONで管理する。
import { z } from 'zod';

export const SCHEMA_VERSION = 1;

const TRIP_ID = /^[a-z0-9][a-z0-9-]{0,63}$/;

export const latSchema = z.number().finite().min(-90).max(90);
export const lngSchema = z.number().finite().min(-180).max(180);

/** GeoJSONの座標順 [経度, 緯度] */
export const lngLatSchema = z.tuple([lngSchema, latSchema]);

/** 人が書く設定ファイル用の [緯度, 経度]（Google Mapsと同じ順） */
export const latLngSchema = z.tuple([latSchema, lngSchema]);

export const tripIdSchema = z.string().regex(TRIP_ID, 'tripIdは英小文字・数字・ハイフンのみ');

export const tripConfigSchema = z.object({
  tripId: tripIdSchema,
  title: z.string().min(1),
  articleUrl: z.url({ protocol: /^https$/ }),
  journeyDate: z.iso.date(),
  timeZone: z.string().min(1),
  routingProfile: z.string().min(1),
  /** 日付をまたいだ地点の日付補正。キーは地点ID */
  dateOverrides: z.record(z.string(), z.iso.date()).optional(),
});

export const tripsFileSchema = z.object({
  trips: z.array(tripConfigSchema).min(1),
});

export const photoSchema = z.object({
  url: z.url({ protocol: /^https?$/ }),
  alt: z.string(),
});

export const pointSchema = z.object({
  id: z.string().min(1),
  order: z.number().int().nonnegative(),
  recordedAt: z.iso.datetime({ offset: true }),
  lat: latSchema,
  lng: lngSchema,
  photos: z.array(photoSchema),
  comment: z.string(),
  originalMapUrl: z.url(),
});

export const lineStringSchema = z.object({
  type: z.literal('LineString'),
  coordinates: z.array(lngLatSchema).min(2),
});

export const segmentSchema = z.object({
  fromPointId: z.string(),
  toPointId: z.string(),
  /** routed: 徒歩APIで計算 / identical-points: 同一座標のためAPIを呼ばず距離0 */
  method: z.enum(['routed', 'identical-points']),
  routeCacheKey: z.string().nullable(),
  geometry: lineStringSchema,
  distanceMeters: z.number().nonnegative(),
  estimatedDurationSeconds: z.number().nonnegative().nullable(),
  routedAt: z.iso.datetime({ offset: true }).nullable(),
  provider: z.string().nullable(),
  profile: z.string().nullable(),
  attribution: z.string().nullable(),
  routingOptionsVersion: z.string().nullable(),
  /** APIが道路上にスナップした始終点 [経度, 緯度] */
  snappedFrom: lngLatSchema.nullable(),
  snappedTo: lngLatSchema.nullable(),
});

export const tripDataSchema = z.object({
  schemaVersion: z.literal(SCHEMA_VERSION),
  tripId: tripIdSchema,
  title: z.string(),
  articleUrl: z.url(),
  journeyDate: z.iso.date(),
  timeZone: z.string(),
  sourceContentHash: z.string(),
  generatedAt: z.iso.datetime({ offset: true }),
  points: z.array(pointSchema).min(1),
  segments: z.array(segmentSchema),
  estimatedTotalDistanceMeters: z.number().nonnegative(),
  attribution: z.array(z.string()),
});

export const routeCacheEntrySchema = z.object({
  cacheKey: z.string(),
  provider: z.string(),
  profile: z.string(),
  routingOptionsVersion: z.string(),
  request: z.object({
    from: latLngSchema,
    to: latLngSchema,
    via: z.array(latLngSchema),
  }),
  geometry: lineStringSchema,
  distanceMeters: z.number().nonnegative(),
  estimatedDurationSeconds: z.number().nonnegative().nullable(),
  routedAt: z.iso.datetime({ offset: true }),
  attribution: z.string(),
  snappedFrom: lngLatSchema.nullable(),
  snappedTo: lngLatSchema.nullable(),
});

export const overridesFileSchema = z.object({
  segments: z.array(
    z.object({
      fromPointId: z.string(),
      toPointId: z.string(),
      /** 補助経由点 [緯度, 経度]。順序どおりに経由する */
      via: z.array(latLngSchema).min(1),
      note: z.string().optional(),
    }),
  ),
});

/** ビューアが読むサイト内の旅一覧 */
export const siteIndexSchema = z.object({
  schemaVersion: z.literal(SCHEMA_VERSION),
  trips: z.array(
    z.object({
      tripId: tripIdSchema,
      title: z.string(),
      articleUrl: z.url(),
      journeyDate: z.iso.date(),
      generatedAt: z.iso.datetime({ offset: true }),
      pointCount: z.number().int(),
    }),
  ),
});

export type TripConfig = z.infer<typeof tripConfigSchema>;
export type Photo = z.infer<typeof photoSchema>;
export type Point = z.infer<typeof pointSchema>;
export type LngLat = z.infer<typeof lngLatSchema>;
export type LatLng = z.infer<typeof latLngSchema>;
export type LineString = z.infer<typeof lineStringSchema>;
export type Segment = z.infer<typeof segmentSchema>;
export type TripData = z.infer<typeof tripDataSchema>;
export type RouteCacheEntry = z.infer<typeof routeCacheEntrySchema>;
export type OverridesFile = z.infer<typeof overridesFileSchema>;
export type SiteIndex = z.infer<typeof siteIndexSchema>;

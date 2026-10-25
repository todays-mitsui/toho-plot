import type { LatLng, LineString, LngLat } from '../../shared/schema.ts';

export interface RouteRequest {
  from: LatLng;
  to: LatLng;
  /** 順序付き補助経由点 */
  via: LatLng[];
  profile: string;
}

export interface RouteResult {
  geometry: LineString;
  distanceMeters: number;
  estimatedDurationSeconds: number | null;
  snappedFrom: LngLat | null;
  snappedTo: LngLat | null;
}

/** キャッシュキーと出典表示に使う、プロバイダーの静的な情報（APIキー不要） */
export interface RoutingSpec {
  /** キャッシュキーに含めるプロバイダー名 */
  readonly name: string;
  /** API・リクエストオプションの版。経路に影響する変更をしたら上げる */
  readonly optionsVersion: string;
  /** 経路選択に影響するオプション（キャッシュキーに含める） */
  readonly routingOptions: Record<string, unknown>;
  readonly attribution: string;
}

/** 徒歩ルーティングAPIの差し替え口 */
export interface RoutingProvider extends RoutingSpec {
  route(request: RouteRequest): Promise<RouteResult>;
}

export class RoutingError extends Error {
  override name = 'RoutingError';
  readonly status: number | null;
  readonly retryable: boolean;
  /** 429のRetry-Afterなど、サーバーが指定した待ち時間 */
  readonly retryAfterMs: number | null;

  constructor(
    message: string,
    { status = null, retryable = false, retryAfterMs = null }: { status?: number | null; retryable?: boolean; retryAfterMs?: number | null } = {},
  ) {
    super(message);
    this.status = status;
    this.retryable = retryable;
    this.retryAfterMs = retryAfterMs;
  }
}

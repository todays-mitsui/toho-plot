// openrouteservice Directions V2 adapter
// 仕様の確認日・出典は README の「徒歩ルーティングAPI」節を参照。
import { z } from 'zod';
import { latLngToLngLat } from '../../shared/geo.ts';
import { lineStringSchema, type LngLat } from '../../shared/schema.ts';
import { RoutingError, type RouteRequest, type RouteResult, type RoutingProvider, type RoutingSpec } from './types.ts';

export const DEFAULT_ORS_BASE_URL = 'https://api.openrouteservice.org';

export const ORS_SPEC: RoutingSpec = {
  name: 'openrouteservice',
  optionsVersion: 'directions-v2-geojson-1',
  routingOptions: { preference: 'recommended' },
  attribution: '© openrouteservice.org by HeiGIT | Map data © OpenStreetMap contributors',
};

const responseSchema = z.object({
  features: z
    .array(
      z.object({
        geometry: lineStringSchema,
        properties: z.object({
          summary: z.object({
            distance: z.number().nonnegative().optional(),
            duration: z.number().nonnegative().optional(),
          }),
        }),
      }),
    )
    .min(1),
});

export interface OpenRouteServiceOptions {
  apiKey: string;
  baseUrl?: string;
  timeoutMs?: number;
  maxAttempts?: number;
  /** 分間上限 (40 req/min) を超えないための最小呼び出し間隔 */
  minIntervalMs?: number;
  fetch?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
}

export class OpenRouteServiceProvider implements RoutingProvider {
  readonly name = ORS_SPEC.name;
  readonly optionsVersion = ORS_SPEC.optionsVersion;
  readonly routingOptions = ORS_SPEC.routingOptions;
  readonly attribution = ORS_SPEC.attribution;

  readonly #apiKey: string;
  readonly #baseUrl: string;
  readonly #timeoutMs: number;
  readonly #maxAttempts: number;
  readonly #minIntervalMs: number;
  readonly #fetch: typeof fetch;
  readonly #sleep: (ms: number) => Promise<void>;
  readonly #now: () => number;
  #lastCallAt = Number.NEGATIVE_INFINITY;

  constructor(options: OpenRouteServiceOptions) {
    if (!options.apiKey) throw new RoutingError('ROUTING_API_KEY が設定されていません');
    this.#apiKey = options.apiKey;
    this.#baseUrl = (options.baseUrl || DEFAULT_ORS_BASE_URL).replace(/\/+$/, '');
    this.#timeoutMs = options.timeoutMs ?? 30_000;
    this.#maxAttempts = options.maxAttempts ?? 4;
    this.#minIntervalMs = options.minIntervalMs ?? 1_600;
    this.#fetch = options.fetch ?? fetch;
    this.#sleep = options.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
    this.#now = options.now ?? Date.now;
  }

  async route(request: RouteRequest): Promise<RouteResult> {
    const body = JSON.stringify({
      coordinates: [request.from, ...request.via, request.to].map(latLngToLngLat),
      ...this.routingOptions,
      instructions: false,
      elevation: false,
    });
    const url = `${this.#baseUrl}/v2/directions/${encodeURIComponent(request.profile)}/geojson`;

    for (let attempt = 1; ; attempt++) {
      try {
        return await this.#call(url, body);
      } catch (error) {
        const routingError = error instanceof RoutingError ? error : new RoutingError(String(error), { retryable: true });
        if (!routingError.retryable || attempt >= this.#maxAttempts) throw routingError;
        const waitMs = routingError.retryAfterMs ?? backoffMs(attempt);
        console.warn(`  routing: ${routingError.message} — ${Math.round(waitMs / 1000)}秒後に再試行 (${attempt}/${this.#maxAttempts - 1})`);
        await this.#sleep(waitMs);
      }
    }
  }

  async #call(url: string, body: string): Promise<RouteResult> {
    const wait = this.#lastCallAt + this.#minIntervalMs - this.#now();
    if (wait > 0) await this.#sleep(wait);
    this.#lastCallAt = this.#now();

    let response: Response;
    try {
      response = await this.#fetch(url, {
        method: 'POST',
        headers: {
          Authorization: this.#apiKey,
          'Content-Type': 'application/json; charset=utf-8',
          Accept: 'application/geo+json, application/json',
        },
        body,
        signal: AbortSignal.timeout(this.#timeoutMs),
      });
    } catch (error) {
      throw new RoutingError(`通信エラー: ${(error as Error).message}`, { retryable: true });
    }

    if (!response.ok) {
      const detail = (await response.text().catch(() => '')).slice(0, 300);
      throw httpError(response, detail, this.#now());
    }

    const parsed = responseSchema.safeParse(await response.json().catch(() => null));
    if (!parsed.success) throw new RoutingError('徒歩APIの応答形式が想定と異なります');
    const feature = parsed.data.features[0]!;
    const coords = feature.geometry.coordinates;
    return {
      geometry: feature.geometry,
      distanceMeters: feature.properties.summary.distance ?? 0,
      estimatedDurationSeconds: feature.properties.summary.duration ?? null,
      snappedFrom: (coords[0] as LngLat | undefined) ?? null,
      snappedTo: (coords.at(-1) as LngLat | undefined) ?? null,
    };
  }
}

function httpError(response: Response, detail: string, now: number): RoutingError {
  const status = response.status;
  if (status === 429) {
    const retryAfterMs = parseRetryAfter(response.headers.get('retry-after'), now) ?? 60_000;
    return new RoutingError(`レート制限 (429): ${detail}`, { status, retryable: true, retryAfterMs });
  }
  if (status === 401) return new RoutingError(`認証エラー (401): APIキーを確認してください`, { status });
  if (status === 403) return new RoutingError(`アクセス拒否 (403): 日次上限超過またはキー権限の可能性 ${detail}`, { status });
  if (status === 408 || status >= 500) {
    return new RoutingError(`一時的なエラー (${status}): ${detail}`, { status, retryable: true });
  }
  // 400/404 など: 経路が見つからない・入力不備は再試行しない
  return new RoutingError(`ルート取得失敗 (${status}): ${detail}`, { status });
}

export function parseRetryAfter(value: string | null, now: number): number | null {
  if (!value) return null;
  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) return seconds * 1000;
  const date = Date.parse(value);
  if (Number.isFinite(date)) return Math.max(0, date - now);
  return null;
}

function backoffMs(attempt: number): number {
  return Math.min(30_000, 2_000 * 2 ** (attempt - 1));
}

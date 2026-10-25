import type { RouteRequest, RouteResult, RoutingProvider } from '../src/generator/routing/types.ts';
import { ORS_SPEC } from '../src/generator/routing/openrouteservice.ts';
import { latLngToLngLat } from '../src/shared/geo.ts';
import type { TripConfig } from '../src/shared/schema.ts';

export const TRIP: TripConfig = {
  tripId: 'test-trip',
  title: 'テストの旅',
  articleUrl: 'https://example.hatenablog.com/entry/2026/03/15/060000',
  journeyDate: '2026-03-15',
  timeZone: 'Asia/Tokyo',
  routingProfile: 'foot-walking',
};

export interface LogEntry {
  time?: string;
  lat: number;
  lng: number;
  photos?: string[];
  comment?: string;
  href?: string;
}

/** はてなブログの個別記事ページを模したHTML */
export function articleHtml(entries: LogEntry[], { intro = '', outro = '' } = {}): string {
  const logs = entries
    .map((e) => {
      const href = e.href ?? `https://www.google.com/maps?q=${e.lat},${e.lng}`;
      const photos = (e.photos ?? [])
        .map((src) => `<p><span itemscope><img src="${src}" class="hatena-fotolife" loading="lazy"></span></p>`)
        .join('\n');
      const comment = e.comment ? `<p>${e.comment}</p>` : '';
      return `<p><strong>${e.time ?? ''}</strong> <a href="${href}">🚶‍♂️現在地</a></p>\n${photos}\n${comment}`;
    })
    .join('\n<hr />\n');
  return `<!doctype html><html><body>
<header><a href="https://www.google.com/maps?q=1,1">🚶‍♂️現在地（ヘッダー）</a></header>
<article class="entry"><div class="entry-content hatenablog-entry">
${intro}
<h2>ログ</h2>
${logs}
${outro}
</div></article>
<aside><a href="https://www.google.com/maps?q=2,2">現在地（サイドバー）</a></aside>
</body></html>`;
}

/** 呼び出しを記録する偽の徒歩API。経路は始点・経由点・終点を結んだ折れ線 */
export class FakeProvider implements RoutingProvider {
  readonly name = ORS_SPEC.name;
  readonly optionsVersion = ORS_SPEC.optionsVersion;
  readonly routingOptions = ORS_SPEC.routingOptions;
  readonly attribution = ORS_SPEC.attribution;
  readonly calls: RouteRequest[] = [];
  failAt: number | null = null;

  async route(request: RouteRequest): Promise<RouteResult> {
    this.calls.push(request);
    if (this.failAt !== null && this.calls.length >= this.failAt) throw new Error('fake API failure');
    const coordinates = [request.from, ...request.via, request.to].map(latLngToLngLat);
    return {
      geometry: { type: 'LineString', coordinates },
      distanceMeters: 1000 * (request.via.length + 1),
      estimatedDurationSeconds: 720,
      snappedFrom: coordinates[0]!,
      snappedTo: coordinates.at(-1)!,
    };
  }
}

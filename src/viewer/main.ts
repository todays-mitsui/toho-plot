// 自前のスタイルでLeafletの既定 (.leaflet-marker-icon { display: block } など) を上書きするため、この順で読み込む
import 'leaflet/dist/leaflet.css';
import './style.css';
import { siteIndexSchema, tripDataSchema, type SiteIndex } from '../shared/schema.ts';
import { h } from './dom.ts';
import { renderTrip } from './trip-view.ts';
import { readViewState, shareUrl } from './url.ts';

const app = document.getElementById('app')!;
const state = readViewState();
document.body.classList.toggle('embed', state.embed);

try {
  const index = siteIndexSchema.parse(await fetchJson('data/index.json'));
  // データパスは公開済み一覧のtripIdからのみ組み立てる（任意URLは読まない）
  const entry = state.tripId ? index.trips.find((t) => t.tripId === state.tripId) : undefined;
  if (!state.tripId) {
    renderTripList(index, null);
  } else if (!entry) {
    renderTripList(index, `「${state.tripId}」という旅の地図は見つかりません。`);
  } else {
    const trip = tripDataSchema.parse(await fetchJson(`data/trips/${encodeURIComponent(entry.tripId)}.json`));
    document.title = `${trip.title} - 歩き旅の地図`;
    renderTrip(app, trip, { embed: state.embed, pointId: state.pointId });
  }
} catch (error) {
  console.error(error);
  app.replaceChildren(h('p', { class: 'status status--error' }, '地図データを読み込めませんでした。時間をおいて再読み込みしてください。'));
}

async function fetchJson(path: string): Promise<unknown> {
  // 再読み込みで最新の公開版を取得する（ETagで再検証）
  const response = await fetch(path, { cache: 'no-cache' });
  if (!response.ok) throw new Error(`${path}: HTTP ${response.status}`);
  return response.json();
}

function renderTripList(index: SiteIndex, error: string | null) {
  const items = index.trips.map((t) =>
    h(
      'li',
      {},
      h('a', { href: shareUrl(t.tripId), target: state.embed ? '_blank' : undefined }, t.title),
      ` (${t.journeyDate}・${t.pointCount}地点)`,
    ),
  );
  app.replaceChildren(
    h(
      'main',
      { class: 'trip-list' },
      h('h1', {}, '歩き旅の地図'),
      error ? h('p', { class: 'status status--error' }, error) : null,
      items.length > 0 ? h('ul', {}, ...items) : h('p', {}, '公開中の地図はまだありません。'),
    ),
  );
}

import type { Point, TripData } from '../shared/schema.ts';
import { h } from './dom.ts';
import { createTripMap, type TripMap } from './map.ts';
import { readPointHash, replacePointHash, shareUrl } from './url.ts';

const ESTIMATE_NOTICE = '徒歩ルートは記録地点間の推定です。実際に歩いた道とは異なる場合があります。';

export function renderTrip(app: HTMLElement, trip: TripData, { embed, pointId }: { embed: boolean; pointId: string | null }) {
  const distance = formatKm(trip.estimatedTotalDistanceMeters);
  const elapsed = formatElapsed(trip);
  const notices = h('div', { class: 'notices', role: 'status' });
  const mapEl = h('div', { class: 'map', role: 'region', 'aria-label': '地図' });
  const panel = h('section', { class: 'panel', 'aria-label': '記録地点' });
  const layout = h('div', { class: 'layout' }, h('div', { class: 'map-wrap' }, mapEl), panel);
  app.replaceChildren(...(embed ? [] : [renderHeader(trip)]), notices, layout, ...(embed ? [] : [renderFooter(trip)]));

  let selectedId: string | null = null;
  // 地点カード欄を先に組み立て、地図の大きさが確定してから全地点が収まるように表示する
  let tripMap: TripMap | null = null;

  const select = (id: string | null, { pan = true, scroll = true, updateHash = true } = {}) => {
    if (!trip.points.some((p) => p.id === id)) id = null;
    selectedId = id;
    tripMap?.setSelected(id, { pan });
    if (updateHash) replacePointHash(id);
    if (embed) renderEmbedCard();
    else updateList(scroll);
  };

  // --- 通常モード: 全地点のカード一覧 ---
  const cards = new Map<string, HTMLElement>();
  function updateList(scroll: boolean) {
    for (const [id, card] of cards) {
      const active = id === selectedId;
      card.classList.toggle('card--selected', active);
      card.setAttribute('aria-current', active ? 'true' : 'false');
      if (active && scroll) card.scrollIntoView({ block: 'nearest' });
    }
  }
  if (!embed) {
    const list = h('ol', { class: 'cards' });
    trip.points.forEach((point, i) => {
      const card = renderCard(trip, point, i);
      card.addEventListener('click', (event) => {
        if ((event.target as HTMLElement).closest('a, button')) return;
        select(point.id, { scroll: false });
      });
      card.addEventListener('keydown', (event) => {
        if (event.key === 'Enter' && event.target === card) select(point.id, { scroll: false });
      });
      cards.set(point.id, card);
      list.append(h('li', {}, card));
    });
    panel.append(list);
  }

  // --- 埋め込みモード: 未選択なら旅の概要、選択中は1地点だけのコンパクトなカード ---
  // 「‹」「›」で 概要 ↔ 地点1 ↔ 地点2 … と移動する
  const embedCard = h('div', { class: 'embed-card' });
  function renderEmbedCard() {
    const index = trip.points.findIndex((p) => p.id === selectedId);
    const prev = h('button', { type: 'button', class: 'nav', 'aria-label': index === 0 ? '旅の概要' : '前の地点', disabled: index < 0 }, '‹');
    const next = h('button', { type: 'button', class: 'nav', 'aria-label': '次の地点', disabled: index === trip.points.length - 1 }, '›');
    prev.addEventListener('click', () => select(trip.points[index - 1]?.id ?? null));
    next.addEventListener('click', () => select(trip.points[index + 1]!.id));
    if (index < 0) {
      embedCard.replaceChildren(
        prev,
        h(
          'div',
          { class: 'embed-card__body' },
          h(
            'div',
            { class: 'embed-card__text' },
            h('p', { class: 'embed-card__title' }, trip.title),
            h('p', {}, `推定徒歩距離 ${distance}・${trip.points.length}地点`),
            elapsed ? h('p', {}, `かかった時間 ${elapsed}`) : null,
            h('p', { class: 'embed-card__hint' }, 'ピンか「›」で各地点の写真とコメントを表示'),
          ),
        ),
        next,
      );
      return;
    }
    const point = trip.points[index]!;
    const photo = point.photos[0];
    embedCard.replaceChildren(
      prev,
      h(
        'div',
        { class: 'embed-card__body' },
        photo ? photoEl(photo.url, photoAlt(point, index, photo.alt), 'embed-card__photo') : null,
        h(
          'div',
          { class: 'embed-card__text' },
          h('p', { class: 'card__meta' }, h('span', { class: 'badge' }, String(index + 1)), ` ${formatTime(trip, point)}`),
          point.comment ? h('p', { class: 'embed-card__comment' }, point.comment) : null,
        ),
      ),
      next,
    );
  }
  if (embed) {
    const openLarge = h('a', { href: shareUrl(trip.tripId, null), target: '_blank', rel: 'noopener' }, '大きな地図で開く');
    openLarge.addEventListener('click', () => (openLarge.href = shareUrl(trip.tripId, selectedId)));
    panel.append(
      embedCard,
      h(
        'div',
        { class: 'embed-footer' },
        h('span', {}, '徒歩ルートは記録地点間の推定'),
        h('a', { href: trip.articleUrl, target: '_blank', rel: 'noopener' }, '元記事'),
        openLarge,
      ),
    );
  }

  // 地点別URLで開いたとき以外は、どの地点も選択しない
  select(pointId, { updateHash: false });

  tripMap = createTripMap(mapEl, trip, {
    interactive: !embed,
    onSelect: (id) => select(id, { pan: false }),
    onBackgroundClick: () => select(null, { pan: false, scroll: false }),
    onTileError: () =>
      notices.append(h('p', { class: 'notice' }, '地図タイルを読み込めませんでした。地点一覧と元記事へのリンクは引き続き利用できます。')),
  });
  tripMap.setSelected(selectedId, { pan: Boolean(pointId) });
  if (embed) setupEmbedInteraction(mapEl.parentElement!, tripMap);

  window.addEventListener('hashchange', () => select(readPointHash(window.location.hash)));

  function renderHeader(trip: TripData) {
    const copyTrip = copyButton('この地図のURLをコピー', () => shareUrl(trip.tripId));
    return h(
      'header',
      { class: 'header' },
      h('h1', {}, trip.title),
      h(
        'p',
        { class: 'header__meta' },
        h('span', {}, `推定徒歩距離 ${distance}`),
        elapsed ? h('span', {}, `かかった時間 ${elapsed}`) : null,
        h('span', {}, `${trip.points.length}地点`),
        h('span', {}, `地図データ更新日時 ${formatDateTime(trip.generatedAt)}`),
      ),
      h(
        'p',
        { class: 'header__actions' },
        h('a', { href: trip.articleUrl, target: '_blank', rel: 'noopener' }, '元記事を読む'),
        copyTrip,
      ),
      h('p', { class: 'header__notice' }, ESTIMATE_NOTICE),
    );
  }
}

function renderCard(trip: TripData, point: Point, index: number): HTMLElement {
  return h(
    'article',
    { class: 'card', id: `card-${point.id}`, tabindex: '0', 'aria-label': `地点${index + 1} ${formatTime(trip, point)}` },
    h('p', { class: 'card__meta' }, h('span', { class: 'badge' }, String(index + 1)), ` ${formatTime(trip, point)}`),
    ...point.photos.map((photo) => photoEl(photo.url, photoAlt(point, index, photo.alt), 'card__photo')),
    point.comment ? h('p', { class: 'card__comment' }, point.comment) : null,
    h(
      'p',
      { class: 'card__actions' },
      copyButton('この地点のURLをコピー', () => shareUrl(trip.tripId, point.id)),
      h('a', { href: point.originalMapUrl, target: '_blank', rel: 'noopener' }, 'Google マップ'),
    ),
  );
}

function renderFooter(trip: TripData): HTMLElement {
  return h(
    'footer',
    { class: 'footer' },
    h(
      'p',
      {},
      ESTIMATE_NOTICE,
      ' 推定徒歩距離は各区間の推定距離の和です。かかった時間は最初と最後の記録時刻の差で、ルートからの推定ではありません。',
    ),
    trip.attribution.length > 0 ? h('p', {}, `徒歩ルート: ${trip.attribution.join(' / ')}`) : null,
  );
}

/** 埋め込み時は地図操作を止めてブログのスクロールを優先し、ボタンで操作を切り替える */
function setupEmbedInteraction(wrap: HTMLElement, tripMap: TripMap) {
  const start = h('button', { type: 'button', class: 'map-toggle map-toggle--start' }, '地図を操作する');
  const end = h('button', { type: 'button', class: 'map-toggle map-toggle--end', hidden: true }, '操作を終了');
  const setActive = (active: boolean) => {
    tripMap.setInteractive(active);
    wrap.classList.toggle('map-wrap--active', active);
    start.hidden = active;
    end.hidden = !active;
    (active ? end : start).focus({ preventScroll: true });
  };
  start.addEventListener('click', () => setActive(true));
  end.addEventListener('click', () => setActive(false));
  wrap.append(start, end);
}

function photoEl(url: string, alt: string, className: string): HTMLElement {
  const img = h('img', { src: url, alt, loading: 'lazy', decoding: 'async', class: className });
  img.addEventListener('error', () => img.replaceWith(h('span', { class: `${className} photo-error` }, '写真を読み込めませんでした')), {
    once: true,
  });
  return img;
}

function photoAlt(point: Point, index: number, alt: string): string {
  return alt || `地点${index + 1}（${point.recordedAt.slice(11, 16)}）の写真`;
}

function copyButton(label: string, getText: () => string): HTMLButtonElement {
  const button = h('button', { type: 'button', class: 'copy' }, label);
  button.addEventListener('click', async () => {
    const text = getText();
    try {
      await navigator.clipboard.writeText(text);
      flash(button, 'コピーしました', label);
    } catch {
      window.prompt('URLをコピーしてください', text);
    }
  });
  return button;
}

function flash(button: HTMLButtonElement, message: string, label: string) {
  button.textContent = message;
  setTimeout(() => (button.textContent = label), 1500);
}

/** 記録時刻は記事のタイムゾーンの壁時計時刻で表示する。旅の日付と異なる場合だけ日付も出す */
function formatTime(trip: TripData, point: Point): string {
  const date = point.recordedAt.slice(0, 10);
  const time = point.recordedAt.slice(11, 16);
  return date === trip.journeyDate ? time : `${date.slice(5).replace('-', '/')} ${time}`;
}

function formatDateTime(iso: string): string {
  return new Intl.DateTimeFormat('ja-JP', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Tokyo' }).format(new Date(iso));
}

/** 最初と最後の記録時刻の差。例: 11時間21分（07:06〜18:27） */
function formatElapsed(trip: TripData): string | null {
  const first = trip.points[0]!;
  const last = trip.points.at(-1)!;
  const minutes = Math.round((Date.parse(last.recordedAt) - Date.parse(first.recordedAt)) / 60_000);
  if (trip.points.length < 2 || minutes <= 0) return null;
  const duration = minutes >= 60 ? `${Math.floor(minutes / 60)}時間${minutes % 60}分` : `${minutes}分`;
  return `${duration}（${formatTime(trip, first)}〜${formatTime(trip, last)}）`;
}

function formatKm(meters: number): string {
  return `約${(meters / 1000).toFixed(1)}km`;
}

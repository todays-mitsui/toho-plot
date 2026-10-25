// はてなブログ記事HTMLから「現在地」ログを本文順に抽出する。
import * as cheerio from 'cheerio';
import type { AnyNode, Element } from 'domhandler';
import { latSchema, lngSchema, pointSchema, type Photo, type Point, type TripConfig } from '../shared/schema.ts';
import { formatOffsetDateTime } from './time.ts';

export class ParseError extends Error {
  override name = 'ParseError';
}

const LOCATION_LINK_TEXT = '現在地';
const BLOCK_BOUNDARY = new Set(['hr', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6']);
const GOOGLE_MAPS_HOSTS = new Set(['www.google.com', 'google.com', 'maps.google.com', 'www.google.co.jp', 'google.co.jp']);
const TIME_PATTERN = /(?<![\d:])(\d{1,2}):(\d{2})(?![\d:])/;

export interface ParseOptions {
  trip: Pick<TripConfig, 'articleUrl' | 'journeyDate' | 'timeZone' | 'dateOverrides'>;
}

export function parseArticle(html: string, { trip }: ParseOptions): Point[] {
  const $ = cheerio.load(html);
  const scope = findEntryContent($);
  const articleKey = articleKeyFromUrl(trip.articleUrl);

  const links = scope
    .find('a')
    .toArray()
    .filter((a) => $(a).text().includes(LOCATION_LINK_TEXT))
    // 引用・埋め込みカード内のリンクは記録地点ではない
    .filter((a) => $(a).closest('blockquote, .hatena-citation, .embed-card, iframe').length === 0);

  const blocks = links.map((a) => topLevelChild($, scope.get(0)!, a));
  const blockSet = new Set<AnyNode>(blocks);
  const sameTimeCounts = new Map<string, number>();

  const points = links.map((link, order): Point => {
    const block = blocks[order]!;
    const href = $(link).attr('href') ?? '';
    const { lat, lng } = parseGoogleMapsUrl(href);

    const time = extractTime($, block, link);
    if (!time) {
      throw new ParseError(`${order + 1}件目の「現在地」(${href}) の近くに時刻 (HH:MM) が見つかりません`);
    }
    const hhmm = `${time.hour.toString().padStart(2, '0')}${time.minute.toString().padStart(2, '0')}`;
    const n = (sameTimeCounts.get(hhmm) ?? 0) + 1;
    sameTimeCounts.set(hhmm, n);
    const id = `${articleKey}-${hhmm}-${n}`;

    const date = trip.dateOverrides?.[id] ?? trip.journeyDate;
    const recordedAt = formatOffsetDateTime(date, time.hour, time.minute, trip.timeZone);

    const following = followingBlockElements($, block, blockSet);
    const photos = extractPhotos($, [block, ...following], trip.articleUrl);
    const comment = following
      .map((el) => normalizeText($(el).text()))
      .filter((text) => text.length > 0)
      .join('\n');

    return pointSchema.parse({ id, order, recordedAt, lat, lng, photos, comment, originalMapUrl: href });
  });

  if (points.length === 0) {
    throw new ParseError('記事本文に「現在地」リンクが1件もありません');
  }
  return points;
}

function findEntryContent($: cheerio.CheerioAPI) {
  const candidates = $('article .entry-content');
  if (candidates.length === 0) {
    throw new ParseError('記事本文 (article .entry-content) が見つかりません');
  }
  // 個別記事ページでは最初のarticleが対象記事
  return candidates.first();
}

/** /entry/2026/03/15/060000 → 20260315060000。それ以外のURL形式はパスから作る */
export function articleKeyFromUrl(articleUrl: string): string {
  const path = new URL(articleUrl).pathname.replace(/^\/entry\//, '');
  const key = path.replace(/[^A-Za-z0-9]+/g, '');
  if (!key) throw new ParseError(`記事URLから記事IDを決められません: ${articleUrl}`);
  return key;
}

export function parseGoogleMapsUrl(href: string): { lat: number; lng: number } {
  let url: URL;
  try {
    url = new URL(href);
  } catch {
    throw new ParseError(`「現在地」のURLを解析できません: ${href}`);
  }
  if (!GOOGLE_MAPS_HOSTS.has(url.hostname) || !url.pathname.startsWith('/maps')) {
    throw new ParseError(`未対応の「現在地」リンクです（qパラメータ付きGoogle MapsのURLのみ対応）: ${href}`);
  }
  const q = url.searchParams.get('q') ?? url.searchParams.get('query');
  const match = q?.trim().match(/^(-?\d+(?:\.\d+)?),\s*(-?\d+(?:\.\d+)?)$/);
  if (!match) {
    throw new ParseError(`「現在地」のqパラメータが「緯度,経度」ではありません: ${href}`);
  }
  const lat = latSchema.safeParse(Number(match[1]));
  const lng = lngSchema.safeParse(Number(match[2]));
  if (!lat.success || !lng.success) {
    throw new ParseError(`「現在地」の緯度経度が範囲外です: ${href}`);
  }
  return { lat: lat.data, lng: lng.data };
}

function topLevelChild($: cheerio.CheerioAPI, scope: Element, node: AnyNode): AnyNode {
  let current: AnyNode = node;
  while (current.parent && current.parent !== scope) {
    current = current.parent;
  }
  if (current.parent !== scope) throw new ParseError('「現在地」リンクの本文内の位置を特定できません');
  return current;
}

function extractTime($: cheerio.CheerioAPI, block: AnyNode, link: AnyNode): { hour: number; minute: number } | null {
  // リンク文言自体は除き、同じ段落の時刻を探す
  const clone = $(block).clone();
  clone.find('a').filter((_, a) => $(a).text() === $(link).text()).remove();
  const match = clone.text().match(TIME_PATTERN);
  if (!match) return null;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (hour > 23 || minute > 59) return null;
  return { hour, minute };
}

/** 「現在地」段落の後ろから、区切り線・見出し・次の「現在地」段落の手前までの要素 */
function followingBlockElements($: cheerio.CheerioAPI, block: AnyNode, blockSet: Set<AnyNode>): Element[] {
  const result: Element[] = [];
  for (const el of $(block).nextAll().toArray()) {
    if (BLOCK_BOUNDARY.has(el.tagName.toLowerCase()) || blockSet.has(el)) break;
    result.push(el);
  }
  return result;
}

function extractPhotos($: cheerio.CheerioAPI, elements: AnyNode[], baseUrl: string): Photo[] {
  const photos: Photo[] = [];
  for (const el of elements) {
    for (const img of $(el).find('img').addBack('img').toArray()) {
      const raw = $(img).attr('data-src') ?? $(img).attr('src');
      if (!raw || raw.startsWith('data:')) continue;
      const url = new URL(raw, baseUrl);
      if (url.protocol !== 'https:' && url.protocol !== 'http:') continue;
      photos.push({ url: url.toString(), alt: normalizeText($(img).attr('alt') ?? '') });
    }
  }
  return photos;
}

function normalizeText(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

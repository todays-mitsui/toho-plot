import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { ParseError, parseArticle, parseGoogleMapsUrl } from '../src/generator/parse.ts';
import { articleHtml, TRIP } from './helpers.ts';

const REAL_TRIP = {
  articleUrl: 'https://todays-mitsui.hatenablog.com/entry/2026/03/15/060000',
  journeyDate: '2026-03-15',
  timeZone: 'Asia/Tokyo',
};

describe('実記事fixture (高松→徳島 2日目)', () => {
  const html = readFileSync(new URL('./fixtures/takamatsu-tokushima-day2.html', import.meta.url), 'utf8');
  const points = parseArticle(html, { trip: REAL_TRIP });

  it('現在地を本文順に27件抽出する', () => {
    expect(points).toHaveLength(27);
    expect(points.map((p) => p.order)).toEqual([...Array(27).keys()]);
  });

  it('先頭と末尾の地点の時刻・座標・写真・コメント', () => {
    expect(points[0]).toEqual({
      id: '20260315060000-0706-1',
      order: 0,
      recordedAt: '2026-03-15T07:06:00+09:00',
      lat: 34.24345725635057,
      lng: 134.3609731123187,
      photos: [{ url: 'https://cdn-ak.f.st-hatena.com/images/fotolife/t/todays_mitsui/20260315/20260315070637.jpg', alt: '' }],
      comment: '行くかー。今日はここから歩きでJR徳島駅を目指します。',
      originalMapUrl: 'https://www.google.com/maps?q=34.24345725635057,134.3609731123187',
    });
    const last = points.at(-1)!;
    expect(last.recordedAt).toBe('2026-03-15T18:27:00+09:00');
    expect(last.comment).toBe('徳島駅についたー！やったー！');
  });

  it('行程のGoogle Mapsリンクやまとめの写真を地点として扱わない', () => {
    expect(points.some((p) => p.originalMapUrl.includes('maps.app.goo.gl'))).toBe(false);
    // まとめ見出し以降の写真 (18:29) は最後の地点に含めない
    expect(points.at(-1)!.photos.map((p) => p.url)).toEqual([
      'https://cdn-ak.f.st-hatena.com/images/fotolife/t/todays_mitsui/20260315/20260315182732.jpg',
    ]);
    expect(points.at(-1)!.comment).not.toContain('完了');
  });

  it('全地点に1枚ずつ写真がある', () => {
    expect(points.every((p) => p.photos.length === 1)).toBe(true);
  });
});

describe('合成HTML', () => {
  const parse = (html: string) => parseArticle(html, { trip: TRIP });

  it('ヘッダー・サイドバーのリンクを除外し、写真なし・コメントなしを許容する', () => {
    const points = parse(
      articleHtml([
        { time: '07:00', lat: 34.1, lng: 134.1 },
        { time: '07:30', lat: 34.2, lng: 134.2, photos: ['/images/a.jpg'], comment: '<b>太字</b>と<script>x</script>' },
      ]),
    );
    expect(points).toHaveLength(2);
    expect(points[0]).toMatchObject({ photos: [], comment: '' });
    expect(points[1]!.photos).toEqual([{ url: 'https://example.hatenablog.com/images/a.jpg', alt: '' }]);
    // HTMLはプレーンテキスト化する
    expect(points[1]!.comment).toBe('太字とx');
  });

  it('時刻でソートせず本文順を保ち、同一時刻は出現順で区別する', () => {
    const points = parse(
      articleHtml([
        { time: '09:00', lat: 34.1, lng: 134.1 },
        { time: '08:00', lat: 34.2, lng: 134.2 },
        { time: '09:00', lat: 34.3, lng: 134.3 },
      ]),
    );
    expect(points.map((p) => p.id)).toEqual(['20260315060000-0900-1', '20260315060000-0800-1', '20260315060000-0900-2']);
  });

  it('同じ座標への再訪を削除しない', () => {
    const points = parse(
      articleHtml([
        { time: '09:00', lat: 34.1, lng: 134.1 },
        { time: '09:10', lat: 34.1, lng: 134.1 },
      ]),
    );
    expect(points).toHaveLength(2);
  });

  it('地点IDは座標を含まず、位置修正でも変わらない', () => {
    const before = parse(articleHtml([{ time: '09:00', lat: 34.1, lng: 134.1 }]));
    const after = parse(articleHtml([{ time: '09:00', lat: 34.15, lng: 134.15 }]));
    expect(after[0]!.id).toBe(before[0]!.id);
  });

  it('引用内の現在地リンクは巡回しない', () => {
    const points = parse(
      articleHtml([{ time: '09:00', lat: 34.1, lng: 134.1 }], {
        intro: '<blockquote><p>10:00 <a href="https://www.google.com/maps?q=3,3">現在地</a></p></blockquote>',
      }),
    );
    expect(points).toHaveLength(1);
  });

  it('dateOverridesで日付をまたいだ地点の日付を補正する', () => {
    const points = parseArticle(
      articleHtml([
        { time: '23:50', lat: 34.1, lng: 134.1 },
        { time: '00:20', lat: 34.2, lng: 134.2 },
      ]),
      { trip: { ...TRIP, dateOverrides: { '20260315060000-0020-1': '2026-03-16' } } },
    );
    expect(points[1]!.recordedAt).toBe('2026-03-16T00:20:00+09:00');
  });

  it.each([
    ['短縮URL', 'https://maps.app.goo.gl/abc', /未対応/],
    ['qが緯度経度でない', 'https://www.google.com/maps?q=徳島駅', /緯度,経度/],
    ['緯度が範囲外', 'https://www.google.com/maps?q=95.1,134.1', /範囲外/],
    ['qなし', 'https://www.google.com/maps', /緯度,経度/],
  ])('%s の現在地は黙って欠落させずエラー', (_, href, message) => {
    expect(() => parse(articleHtml([{ time: '09:00', lat: 0, lng: 0, href }]))).toThrow(message);
  });

  it('時刻のない現在地はエラー', () => {
    expect(() => parse(articleHtml([{ lat: 34.1, lng: 134.1 }]))).toThrow(/時刻/);
  });

  it('記事本文が見つからなければエラー', () => {
    expect(() => parse('<html><body><p>09:00 <a href="https://www.google.com/maps?q=1,1">現在地</a></p></body></html>')).toThrow(
      ParseError,
    );
  });

  it('0地点はエラー', () => {
    expect(() => parse(articleHtml([]))).toThrow(/1件もありません/);
  });
});

describe('parseGoogleMapsUrl', () => {
  it('q と query を読む', () => {
    expect(parseGoogleMapsUrl('https://www.google.com/maps?q=34.5,134.25')).toEqual({ lat: 34.5, lng: 134.25 });
    expect(parseGoogleMapsUrl('https://www.google.com/maps/search/?api=1&query=-1.5,-2')).toEqual({ lat: -1.5, lng: -2 });
  });
});

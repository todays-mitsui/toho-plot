const DEFAULT_TIMEOUT_MS = 20_000;
const DEFAULT_MAX_BYTES = 5 * 1024 * 1024;

export interface FetchArticleOptions {
  /** trips.json に登録された記事のホストのみ許可する */
  allowedHosts: Set<string>;
  timeoutMs?: number;
  maxBytes?: number;
  fetch?: typeof fetch;
}

export async function fetchArticle(url: string, options: FetchArticleOptions): Promise<string> {
  assertAllowed(url, options.allowedHosts);
  const response = await (options.fetch ?? fetch)(url, {
    headers: { Accept: 'text/html', 'User-Agent': 'toho-plot map generator (+GitHub Actions)' },
    signal: AbortSignal.timeout(options.timeoutMs ?? DEFAULT_TIMEOUT_MS),
  });
  // リダイレクト後のURLも登録ホストに限る
  if (response.url && response.url !== url) {
    try {
      assertAllowed(response.url, options.allowedHosts);
    } catch {
      throw new Error(
        `記事URLが登録されていないホストへ転送されました: ${url} → ${response.url}。` +
          'ブログのドメインが変わった場合は trips.json の articleUrl を転送先のURLに更新してください',
      );
    }
  }
  if (!response.ok) throw new Error(`記事の取得に失敗しました: HTTP ${response.status} ${url}`);
  const contentType = response.headers.get('content-type') ?? '';
  if (!contentType.includes('text/html')) throw new Error(`記事がHTMLではありません (${contentType}): ${url}`);

  const maxBytes = options.maxBytes ?? DEFAULT_MAX_BYTES;
  const declared = Number(response.headers.get('content-length'));
  if (declared > maxBytes) throw new Error(`記事HTMLがサイズ上限 ${maxBytes} bytes を超えています`);

  const chunks: Uint8Array[] = [];
  let total = 0;
  for await (const chunk of response.body ?? []) {
    total += chunk.byteLength;
    if (total > maxBytes) throw new Error(`記事HTMLがサイズ上限 ${maxBytes} bytes を超えています`);
    chunks.push(chunk);
  }
  return new TextDecoder('utf-8').decode(Buffer.concat(chunks));
}

function assertAllowed(url: string, allowedHosts: Set<string>): void {
  const parsed = new URL(url);
  if (parsed.protocol !== 'https:' || !allowedHosts.has(parsed.hostname)) {
    throw new Error(`登録されていないホストへのアクセスは行いません: ${url}`);
  }
}

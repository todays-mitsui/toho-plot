// 使い方は README を参照。
//   node src/generator/cli.ts update --trip <tripId> --data-dir <dir> [--force-reroute] [--allow-removal] [--html-file <path>] [--dry-run]
//   node src/generator/cli.ts parse --trip <tripId> [--html-file <path>]
//   node src/generator/cli.ts routing-check [--trip <tripId>] [--html-file <path>] [--out <geojson>]
// GitHub Actionsからは入力を環境変数 TRIP_ID / FORCE_REROUTE / ALLOW_REMOVAL で渡す。
import { appendFile, readFile, writeFile } from 'node:fs/promises';
import { parseArgs } from 'node:util';
import { haversineMeters, pointLatLng } from '../shared/geo.ts';
import { findTrip, loadTrips } from './config.ts';
import { fetchArticle } from './fetch.ts';
import { parseArticle } from './parse.ts';
import { OpenRouteServiceProvider } from './routing/openrouteservice.ts';
import { formatSummary, runUpdate } from './update.ts';

const { positionals, values } = parseArgs({
  allowPositionals: true,
  options: {
    trip: { type: 'string' },
    'data-dir': { type: 'string' },
    'html-file': { type: 'string' },
    'force-reroute': { type: 'boolean' },
    'allow-removal': { type: 'boolean' },
    'dry-run': { type: 'boolean' },
    out: { type: 'string' },
  },
});

const env = process.env;
const tripId = values.trip ?? env.TRIP_ID ?? '';
const command = positionals[0];

try {
  switch (command) {
    case 'update':
      await update();
      break;
    case 'parse':
      await parse();
      break;
    case 'routing-check':
      await routingCheck();
      break;
    default:
      console.error('usage: cli.ts <update|parse|routing-check> --trip <tripId> ...');
      process.exitCode = 2;
  }
} catch (error) {
  console.error(`エラー: ${(error as Error).message}`);
  process.exitCode = 1;
}

async function update() {
  const result = await runUpdate({
    tripId,
    dataDir: values['data-dir'] ?? env.DATA_DIR ?? 'data',
    forceReroute: values['force-reroute'] ?? env.FORCE_REROUTE === 'true',
    allowRemoval: values['allow-removal'] ?? env.ALLOW_REMOVAL === 'true',
    htmlFile: values['html-file'],
    dryRun: values['dry-run'],
  });
  const summary = formatSummary(result, env.SITE_URL || undefined);
  console.log(summary);
  for (const warning of result.warnings) console.log(`::warning::${warning}`);
  if (result.prunedRoutes.length > 0) console.log(`未使用のルートキャッシュを${result.prunedRoutes.length}件削除しました`);
  if (env.GITHUB_STEP_SUMMARY) await appendFile(env.GITHUB_STEP_SUMMARY, summary);
  if (env.GITHUB_OUTPUT) await appendFile(env.GITHUB_OUTPUT, `changed=${result.changed}\n`);
}

async function loadPoints() {
  const trips = await loadTrips();
  const trip = findTrip(trips, tripId);
  const html = values['html-file']
    ? await readFile(values['html-file'], 'utf8')
    : await fetchArticle(trip.articleUrl, { allowedHosts: new Set([new URL(trip.articleUrl).hostname]) });
  return { trip, points: parseArticle(html, { trip }) };
}

async function parse() {
  const { points } = await loadPoints();
  console.log(JSON.stringify(points, null, 2));
}

/** 実APIの疎通と経路の妥当性確認。データは保存しない */
async function routingCheck() {
  const { trip, points } = await loadPoints();
  const provider = new OpenRouteServiceProvider({
    apiKey: env.ROUTING_API_KEY ?? '',
    baseUrl: env.ROUTING_API_BASE_URL || undefined,
  });
  // 既定は高松→徳島2日目の 海沿い(08:43→09:11)・峠(14:17→14:58)・インターチェンジ(17:09→17:26)・吉野川(17:26→17:44)
  const pairs = (env.ROUTING_CHECK_PAIRS ?? '4,17,21,22')
    .split(',')
    .map(Number)
    .filter((i) => i >= 0 && i + 1 < points.length);
  const features = [];
  for (const i of pairs) {
    const from = points[i]!;
    const to = points[i + 1]!;
    const result = await provider.route({ from: pointLatLng(from), to: pointLatLng(to), via: [], profile: trip.routingProfile });
    const straight = haversineMeters(pointLatLng(from), pointLatLng(to));
    console.log(
      `${from.id} → ${to.id}: 推定 ${Math.round(result.distanceMeters)}m / 直線 ${Math.round(straight)}m ` +
        `(比 ${(result.distanceMeters / straight).toFixed(2)}), 頂点 ${result.geometry.coordinates.length}`,
    );
    features.push({ type: 'Feature', properties: { from: from.id, to: to.id }, geometry: result.geometry });
  }
  if (values.out) {
    await writeFile(values.out, JSON.stringify({ type: 'FeatureCollection', features }, null, 2));
    console.log(`GeoJSONを ${values.out} に書き出しました（geojson.io などで目視確認できます）`);
  }
}

// DATA_DIR (既定: data) の生成済みデータを public/data に配置する。vite build の前に実行する。
import path from 'node:path';
import { loadTrips, REPO_ROOT } from '../src/generator/config.ts';
import { stageData } from '../src/generator/stage.ts';

const dataDir = path.resolve(REPO_ROOT, process.env.DATA_DIR ?? 'data');
const outDir = path.join(REPO_ROOT, 'public', 'data');
const { published, missing } = await stageData({ dataDir, outDir, trips: await loadTrips() });
console.log(`公開する旅: ${published.join(', ') || '(なし)'}`);
if (missing.length > 0) console.log(`生成済みデータがないため未公開: ${missing.join(', ')}`);

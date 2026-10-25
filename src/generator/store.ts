// generated-dataブランチ（を checkout したディレクトリ）の読み書き
//   schema-version.json
//   trips/<tripId>/trip.json
//   routes/<cacheKey>.json
import { mkdir, readdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { routeCacheEntrySchema, SCHEMA_VERSION, tripDataSchema, type RouteCacheEntry, type TripData } from '../shared/schema.ts';

const CACHE_KEY = /^[0-9a-f]{64}$/;

export class DataStore {
  readonly dir: string;

  constructor(dir: string) {
    this.dir = dir;
  }

  tripPath(tripId: string): string {
    return path.join(this.dir, 'trips', tripId, 'trip.json');
  }

  routePath(cacheKey: string): string {
    if (!CACHE_KEY.test(cacheKey)) throw new Error(`不正なキャッシュキー: ${cacheKey}`);
    return path.join(this.dir, 'routes', `${cacheKey}.json`);
  }

  /** 前回データ。スキーマ不一致・破損はエラーにする（黙って作り直さない） */
  async readTrip(tripId: string): Promise<TripData | null> {
    const json = await readJson(this.tripPath(tripId));
    if (json === null) return null;
    const parsed = tripDataSchema.safeParse(json);
    if (!parsed.success) {
      throw new Error(`${this.tripPath(tripId)} を読み込めません（スキーマ不一致または破損）: ${parsed.error.message}`);
    }
    return parsed.data;
  }

  async listTripIds(): Promise<string[]> {
    try {
      const entries = await readdir(path.join(this.dir, 'trips'), { withFileTypes: true });
      return entries.filter((e) => e.isDirectory()).map((e) => e.name).sort();
    } catch (error) {
      if (isNotFound(error)) return [];
      throw error;
    }
  }

  async readRoute(cacheKey: string): Promise<RouteCacheEntry | null> {
    const json = await readJson(this.routePath(cacheKey));
    if (json === null) return null;
    const parsed = routeCacheEntrySchema.safeParse(json);
    // 壊れたキャッシュやキー不一致は使わず再計算させる
    if (!parsed.success || parsed.data.cacheKey !== cacheKey) return null;
    return parsed.data;
  }

  async writeRoute(entry: RouteCacheEntry): Promise<void> {
    await writeJsonAtomic(this.routePath(entry.cacheKey), routeCacheEntrySchema.parse(entry));
  }

  async writeTrip(trip: TripData): Promise<void> {
    await writeJsonAtomic(path.join(this.dir, 'schema-version.json'), { schemaVersion: SCHEMA_VERSION });
    await writeJsonAtomic(this.tripPath(trip.tripId), tripDataSchema.parse(trip));
  }

  /** どの旅からも参照されないルートキャッシュを削除する。削除したキーを返す */
  async pruneRoutes(): Promise<string[]> {
    const referenced = new Set<string>();
    for (const tripId of await this.listTripIds()) {
      const trip = await this.readTrip(tripId);
      for (const segment of trip?.segments ?? []) {
        if (segment.routeCacheKey) referenced.add(segment.routeCacheKey);
      }
    }
    let files: string[];
    try {
      files = await readdir(path.join(this.dir, 'routes'));
    } catch (error) {
      if (isNotFound(error)) return [];
      throw error;
    }
    const removed: string[] = [];
    for (const file of files) {
      const key = file.replace(/\.json$/, '');
      if (CACHE_KEY.test(key) && !referenced.has(key)) {
        await rm(this.routePath(key));
        removed.push(key);
      }
    }
    return removed;
  }
}

export async function readJson(file: string): Promise<unknown | null> {
  try {
    return JSON.parse(await readFile(file, 'utf8'));
  } catch (error) {
    if (isNotFound(error)) return null;
    throw error;
  }
}

export async function writeJsonAtomic(file: string, value: unknown): Promise<void> {
  await mkdir(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  await writeFile(tmp, `${JSON.stringify(value, null, 2)}\n`);
  await rename(tmp, file);
}

function isNotFound(error: unknown): boolean {
  return (error as NodeJS.ErrnoException)?.code === 'ENOENT';
}

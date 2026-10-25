import path from 'node:path';
import { overridesFileSchema, tripIdSchema, tripsFileSchema, type OverridesFile, type TripConfig } from '../shared/schema.ts';
import { readJson } from './store.ts';

export const REPO_ROOT = path.resolve(import.meta.dirname, '../..');

export async function loadTrips(file = path.join(REPO_ROOT, 'trips.json')): Promise<TripConfig[]> {
  const json = await readJson(file);
  if (json === null) throw new Error(`${file} がありません`);
  const { trips } = tripsFileSchema.parse(json);
  const ids = new Set<string>();
  for (const trip of trips) {
    if (ids.has(trip.tripId)) throw new Error(`trips.json に tripId "${trip.tripId}" が重複しています`);
    ids.add(trip.tripId);
  }
  return trips;
}

/** workflow入力などの外部入力を登録済みtripIdに限定する */
export function findTrip(trips: TripConfig[], tripId: string): TripConfig {
  const id = tripIdSchema.safeParse(tripId);
  const trip = id.success ? trips.find((t) => t.tripId === id.data) : undefined;
  if (!trip) {
    throw new Error(`未登録のtripIdです: "${tripId}"。登録済み: ${trips.map((t) => t.tripId).join(', ')}`);
  }
  return trip;
}

export async function loadOverrides(tripId: string, dir = path.join(REPO_ROOT, 'overrides')): Promise<OverridesFile> {
  const json = await readJson(path.join(dir, `${tripIdSchema.parse(tripId)}.json`));
  return json === null ? { segments: [] } : overridesFileSchema.parse(json);
}

// 座標順の変換はここに集約する。
// GeoJSON・openrouteservice: [経度, 緯度] / Leaflet・Google Mapsのq・設定ファイル: [緯度, 経度]
import type { LatLng, LngLat } from './schema.ts';

export function lngLatToLatLng([lng, lat]: LngLat): LatLng {
  return [lat, lng];
}

export function latLngToLngLat([lat, lng]: LatLng): LngLat {
  return [lng, lat];
}

export function pointLatLng(point: { lat: number; lng: number }): LatLng {
  return [point.lat, point.lng];
}

const EARTH_RADIUS_METERS = 6_371_008.8;

/** 2点間の大円距離（メートル） */
export function haversineMeters([lat1, lng1]: LatLng, [lat2, lng2]: LatLng): number {
  const rad = Math.PI / 180;
  const dLat = (lat2 - lat1) * rad;
  const dLng = (lng2 - lng1) * rad;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * rad) * Math.cos(lat2 * rad) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_METERS * Math.asin(Math.min(1, Math.sqrt(a)));
}

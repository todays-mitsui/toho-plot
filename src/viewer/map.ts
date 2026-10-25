import L from 'leaflet';
import { lngLatToLatLng, pointLatLng } from '../shared/geo.ts';
import type { TripData } from '../shared/schema.ts';

const TILE_URL = import.meta.env.VITE_TILE_URL || 'https://tile.openstreetmap.org/{z}/{x}/{y}.png';
const TILE_ATTRIBUTION =
  import.meta.env.VITE_TILE_ATTRIBUTION || '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors';

export interface TripMap {
  map: L.Map;
  setSelected(pointId: string | null, options?: { pan?: boolean }): void;
  /** 埋め込みモードでのドラッグ・ホイール・タッチ操作の有効/無効 */
  setInteractive(enabled: boolean): void;
}

export function createTripMap(
  container: HTMLElement,
  trip: TripData,
  { interactive, onSelect, onTileError }: { interactive: boolean; onSelect: (pointId: string) => void; onTileError: () => void },
): TripMap {
  const map = L.map(container, {
    dragging: interactive,
    touchZoom: interactive,
    scrollWheelZoom: interactive,
    doubleClickZoom: interactive,
    boxZoom: interactive,
    keyboard: interactive,
  });

  const tiles = L.tileLayer(TILE_URL, { maxZoom: 19, attribution: TILE_ATTRIBUTION });
  let tileErrorReported = false;
  tiles.on('tileerror', () => {
    if (!tileErrorReported) onTileError();
    tileErrorReported = true;
  });
  tiles.addTo(map);
  for (const attribution of trip.attribution) map.attributionControl.addAttribution(escapeHtml(attribution));

  const bounds = L.latLngBounds([]);
  for (const segment of trip.segments) {
    if (segment.method !== 'routed') continue;
    const latLngs = segment.geometry.coordinates.map(lngLatToLatLng);
    L.polyline(latLngs, { className: 'route-line', weight: 5, opacity: 0.85, interactive: false }).addTo(map);
    for (const ll of latLngs) bounds.extend(ll);
  }

  const markers = new Map<string, L.Marker>();
  trip.points.forEach((point, i) => {
    const latLng = pointLatLng(point);
    bounds.extend(latLng);
    const marker = L.marker(latLng, {
      icon: pinIcon(i + 1, false),
      title: `${i + 1}. ${point.recordedAt.slice(11, 16)}`,
      alt: `地点${i + 1}`,
      riseOnHover: true,
      keyboard: true,
    });
    marker.on('click', () => onSelect(point.id));
    marker.addTo(map);
    markers.set(point.id, marker);
  });

  map.fitBounds(bounds, { padding: [24, 24], maxZoom: 16 });
  // iframeの高さ変更や画面回転でコンテナの大きさが変わったらタイルを読み直す
  new ResizeObserver(() => map.invalidateSize()).observe(container);

  let selectedId: string | null = null;
  return {
    map,
    setSelected(pointId, { pan = true } = {}) {
      if (selectedId) {
        const index = trip.points.findIndex((p) => p.id === selectedId);
        markers.get(selectedId)?.setIcon(pinIcon(index + 1, false)).setZIndexOffset(0);
      }
      selectedId = pointId;
      if (!pointId) return;
      const marker = markers.get(pointId);
      if (!marker) return;
      const index = trip.points.findIndex((p) => p.id === pointId);
      marker.setIcon(pinIcon(index + 1, true)).setZIndexOffset(1000);
      if (pan && !map.getBounds().pad(-0.1).contains(marker.getLatLng())) {
        map.panTo(marker.getLatLng());
      }
    },
    setInteractive(enabled) {
      for (const handler of [map.dragging, map.touchZoom, map.scrollWheelZoom, map.doubleClickZoom, map.boxZoom, map.keyboard]) {
        if (enabled) handler.enable();
        else handler.disable();
      }
    },
  };
}

function pinIcon(number: number, selected: boolean): L.DivIcon {
  return L.divIcon({
    className: selected ? 'pin pin--selected' : 'pin',
    html: `<span>${number}</span>`,
    iconSize: [28, 28],
    iconAnchor: [14, 14],
  });
}

function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}

// URL設計: ?trip=<tripId>[&embed=1][#point=<pointId>]
export interface ViewState {
  tripId: string | null;
  embed: boolean;
  pointId: string | null;
}

export function readViewState(location: Location = window.location): ViewState {
  const params = new URLSearchParams(location.search);
  return {
    tripId: params.get('trip'),
    embed: params.get('embed') === '1',
    pointId: readPointHash(location.hash),
  };
}

export function readPointHash(hash: string): string | null {
  return new URLSearchParams(hash.replace(/^#/, '')).get('point');
}

/** 共有用の通常URL（embedを除く）。pointIdを渡すと地点別URL */
export function shareUrl(tripId: string, pointId: string | null = null, base: string = window.location.href): string {
  const url = new URL(base);
  url.search = new URLSearchParams({ trip: tripId }).toString();
  url.hash = pointId ? new URLSearchParams({ point: pointId }).toString() : '';
  return url.toString();
}

export function replacePointHash(pointId: string | null): void {
  const url = new URL(window.location.href);
  url.hash = pointId ? new URLSearchParams({ point: pointId }).toString() : '';
  history.replaceState(null, '', url);
}

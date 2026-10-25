/** 指定タイムゾーンでの日時を "2026-03-15T07:06:00+09:00" 形式にする */
export function formatOffsetDateTime(date: string, hour: number, minute: number, timeZone: string): string {
  const [y, m, d] = date.split('-').map(Number) as [number, number, number];
  // 壁時計時刻をUTCとみなした時刻から、そのタイムゾーンのオフセットを求める
  const naiveUtc = Date.UTC(y, m - 1, d, hour, minute);
  const offsetMinutes = timeZoneOffsetMinutes(new Date(naiveUtc - timeZoneOffsetMinutes(new Date(naiveUtc), timeZone) * 60_000), timeZone);
  const sign = offsetMinutes >= 0 ? '+' : '-';
  const abs = Math.abs(offsetMinutes);
  const pad = (n: number) => n.toString().padStart(2, '0');
  return `${date}T${pad(hour)}:${pad(minute)}:00${sign}${pad(Math.floor(abs / 60))}:${pad(abs % 60)}`;
}

function timeZoneOffsetMinutes(instant: Date, timeZone: string): number {
  const name = new Intl.DateTimeFormat('en-US', { timeZone, timeZoneName: 'longOffset' })
    .formatToParts(instant)
    .find((p) => p.type === 'timeZoneName')?.value;
  const match = name?.match(/^GMT(?:([+-])(\d{2}):(\d{2}))?$/);
  if (!match) throw new Error(`タイムゾーンのオフセットを取得できません: ${timeZone}`);
  if (!match[1]) return 0;
  const minutes = Number(match[2]) * 60 + Number(match[3]);
  return match[1] === '-' ? -minutes : minutes;
}

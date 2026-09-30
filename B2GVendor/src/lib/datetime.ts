// Date/interval formatting shared by the admin ingestion UI. Everything renders
// in the viewer's local time.

type Lang = 'th' | 'en';

export function formatDateTime(iso: string | null | undefined, lang: Lang): string {
  if (!iso) return '—';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleString(lang === 'en' ? 'en-GB' : 'th-TH', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  });
}

// "in 3 h 20 min" / "ใน 3 ชม. 20 นาที" -- or "any moment" once it is due.
export function formatCountdown(iso: string | null | undefined, lang: Lang, now: number = Date.now()): string {
  if (!iso) return '—';
  const target = new Date(iso).getTime();
  if (Number.isNaN(target)) return '—';

  const totalMinutes = Math.round((target - now) / 60_000);
  if (totalMinutes <= 0) return lang === 'en' ? 'any moment now' : 'ภายในไม่กี่นาที';

  const days = Math.floor(totalMinutes / 1440);
  const hours = Math.floor((totalMinutes % 1440) / 60);
  const minutes = totalMinutes % 60;
  const parts: string[] = [];
  if (days) parts.push(lang === 'en' ? `${days} d` : `${days} วัน`);
  if (hours) parts.push(lang === 'en' ? `${hours} h` : `${hours} ชม.`);
  if (minutes && !days) parts.push(lang === 'en' ? `${minutes} min` : `${minutes} นาที`);
  return lang === 'en' ? `in ${parts.join(' ')}` : `ใน ${parts.join(' ')}`;
}

export function minutesToHours(minutes: number): number {
  return Math.round((minutes / 60) * 100) / 100;
}

// 1440 -> "Every 24 hours" / "ทุก 24 ชั่วโมง"; 150 -> "Every 2.5 hours".
export function describeInterval(minutes: number, lang: Lang): string {
  const hours = minutesToHours(minutes);
  return lang === 'en'
    ? `Every ${hours} ${hours === 1 ? 'hour' : 'hours'}`
    : `ทุก ${hours} ชั่วโมง`;
}

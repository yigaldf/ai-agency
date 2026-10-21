const pad = (n: number) => String(n).padStart(2, '0');
export const isoDate = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
export const TODAY = isoDate(new Date());
export const YESTERDAY = isoDate(new Date(Date.now() - 864e5));
export const daysAgo = (n: number) => isoDate(new Date(Date.now() - n * 864e5));

export function heDate(iso: string): string {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString('he-IL', { weekday: 'long', day: 'numeric', month: 'long' });
}

export const uid = (p: string) => p + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);

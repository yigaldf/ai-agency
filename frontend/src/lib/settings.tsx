import { createContext, useContext, useState, type ReactNode } from 'react';

export type DateKey = 'created' | 'started' | 'due' | 'done';
export const DATE_LABELS: Record<DateKey, string> = { created: 'נוצר', started: 'התחיל', due: 'יעד', done: 'הסתיים' };
export const DATE_KEYS: DateKey[] = ['created', 'started', 'due', 'done'];

export interface ViewSettings { dates: Record<DateKey, boolean> }
const DEFAULT: ViewSettings = { dates: { created: false, started: false, due: true, done: true } };

function load(): ViewSettings {
  try {
    const raw = localStorage.getItem('viewSettings');
    if (!raw) return DEFAULT;
    const v = JSON.parse(raw);
    return { dates: { ...DEFAULT.dates, ...(v.dates ?? {}) } };
  } catch { return DEFAULT; }
}

const Ctx = createContext<{ settings: ViewSettings; update: (s: ViewSettings) => void }>({ settings: DEFAULT, update: () => {} });
export const useViewSettings = () => useContext(Ctx);

export function ViewSettingsProvider({ children }: { children: ReactNode }) {
  const [settings, setSettings] = useState<ViewSettings>(load);
  const update = (s: ViewSettings) => { setSettings(s); try { localStorage.setItem('viewSettings', JSON.stringify(s)); } catch { /* ignore */ } };
  return <Ctx.Provider value={{ settings, update }}>{children}</Ctx.Provider>;
}

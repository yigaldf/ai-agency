import { useEffect, useRef, useState } from 'react';
import { DATE_KEYS, DATE_LABELS, useViewSettings } from '../lib/settings';

// "⚙ תצוגה": which task dates the dashboard shows. Remembered per browser.
export function ViewSettingsButton() {
  const { settings, update } = useViewSettings();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false); };
    document.addEventListener('click', close);
    return () => document.removeEventListener('click', close);
  }, [open]);
  return (
    <div className="vs" ref={ref}>
      <button className="ghost tiny" onClick={() => setOpen((o) => !o)} aria-expanded={open}>⚙ תצוגה</button>
      {open && (
        <div className="vs-pop">
          <div className="muted small">אילו תאריכים להציג על משימות</div>
          {DATE_KEYS.map((k) => (
            <label key={k} className="row">
              <input type="checkbox" checked={settings.dates[k]} onChange={(e) => update({ ...settings, dates: { ...settings.dates, [k]: e.target.checked } })} />
              {DATE_LABELS[k]}
            </label>
          ))}
          <div className="muted small">תאריך יעד מופיע תמיד על קוביות ברודמפ.</div>
        </div>
      )}
    </div>
  );
}

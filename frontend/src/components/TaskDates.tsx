import { useEffect, useRef, useState } from 'react';
import { api } from '../lib/api';
import { TODAY } from '../lib/dates';
import { DATE_LABELS, useViewSettings, type DateKey } from '../lib/settings';
import type { Task } from '../lib/types';

export const fmt = (iso: string) => { const [y, m, d] = iso.split('-'); return `${Number(d)}.${Number(m)}${y !== TODAY.slice(0, 4) ? '.' + y.slice(2) : ''}`; };

function dateOf(t: Task, k: DateKey): string | null {
  return k === 'created' ? t.createdAt : k === 'started' ? t.startedAt : k === 'due' ? t.dueDate : t.doneAt;
}

/** Date chips for a task, filtered by the view settings. `always` forces keys on (e.g. due on roadmap nodes). */
export function TaskDates({ t, done, always = [] }: { t: Task; done: boolean; always?: DateKey[] }) {
  const { settings } = useViewSettings();
  const keys = (Object.keys(DATE_LABELS) as DateKey[]).filter((k) => (settings.dates[k] || always.includes(k)) && dateOf(t, k) && (k !== 'done' || done));
  if (!keys.length) return null;
  return (
    <span className="dates">
      {keys.map((k) => {
        const v = dateOf(t, k)!;
        const overdue = k === 'due' && !done && v < TODAY;
        const soon = k === 'due' && !done && !overdue && v <= TODAY;
        return <span key={k} className={'dchip ' + k + (overdue ? ' overdue' : '') + (soon ? ' soon' : '')} title={DATE_LABELS[k] + ' ' + v}>{DATE_LABELS[k]} {fmt(v)}</span>;
      })}
    </span>
  );
}

/** 📅 button with a popover to edit start / due / done dates. */
export function DateEditor({ t, done, refresh, inline = false }: { t: Task; done: boolean; refresh: () => Promise<void>; inline?: boolean }) {
  const [open, setOpen] = useState(inline);
  const [due, setDue] = useState(t.dueDate ?? '');
  const [start, setStart] = useState(t.startedAt ?? '');
  const [end, setEnd] = useState(t.doneAt ?? '');
  const ref = useRef<HTMLSpanElement>(null);
  useEffect(() => { setDue(t.dueDate ?? ''); setStart(t.startedAt ?? ''); setEnd(t.doneAt ?? ''); }, [t.dueDate, t.startedAt, t.doneAt]);
  useEffect(() => {
    if (!open || inline) return;
    const close = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false); };
    document.addEventListener('click', close);
    return () => document.removeEventListener('click', close);
  }, [open, inline]);

  const save = async () => {
    await api.putTask({ ...t, dueDate: due || null, startedAt: start || null, doneAt: done ? end || TODAY : t.doneAt });
    if (!inline) setOpen(false);
    await refresh();
  };

  const form = (
    <div className="date-form" onClick={(e) => e.stopPropagation()}>
      <label>יעד<input type="date" value={due} onChange={(e) => setDue(e.target.value)} /></label>
      <label>התחלה<input type="date" value={start} onChange={(e) => setStart(e.target.value)} /></label>
      {done && <label>סיום<input type="date" value={end} onChange={(e) => setEnd(e.target.value)} /></label>}
      <div className="muted small">נוצר: {t.createdAt ? fmt(t.createdAt) : '—'}</div>
      <div className="row">
        <button className="tiny primary" onClick={save}>שמור</button>
        {due && <button className="tiny ghost" onClick={() => setDue('')}>נקה יעד</button>}
        {!inline && <button className="tiny ghost" onClick={() => setOpen(false)}>סגור</button>}
      </div>
    </div>
  );
  if (inline) return form;
  return (
    <span className="date-editor" ref={ref} onClick={(e) => e.stopPropagation()}>
      <button className="tiny ghost" title="תאריכים" aria-label="תאריכים" onClick={() => setOpen((o) => !o)}>📅</button>
      {open && <div className="date-pop">{form}</div>}
    </span>
  );
}

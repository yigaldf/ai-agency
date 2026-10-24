import { useCallback, useEffect, useMemo, useState, type KeyboardEvent } from 'react';
import { api } from '../lib/api';
import { TODAY, daysAgo, isoDate, uid } from '../lib/dates';
import type { Routine, RoutineCheck } from '../lib/types';
import { useToast } from './Toast';

const DAY_LETTERS = ['א', 'ב', 'ג', 'ד', 'ה', 'ו', 'ש']; // 0 = Sunday … 6 = Saturday, same as Date#getDay()
const WEEK = 7;

const weekdayOf = (iso: string) => { const [y, m, d] = iso.split('-').map(Number); return new Date(y, m - 1, d).getDay(); };
const dueOn = (r: Routine, iso: string) => r.active && (r.days.length === 0 || r.days.includes(weekdayOf(iso)));
const daysLabel = (r: Routine) => (r.days.length === 0 || r.days.length === 7 ? 'כל יום' : r.days.map((d) => DAY_LETTERS[d]).join(' '));

export function Routines() {
  const { toast } = useToast();
  const [routines, setRoutines] = useState<Routine[] | null>(null);
  const [checks, setChecks] = useState<Set<string>>(new Set()); // "routineId|date"
  const [newTitle, setNewTitle] = useState('');
  const [newDays, setNewDays] = useState<number[]>([]);
  const [editing, setEditing] = useState<string | null>(null);

  // last 7 days, oldest first, ending today
  const dates = useMemo(() => Array.from({ length: WEEK }, (_, i) => daysAgo(WEEK - 1 - i)), []);
  const key = (rid: string, date: string) => rid + '|' + date;

  const load = useCallback(async () => {
    const s = await api.routines(dates[0], TODAY);
    setRoutines(s.routines);
    setChecks(new Set(s.checks.map((c: RoutineCheck) => key(c.routineId, c.date))));
  }, [dates]);
  useEffect(() => { load(); }, [load]);

  const active = (routines ?? []).filter((r) => r.active);
  const dueToday = active.filter((r) => dueOn(r, TODAY));
  const doneToday = dueToday.filter((r) => checks.has(key(r.id, TODAY))).length;
  const weekDue = active.reduce((n, r) => n + dates.filter((d) => dueOn(r, d)).length, 0);
  const weekDone = active.reduce((n, r) => n + dates.filter((d) => dueOn(r, d) && checks.has(key(r.id, d))).length, 0);
  const streak = (r: Routine) => {
    let n = 0;
    for (let i = 0; i < 60; i++) {
      const d = isoDate(new Date(Date.now() - i * 864e5));
      if (!dueOn(r, d)) continue;
      if (checks.has(key(r.id, d))) n++;
      else if (d !== TODAY) break; // today may still be pending
    }
    return n;
  };

  const toggle = async (r: Routine, date: string) => {
    const k = key(r.id, date);
    const done = !checks.has(k);
    setChecks((prev) => { const next = new Set(prev); done ? next.add(k) : next.delete(k); return next; }); // optimistic
    try { await api.checkRoutine(r.id, date, done); } catch { await load(); toast('השמירה נכשלה'); }
  };

  const add = async () => {
    const title = newTitle.trim();
    if (!title) return;
    await api.putRoutine({ id: uid('r'), title, days: newDays, order: (routines?.length ?? 0) + 1, active: true, notes: '', createdAt: TODAY });
    setNewTitle(''); setNewDays([]);
    await load();
  };

  const save = async (r: Routine) => { await api.putRoutine(r); setEditing(null); await load(); };

  const remove = async (r: Routine) => {
    const { routine, checks: dates } = await api.deleteRoutine(r.id);
    await load();
    toast(`נמחק: ${r.title}`, async () => {
      await api.putRoutine(routine);
      if (dates.length) await api.restoreRoutineChecks(routine.id, dates);
      await load();
      toast('שוחזר');
    });
  };

  if (!routines) return <div className="loading">טוען…</div>;

  return (
    <>
      <div className="stats">
        <div className={'stat' + (dueToday.length && doneToday === dueToday.length ? ' good' : '')}>
          <span className="muted small">היום</span><b>{doneToday}/{dueToday.length}</b>
        </div>
        <div className="stat"><span className="muted small">7 ימים אחרונים</span><b>{weekDue ? Math.round((weekDone / weekDue) * 100) : 0}%</b></div>
        <div className="stat"><span className="muted small">משימות שגרה פעילות</span><b>{active.length}</b></div>
      </div>

      <section className="panel">
        <div className="panel-head">
          <div>
            <h2>משימות שגרה</h2>
            <div className="muted small">מה שחוזר על עצמו: כל יום או בימים קבועים. סימון נשמר מיד. לחיצה כפולה על שם פותחת עריכה.</div>
          </div>
        </div>

        <div className="add routine-add">
          <input type="text" value={newTitle} onChange={(e) => setNewTitle(e.target.value)} onKeyDown={(e: KeyboardEvent) => e.key === 'Enter' && add()} placeholder="משימת שגרה חדשה, למשל: 20 דקות הליכה" />
          <DayPicker value={newDays} onChange={setNewDays} />
          <button onClick={add}>הוסף</button>
        </div>

        {routines.length ? (
          <div className="routines">
            <div className="routine-head">
              <span />
              {dates.map((d) => (
                <span key={d} className={'rday' + (d === TODAY ? ' today' : '')} title={d}>
                  <small>{DAY_LETTERS[weekdayOf(d)]}</small>{Number(d.slice(8))}
                </span>
              ))}
              <span />
            </div>
            {routines.slice().sort((a, b) => Number(b.active) - Number(a.active) || a.order - b.order).map((r) => (
              editing === r.id ? (
                <RoutineEditor key={r.id} r={r} onSave={save} onCancel={() => setEditing(null)} />
              ) : (
                <div className={'routine-row' + (r.active ? '' : ' done')} key={r.id}>
                  <div className="title" onDoubleClick={() => setEditing(r.id)} title="לחיצה כפולה לעריכה">
                    {r.title}
                    <div className="muted small">{daysLabel(r)}{r.active && streak(r) > 1 ? ` · רצף ${streak(r)}` : ''}</div>
                  </div>
                  {dates.map((d) => {
                    const due = dueOn(r, d); const done = checks.has(key(r.id, d));
                    return (
                      <button key={d} className={'rcheck' + (done ? ' on' : '') + (due ? '' : ' off') + (d === TODAY ? ' today' : '')}
                        aria-label={`${r.title} ${d}`} aria-pressed={done} onClick={() => toggle(r, d)} disabled={!r.active}>
                        {done ? '✓' : due ? '' : '·'}
                      </button>
                    );
                  })}
                  <div className="ctl">
                    <button className="tiny" onClick={() => save({ ...r, active: !r.active })}>{r.active ? 'השהה' : 'הפעל'}</button>
                    <button className="trash" title="מחק" aria-label="מחק" onClick={() => remove(r)}>🗑</button>
                  </div>
                </div>
              )
            ))}
          </div>
        ) : (
          <div className="empty-state">אין משימות שגרה עדיין. הוסף אחת למעלה.</div>
        )}
      </section>
    </>
  );
}

function DayPicker({ value, onChange }: { value: number[]; onChange: (v: number[]) => void }) {
  const toggle = (d: number) => onChange(value.includes(d) ? value.filter((x) => x !== d) : [...value, d].sort());
  return (
    <div className="daypick" title="ריק = כל יום">
      {DAY_LETTERS.map((l, d) => (
        <button type="button" key={d} className={'dchip' + (value.includes(d) ? ' on' : '')} onClick={() => toggle(d)} aria-pressed={value.includes(d)}>{l}</button>
      ))}
    </div>
  );
}

function RoutineEditor({ r, onSave, onCancel }: { r: Routine; onSave: (r: Routine) => Promise<void>; onCancel: () => void }) {
  const [title, setTitle] = useState(r.title);
  const [days, setDays] = useState(r.days);
  const commit = () => { if (title.trim()) onSave({ ...r, title: title.trim(), days }); };
  return (
    <div className="routine-row editing">
      <div className="add routine-add" style={{ gridColumn: '1 / -1' }}>
        <input type="text" value={title} autoFocus onChange={(e) => setTitle(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') commit(); if (e.key === 'Escape') onCancel(); }} />
        <DayPicker value={days} onChange={setDays} />
        <button className="primary" onClick={commit}>שמור</button>
        <button className="ghost" onClick={onCancel}>ביטול</button>
      </div>
    </div>
  );
}

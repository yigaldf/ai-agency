import { useEffect, useState, type ReactNode } from 'react';
import { api } from '../lib/api';
import { TODAY, daysAgo } from '../lib/dates';
import type { Model } from '../lib/model';
import type { Task } from '../lib/types';

interface Props { model: Model; refresh: () => Promise<void> }

type ListKey = 'new' | 'active' | 'done' | 'archive';
const LISTS: { key: ListKey; title: string; tone: string; empty: string }[] = [
  { key: 'new', title: 'משימות חדשות', tone: 'hold', empty: 'אין משימות חדשות.' },
  { key: 'active', title: 'משימות פעילות', tone: 'active', empty: 'אין משימות פעילות. העבר אחת מ"משימות חדשות".' },
  { key: 'done', title: 'משימות שהסתיימו', tone: 'done', empty: 'עוד לא הסתיימה אף משימה בשבוע האחרון.' },
  { key: 'archive', title: 'Archive', tone: 'hold', empty: 'הארכיון ריק. משימות עוברות לכאן שבוע אחרי שהסתיימו.' },
];
const ARCHIVE_AFTER_DAYS = 7;

function readFocus(): ListKey | null {
  try { const v = localStorage.getItem('boardFocus'); return LISTS.some((l) => l.key === v) ? (v as ListKey) : null; } catch { return null; }
}

// Leaf tasks only: parents derive their state from their children.
export function TaskBoard({ model, refresh }: Props) {
  const [focus, setFocusState] = useState<ListKey | null>(readFocus);
  const setFocus = (k: ListKey | null) => { setFocusState(k); try { k ? localStorage.setItem('boardFocus', k) : localStorage.removeItem('boardFocus'); } catch { /* ignore */ } };

  const cutoff = daysAgo(ARCHIVE_AFTER_DAYS);
  const leaves = model.leaves();
  const finished = leaves.filter((t) => model.isDone(t));
  const lists: Record<ListKey, Task[]> = {
    new: leaves.filter((t) => !model.isDone(t) && t.status !== 'active').sort((a, b) => model.sysOrder(a) - model.sysOrder(b) || a.order - b.order),
    active: leaves.filter((t) => !model.isDone(t) && t.status === 'active').sort((a, b) => Number(model.isToday(b)) - Number(model.isToday(a)) || model.sysOrder(a) - model.sysOrder(b)),
    done: finished.filter((t) => !t.doneAt || t.doneAt > cutoff).sort((a, b) => (b.doneAt ?? '').localeCompare(a.doneAt ?? '')),
    archive: finished.filter((t) => t.doneAt && t.doneAt <= cutoff).sort((a, b) => (b.doneAt ?? '').localeCompare(a.doneAt ?? '')),
  };

  const start = async (t: Task) => { await api.putTask({ ...t, status: 'active', startedAt: t.startedAt ?? TODAY }); await refresh(); };
  const pause = async (t: Task) => { await api.putTask({ ...t, status: 'backlog' }); await refresh(); };
  const setProgress = async (t: Task, p: number) => { await api.setProgress(t.id, p, TODAY); await refresh(); };

  const rowFor = (key: ListKey, t: Task) => {
    switch (key) {
      case 'new':
        return <Row key={t.id} t={t} model={model}><button className="tiny primary" onClick={() => start(t)}>התחל</button></Row>;
      case 'active':
        return (
          <Row key={t.id} t={t} model={model} slider={(p) => setProgress(t, p)}>
            <button className="tiny" aria-label="פחות 10%" onClick={() => setProgress(t, (t.progress ?? 0) - 10)}>−10</button>
            <button className="tiny" aria-label="עוד 10%" onClick={() => setProgress(t, (t.progress ?? 0) + 10)}>+10</button>
            <button className="tiny" onClick={() => pause(t)}>השהה</button>
            <button className="tiny primary" onClick={() => setProgress(t, 100)}>סיים ✓</button>
          </Row>
        );
      default:
        return (
          <Row key={t.id} t={t} model={model}>
            {t.doneAt && <span className="muted small">{t.doneAt}</span>}
            <button className="tiny" onClick={() => setProgress(t, 90)}>פתח מחדש</button>
          </Row>
        );
    }
  };

  const shown = focus ? LISTS.filter((l) => l.key === focus) : LISTS;

  return (
    <section className="boardwrap">
      <nav className="subtabs" role="tablist" aria-label="רשימות משימות">
        {LISTS.map((l) => (
          <button key={l.key} role="tab" aria-selected={focus === l.key} className={'subtab' + (focus === l.key ? ' on' : '')} onClick={() => setFocus(l.key)}>
            {l.title} <span className={'chip ' + l.tone}>{lists[l.key].length}</span>
          </button>
        ))}
        {focus && <button className="ghost tiny back" onClick={() => setFocus(null)}>⊞ מראה כללי</button>}
      </nav>

      <div className={'board' + (focus ? ' focused' : '')}>
        {shown.map((l) => (
          <div className="panel col-panel" key={l.key}>
            <div className="panel-head">
              <h2 className="col-title" onClick={() => setFocus(focus === l.key ? null : l.key)} title={focus ? 'חזרה למראה כללי' : 'פתח במסך מלא'}>{l.title}</h2>
              <span className={'chip ' + l.tone}>{lists[l.key].length}</span>
            </div>
            <div className="list">{lists[l.key].length ? lists[l.key].map((t) => rowFor(l.key, t)) : <div className="empty-state">{l.empty}</div>}</div>
          </div>
        ))}
      </div>
    </section>
  );
}

function Row({ t, model, slider, children }: { t: Task; model: Model; slider?: (p: number) => Promise<void>; children: ReactNode }) {
  const p = model.prog(t);
  const [val, setVal] = useState(p);
  useEffect(() => setVal(p), [p]);
  const doneNow = model.isDone(t);
  return (
    <div className={'brow' + (doneNow ? ' done' : '')}>
      <div className="title">{t.title}{model.isToday(t) && <span className="chip today" style={{ marginInlineStart: 6 }}>היום</span>}</div>
      <div className="path muted small">{model.pathOf(t)}</div>
      <div className="meta">
        <div className={'bar' + (doneNow ? ' full' : '')}><i style={{ width: `${slider ? val : p}%` }} /></div>
        <span className="pct">{slider ? val : p}%</span>
      </div>
      {slider && (
        <input type="range" min={0} max={100} step={5} value={val} aria-label={`אחוז ביצוע ${t.title}`}
          onChange={(e) => setVal(Number(e.target.value))}
          onMouseUp={() => val !== p && slider(val)} onTouchEnd={() => val !== p && slider(val)} onKeyUp={() => val !== p && slider(val)} />
      )}
      <div className="ctl">{children}</div>
    </div>
  );
}

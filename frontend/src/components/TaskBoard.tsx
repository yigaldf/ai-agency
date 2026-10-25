import { useEffect, useState } from 'react';
import { api } from '../lib/api';
import { TODAY } from '../lib/dates';
import type { Model } from '../lib/model';
import type { Task } from '../lib/types';

interface Props { model: Model; refresh: () => Promise<void> }

// Leaf tasks only: parents derive their state from their children.
export function TaskBoard({ model, refresh }: Props) {
  const leaves = model.leaves();
  const done = leaves.filter((t) => model.isDone(t)).sort((a, b) => (b.doneAt ?? '').localeCompare(a.doneAt ?? ''));
  const active = leaves.filter((t) => !model.isDone(t) && t.status === 'active').sort((a, b) => Number(model.isToday(b)) - Number(model.isToday(a)) || model.sysOrder(a) - model.sysOrder(b));
  const backlog = leaves.filter((t) => !model.isDone(t) && t.status !== 'active').sort((a, b) => model.sysOrder(a) - model.sysOrder(b) || a.order - b.order);

  const start = async (t: Task) => { await api.putTask({ ...t, status: 'active', startedAt: t.startedAt ?? TODAY }); await refresh(); };
  const pause = async (t: Task) => { await api.putTask({ ...t, status: 'backlog' }); await refresh(); };
  const setProgress = async (t: Task, p: number) => { await api.setProgress(t.id, p, TODAY); await refresh(); };

  return (
    <section className="board">
      <Column title="לא החלו" count={backlog.length} tone="hold" empty="אין משימות שממתינות.">
        {backlog.map((t) => (
          <Row key={t.id} t={t} model={model}>
            <button className="tiny primary" onClick={() => start(t)}>התחל</button>
          </Row>
        ))}
      </Column>

      <Column title="פעילות" count={active.length} tone="active" empty="אין משימות פעילות. העבר אחת מ'לא החלו'.">
        {active.map((t) => (
          <Row key={t.id} t={t} model={model} slider={(p) => setProgress(t, p)}>
            <button className="tiny" aria-label="פחות 10%" onClick={() => setProgress(t, (t.progress ?? 0) - 10)}>−10</button>
            <button className="tiny" aria-label="עוד 10%" onClick={() => setProgress(t, (t.progress ?? 0) + 10)}>+10</button>
            <button className="tiny" onClick={() => pause(t)}>השהה</button>
            <button className="tiny primary" onClick={() => setProgress(t, 100)}>סיים ✓</button>
          </Row>
        ))}
      </Column>

      <Column title="הסתיימו" count={done.length} tone="done" empty="עוד לא הסתיימה אף משימה.">
        {done.map((t) => (
          <Row key={t.id} t={t} model={model}>
            {t.doneAt && <span className="muted small">{t.doneAt}</span>}
            <button className="tiny" onClick={() => setProgress(t, 90)}>פתח מחדש</button>
          </Row>
        ))}
      </Column>
    </section>
  );
}

function Column({ title, count, tone, empty, children }: { title: string; count: number; tone: string; empty: string; children: React.ReactNode }) {
  return (
    <div className="panel col-panel">
      <div className="panel-head">
        <h2>{title}</h2>
        <span className={'chip ' + tone}>{count}</span>
      </div>
      <div className="list">{count ? children : <div className="empty-state">{empty}</div>}</div>
    </div>
  );
}

function Row({ t, model, slider, children }: { t: Task; model: Model; slider?: (p: number) => Promise<void>; children: React.ReactNode }) {
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

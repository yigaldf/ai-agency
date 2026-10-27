import { useState, type ClipboardEvent, type KeyboardEvent } from 'react';
import { api } from '../lib/api';
import { TODAY, uid } from '../lib/dates';
import { parseList, type Model } from '../lib/model';
import type { Link, System, Task } from '../lib/types';
import { Links } from './Links';
import { useToast } from './Toast';

interface TreeProps { model: Model; refresh: () => Promise<void> }

export function Tree({ model, refresh }: TreeProps) {
  const { toast } = useToast();
  const [newSystem, setNewSystem] = useState('');

  const addSystem = async () => {
    const name = newSystem.trim();
    if (!name) return;
    await api.putSystem({ id: uid('s'), name, order: model.systems.length + 1, links: [], createdAt: TODAY });
    setNewSystem('');
    await refresh();
  };

  const deleteSystem = async (s: System) => {
    const { system, tasks } = await api.deleteSystem(s.id);
    await refresh();
    toast(`נמחקה המערכת ${s.name}${tasks.length ? ` (+${tasks.length} משימות)` : ''}`, async () => {
      await api.putSystem(system);
      if (tasks.length) await api.bulkTasks(tasks);
      await refresh();
      toast('שוחזר');
    });
  };

  return (
    <section>
      <div className="panel-head" style={{ marginBottom: 10 }}>
        <h2>מערכות</h2>
        <div className="add" style={{ flex: '1 1 280px', maxWidth: 420 }}>
          <input type="text" value={newSystem} onChange={(e) => setNewSystem(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && addSystem()} placeholder="מערכת חדשה" />
          <button onClick={addSystem}>הוסף</button>
        </div>
      </div>
      <div className="list" style={{ gap: 12 }}>
        {model.systems.length ? (
          model.systems.slice().sort((a, b) => Number(systemDone(model, a)) - Number(systemDone(model, b)) || a.order - b.order).map((s) => (
            <SystemCard key={s.id} s={s} model={model} refresh={refresh} onDelete={() => deleteSystem(s)} />
          ))
        ) : (
          <div className="empty-state">אין מערכות עדיין. הוסף אחת למעלה.</div>
        )}
      </div>
    </section>
  );
}

// a system is finished when it has tasks and every leaf is done
const systemDone = (model: Model, s: System) => {
  const leaves = model.tasks.filter((t) => t.systemId === s.id && model.isLeaf(t));
  return leaves.length > 0 && leaves.every((t) => model.isDone(t));
};
// open items first, finished ones last, then the original order
const openFirst = (model: Model) => (a: Task, b: Task) => Number(model.isDone(a)) - Number(model.isDone(b)) || a.order - b.order;

// ---------- system ----------
function SystemCard({ s, model, refresh, onDelete }: { s: System; model: Model; refresh: () => Promise<void>; onDelete: () => void }) {
  const ts = model.topTasks(s.id).sort(openFirst(model));
  const all = model.tasks.filter((t) => t.systemId === s.id && model.isLeaf(t));
  const avg = ts.length ? Math.round(ts.reduce((a, t) => a + model.prog(t), 0) / ts.length) : 0;
  const allDone = all.length > 0 && all.every((t) => model.isDone(t));
  const [open, setOpen] = useState(!allDone);

  return (
    <details className="system" open={open} onToggle={(e) => setOpen((e.target as HTMLDetailsElement).open)}>
      <summary>
        <span className="chev">◀</span>
        <h3 style={{ flex: '1 1 160px' }}>{s.name}</h3>
        <span className="muted small">{all.filter((t) => model.isDone(t)).length}/{all.length}</span>
        <Bar pct={avg} full={allDone} />
        <span className="pct">{avg}%</span>
        {allDone && <span className="chip done">הסתיים</span>}
        <button className="trash" title="מחק מערכת" aria-label="מחק מערכת" onClick={(e) => { e.preventDefault(); onDelete(); }}>🗑</button>
      </summary>
      <div className="body">
        <Links links={s.links} onChange={async (links) => { await api.putSystem({ ...s, links }); await refresh(); }} />
        {ts.map((t) => <TaskRow key={t.id} t={t} model={model} refresh={refresh} />)}
        <AddInput placeholder={`משימה חדשה תחת ${s.name}, או הדבק רשימה`} systemId={s.id} parentId={null} model={model} refresh={refresh} label="הוסף משימה" />
      </div>
    </details>
  );
}

// ---------- task + sub-task ----------
function TaskRow({ t, model, refresh }: { t: Task; model: Model; refresh: () => Promise<void> }) {
  const subs = model.children(t.id).slice().sort(openFirst(model));
  const p = model.prog(t);
  const done = model.isDone(t);
  const [open, setOpen] = useState(!done);

  return (
    <div className={'task' + (done ? ' done' : '') + (open ? ' open' : '')}>
      <div className="thead">
        <button className="chevbtn" aria-label={open ? 'קפל' : 'פתח'} aria-expanded={open} onClick={() => setOpen((o) => !o)}>
          <span className="chev">◀</span>
        </button>
        <EditableTitle t={t} refresh={refresh} onClick={() => setOpen((o) => !o)} title="לחיצה לפתיחה, לחיצה כפולה לעריכה" />
        <div className="ctl">
          {!subs.length && <LeafControls t={t} done={done} refresh={refresh} />}
          <DeleteButton t={t} refresh={refresh} />
        </div>
        <div className="meta">
          <Chip t={t} done={done} model={model} />
          <Bar pct={p} full={done} />
          <span className="pct">{p}%</span>
          {subs.length > 0 && <span className="muted small">{subs.filter((s) => model.isDone(s)).length}/{subs.length} תת־משימות</span>}
        </div>
        <TaskLinks t={t} refresh={refresh} />
      </div>
      {open && (
        <div className="tbody">
          {subs.map((s) => <SubRow key={s.id} t={s} model={model} refresh={refresh} />)}
          <AddInput placeholder="תת־משימה חדשה, או הדבק רשימה שלמה" systemId={t.systemId} parentId={t.id} model={model} refresh={refresh} label="הוסף" sub />
        </div>
      )}
    </div>
  );
}

function SubRow({ t, model, refresh }: { t: Task; model: Model; refresh: () => Promise<void> }) {
  const p = model.prog(t);
  const done = model.isDone(t);
  return (
    <div className={'sub' + (done ? ' done' : '')}>
      <EditableTitle t={t} refresh={refresh} title="לחיצה כפולה לעריכה" />
      <div className="ctl">
        <LeafControls t={t} done={done} refresh={refresh} />
        <DeleteButton t={t} refresh={refresh} />
      </div>
      <div className="meta">
        <Chip t={t} done={done} model={model} />
        <Bar pct={p} full={done} />
        <span className="pct">{p}%</span>
        {t.doneAt && <span className="muted small">{t.doneAt}</span>}
      </div>
      <TaskLinks t={t} refresh={refresh} />
    </div>
  );
}

// ---------- pieces ----------
const Bar = ({ pct, full }: { pct: number; full: boolean }) => (
  <div className={'bar' + (full ? ' full' : '')}><i style={{ width: `${pct}%` }} /></div>
);

function Chip({ t, done, model }: { t: Task; done: boolean; model: Model }) {
  if (done) return <span className="chip done">הושלם</span>;
  if (!model.isLeaf(t)) return model.children(t.id).some(model.isToday) ? <span className="chip today">היום</span> : null;
  if (model.isToday(t)) return <span className="chip today">היום</span>;
  return t.status === 'active' ? <span className="chip active">בעבודה</span> : <span className="chip hold">ממתין</span>;
}

function TaskLinks({ t, refresh }: { t: Task; refresh: () => Promise<void> }) {
  return <Links links={t.links} onChange={async (links: Link[]) => { await api.putTask({ ...t, links }); await refresh(); }} />;
}

function LeafControls({ t, done, refresh }: { t: Task; done: boolean; refresh: () => Promise<void> }) {
  const set = (p: number) => api.setProgress(t.id, p, TODAY).then(refresh);
  if (done) return <button className="tiny" onClick={() => set(90)}>פתח מחדש</button>;
  const toggleStatus = async () => {
    const n: Task = { ...t, status: t.status === 'active' ? 'backlog' : 'active' };
    if (n.status === 'active' && !n.startedAt) n.startedAt = TODAY;
    await api.putTask(n);
    await refresh();
  };
  return (
    <>
      <button className="tiny" aria-label="פחות 10%" onClick={() => set((t.progress ?? 0) - 10)}>−10</button>
      <button className="tiny" aria-label="עוד 10%" onClick={() => set((t.progress ?? 0) + 10)}>+10</button>
      <button className="tiny" onClick={() => set(100)}>✓</button>
      <button className="tiny" onClick={toggleStatus}>{t.status === 'active' ? 'השהה' : 'התחל'}</button>
    </>
  );
}

function DeleteButton({ t, refresh }: { t: Task; refresh: () => Promise<void> }) {
  const { toast } = useToast();
  const del = async () => {
    const rows = await api.deleteTask(t.id);
    await refresh();
    toast(`נמחק: ${t.title}${rows.length > 1 ? ` (+${rows.length - 1})` : ''}`, async () => {
      await api.bulkTasks(rows);
      await refresh();
      toast('שוחזר');
    });
  };
  return <button className="trash" title="מחק" aria-label="מחק" onClick={del}>🗑</button>;
}

function EditableTitle({ t, refresh, onClick, title }: { t: Task; refresh: () => Promise<void>; onClick?: () => void; title: string }) {
  const [editing, setEditing] = useState(false);
  const [val, setVal] = useState(t.title);
  const commit = async () => {
    setEditing(false);
    const v = val.trim();
    if (v && v !== t.title) { await api.putTask({ ...t, title: v }); await refresh(); } else setVal(t.title);
  };
  if (editing) {
    return (
      <div className="title">
        <input type="text" value={val} autoFocus onChange={(e) => setVal(e.target.value)} onBlur={commit}
          onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); commit(); } if (e.key === 'Escape') { setVal(t.title); setEditing(false); } }} />
      </div>
    );
  }
  return (
    <div className="title" title={title} onClick={onClick} onDoubleClick={(e) => { e.preventDefault(); setVal(t.title); setEditing(true); }}>
      {t.title}
    </div>
  );
}

interface AddProps { placeholder: string; systemId: string; parentId: string | null; model: Model; refresh: () => Promise<void>; label: string; sub?: boolean }

function AddInput({ placeholder, systemId, parentId, model, refresh, label, sub }: AddProps) {
  const { toast } = useToast();
  const [v, setV] = useState('');
  const siblings = () => (parentId ? model.children(parentId) : model.topTasks(systemId)).length;
  const make = (title: string, order: number): Task => ({
    id: uid('t'), systemId, parentId, title, progress: 0, status: 'backlog', order, todayDate: null, startedAt: null, doneAt: null, links: [], createdAt: TODAY,
  });

  const add = async () => {
    const title = v.trim();
    if (!title) return;
    await api.putTask(make(title, siblings() + 1));
    setV('');
    await refresh();
  };
  const onKey = (e: KeyboardEvent) => { if (e.key === 'Enter') add(); };

  // Paste a multi-line list: one task per line.
  const onPaste = async (e: ClipboardEvent) => {
    const text = e.clipboardData.getData('text') || '';
    if (!/\n/.test(text.trim())) return;
    const items = parseList(text);
    if (items.length < 2) return;
    e.preventDefault();
    let order = siblings();
    const created = items.map((title) => make(title, ++order));
    await api.bulkTasks(created);
    setV('');
    await refresh();
    toast(`נוצרו ${created.length} ${sub ? 'תת־משימות' : 'משימות'} מהרשימה`, async () => {
      for (const t of created) await api.deleteTask(t.id).catch(() => {});
      await refresh();
      toast('בוטל');
    });
  };

  return (
    <div className={'add' + (sub ? ' sub-add' : '')}>
      <input type="text" value={v} onChange={(e) => setV(e.target.value)} onKeyDown={onKey} onPaste={onPaste} placeholder={placeholder} />
      <button className={sub ? 'tiny' : ''} onClick={add}>{label}</button>
    </div>
  );
}

import { Fragment, useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { api } from '../lib/api';
import { TODAY, uid } from '../lib/dates';
import { useDragList } from '../lib/dnd';
import type { Model } from '../lib/model';
import type { System, SystemStatus, Task } from '../lib/types';
import { StatusMenu } from './SystemStatus';
import { DateEditor, TaskDates } from './TaskDates';
import { useToast } from './Toast';

/**
 * Roadmap view of one system.
 * chain  = a top-level task (its title is the chain's subject)
 * node   = a sub-task inside that chain
 * main chain = the system's top-level tasks, one node per chain (shown when there is more than one)
 * The data model is unchanged: moving a node between chains is a parentId change.
 */
interface Props {
  s: System; model: Model; refresh: () => Promise<void>; onStatus: (to: SystemStatus) => void;
  onDeleteSystem?: () => void; // only for archived systems
  handleProps: object; rowProps: { className: string };
}

export function Roadmap({ s, model, refresh, onStatus, onDeleteSystem, handleProps, rowProps }: Props) {
  const { toast } = useToast();
  const chains = model.topTasks(s.id);
  const leaves = model.tasks.filter((t) => t.systemId === s.id && model.isLeaf(t));
  const doneCount = leaves.filter((t) => model.isDone(t)).length;
  const avg = chains.length ? Math.round(chains.reduce((a, t) => a + model.prog(t), 0) / chains.length) : 0;
  const [newChain, setNewChain] = useState('');
  const chainRefs = useRef<Record<string, HTMLDivElement | null>>({});

  const persist = async (next: Task[]) => {
    const changed = next.map((x, k) => ({ ...x, order: k + 1 })).filter((x, k) => next[k].order !== x.order);
    if (changed.length) await api.bulkTasks(changed);
    await refresh();
  };
  const mainDnd = useDragList(chains, persist);

  const addChain = async () => {
    const title = newChain.trim();
    if (!title) return;
    await api.putTask({ id: uid('t'), systemId: s.id, parentId: null, title, progress: 0, status: 'backlog', order: chains.length + 1, todayDate: null, startedAt: null, doneAt: null, dueDate: null, links: [], createdAt: TODAY });
    setNewChain('');
    await refresh();
  };

  return (
    <section {...rowProps} className={'panel sys-road' + rowProps.className}>
      <div className="panel-head">
        <div className="row">
          <span className="grip" title="גרור לשינוי סדר" {...handleProps}>⋮⋮</span>
          <h2>{s.name}</h2>
          <span className="muted small">{doneCount}/{leaves.length}</span>
          <div className={'bar' + (leaves.length && doneCount === leaves.length ? ' full' : '')}><i style={{ width: `${avg}%` }} /></div>
          <span className="pct">{avg}%</span>
          {leaves.length > 0 && doneCount === leaves.length && <span className="chip done">הסתיים</span>}
          <StatusMenu s={s} onChange={onStatus} />
        </div>
        <div className="row">
          <input type="text" className="small-input" value={newChain} onChange={(e) => setNewChain(e.target.value)} onKeyDown={(e: KeyboardEvent) => e.key === 'Enter' && addChain()} placeholder="שרשרת חדשה (שם נושא)" />
          <button className="tiny primary" onClick={addChain}>+ שרשרת</button>
          {onDeleteSystem && <button className="trash" title="מחק מערכת" aria-label="מחק מערכת" onClick={onDeleteSystem}>🗑</button>}
        </div>
      </div>

      {chains.length > 1 && (
        <div className="chain main">
          <div className="chain-head">
            <span className="title">שרשרת ראשית</span>
            <span className="muted small">קובייה לכל שרשרת. גרירה משנה את סדר השרשראות.</span>
          </div>
          <div className="track"><div className="nodes">
            {chains.map((c, i) => (
              <Fragment key={c.id}>
                {i > 0 && <Arrow done={model.isDone(chains[i - 1])} />}
                <div {...mainDnd.rowProps(c.id)} className={'node ' + tone(model, c) + mainDnd.rowProps(c.id).className} onClick={() => chainRefs.current[c.id]?.scrollIntoView({ behavior: 'smooth', block: 'center' })} title="לחיצה קופצת לשרשרת">
                  <span className="grip small" {...mainDnd.handleProps(c.id)} onClick={(e) => e.stopPropagation()}>⋮⋮</span>
                  <span className="num">{i + 1}</span>
                  <div className="t">{c.title}</div>
                  <div className="p">{model.prog(c)}%</div>
                  <div className="mini"><i style={{ width: `${model.prog(c)}%` }} /></div>
                  <TaskDates t={c} done={model.isDone(c)} always={['due']} />
                  <div className="muted tiny-txt">{model.children(c.id).length ? `${model.children(c.id).filter((x) => model.isDone(x)).length}/${model.children(c.id).length} קוביות` : 'קובייה בודדת'}</div>
                </div>
              </Fragment>
            ))}
          </div></div>
        </div>
      )}

      {chains.length === 0 && <div className="empty-state">אין שרשראות עדיין. הוסף שרשרת עם שם נושא למעלה.</div>}
      {chains.map((c) => (
        <Chain key={c.id} chain={c} chains={chains} model={model} refresh={refresh} toast={toast} setRef={(el) => { chainRefs.current[c.id] = el; }} />
      ))}
    </section>
  );
}


const tone = (model: Model, t: Task) => (model.isDone(t) ? 'done' : t.status === 'active' || (!model.isLeaf(t) && model.prog(t) > 0) ? 'active' : 'wait') + (model.isToday(t) || (!model.isLeaf(t) && model.children(t.id).some(model.isToday)) ? ' today' : '');

const Arrow = ({ done }: { done: boolean }) => <div className={'link' + (done ? ' done' : '')} aria-hidden="true" />;

interface ChainProps { chain: Task; chains: Task[]; model: Model; refresh: () => Promise<void>; toast: (m: string, u?: () => Promise<void>) => void; setRef: (el: HTMLDivElement | null) => void }

function Chain({ chain, chains, model, refresh, toast, setRef }: ChainProps) {
  // a chain without sub-tasks is itself its single node
  const subs = model.children(chain.id);
  const nodes: Task[] = subs.length ? subs : [chain];
  const single = !subs.length;
  const p = model.prog(chain);
  const done = model.isDone(chain);
  const [newNode, setNewNode] = useState('');
  const [editing, setEditing] = useState(false);
  const [title, setTitle] = useState(chain.title);
  useEffect(() => setTitle(chain.title), [chain.title]);

  const persist = async (next: Task[]) => {
    if (single) return;
    const changed = next.map((x, k) => ({ ...x, order: k + 1 })).filter((x, k) => next[k].order !== x.order);
    if (changed.length) await api.bulkTasks(changed);
    await refresh();
  };
  const dnd = useDragList(nodes, persist);

  const addNode = async () => {
    const t = newNode.trim();
    if (!t) return;
    // first node on a single-node chain: the chain's own progress moves into the new node so nothing is lost
    await api.putTask({ id: uid('t'), systemId: chain.systemId, parentId: chain.id, title: t, progress: single ? chain.progress : 0, status: single ? chain.status : 'backlog', order: subs.length + 1, todayDate: single ? chain.todayDate : null, startedAt: single ? chain.startedAt : null, doneAt: single ? chain.doneAt : null, dueDate: single ? chain.dueDate : null, links: [], createdAt: TODAY });
    setNewNode('');
    await refresh();
  };
  const rename = async () => {
    setEditing(false);
    const v = title.trim();
    if (v && v !== chain.title) { await api.putTask({ ...chain, title: v }); await refresh(); } else setTitle(chain.title);
  };
  const del = async () => {
    const rows = await api.deleteTask(chain.id);
    await refresh();
    toast(`נמחקה השרשרת: ${chain.title}${rows.length > 1 ? ` (+${rows.length - 1})` : ''}`, async () => { await api.bulkTasks(rows); await refresh(); toast('שוחזר'); });
  };

  return (
    <div className={'chain' + (done ? ' done' : '')} ref={setRef}>
      <div className="chain-head">
        {editing ? (
          <input type="text" className="small-input" value={title} autoFocus onChange={(e) => setTitle(e.target.value)} onBlur={rename}
            onKeyDown={(e) => { if (e.key === 'Enter') rename(); if (e.key === 'Escape') { setTitle(chain.title); setEditing(false); } }} />
        ) : (
          <span className="title" onDoubleClick={() => setEditing(true)} title="לחיצה כפולה לשינוי שם">{chain.title}</span>
        )}
        <span className="acts">
          <button className="tiny" onClick={() => setEditing(true)}>שנה שם</button>
          <button className="trash" title="מחק שרשרת" aria-label="מחק שרשרת" onClick={del}>🗑</button>
        </span>
        <div className="sum">
          <span className={'chip ' + (done ? 'done' : p > 0 || chain.status === 'active' ? 'active' : 'hold')}>{done ? 'הושלם' : p > 0 || chain.status === 'active' ? 'בעבודה' : 'ממתין'}</span>
          <div className={'bar' + (done ? ' full' : '')}><i style={{ width: `${p}%` }} /></div>
          <span className="pct">{p}%</span>
          <span className="muted small">{single ? 'קובייה בודדת' : `${subs.filter((x) => model.isDone(x)).length}/${subs.length} קוביות`}{done && chain.doneAt ? ` · ${chain.doneAt}` : ''}</span>
        </div>
      </div>
      <div className="track"><div className="nodes">
        {nodes.map((n, i) => (
          <Fragment key={n.id}>
            {i > 0 && <Arrow done={model.isDone(nodes[i - 1])} />}
            <Node t={n} index={i} model={model} refresh={refresh} toast={toast} chains={single ? [] : chains.filter((c) => c.id !== chain.id)} dnd={single ? null : dnd} />
          </Fragment>
        ))}
        <div className="addnode-wrap">
          <input type="text" className="small-input" value={newNode} onChange={(e) => setNewNode(e.target.value)} onKeyDown={(e: KeyboardEvent) => e.key === 'Enter' && addNode()} placeholder="קובייה חדשה" />
          <button className="addnode" title="הוסף קובייה" aria-label="הוסף קובייה" onClick={addNode}>+</button>
        </div>
      </div></div>
    </div>
  );
}

interface NodeProps { t: Task; index: number; model: Model; refresh: () => Promise<void>; toast: (m: string, u?: () => Promise<void>) => void; chains: Task[]; dnd: ReturnType<typeof useDragList<Task>> | null }

function Node({ t, index, model, refresh, toast, chains, dnd }: NodeProps) {
  const [open, setOpen] = useState(false);
  const [moving, setMoving] = useState(false);
  const [dates, setDates] = useState(false);
  const [editing, setEditing] = useState(false);
  const [title, setTitle] = useState(t.title);
  const p = model.prog(t);
  const done = model.isDone(t);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) { setOpen(false); setMoving(false); setDates(false); } };
    document.addEventListener('click', close);
    return () => document.removeEventListener('click', close);
  }, [open]);

  const setProgress = async (v: number) => { await api.setProgress(t.id, v, TODAY); await refresh(); };
  const toggleToday = async () => {
    const n: Task = { ...t, todayDate: model.isToday(t) ? null : TODAY };
    if (n.todayDate && n.status !== 'active') { n.status = 'active'; n.startedAt = n.startedAt ?? TODAY; }
    await api.putTask(n); await refresh();
  };
  const moveTo = async (target: Task) => {
    const siblings = model.children(target.id);
    await api.putTask({ ...t, parentId: target.id, systemId: target.systemId, order: siblings.length + 1 });
    setOpen(false); setMoving(false);
    await refresh();
    toast(`"${t.title}" עברה לשרשרת "${target.title}"`);
  };
  const rename = async () => {
    setEditing(false);
    const v = title.trim();
    if (v && v !== t.title) { await api.putTask({ ...t, title: v }); await refresh(); } else setTitle(t.title);
  };
  const del = async () => {
    const rows = await api.deleteTask(t.id);
    setOpen(false);
    await refresh();
    toast(`נמחק: ${t.title}`, async () => { await api.bulkTasks(rows); await refresh(); toast('שוחזר'); });
  };

  const rowProps = dnd ? dnd.rowProps(t.id) : { className: '' };
  return (
    <div ref={ref} {...rowProps} className={'node ' + tone(model, t) + (open ? ' open' : '') + rowProps.className} onClick={(e) => { if (!(e.target as HTMLElement).closest('.menu, input, .grip')) setOpen((o) => !o); }}>
      {dnd && <span className="grip small" {...dnd.handleProps(t.id)}>⋮⋮</span>}
      <span className="num">{index + 1}</span>
      {editing ? (
        <input type="text" className="small-input" value={title} autoFocus onChange={(e) => setTitle(e.target.value)} onBlur={rename}
          onKeyDown={(e) => { if (e.key === 'Enter') rename(); if (e.key === 'Escape') { setTitle(t.title); setEditing(false); } }} onClick={(e) => e.stopPropagation()} />
      ) : (
        <div className="t">{t.title}</div>
      )}
      <div className="p">{p}%</div>
      <div className="mini"><i style={{ width: `${p}%` }} /></div>
      <TaskDates t={t} done={done} always={['due']} />
      {model.isToday(t) && <span className="chip today">היום</span>}
      {open && (
        <div className="menu" onClick={(e) => e.stopPropagation()}>
          {!done ? (
            <>
              <div className="row">
                <button className="tiny" onClick={() => setProgress(p - 10)}>−10</button>
                <button className="tiny" onClick={() => setProgress(p + 10)}>+10</button>
                <button className="tiny primary" onClick={() => setProgress(100)}>הושלם ✓</button>
              </div>
              <button className="mi" onClick={toggleToday}>{model.isToday(t) ? 'הסר מהיום' : 'סמן להיום'}</button>
            </>
          ) : (
            <button className="mi" onClick={() => setProgress(90)}>פתח מחדש</button>
          )}
          {chains.length > 0 && !moving && <button className="mi" onClick={() => setMoving(true)}>העבר לשרשרת…</button>}
          {moving && (
            <div className="movelist">
              {chains.map((c) => <button className="mi" key={c.id} onClick={() => moveTo(c)}>→ {c.title}</button>)}
            </div>
          )}
          {!dates && <button className="mi" onClick={() => setDates(true)}>תאריכים…</button>}
          {dates && <DateEditor t={t} done={done} refresh={refresh} inline />}
          <button className="mi" onClick={() => { setEditing(true); setOpen(false); }}>שנה שם</button>
          <button className="mi danger" onClick={del}>מחק</button>
        </div>
      )}
    </div>
  );
}

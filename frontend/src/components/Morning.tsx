import { useEffect, useRef, useState } from 'react';
import { api, errorMessage, streamText, ApiError } from '../lib/api';
import { TODAY, YESTERDAY, heDate } from '../lib/dates';
import type { Model } from '../lib/model';
import type { Day, Task } from '../lib/types';
import { useToast } from './Toast';

interface Props {
  model: Model;
  days: Day[];
  aiEnabled: boolean;
  refresh: () => Promise<void>;
}

export function Morning({ model, days, aiEnabled, refresh }: Props) {
  const { toast } = useToast();
  const todayDoc = days.find((d) => d.id === TODAY);
  const [yText, setYText] = useState('');
  const [tText, setTText] = useState('');
  const [dirty, setDirty] = useState(false);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const ctl = useRef<AbortController | null>(null);

  // Pull saved texts/feedback from the server until the user starts typing.
  useEffect(() => {
    if (dirty) return;
    setYText(todayDoc?.yesterdayText ?? '');
    setTText(todayDoc?.todayText ?? '');
    setFeedback(todayDoc?.feedback ?? null);
  }, [todayDoc, dirty]);

  // Yesterday: tasks planned for yesterday, else yesterday's saved plan, else current WIP.
  const yesterdayItems = (): Task[] => {
    const planned = model.leaves().filter((t) => t.todayDate === YESTERDAY);
    if (planned.length) return planned;
    const y = days.find((d) => d.id === YESTERDAY);
    const ids = new Set((y?.plan ?? []).map((p) => p.id));
    const fromPlan = model.leaves().filter((t) => ids.has(t.id));
    return fromPlan.length ? fromPlan : model.wip();
  };

  const picks = model.openLeaves().slice().sort((a, b) => Number(model.isToday(b)) - Number(model.isToday(a)) || model.sysOrder(a) - model.sysOrder(b));
  const nToday = picks.filter(model.isToday).length;

  const togglePick = async (t: Task, checked: boolean) => {
    const n: Task = { ...t };
    if (checked) {
      n.todayDate = TODAY;
      if (n.status !== 'active') {
        n.status = 'active';
        if (!n.startedAt) n.startedAt = TODAY;
      }
    } else n.todayDate = null;
    await api.putTask(n);
    await refresh();
  };

  const saveDay = async () => {
    await api.patchDay(TODAY, {
      yesterdayText: yText,
      todayText: tText,
      plan: model.tasks.filter(model.isToday).map((t) => ({ id: t.id, title: t.title })),
      saved: true,
    });
    setDirty(false);
    await refresh();
    toast('היום נשמר');
  };

  const askClaude = async () => {
    ctl.current = new AbortController();
    setBusy(true);
    setFeedback('קלוד קורא את הנתונים…');
    try {
      const text = await streamText('/feedback', { today: TODAY, yesterdayText: yText, todayText: tText }, { signal: ctl.current.signal, onText: setFeedback });
      setFeedback(text);
      setDirty(false);
      await refresh();
    } catch (e) {
      if (e instanceof ApiError && e.code === 'cancelled') setFeedback(e.text || 'הופסק.');
      else setFeedback(((e as ApiError).text || '') + '\n\n' + errorMessage(e));
    } finally {
      setBusy(false);
      ctl.current = null;
    }
  };

  return (
    <section className="panel" id="morning">
      <div className="panel-head">
        <h2>הטקס של הבוקר</h2>
        <span className="muted small">{todayDoc?.savedAt ? 'היום נשמר ✓' : 'עדיין לא נשמר היום'}</span>
      </div>
      <div className="cols">
        <div className="col">
          <h3>
            אתמול <span className="muted small">{heDate(YESTERDAY)}</span>
          </h3>
          <div className="muted small">גרור את הסליידר לאחוז שאליו הגעת. כל שינוי נשמר מיד.</div>
          <div className="list">
            {yesterdayItems().length ? (
              yesterdayItems().map((t) => <YesterdayRow key={t.id} t={t} model={model} refresh={refresh} />)
            ) : (
              <div className="empty-state">לא היו משימות מתוכננות לאתמול.</div>
            )}
          </div>
          <textarea
            value={yText}
            onChange={(e) => { setYText(e.target.value); setDirty(true); }}
            placeholder="כמה מילים, רק אם יש מה להגיד."
          />
        </div>
        <div className="col">
          <h3>
            היום <span className="muted small">(עד 3 מומלץ)</span>
          </h3>
          {nToday > 3 && <div className="wip-warn">{nToday} משימות להיום. יותר מ־3 במקביל זה בדיוק מה שמשחק את היעילות. בחר מה נדחה.</div>}
          <div className="list">
            {picks.length ? (
              picks.map((t) => (
                <label className="pick" key={t.id}>
                  <input type="checkbox" key={String(model.isToday(t))} defaultChecked={model.isToday(t)} onChange={(e) => togglePick(t, e.target.checked)} />
                  <span>{t.title}</span>
                  <span className="path">{model.pathOf(t)}</span>
                </label>
              ))
            ) : (
              <div className="empty-state">אין משימות פתוחות.</div>
            )}
          </div>
          <textarea
            value={tText}
            onChange={(e) => { setTText(e.target.value); setDirty(true); }}
            placeholder="הערה ליום, רק אם צריך."
          />
        </div>
      </div>
      <div className="row">
        <button className="primary" onClick={saveDay}>שמור את היום</button>
        {aiEnabled && (
          <button onClick={askClaude} disabled={busy}>בקש פידבק מקלוד על הקצב</button>
        )}
        {busy && (
          <button className="ghost" onClick={() => ctl.current?.abort()}>עצור</button>
        )}
      </div>
      <div className={'feedback' + (feedback ? '' : ' empty')}>
        {feedback ?? 'הפידבק של קלוד יופיע כאן אחרי שתסמן מה אתה עושה היום ותבקש אותו.'}
      </div>
    </section>
  );
}

function YesterdayRow({ t, model, refresh }: { t: Task; model: Model; refresh: () => Promise<void> }) {
  const saved = model.prog(t);
  const [val, setVal] = useState(saved);
  useEffect(() => setVal(saved), [saved]);
  const done = model.isDone(t);
  return (
    <div className={'yrow' + (done ? ' done' : '')}>
      <div className="t">{t.title}</div>
      <div className="pct">{val}%</div>
      <div className="path">{model.pathOf(t)}</div>
      <input
        type="range" min={0} max={100} step={5} value={val}
        aria-label={`התקדמות ${t.title}`}
        onChange={(e) => setVal(Number(e.target.value))}
        onMouseUp={() => api.setProgress(t.id, val, TODAY).then(refresh)}
        onTouchEnd={() => api.setProgress(t.id, val, TODAY).then(refresh)}
        onKeyUp={() => api.setProgress(t.id, val, TODAY).then(refresh)}
      />
    </div>
  );
}

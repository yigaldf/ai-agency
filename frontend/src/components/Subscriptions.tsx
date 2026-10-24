import { useEffect, useMemo, useRef, useState, type ChangeEvent, type FormEvent } from 'react';
import { api } from '../lib/api';
import { TODAY, daysAgo, heDate, uid } from '../lib/dates';
import type { Subscription, SubCycle, SubStatus } from '../lib/types';
import { useToast } from './Toast';

const CYCLES: Record<SubCycle, string> = { monthly: 'חודשי', yearly: 'שנתי', weekly: 'שבועי' };
const STATUSES: Record<SubStatus, string> = { active: 'פעיל', trial: 'ניסיון', cancelled: 'בוטל' };
const MONTHLY_FACTOR: Record<SubCycle, number> = { monthly: 1, yearly: 1 / 12, weekly: 52 / 12 };
const SYMBOL: Record<string, string> = { USD: '$', ILS: '₪', EUR: '€', GBP: '£' };

const money = (amount: number, currency: string) =>
  `${SYMBOL[currency] ?? currency + ' '}${amount.toLocaleString('he-IL', { maximumFractionDigits: 0 })}`;

const blank = (): Subscription => ({
  id: uid('sub'), name: '', vendor: '', amount: 0, currency: 'USD', cycle: 'monthly', status: 'active', category: '',
  nextCharge: null, lastCharge: null, paymentMethod: '', cancelUrl: '', sourceUrl: '', notes: '', createdAt: TODAY,
});

export function Subscriptions() {
  const { toast } = useToast();
  const [subs, setSubs] = useState<Subscription[] | null>(null);
  const [editing, setEditing] = useState<Subscription | null>(null);
  const [showCancelled, setShowCancelled] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);

  // Import a JSON file: either {"subscriptions": [...]} or a bare array.
  const importFile = async (e: ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    e.target.value = '';
    if (!f) return;
    try {
      const parsed = JSON.parse(await f.text());
      const list = Array.isArray(parsed) ? parsed : parsed.subscriptions;
      if (!Array.isArray(list)) throw new Error('bad shape');
      const r = await api.importData({ subscriptions: list });
      await load();
      toast(`יובאו ${r.subscriptions} מנויים`);
    } catch {
      toast('הקובץ לא תקין. צריך JSON עם מערך subscriptions.');
    }
  };

  const load = async () => setSubs(await api.subscriptions());
  useEffect(() => { load(); }, []);

  const active = useMemo(() => (subs ?? []).filter((s) => s.status !== 'cancelled'), [subs]);
  const visible = showCancelled ? subs ?? [] : active;

  // Totals per currency, normalised to a month. No FX conversion: one line per currency.
  const totals = useMemo(() => {
    const m = new Map<string, number>();
    for (const s of active) m.set(s.currency, (m.get(s.currency) ?? 0) + s.amount * MONTHLY_FACTOR[s.cycle]);
    return [...m.entries()].sort();
  }, [active]);
  const soon = active.filter((s) => s.nextCharge && s.nextCharge >= TODAY && s.nextCharge <= daysAgo(-7));

  const save = async (s: Subscription) => {
    await api.putSubscription(s);
    setEditing(null);
    await load();
  };
  const remove = async (s: Subscription) => {
    const old = await api.deleteSubscription(s.id);
    await load();
    toast(`נמחק: ${s.name}`, async () => { await api.putSubscription(old); await load(); toast('שוחזר'); });
  };
  const setStatus = async (s: Subscription, status: SubStatus) => { await api.putSubscription({ ...s, status }); await load(); };

  if (!subs) return <div className="loading">טוען…</div>;

  return (
    <>
      <div className="stats">
        {totals.length ? totals.map(([cur, v]) => (
          <div className="stat" key={cur}><span className="muted small">לחודש ({cur})</span><b>{money(Math.round(v), cur)}</b></div>
        )) : <div className="stat"><span className="muted small">לחודש</span><b>0</b></div>}
        {totals.map(([cur, v]) => (
          <div className="stat" key={cur + 'y'}><span className="muted small">לשנה ({cur})</span><b>{money(Math.round(v * 12), cur)}</b></div>
        ))}
        <div className="stat"><span className="muted small">מנויים פעילים</span><b>{active.length}</b></div>
        <div className={'stat' + (soon.length ? ' hot' : '')}><span className="muted small">חיובים ב־7 הימים הקרובים</span><b>{soon.length}</b></div>
      </div>

      <section className="panel">
        <div className="panel-head">
          <div>
            <h2>מנויים משולמים</h2>
            <div className="muted small">כל מה שמחויב אוטומטית. לחיצה על שורה פותחת עריכה.</div>
          </div>
          <div className="row">
            <label className="row small muted"><input type="checkbox" checked={showCancelled} onChange={(e) => setShowCancelled(e.target.checked)} /> הצג מבוטלים</label>
            <button className="ghost" onClick={() => fileInput.current?.click()}>ייבוא JSON</button>
            <input ref={fileInput} type="file" accept="application/json,.json" hidden onChange={importFile} />
            <button className="primary" onClick={() => setEditing(blank())}>+ מנוי</button>
          </div>
        </div>

        {editing && <SubForm initial={editing} onSave={save} onCancel={() => setEditing(null)} />}

        {visible.length ? (
          <div className="subs">
            <div className="subs-head">
              <span>שירות</span><span>סכום</span><span>מחזור</span><span>חיוב הבא</span><span>סטטוס</span><span></span>
            </div>
            {visible.slice().sort(bySoonest).map((s) => (
              <div className={'subs-row' + (s.status === 'cancelled' ? ' done' : '')} key={s.id} onClick={() => setEditing(s)}>
                <span className="title">
                  {s.name}
                  {s.vendor && s.vendor !== s.name && <span className="muted small"> · {s.vendor}</span>}
                  {s.category && <span className="chip hold" style={{ marginInlineStart: 6 }}>{s.category}</span>}
                </span>
                <span className="num">{money(s.amount, s.currency)}</span>
                <span className="muted">{CYCLES[s.cycle]}</span>
                <span className={soon.includes(s) ? 'num warn' : 'num muted'}>{s.nextCharge ?? '—'}</span>
                <span><span className={'chip ' + (s.status === 'active' ? 'active' : s.status === 'trial' ? 'today' : 'hold')}>{STATUSES[s.status]}</span></span>
                <span className="ctl" onClick={(e) => e.stopPropagation()}>
                  {s.cancelUrl && <a className="lchip" href={s.cancelUrl} target="_blank" rel="noopener"><span>ביטול</span></a>}
                  {s.sourceUrl && <a className="lchip" href={s.sourceUrl} target="_blank" rel="noopener"><span>מייל</span></a>}
                  {s.status !== 'cancelled'
                    ? <button className="tiny" onClick={() => setStatus(s, 'cancelled')}>סמן כבוטל</button>
                    : <button className="tiny" onClick={() => setStatus(s, 'active')}>הפעל</button>}
                  <button className="trash" title="מחק" aria-label="מחק" onClick={() => remove(s)}>🗑</button>
                </span>
              </div>
            ))}
          </div>
        ) : (
          <div className="empty-state">אין מנויים עדיין. הוסף אחד, או בקש מקלוד לסרוק את המייל.</div>
        )}
      </section>

      {soon.length > 0 && (
        <section className="panel">
          <div className="panel-head"><h2>חיובים קרובים</h2></div>
          <div className="list">
            {soon.sort(bySoonest).map((s) => (
              <div className="pick" key={s.id}><span className="num">{heDate(s.nextCharge!)}</span><span className="title">{s.name}</span><span className="num">{money(s.amount, s.currency)}</span></div>
            ))}
          </div>
        </section>
      )}
    </>
  );
}

const bySoonest = (a: Subscription, b: Subscription) => (a.nextCharge ?? '9999').localeCompare(b.nextCharge ?? '9999') || a.name.localeCompare(b.name);

function SubForm({ initial, onSave, onCancel }: { initial: Subscription; onSave: (s: Subscription) => Promise<void>; onCancel: () => void }) {
  const [s, setS] = useState(initial);
  useEffect(() => setS(initial), [initial]);
  const set = <K extends keyof Subscription>(k: K, v: Subscription[K]) => setS((x) => ({ ...x, [k]: v }));
  const submit = (e: FormEvent) => { e.preventDefault(); if (s.name.trim()) onSave({ ...s, name: s.name.trim() }); };

  return (
    <form className="subform" onSubmit={submit}>
      <label>שם<input type="text" value={s.name} onChange={(e) => set('name', e.target.value)} required autoFocus /></label>
      <label>ספק<input type="text" value={s.vendor} onChange={(e) => set('vendor', e.target.value)} /></label>
      <label>סכום<input type="number" min={0} step="0.01" value={s.amount} onChange={(e) => set('amount', Number(e.target.value))} /></label>
      <label>מטבע
        <select value={s.currency} onChange={(e) => set('currency', e.target.value)}>
          {['USD', 'ILS', 'EUR', 'GBP'].map((c) => <option key={c}>{c}</option>)}
        </select>
      </label>
      <label>מחזור
        <select value={s.cycle} onChange={(e) => set('cycle', e.target.value as SubCycle)}>
          {Object.entries(CYCLES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
      </label>
      <label>סטטוס
        <select value={s.status} onChange={(e) => set('status', e.target.value as SubStatus)}>
          {Object.entries(STATUSES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
      </label>
      <label>קטגוריה<input type="text" value={s.category} onChange={(e) => set('category', e.target.value)} placeholder="AI, אירוח, תוכנה…" /></label>
      <label>חיוב הבא<input type="date" value={s.nextCharge ?? ''} onChange={(e) => set('nextCharge', e.target.value || null)} /></label>
      <label>חיוב אחרון<input type="date" value={s.lastCharge ?? ''} onChange={(e) => set('lastCharge', e.target.value || null)} /></label>
      <label>אמצעי תשלום<input type="text" value={s.paymentMethod} onChange={(e) => set('paymentMethod', e.target.value)} placeholder="ויזה 1234 / PayPal" /></label>
      <label>קישור לביטול<input type="text" className="ltr" value={s.cancelUrl} onChange={(e) => set('cancelUrl', e.target.value)} placeholder="https://…" /></label>
      <label>קישור למייל<input type="text" className="ltr" value={s.sourceUrl} onChange={(e) => set('sourceUrl', e.target.value)} placeholder="https://mail.google.com/…" /></label>
      <label className="wide">הערות<textarea value={s.notes} onChange={(e) => set('notes', e.target.value)} rows={2} /></label>
      <div className="row wide">
        <button className="primary" type="submit">שמור</button>
        <button className="ghost" type="button" onClick={onCancel}>ביטול</button>
      </div>
    </form>
  );
}

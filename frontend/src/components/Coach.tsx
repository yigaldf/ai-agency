import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { api, errorMessage, streamText, ApiError } from '../lib/api';
import { TODAY } from '../lib/dates';
import type { CoachMessage } from '../lib/types';
import { useToast } from './Toast';

const QUICK: [string, string][] = [
  ['אני לחוץ ועייף', 'אני מרגיש לחוץ ועייף, ימים עוברים ואני לא מסיים כלום.'],
  ['אין לי כוח להתחיל', 'אין לי כוח להתחיל את המשימה הראשונה היום. תעזור לי להתניע.'],
  ['יותר מדי במקביל', 'אני עובד על יותר מדי דברים במקביל ולא מצליח לבחור. תעזור לי להחליט מה נדחה.'],
  ['צ׳ק־אין של 2 דקות', 'סיימתי יום. בוא נעשה צ׳ק־אין של שתי דקות על איך היה.'],
  ['תרגיל נשימה קצר', 'תעשה איתי תרגיל נשימה קצר ואז נחזור לעבודה.'],
];

interface Props { messages: CoachMessage[]; aiEnabled: boolean; refresh: () => Promise<void> }

export function Coach({ messages, aiEnabled, refresh }: Props) {
  const { toast } = useToast();
  const [input, setInput] = useState('');
  const [pending, setPending] = useState<{ user: string; reply: string | null } | null>(null);
  const [busy, setBusy] = useState(false);
  const ctl = useRef<AbortController | null>(null);
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => { if (box.current) box.current.scrollTop = box.current.scrollHeight; }, [messages, pending]);

  const send = async (raw: string) => {
    const text = raw.trim();
    if (!text || busy || !aiEnabled) return;
    setBusy(true);
    setInput('');
    setPending({ user: text, reply: null });
    ctl.current = new AbortController();
    try {
      await streamText('/coach/messages', { content: text, today: TODAY }, {
        signal: ctl.current.signal,
        onText: (full) => setPending({ user: text, reply: full }),
      });
    } catch (e) {
      if (!(e instanceof ApiError && e.code === 'cancelled')) toast(errorMessage(e));
    } finally {
      await refresh(); // server stored both turns (and the partial reply on stop)
      setPending(null);
      setBusy(false);
      ctl.current = null;
    }
  };

  const reset = async () => {
    if (!messages.length) return;
    const old = await api.clearCoach();
    await refresh();
    toast('השיחה נוקתה', async () => { await api.restoreCoach(old); await refresh(); });
  };

  const onKey = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(input); }
  };

  const empty = !messages.length && !pending;
  return (
    <section className="panel coach">
      <div className="panel-head">
        <div>
          <h2>מאמן מנטלי</h2>
          <div className="muted small">מקום לפרוק, להתארגן מחדש, ולצאת עם צעד אחד קטן. המאמן רואה את מצב המשימות שלך.</div>
        </div>
        <button className="ghost tiny" onClick={reset}>שיחה חדשה</button>
      </div>
      <div className="quick">
        {QUICK.map(([label, q]) => <button className="qchip" key={label} onClick={() => send(q)}>{label}</button>)}
      </div>
      <div className="chat" ref={box}>
        {empty && <div className="empty-state">עוד לא דיברתם. בחר פתיח למעלה או כתוב משהו משלך.</div>}
        {messages.map((m) => <div className={'msg ' + (m.role === 'user' ? 'user' : 'coach')} key={m.id}>{m.content}</div>)}
        {pending && (
          <>
            <div className="msg user">{pending.user}</div>
            <div className={'msg coach' + (pending.reply === null ? ' thinking' : '')}>{pending.reply ?? 'המאמן חושב…'}</div>
          </>
        )}
      </div>
      <div className="composer">
        <textarea
          value={input} rows={2} onChange={(e) => setInput(e.target.value)} onKeyDown={onKey}
          placeholder={aiEnabled ? 'מה עובר עליך עכשיו?' : 'המאמן לא זמין: חסר מפתח API בשרת'} disabled={!aiEnabled}
        />
        <div className="row">
          <button className="primary" onClick={() => send(input)} disabled={busy || !aiEnabled}>שלח</button>
          {busy && <button className="ghost" onClick={() => ctl.current?.abort()}>עצור</button>}
          <span className="muted small">Enter שולח, Shift+Enter שורה חדשה</span>
        </div>
      </div>
    </section>
  );
}

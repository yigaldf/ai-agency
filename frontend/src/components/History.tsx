import { TODAY, heDate } from '../lib/dates';
import type { Day } from '../lib/types';

export function History({ days }: { days: Day[] }) {
  const list = days.filter((d) => d.id !== TODAY).slice().sort((a, b) => b.id.localeCompare(a.id)).slice(0, 10);
  return (
    <section className="panel">
      <div className="panel-head"><h2>הימים האחרונים</h2></div>
      <div className="history">
        {list.length ? (
          list.map((d) => (
            <div className="day" key={d.id}>
              <div className="row"><span className="d">{heDate(d.id)}</span><span className="muted small">{d.id}</span></div>
              {d.plan.length > 0 && <div><span className="muted small">תוכנן: </span>{d.plan.map((p) => p.title).join(' · ')}</div>}
              {d.todayText && <div><span className="muted small">הערה: </span>{d.todayText}</div>}
              {d.yesterdayText && <div><span className="muted small">סיכום: </span>{d.yesterdayText}</div>}
              {d.events.length > 0 && <div className="events">{d.events.map((e) => `${e.title} ${e.from}→${e.to}%`).join(' · ')}</div>}
              {d.feedback && <div className="fb">{d.feedback}</div>}
            </div>
          ))
        ) : (
          <div className="empty-state">ההיסטוריה תתמלא מהיום הראשון שתשמור.</div>
        )}
      </div>
    </section>
  );
}

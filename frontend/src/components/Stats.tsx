import { daysAgo } from '../lib/dates';
import type { Model } from '../lib/model';
import type { Day } from '../lib/types';

export function Stats({ model, days }: { model: Model; days: Day[] }) {
  const weekAgo = daysAgo(7);
  const doneWeek = model.leaves().filter((t) => model.isDone(t) && t.doneAt && t.doneAt >= weekAgo).length;
  const w = model.wip().length;
  return (
    <div className="stats">
      <Stat label="הושלמו ב־7 ימים" value={doneWeek} />
      <Stat label="בעבודה במקביל" value={w} hot={w > 3} />
      <Stat label="פתוחות" value={model.openLeaves().length} />
      <Stat label="ימים שתועדו" value={days.filter((d) => d.savedAt).length} />
    </div>
  );
}

function Stat({ label, value, hot }: { label: string; value: number; hot?: boolean }) {
  return (
    <div className={'stat' + (hot ? ' hot' : '')}>
      <span className="muted small">{label}</span>
      <b>{value}</b>
    </div>
  );
}

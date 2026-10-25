import type { CalendarOut, CoachMessage, Day, PlanItem, Routine, RoutinesState, State, Subscription, System, Task } from './types';

export class ApiError extends Error {
  constructor(public code: string, message?: string, public text = '') {
    super(message ?? code);
  }
}

async function req<T>(path: string, init?: RequestInit): Promise<T> {
  const r = await fetch('/api' + path, { headers: { 'Content-Type': 'application/json' }, ...init });
  if (!r.ok) throw new ApiError('http_' + r.status, await r.text().catch(() => ''));
  return r.status === 204 ? (undefined as T) : r.json();
}
const json = (body: unknown) => JSON.stringify(body);

export const api = {
  state: () => req<State>('/state'),

  putSystem: (s: System) => req<System>(`/systems/${s.id}`, { method: 'PUT', body: json(s) }),
  deleteSystem: (id: string) => req<{ system: System; tasks: Task[] }>(`/systems/${id}`, { method: 'DELETE' }),

  putTask: (t: Task) => req<Task>(`/tasks/${t.id}`, { method: 'PUT', body: json(t) }),
  bulkTasks: (ts: Task[]) => req<Task[]>('/tasks/bulk', { method: 'POST', body: json(ts) }),
  deleteTask: (id: string) => req<Task[]>(`/tasks/${id}`, { method: 'DELETE' }),
  setProgress: (id: string, progress: number, today: string) =>
    req<Task>(`/tasks/${id}/progress`, { method: 'PUT', body: json({ progress, today }) }),

  patchDay: (id: string, patch: { yesterdayText?: string; todayText?: string; plan?: PlanItem[]; saved?: boolean }) =>
    req<Day>(`/days/${id}`, { method: 'PATCH', body: json(patch) }),

  subscriptions: () => req<Subscription[]>('/subscriptions'),
  putSubscription: (s: Subscription) => req<Subscription>(`/subscriptions/${s.id}`, { method: 'PUT', body: json(s) }),
  deleteSubscription: (id: string) => req<Subscription>(`/subscriptions/${id}`, { method: 'DELETE' }),
  importData: (payload: { subscriptions?: Partial<Subscription>[] }) =>
    req<{ subscriptions: number }>('/import', { method: 'POST', body: json(payload) }),

  routines: (start: string, end: string) => req<RoutinesState>(`/routines?start=${start}&end=${end}`),
  putRoutine: (r: Routine) => req<Routine>(`/routines/${r.id}`, { method: 'PUT', body: json(r) }),
  deleteRoutine: (id: string) => req<{ routine: Routine; checks: string[] }>(`/routines/${id}`, { method: 'DELETE' }),
  restoreRoutineChecks: (id: string, dates: string[]) => req<number>(`/routines/${id}/restore-checks`, { method: 'POST', body: json(dates) }),
  checkRoutine: (id: string, date: string, done: boolean) => req<unknown>(`/routines/${id}/check`, { method: 'POST', body: json({ date, done }) }),

  calendar: (start: string, end: string) => req<CalendarOut>(`/calendar?start=${start}&end=${end}`),

  clearCoach: () => req<CoachMessage[]>('/coach/messages', { method: 'DELETE' }),
  restoreCoach: (msgs: CoachMessage[]) => req<CoachMessage[]>('/coach/restore', { method: 'POST', body: json(msgs) }),
};

// Reads a text/event-stream of {text} | {done} | {error, code} lines. Resolves with the full text.
export async function streamText(
  path: string,
  body: unknown,
  opts: { signal?: AbortSignal; onText?: (full: string) => void } = {},
): Promise<string> {
  let text = '';
  let res: Response;
  try {
    res = await fetch('/api' + path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: json(body), signal: opts.signal });
  } catch (e) {
    if ((e as Error).name === 'AbortError') throw new ApiError('cancelled', undefined, text);
    throw new ApiError('network');
  }
  if (!res.ok || !res.body) {
    throw new ApiError(res.status === 429 ? 'rate_limited' : res.status === 503 ? 'sampling_disabled' : 'http_' + res.status);
  }
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = '';
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      const lines = buf.split('\n');
      buf = lines.pop() ?? '';
      for (const line of lines) {
        if (!line.startsWith('data: ')) continue;
        const ev = JSON.parse(line.slice(6)) as { text?: string; done?: boolean; error?: string; code?: string };
        if (ev.text) {
          text += ev.text;
          opts.onText?.(text);
        }
        if (ev.error) throw new ApiError(ev.code ?? 'error', ev.error, text);
      }
    }
  } catch (e) {
    if ((e as Error).name === 'AbortError') throw new ApiError('cancelled', undefined, text);
    throw e;
  }
  return text;
}

export function errorMessage(e: unknown): string {
  const code = e instanceof ApiError ? e.code : 'error';
  if (code === 'rate_limited') return 'יותר מדי בקשות כרגע. נסה שוב בעוד כמה דקות.';
  if (code === 'not_granted' || code === 'sampling_disabled') return 'קלוד לא זמין: חסר מפתח API בשרת.';
  if (code === 'refusal') return 'קלוד סירב לענות על הבקשה הזו.';
  return `משהו נכשל (${code}). נסה שוב.`;
}

// Derived views over the task tree. Leaves carry their own progress; parents average their children.
import { TODAY } from './dates';
import type { System, Task } from './types';

export class Model {
  private byIdMap = new Map<string, Task>();
  private kids = new Map<string | null, Task[]>();
  private sysMap = new Map<string, System>();

  constructor(public systems: System[], public tasks: Task[]) {
    for (const t of tasks) {
      this.byIdMap.set(t.id, t);
      const arr = this.kids.get(t.parentId) ?? [];
      arr.push(t);
      this.kids.set(t.parentId, arr);
    }
    for (const arr of this.kids.values()) arr.sort((a, b) => a.order - b.order);
    for (const s of systems) this.sysMap.set(s.id, s);
  }

  byId = (id: string) => this.byIdMap.get(id);
  sysById = (id: string) => this.sysMap.get(id);
  children = (id: string) => this.kids.get(id) ?? [];
  topTasks = (sid: string) => this.tasks.filter((t) => t.systemId === sid && !t.parentId).sort((a, b) => a.order - b.order);
  isLeaf = (t: Task) => this.children(t.id).length === 0;

  prog(t: Task): number {
    const c = this.children(t.id);
    if (!c.length) return Math.min(100, Math.max(0, t.progress ?? 0));
    return Math.round(c.reduce((s, x) => s + this.prog(x), 0) / c.length);
  }
  isDone(t: Task): boolean {
    return this.isLeaf(t) ? t.status === 'done' || (t.progress ?? 0) >= 100 : this.children(t.id).every((c) => this.isDone(c));
  }
  isToday = (t: Task) => t.todayDate === TODAY && !this.isDone(t);
  leaves = () => this.tasks.filter(this.isLeaf);
  openLeaves = () => this.leaves().filter((t) => !this.isDone(t));
  wip = () => this.openLeaves().filter((t) => t.status === 'active');
  sysOrder = (t: Task) => this.sysById(t.systemId)?.order ?? 99;

  pathOf(t: Task): string {
    const parts: string[] = [];
    const sys = this.sysById(t.systemId);
    if (sys) parts.push(sys.name);
    if (t.parentId) {
      const p = this.byId(t.parentId);
      if (p) parts.push(p.title);
    }
    return parts.join(' › ');
  }
}

export function hostOf(u: string): string {
  try {
    return new URL(u).hostname
      .replace(/^www\./, '')
      .replace(/^docs\.google\.com$/, 'Google Docs')
      .replace(/^drive\.google\.com$/, 'Drive')
      .replace(/^claude\.ai$/, 'Claude');
  } catch {
    return '';
  }
}

// Paste a multi-line list into "new task": one item per line, list markers stripped.
export function parseList(text: string): string[] {
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const mark = /^(?:\d+\s*[.)\-:]\s*|[-*•·]\s*|[א-ת]\s*[.)]\s+)/;
  const marked = lines.filter((l) => mark.test(l));
  const src = marked.length >= 2 ? marked : lines;
  return src.map((l) => l.replace(mark, '').trim()).filter((l) => l.length > 1);
}

export interface Link { label: string; url: string }

export interface System {
  id: string;
  name: string;
  order: number;
  links: Link[];
  createdAt: string | null;
}

export type TaskStatus = 'backlog' | 'active' | 'done';

export interface Task {
  id: string;
  systemId: string;
  parentId: string | null;
  title: string;
  progress: number;
  status: TaskStatus;
  order: number;
  todayDate: string | null;
  startedAt: string | null;
  doneAt: string | null;
  links: Link[];
  createdAt: string | null;
}

export interface PlanItem { id: string; title: string }
export interface DayEvent { taskId: string; title: string; from: number; to: number; at: string }

export interface Day {
  id: string;
  yesterdayText: string;
  todayText: string;
  plan: PlanItem[];
  events: DayEvent[];
  feedback: string | null;
  feedbackAt: string | null;
  savedAt: string | null;
}

export interface CoachMessage { id: number; role: 'user' | 'assistant'; content: string; createdAt: string }

export interface State {
  systems: System[];
  tasks: Task[];
  days: Day[];
  coach: CoachMessage[];
  ai: { enabled: boolean; model: string };
}

export type SubCycle = 'monthly' | 'yearly' | 'weekly';
export type SubStatus = 'active' | 'cancelled' | 'trial';

export interface Subscription {
  id: string;
  name: string;
  vendor: string;
  amount: number;
  currency: string;
  cycle: SubCycle;
  status: SubStatus;
  category: string;
  nextCharge: string | null;
  lastCharge: string | null;
  paymentMethod: string;
  cancelUrl: string;
  sourceUrl: string;
  notes: string;
  createdAt: string | null;
}

export interface Routine {
  id: string;
  title: string;
  days: number[]; // 0 = Sunday … 6 = Saturday; empty = every day
  order: number;
  active: boolean;
  notes: string;
  createdAt: string | null;
}
export interface RoutineCheck { routineId: string; date: string }
export interface RoutinesState { routines: Routine[]; checks: RoutineCheck[] }

export interface CalendarEvent {
  id: string;
  title: string;
  start: string; // ISO, local time
  end: string;
  date: string; // YYYY-MM-DD
  allDay: boolean;
  recurring: boolean;
  location: string;
}
export interface CalendarOut { enabled: boolean; source: string; events: CalendarEvent[]; error: string | null }
export interface GoogleStatus { configured: boolean; connected: boolean }

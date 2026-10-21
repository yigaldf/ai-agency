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

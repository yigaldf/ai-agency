import { useEffect, useRef, useState } from 'react';
import type { System, SystemStatus } from '../lib/types';

// new: created, nothing started yet · active: work started on a task · inactive: parked · archived: done with it (only here can it be deleted)
export const SYSTEM_STATUSES: { key: SystemStatus; label: string }[] = [
  { key: 'new', label: 'חדש' },
  { key: 'active', label: 'פעיל' },
  { key: 'inactive', label: 'לא פעיל' },
  { key: 'archived', label: 'ארכיב' },
];

export const isSystemStatus = (v: unknown): v is SystemStatus => SYSTEM_STATUSES.some((x) => x.key === v);
export const statusLabel = (k: SystemStatus) => SYSTEM_STATUSES.find((x) => x.key === k)?.label ?? k;

// A chip-like button with the current status; it opens a menu with the other three.
// Clicks are stopped so it can sit inside a <summary> without folding the card.
export function StatusMenu({ s, onChange }: { s: System; onChange: (to: SystemStatus) => void }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    if (!open) return;
    const outside = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false); };
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', outside);
    document.addEventListener('keydown', esc);
    return () => { document.removeEventListener('mousedown', outside); document.removeEventListener('keydown', esc); };
  }, [open]);

  return (
    <span className="status-menu" ref={ref}>
      <button className={'tiny status-btn st-' + s.status} title="שינוי סטטוס" aria-haspopup="menu" aria-expanded={open}
        onClick={(e) => { e.preventDefault(); e.stopPropagation(); setOpen((o) => !o); }}>
        {statusLabel(s.status)} ▾
      </button>
      {open && (
        <div className="menu" role="menu" onClick={(e) => { e.preventDefault(); e.stopPropagation(); }}>
          <div className="menu-title muted small">העבר לסטטוס</div>
          {SYSTEM_STATUSES.filter((x) => x.key !== s.status).map((x) => (
            <button key={x.key} role="menuitem" className="mi" onClick={() => { setOpen(false); onChange(x.key); }}>{x.label}</button>
          ))}
        </div>
      )}
    </span>
  );
}

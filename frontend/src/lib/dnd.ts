import { useState, type DragEvent } from 'react';

/**
 * Drag-to-reorder for one flat list. Each list gets its own hook instance, so a
 * row only reacts to drags that started in the same list (nested lists stay apart).
 * `handleProps(id)` goes on the grip, `rowProps(id)` on the row container.
 */
export function useDragList<T extends { id: string }>(items: T[], onReorder: (next: T[]) => Promise<void> | void) {
  const [dragId, setDragId] = useState<string | null>(null);
  const [overId, setOverId] = useState<string | null>(null);

  const reset = () => { setDragId(null); setOverId(null); };

  const handleProps = (id: string) => ({
    draggable: true,
    onDragStart: (e: DragEvent) => {
      e.stopPropagation();
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('text/plain', id);
      setDragId(id);
    },
    onDragEnd: reset,
  });

  const rowProps = (id: string) => ({
    onDragOver: (e: DragEvent) => {
      if (!dragId) return; // a drag from another list: let it bubble
      e.preventDefault();
      e.stopPropagation();
      e.dataTransfer.dropEffect = 'move';
      if (overId !== id) setOverId(id);
    },
    onDragLeave: (e: DragEvent) => {
      if (!dragId) return;
      if (!(e.currentTarget as HTMLElement).contains(e.relatedTarget as Node | null)) setOverId((o) => (o === id ? null : o));
    },
    onDrop: async (e: DragEvent) => {
      if (!dragId) return;
      e.preventDefault();
      e.stopPropagation();
      const from = items.findIndex((x) => x.id === dragId);
      const to = items.findIndex((x) => x.id === id);
      reset();
      if (from < 0 || to < 0 || from === to) return;
      const next = items.slice();
      const [moved] = next.splice(from, 1);
      next.splice(to, 0, moved); // lands where the target row was: above it when dragging up, below it when dragging down
      await onReorder(next);
    },
    className: (dragId === id ? ' dragging' : '') + (overId === id && dragId !== id ? (items.findIndex((x) => x.id === dragId) < items.findIndex((x) => x.id === id) ? ' drop-after' : ' drop-before') : ''),
  });

  return { dragId, handleProps, rowProps };
}

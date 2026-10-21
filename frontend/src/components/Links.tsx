import { useState, type KeyboardEvent } from 'react';
import { hostOf } from '../lib/model';
import type { Link } from '../lib/types';
import { useToast } from './Toast';

interface Props {
  links: Link[];
  onChange: (links: Link[]) => Promise<void>;
  sub?: boolean;
}

// Links on every level: chips that open in a new tab, a remove × per chip, and an inline add form.
export function Links({ links, onChange }: Props) {
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [label, setLabel] = useState('');
  const [url, setUrl] = useState('');

  const remove = async (i: number) => {
    const removed = links[i];
    const next = links.filter((_, j) => j !== i);
    await onChange(next);
    toast(`הלינק "${removed.label}" הוסר`, () => onChange([...next, removed]));
  };

  const save = async () => {
    let u = url.trim();
    if (!u) return toast('חסרה כתובת');
    if (!/^https?:\/\//i.test(u)) u = 'https://' + u;
    try { new URL(u); } catch { return toast('הכתובת לא תקינה'); }
    setOpen(false); setLabel(''); setUrl('');
    await onChange([...links, { label: label.trim() || hostOf(u) || u, url: u }]);
  };
  const onKey = (e: KeyboardEvent) => { if (e.key === 'Enter') { e.preventDefault(); save(); } };

  return (
    <>
      <div className="links">
        {links.map((l, i) => (
          <a className="lchip" key={i} href={l.url} target="_blank" rel="noopener">
            <span className="x" role="button" title="הסר לינק" onClick={(e) => { e.preventDefault(); e.stopPropagation(); remove(i); }}>×</span>
            <span>{l.label || l.url}</span>
            <b>{hostOf(l.url)}</b>
          </a>
        ))}
        <button className="tiny addlink" onClick={(e) => { e.preventDefault(); setOpen((o) => !o); }}>+ לינק</button>
      </div>
      {open && (
        <div className="linkform" onClick={(e) => e.stopPropagation()}>
          <input type="text" value={label} onChange={(e) => setLabel(e.target.value)} onKeyDown={onKey} placeholder="שם (למשל: חוברת עבודה)" autoFocus />
          <input type="text" className="url" value={url} onChange={(e) => setUrl(e.target.value)} onKeyDown={onKey} placeholder="https://…" />
          <button className="tiny primary" onClick={save}>שמור</button>
          <button className="tiny ghost" onClick={() => setOpen(false)}>ביטול</button>
        </div>
      )}
    </>
  );
}

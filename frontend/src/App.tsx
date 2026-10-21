import { useCallback, useEffect, useMemo, useState } from 'react';
import { Coach } from './components/Coach';
import { History } from './components/History';
import { Morning } from './components/Morning';
import { Stats } from './components/Stats';
import { ToastProvider } from './components/Toast';
import { Tree } from './components/Tree';
import { api } from './lib/api';
import { TODAY, heDate } from './lib/dates';
import { Model } from './lib/model';
import type { State } from './lib/types';

type Tab = 'board' | 'coach';

function initialTab(): Tab {
  if (location.hash === '#coach') return 'coach';
  try { return localStorage.getItem('tab') === 'coach' ? 'coach' : 'board'; } catch { return 'board'; }
}

export default function App() {
  const [state, setState] = useState<State | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>(initialTab);

  const refresh = useCallback(async () => {
    try {
      setState(await api.state());
      setError(null);
    } catch (e) {
      setError('שגיאת חיבור לשרת: ' + (e as Error).message);
    }
  }, []);

  useEffect(() => {
    refresh();
    const onFocus = () => refresh();
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  }, [refresh]);

  const selectTab = (t: Tab) => {
    setTab(t);
    try { localStorage.setItem('tab', t); } catch { /* private mode */ }
  };

  const model = useMemo(() => new Model(state?.systems ?? [], state?.tasks ?? []), [state]);

  return (
    <ToastProvider>
      <div className="wrap">
        <header>
          <div>
            <h1>המסע לסוכנות AI</h1>
            <div className="muted small">יום אחד, מעט משימות, סיום לפני התחלה.</div>
          </div>
          <div className="date">{heDate(TODAY)}</div>
        </header>

        <nav className="tabs" role="tablist">
          <button className={'tab' + (tab === 'board' ? ' on' : '')} role="tab" aria-selected={tab === 'board'} onClick={() => selectTab('board')}>דשבורד</button>
          <button className={'tab' + (tab === 'coach' ? ' on' : '')} role="tab" aria-selected={tab === 'coach'} onClick={() => selectTab('coach')}>מאמן מנטלי</button>
        </nav>

        {error && <div className="wip-warn">{error}</div>}
        {!state ? (
          <div className="loading">{error ? '' : 'טוען…'}</div>
        ) : tab === 'coach' ? (
          <Coach messages={state.coach} aiEnabled={state.ai.enabled} refresh={refresh} />
        ) : (
          <>
            <Stats model={model} days={state.days} />
            <Morning model={model} days={state.days} aiEnabled={state.ai.enabled} refresh={refresh} />
            <Tree model={model} refresh={refresh} />
            <History days={state.days} />
          </>
        )}
      </div>
    </ToastProvider>
  );
}

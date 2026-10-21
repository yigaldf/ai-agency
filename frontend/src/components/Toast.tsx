import { createContext, useCallback, useContext, useRef, useState, type ReactNode } from 'react';

type Undo = () => void | Promise<void>;
interface ToastApi { toast: (msg: string, undo?: Undo) => void }

const Ctx = createContext<ToastApi>({ toast: () => {} });
export const useToast = () => useContext(Ctx);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<{ msg: string; undo?: Undo; show: boolean }>({ msg: '', show: false });
  const timer = useRef<number>();

  const toast = useCallback((msg: string, undo?: Undo) => {
    window.clearTimeout(timer.current);
    setState({ msg, undo, show: true });
    timer.current = window.setTimeout(() => setState((s) => ({ ...s, show: false, undo: undefined })), undo ? 6000 : 2200);
  }, []);

  const onUndo = async () => {
    const f = state.undo;
    window.clearTimeout(timer.current);
    setState((s) => ({ ...s, show: false, undo: undefined }));
    if (f) await f();
  };

  return (
    <Ctx.Provider value={{ toast }}>
      {children}
      <div className={'toast' + (state.show ? ' show' : '')} role="status">
        <span>{state.msg}</span>
        {state.undo && <button onClick={onUndo}>בטל</button>}
      </div>
    </Ctx.Provider>
  );
}

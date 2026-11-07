import { useCallback, useRef, useState } from 'react';

// Back and forward the way a file manager does them: a stack with a cursor,
// so going back then somewhere new discards what was ahead. Without this,
// every hop means re-picking the folder from a dialog that reopens somewhere
// unhelpful.
export function useFolderHistory(onChange) {
    const stackRef = useRef([]);
    const indexRef = useRef(-1);
    // Mirrored into state purely so the arrows re-render as they enable.
    const [{ canBack, canForward }, setFlags] = useState({ canBack: false, canForward: false });

    const sync = useCallback(() => {
        setFlags({
            canBack: indexRef.current > 0,
            canForward: indexRef.current < stackRef.current.length - 1
        });
    }, []);

    // A folder arrived at by any route — picker, show mode, startup.
    const record = useCallback((dir) => {
        if (!dir) return;
        if (stackRef.current[indexRef.current] === dir) return;
        stackRef.current = [...stackRef.current.slice(0, indexRef.current + 1), dir];
        indexRef.current = stackRef.current.length - 1;
        sync();
    }, [sync]);

    const step = useCallback((delta) => {
        const next = indexRef.current + delta;
        if (next < 0 || next >= stackRef.current.length) return;
        indexRef.current = next;
        sync();
        // onChange must not record, or stepping would rewrite history.
        onChange(stackRef.current[next]);
    }, [onChange, sync]);

    return {
        record,
        back: useCallback(() => step(-1), [step]),
        forward: useCallback(() => step(1), [step]),
        canBack,
        canForward
    };
}

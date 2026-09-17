import { useEffect, useRef, type PointerEvent } from "react";
import { trackPointerDrag, type PointerDragCallbacks } from "./pointerDrag";

/** Cancel when another drag starts, its view changes, or its owner unmounts. */
export function usePointerDrag(scope: string) {
  const cancelRef = useRef<(() => void) | null>(null);
  useEffect(() => () => { cancelRef.current?.(); }, [scope]);
  return (event: PointerEvent, callbacks: PointerDragCallbacks) => {
    if (event.button !== 0 || !event.isPrimary) return;
    cancelRef.current?.();
    cancelRef.current = trackPointerDrag(event, callbacks);
  };
}

import { useEffectEvent, useLayoutEffect, useRef } from 'react';

const focusable = 'button, input, select, textarea, a[href], summary, [tabindex]';

export function useModalFocus(open: boolean, onClose: () => void) {
  const ref = useRef<HTMLDivElement>(null);
  const close = useEffectEvent(onClose);

  useLayoutEffect(() => {
    const dialog = ref.current;
    if (!open || !dialog) return;
    const previous = document.activeElement;
    const background = Array.from(dialog.parentElement?.children ?? []).filter(
      (element): element is HTMLElement =>
        element instanceof HTMLElement && element !== dialog && !element.inert,
    );
    background.forEach((element) => { element.inert = true; });

    const targets = () => Array.from(dialog.querySelectorAll<HTMLElement>(focusable)).filter(
      (element) => element.tabIndex >= 0 && !element.matches(':disabled') && element.getClientRects().length > 0,
    );
    (targets()[0] ?? dialog).focus({ preventScroll: true });

    function handleKey(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        event.preventDefault();
        close();
      }
      if (event.key !== 'Tab') return;
      const elements = targets();
      const index = elements.indexOf(document.activeElement as HTMLElement);
      if (index < 0 || (event.shiftKey ? index === 0 : index === elements.length - 1)) {
        event.preventDefault();
        (elements[event.shiftKey ? elements.length - 1 : 0] ?? dialog)?.focus();
      }
    }

    document.addEventListener('keydown', handleKey);
    return () => {
      document.removeEventListener('keydown', handleKey);
      background.forEach((element) => { element.inert = false; });
      if (previous instanceof HTMLElement && previous.isConnected && !previous.matches(':disabled')) {
        previous.focus({ preventScroll: true });
      }
      if (document.activeElement === document.body || dialog.contains(document.activeElement)) {
        document.querySelector<HTMLElement>('.sidebar [aria-current="page"]')?.focus({ preventScroll: true });
      }
    };
  }, [open]);

  return ref;
}

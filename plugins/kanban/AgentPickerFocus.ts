const drawerSelector = '[data-persistent-drawer-content][data-state="open"]';
const pickerTriggerSelector = 'button[aria-label^="Provider, model and reasoning"][aria-expanded="true"]';
const unmountFocusEvent = "focusScope.autoFocusOnUnmount";

// BB 0.44's modal model picker makes the nonmodal thread drawer inherit
// pointer-events:none. Keep that drawer hittable so an inside click dismisses
// only the picker, then respect clicks in its editor after the focus trap ends.
export function mountAgentPickerFocus() {
  const style = document.createElement("style");
  style.textContent = `${drawerSelector}:has(${pickerTriggerSelector}) { pointer-events: auto; }`;
  document.head.append(style);
  let pending: { popup: HTMLElement; listener: EventListener } | null = null;
  const timers = new Set<ReturnType<typeof setTimeout>>();
  function clearPending() {
    if (pending) pending.popup.removeEventListener(unmountFocusEvent, pending.listener);
    pending = null;
  }
  function onPointerDown(event: PointerEvent) {
    clearPending();
    if (event.button !== 0 || !(event.target instanceof Element)) return;
    const drawer = event.target.closest(drawerSelector);
    if (!drawer?.querySelector(pickerTriggerSelector)) return;
    const editor = event.target.closest<HTMLElement>('[role="textbox"][contenteditable="true"], textarea, input');
    if (!editor || !drawer.contains(editor)) return;
    const popup = Array.from(document.querySelectorAll<HTMLElement>('[data-bb-portaled-overlay][role="dialog"][data-state="open"]'))
      .find(element => element.querySelector('[role="listbox"][aria-label="Models"], [role="radiogroup"][aria-label="Reasoning"]'));
    if (!popup || popup.contains(editor)) return;
    const listener: EventListener = focusEvent => {
      focusEvent.preventDefault();
      clearPending();
      // FocusScope releases its trap after this event. Defer until that release.
      const timer = setTimeout(() => {
        timers.delete(timer);
        if (editor.isConnected && drawer.matches(drawerSelector)) editor.focus({ preventScroll: true });
      }, 0);
      timers.add(timer);
    };
    pending = { popup, listener };
    popup.addEventListener(unmountFocusEvent, listener);
  }
  document.addEventListener("pointerdown", onPointerDown, true);
  return () => {
    document.removeEventListener("pointerdown", onPointerDown, true);
    clearPending();
    for (const timer of timers) clearTimeout(timer);
    timers.clear();
    style.remove();
  };
}

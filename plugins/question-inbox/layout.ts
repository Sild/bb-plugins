/** Use our own header anchor; never derive pane pixels from split fractions. */
export function questionContainer(threadId: string, paneId?: string) {
  if (paneId) {
    const pane = Array.from(
      document.querySelectorAll<HTMLElement>("[data-split-pane-id]"),
    ).find((element) => element.dataset.splitPaneId === paneId);
    if (pane) return pane;
  }
  const anchor = Array.from(
    document.querySelectorAll<HTMLElement>("[data-question-thread]"),
  ).find((element) => element.dataset.questionThread === threadId);
  let element = anchor?.parentElement;
  while (element && element !== document.body) {
    const bounds = element.getBoundingClientRect();
    if (bounds.width >= 240 && bounds.height >= 240) return element;
    element = element.parentElement;
  }
  return null;
}

export function questionPosition(
  bounds: { left: number; top: number; width: number; height: number },
  viewport: { width: number; height: number },
) {
  const left = Math.max(0, bounds.left);
  const top = Math.max(0, bounds.top);
  const availableWidth = Math.max(
    0,
    Math.min(bounds.left + bounds.width, viewport.width) - left,
  );
  const availableHeight = Math.max(
    0,
    Math.min(bounds.top + bounds.height, viewport.height) - top,
  );
  if (availableWidth < 280 || availableHeight < 240) {
    return {
      left: viewport.width / 2,
      top: viewport.height / 2,
      width: Math.max(0, Math.min(640, viewport.width - 24)),
      maxHeight: Math.max(0, Math.min(720, viewport.height - 24)),
    };
  }
  const width = Math.min(640, Math.max(0, availableWidth - 24));
  const maxHeight = Math.min(720, Math.max(0, availableHeight - 24));
  return {
    left: left + availableWidth / 2,
    top: top + availableHeight / 2,
    width,
    maxHeight,
  };
}

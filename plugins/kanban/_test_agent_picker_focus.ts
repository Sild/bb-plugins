// @vitest-environment jsdom
import { afterEach, expect, test, vi } from "vitest";
import { fireEvent } from "@testing-library/react";
import { mountAgentPickerFocus } from "./AgentPickerFocus";

let dispose: (() => void) | undefined;
afterEach(() => { dispose?.(); dispose = undefined; document.body.replaceChildren(); vi.useRealTimers(); });
function setup() {
  vi.useFakeTimers();
  document.body.innerHTML = `<div data-persistent-drawer-content data-state="open">
    <button aria-label="Provider, model and reasoning" aria-expanded="true">Model</button>
    <div role="textbox" contenteditable="true" tabindex="0"><p>Draft</p></div>
    <p id="message">Thread message</p>
  </div><div data-bb-portaled-overlay role="dialog" data-state="open">
    <div role="listbox" aria-label="Models"></div><input aria-label="Search models">
  </div>`;
  const editor = document.querySelector<HTMLElement>('[role="textbox"]')!;
  const popup = document.querySelector<HTMLElement>('[role="dialog"]')!;
  dispose = mountAgentPickerFocus();
  return { editor, popup, close: () => { popup.remove(); const event = new Event("focusScope.autoFocusOnUnmount", { cancelable: true }); popup.dispatchEvent(event); return event; } };
}
test("clicking editor content overrides picker focus restoration after its trap is released", () => {
  const { editor, close } = setup();
  fireEvent.pointerDown(editor.firstElementChild!, { button: 0 });
  expect(close().defaultPrevented).toBe(true);
  expect(document.activeElement).not.toBe(editor);
  vi.runAllTimers();
  expect(document.activeElement).toBe(editor);
});
test("thread background, picker search, and unrelated popups retain native focus restoration", () => {
  const { popup, close } = setup();
  fireEvent.pointerDown(document.querySelector('#message')!, { button: 0 });
  expect(close().defaultPrevented).toBe(false);
  document.body.append(popup);
  fireEvent.pointerDown(popup.querySelector('input')!, { button: 0 });
  expect(close().defaultPrevented).toBe(false);
  document.body.append(popup);
  popup.querySelector('[role="listbox"]')?.remove();
  fireEvent.pointerDown(document.querySelector('[role="textbox"]')!, { button: 0 });
  expect(close().defaultPrevented).toBe(false);
});
test("a closed drawer or removed editor cannot receive deferred focus", () => {
  const { editor, close } = setup();
  fireEvent.pointerDown(editor, { button: 0 }); close();
  editor.closest('[data-persistent-drawer-content]')?.setAttribute('data-state', 'closed');
  vi.runAllTimers();
  expect(document.activeElement).not.toBe(editor);
});
test("disposal removes the compatibility style and pending focus work", () => {
  const { editor, close } = setup();
  const style = document.head.lastElementChild!;
  fireEvent.pointerDown(editor, { button: 0 });
  dispose?.(); dispose = undefined;
  expect(style.isConnected).toBe(false);
  expect(close().defaultPrevented).toBe(false);
  vi.runAllTimers();
  expect(document.activeElement).not.toBe(editor);
});

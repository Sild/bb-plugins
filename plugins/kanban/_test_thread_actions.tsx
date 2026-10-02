// @vitest-environment jsdom
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { loadPluginApp, renderSlot } from "@get-bb/plugin-sdk/testing/app";
import type { PluginSidebarThread } from "@get-bb/plugin-sdk/app";

beforeEach(() => {
  Object.defineProperty(HTMLDialogElement.prototype, "showModal", { configurable: true, value: function (this: HTMLDialogElement) { this.setAttribute("open", ""); } });
  Object.defineProperty(HTMLDialogElement.prototype, "close", { configurable: true, value: function (this: HTMLDialogElement) { this.removeAttribute("open"); } });
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); Reflect.deleteProperty(HTMLDialogElement.prototype, "showModal"); Reflect.deleteProperty(HTMLDialogElement.prototype, "close"); });
const thread: PluginSidebarThread = {
  id: "t1", projectId: "p1", title: "Task", titleFallback: null, displayTitle: "Task",
  parentThreadId: null, lifecycleOwnerThreadId: null, sourceThreadId: null, sectionId: null,
  originKind: null, originPluginId: null, providerId: "codex", status: "idle", runtimeStatus: "idle",
  queuedWork: "none", hasPendingInteraction: false, activity: { workflows: 0, backgroundAgents: 0, backgroundCommands: 0, planMode: 0, goals: 0 }, indicator: "none", indicatorLabel: null,
  isUnread: false, isPinned: false, pinnedAt: null, pinSortKey: null, isArchived: false, archivedAt: null,
  href: "/projects/p1/threads/t1", isHidden: false, environment: null, host: null,
  createdAt: 1, updatedAt: 1, lastReadAt: 1, latestAttentionAt: 1,
};
async function mount(update = vi.fn().mockResolvedValue({ success: true })) {
  const app = await loadPluginApp(() => import("./app"));
  return renderSlot(app.threadHeaderActions[0], { threadId: "t1", projectId: "p1", isCompactViewport: false }, {
    composer: { scope: { kind: "thread", threadId: "t1" } },
    sidebarThreads: { status: "ready", threads: [thread], sections: [{ id: "later", name: "Later", createdAt: 1, updatedAt: 1 }] },
    sdk: { threads: { update } },
  });
}

test("exposes six actions directly and delegates archive and delete to native flows", async () => {
  const slot = await mount();
  expect(within(screen.getByRole("group", { name: "Thread actions" })).getAllByRole("button").map((button) => button.getAttribute("aria-label")))
    .toEqual(["Archive", "Pin", "Mark unread", "Move to section", "Copy thread link", "Delete"]);
  fireEvent.click(screen.getByRole("button", { name: "Archive" }));
  fireEvent.click(screen.getByRole("button", { name: "Delete" }));
  expect(slot.inspection.sidebarActionCalls).toContainEqual({ method: "archive", threadId: "t1" });
  expect(slot.inspection.sidebarActionCalls).toContainEqual({ method: "requestDelete", threadId: "t1" });
  slot.lifecycle.unmount();
});

test("tooltips appear on hover and focus, and dismiss on Escape", async () => {
  const slot = await mount();
  expect(screen.queryByRole("button", {name: "Rename"})).toBeNull();
  const archive = screen.getByRole("button", {name: "Archive"});
  fireEvent.pointerMove(archive, {pointerType: "mouse", clientX: 10, clientY: 10});
  expect((await screen.findByRole("tooltip")).textContent).toBe("Archive");
  fireEvent.pointerLeave(archive, {clientX: 10, clientY: 10});
  fireEvent.pointerMove(document.body, {clientX: 500, clientY: 500});
  await waitFor(() => expect(screen.queryByRole("tooltip")).toBeNull());
  const pin = screen.getByRole("button", {name: "Pin"});
  fireEvent.focus(pin);
  expect((await screen.findByRole("tooltip")).textContent).toBe("Pin");
  fireEvent.keyDown(pin, {key: "Escape"});
  await waitFor(() => expect(screen.queryByRole("tooltip")).toBeNull());
  fireEvent.blur(pin);
  fireEvent.pointerMove(archive, {pointerType: "mouse", clientX: 10, clientY: 10});
  await screen.findByRole("tooltip");
  slot.lifecycle.unmount();
  expect(screen.queryByRole("tooltip")).toBeNull();
});

test("header archive is directly available in a compact pane", async () => {
  const app = await loadPluginApp(() => import("./app"));
  const slot = renderSlot(app.threadHeaderActions[0], { threadId: "t1", projectId: "p1", isCompactViewport: true }, {
    sidebarThreads: { status: "ready", threads: [thread], sections: [] },
  });
  fireEvent.click(screen.getByRole("button", { name: "Archive" }));
  expect(slot.inspection.sidebarActionCalls).toContainEqual({ method: "archive", threadId: "t1" });
  slot.lifecycle.unmount();
});


test("section moves use the current thread and failures stay visible", async () => {
  const update = vi.fn().mockRejectedValue(new Error("Move failed"));
  const slot = await mount(update);
  fireEvent.click(screen.getByRole("button", { name: "Move to section" }));
  fireEvent.change(screen.getByRole("combobox", { name: "Move to section" }), { target: { value: "later" } });
  await screen.findByRole("alert");
  expect(update).toHaveBeenCalledWith({ threadId: "t1", sectionId: "later" });
  expect(screen.getByRole("alert").textContent).toBe("Move failed");
  expect(screen.getByRole("combobox", { name: "Move to section" })).toBeTruthy();
  slot.lifecycle.unmount();
});

test("copy uses the SDK thread URL and confirms completion", async () => {
  const writeText = vi.fn().mockResolvedValue(undefined);
  Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText } });
  const slot = await mount();
  fireEvent.click(screen.getByRole("button", { name: "Copy thread link" }));
  await screen.findByText("Thread link copied");
  expect(writeText).toHaveBeenCalledWith(new URL(thread.href, window.location.href).href);
  slot.lifecycle.unmount();
});


test("replaces only its own header menu and restores it on cleanup", async () => {
  const { attachHeaderActions } = await import("./ThreadActions");
  const pane = document.createElement("div");
  pane.innerHTML = '<header><span data-testid="thread-detail-header-actions-menu"><button aria-label="Thread actions">...</button></span><span id="anchor"></span></header>';
  document.body.append(pane);
  const trigger = pane.querySelector("button")!;
  const attachment = attachHeaderActions(pane.querySelector("#anchor")!);
  expect(attachment?.container.parentElement?.getAttribute("data-testid")).toBe("thread-detail-header-actions-menu");
  expect(trigger.style.display).toBe("none");
  attachment?.dispose();
  expect(trigger.style.display).toBe("");
  expect(pane.querySelector("[data-kanban-thread-actions]")).toBeNull();
  pane.remove();
});

test("actions have icons, hover explanations, and no composer toolbar", async () => {
  const slot = await mount();
  for (const button of within(screen.getByRole("group", { name: "Thread actions" })).getAllByRole("button")) {
    expect(button.querySelector("svg")).toBeTruthy();
    expect(button.textContent).toBe("");
    expect(button.hasAttribute("title")).toBe(false);
    expect(button.getAttribute("aria-label")).toBeTruthy();
  }
  const app = await loadPluginApp(() => import("./app"));
  expect(app.composerCustomizations.map((item) => item.id)).not.toContain("thread-actions");
  slot.lifecycle.unmount();
});


test("never borrows another pane's menu", async () => {
  const { attachHeaderActions } = await import("./ThreadActions");
  const layout = document.createElement("div");
  layout.innerHTML = '<div data-split-pane-id="first"><span id="isolated-anchor"></span></div><div data-split-pane-id="second"><span data-testid="thread-detail-header-actions-menu"><button aria-label="Thread actions">...</button></span></div>';
  document.body.append(layout);
  expect(attachHeaderActions(layout.querySelector("#isolated-anchor")!)).toBeNull();
  expect(layout.querySelector("button")!.style.display).toBe("");
  layout.remove();
});

test("archiving a board thread window waits for success and returns to the board", async () => {
  const marker = document.createElement("div"); marker.dataset.kanbanBoard = ""; marker.getClientRects = () => [new DOMRect(0, 0, 100, 100)] as unknown as DOMRectList; document.body.append(marker);
  let complete!: (value: { ok: true; archivedThreadIds: string[] }) => void;
  const archive = vi.fn(() => new Promise<{ ok: true; archivedThreadIds: string[] }>(resolve => { complete = resolve; }));
  const app = await loadPluginApp(() => import("./app"));
  const slot = renderSlot(app.threadHeaderActions[0], { threadId: "t1", projectId: "p1", isCompactViewport: false }, {
    sidebarThreads: { status: "ready", threads: [thread], sections: [] },
    sdk: { threads: { archive, childSummary: async () => ({ nonDeletedChildCount: 0 }) } },
  });
  try {
    fireEvent.click(screen.getByRole("button", { name: "Archive" }));
    await waitFor(() => expect(archive).toHaveBeenCalledWith({ threadId: "t1" }));
    expect(slot.inspection.navigateCalls).toEqual([]);
    complete({ ok: true, archivedThreadIds: ["t1"] });
    await waitFor(() => expect(slot.inspection.navigateCalls).toContainEqual({ method: "toPluginPanel", path: "board", options: { replace: true } }));
    expect(slot.inspection.sidebarActionCalls).toEqual([]);
  } finally { slot.lifecycle.unmount(); marker.remove(); }
});

test("board archival requires confirmation for children and leaves failures in the thread", async () => {
  const marker = document.createElement("div"); marker.dataset.kanbanBoard = ""; marker.getClientRects = () => [new DOMRect(0, 0, 100, 100)] as unknown as DOMRectList; document.body.append(marker);
  const archive = vi.fn().mockRejectedValue(new Error("Archive failed"));
  const app = await loadPluginApp(() => import("./app"));
  const slot = renderSlot(app.threadHeaderActions[0], { threadId: "t1", projectId: "p1", isCompactViewport: false }, {
    sidebarThreads: { status: "ready", threads: [thread], sections: [] },
    sdk: { threads: { archive, childSummary: async () => ({ nonDeletedChildCount: 2 }) } },
  });
  try {
    fireEvent.click(screen.getByRole("button", { name: "Archive" }));
    await screen.findByRole("dialog", { name: "Archive thread and children?" });
    expect(archive).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(archive).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Archive" }));
    await screen.findByRole("dialog", { name: "Archive thread and children?" });
    fireEvent.click(screen.getByRole("button", { name: "Archive all" }));
    await screen.findByText("Archive failed");
    expect(slot.inspection.navigateCalls).toEqual([]);
  } finally { slot.lifecycle.unmount(); marker.remove(); }
});

test("a board in a different split pane does not change ordinary native archival", async () => {
  const otherPane = document.createElement("div"); otherPane.dataset.splitPaneId = "board-pane";
  const board = document.createElement("div"); board.dataset.kanbanBoard = "";
  board.getClientRects = () => [new DOMRect(0, 0, 100, 100)] as unknown as DOMRectList;
  otherPane.append(board); document.body.append(otherPane);
  const slot = await mount();
  const ownPane = document.createElement("div"); ownPane.dataset.splitPaneId = "thread-pane";
  const row = screen.getByRole("group", { name: "Thread actions" });
  row.parentElement!.append(ownPane); ownPane.append(row);
  try {
    fireEvent.click(screen.getByRole("button", { name: "Archive" }));
    expect(slot.inspection.sidebarActionCalls).toContainEqual({ method: "archive", threadId: "t1" });
    expect(slot.inspection.navigateCalls).toEqual([]);
  } finally {
    ownPane.parentElement!.append(row); ownPane.remove();
    slot.lifecycle.unmount(); otherPane.remove();
  }
});

test("navigation away while a board archive is pending is preserved", async () => {
  const board = document.createElement("div"); board.dataset.kanbanBoard = "";
  board.getClientRects = () => [new DOMRect(0, 0, 100, 100)] as unknown as DOMRectList;
  document.body.append(board);
  let complete!: (value: { ok: true; archivedThreadIds: string[] }) => void;
  const archive = vi.fn(() => new Promise<{ ok: true; archivedThreadIds: string[] }>(resolve => { complete = resolve; }));
  const app = await loadPluginApp(() => import("./app"));
  const slot = renderSlot(app.threadHeaderActions[0], { threadId: "t1", projectId: "p1", isCompactViewport: false }, {
    sidebarThreads: { status: "ready", threads: [thread], sections: [] },
    sdk: { threads: { archive, childSummary: async () => ({ nonDeletedChildCount: 0 }) } },
  });
  const oldPath = window.location.pathname;
  try {
    fireEvent.click(screen.getByRole("button", { name: "Archive" }));
    await waitFor(() => expect(archive).toHaveBeenCalled());
    window.history.replaceState(null, "", "/projects/another");
    complete({ ok: true, archivedThreadIds: ["t1"] });
    await waitFor(() => expect((screen.getByRole("button", { name: "Archive" }) as HTMLButtonElement).disabled).toBe(false));
    expect(slot.inspection.navigateCalls).toEqual([]);
  } finally { window.history.replaceState(null, "", oldPath); slot.lifecycle.unmount(); board.remove(); }
});

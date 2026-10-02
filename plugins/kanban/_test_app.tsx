// @vitest-environment jsdom
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { act, cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { loadPluginApp, renderSlot } from "@get-bb/plugin-sdk/testing/app";
import { rpcContract, type BoardData } from "./server";

beforeEach(() => window.localStorage.clear());
afterEach(() => { cleanup(); vi.restoreAllMocks(); window.localStorage.clear(); });
const initial: BoardData = {
  projects: [
    { id: "p1", name: "Alpha", isPersonal: false },
    { id: "p2", name: "Beta", isPersonal: false },
    { id: "p3", name: "Personal", isPersonal: true },
  ],
  folders: [
    { id: "work", name: "Work", projectIds: ["p1", "p2"], sign: "W", iconName: null, iconColor: null },
    { id: "other", name: "Other projects", projectIds: ["p3"], sign: "", iconName: null, iconColor: null },
  ],
  cards: [
    { id: "t1", projectId: "p1", title: "Alpha task", column: "active", status: "active", updatedAt: 2 },
    { id: "t2", projectId: "p2", title: "Beta task", column: "waiting", status: "idle", updatedAt: 1 },
  ],
  truncated: false, folderWarning: null,
};
const subset = (projectIds: string[] | null, board = initial) => ({ ...board, cards: board.cards.filter((card) => projectIds === null || projectIds.includes(card.projectId)) });

const selectedIds = (input: unknown) => rpcContract.board_list.input.parse(input).projectIds;

async function mount(rpc: Record<string, (input: unknown) => unknown> = {}) {
  const app = await loadPluginApp(() => import("./app"));
  const slot = renderSlot(app.navPanels[0], { subPath: "" }, { pluginId: "kanban", rpc: {
    board_list: (input) => subset(selectedIds(input)),
    ...rpc,
  } });
  await screen.findByRole("region", { name: "Project Alpha" });
  return slot;
}

test("shows five statuses and project rows; folder and project checkboxes support multiselect", async () => {
  const slot = await mount();
  expect(screen.getAllByRole("heading", { level: 2 }).map((item) => item.textContent)).toEqual(["Backlog0", "Waiting1", "Active1", "Done0", "Accepted0"]);
  expect(within(screen.getByRole("region", { name: "Project Alpha" })).getByRole("article", { name: "Alpha task" })).toBeTruthy();
  expect(screen.queryByRole("region", { name: "Project Personal" })).toBeNull();
  fireEvent.click(screen.getByLabelText("Filter by projects"));
  fireEvent.click(screen.getByRole("button", { name: "Clear" }));
  await screen.findByText("Select projects to show their threads.");
  fireEvent.click(screen.getByRole("checkbox", { name: "Select folder Work" }));
  await screen.findByRole("region", { name: "Project Alpha" });
  expect(screen.getByRole("region", { name: "Project Beta" })).toBeTruthy();
  expect(screen.queryByRole("region", { name: "Project Personal" })).toBeNull();
  fireEvent.click(screen.getByRole("checkbox", { name: "Show project Beta" }));
  fireEvent.click(screen.getByRole("checkbox", { name: "Show project Personal" }));
  expect((screen.getByRole("checkbox", { name: "Show project Personal" }) as HTMLInputElement).checked).toBe(true);
  expect(screen.queryByRole("region", { name: "Project Personal" })).toBeNull();
  expect(screen.getByRole("region", { name: "Project Alpha" })).toBeTruthy();
  expect(screen.queryByRole("region", { name: "Project Beta" })).toBeNull();
  fireEvent.change(screen.getByRole("searchbox"), { target: { value: "work" } });
  expect(screen.getByRole("checkbox", { name: "Show project Alpha" })).toBeTruthy();
  expect(screen.queryByRole("checkbox", { name: "Show project Personal" })).toBeNull();
  fireEvent.click(screen.getByRole("checkbox", { name: "Show project Alpha" }));
  await screen.findByText("No threads in the selected projects.");
  expect(screen.queryByRole("region", { name: "Project Alpha" })).toBeNull();
  slot.lifecycle.unmount();
});

test("ignores an older list response after the filter changes", async () => {
  let deferred = false;
  const pending: { projectIds: string[] | null; resolve: (value: BoardData) => void }[] = [];
  const slot = await mount({ board_list: (input) => deferred
    ? new Promise<BoardData>((resolve) => pending.push({ projectIds: selectedIds(input), resolve })) : subset(selectedIds(input)) });
  fireEvent.click(screen.getByLabelText("Filter by projects"));
  await act(async () => {});
  deferred = true;
  fireEvent.click(screen.getByRole("checkbox", { name: "Show project Personal" }));
  fireEvent.click(screen.getByRole("checkbox", { name: "Show project Beta" }));
  await waitFor(() => expect(pending).toHaveLength(2));
  await act(async () => pending[1].resolve(subset(["p1"], { ...initial, cards: [{ ...initial.cards[0], title: "Latest Alpha" }] })));
  await screen.findByRole("article", { name: "Latest Alpha" });
  await act(async () => pending[0].resolve(subset(["p1", "p2"], { ...initial, cards: [{ ...initial.cards[0], title: "Stale Alpha" }] })));
  expect(screen.getByRole("article", { name: "Latest Alpha" })).toBeTruthy();
  expect(screen.queryByRole("article", { name: "Stale Alpha" })).toBeNull();
  slot.lifecycle.unmount();
});

test("background refresh keeps the thread count and archive action steady until new data arrives", async () => {
  let resolveRefresh!: (value: BoardData) => void;
  let calls = 0;
  const slot = await mount({ board_list: () => ++calls === 1 ? initial : new Promise<BoardData>((resolve) => { resolveRefresh = resolve; }) });
  const count = screen.getByText("2 threads");
  const archive = screen.getByRole("button", { name: "Archive all accepted tasks" }) as HTMLButtonElement;
  expect(count.textContent).toBe("2 threads");
  expect(archive.disabled).toBe(false);

  fireEvent.click(screen.getByRole("button", { name: "Refresh" }));
  await waitFor(() => expect(calls).toBe(2));
  expect(count.textContent).toBe("2 threads");
  expect(archive.disabled).toBe(false);

  await act(async () => resolveRefresh({ ...initial, cards: [initial.cards[0]] }));
  expect(count.textContent).toBe("1 thread");
  expect(archive.disabled).toBe(false);
  slot.lifecycle.unmount();
});

test("cards use native navigation and expose no manual status control", async () => {
  const slot = await mount();
  expect(screen.queryByRole("combobox")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Alpha task" }));
  expect(slot.inspection.navigateCalls).toContainEqual({ method: "toThread", threadId: "t1" });
  slot.lifecycle.unmount();
});

test("composer offers Accept only for Done and hides it after acceptance or renewed work", async () => {
  const app = await loadPluginApp(() => import("./app"));
  let card = { ...initial.cards[0], column: "active" as BoardData["cards"][number]["column"] };
  const slot = renderSlot(app.composerCustomizations[0].banners![0], {}, {
    composer: { scope: { kind: "thread", threadId: "t1" } },
    rpc: { board_thread: () => card, board_accept: () => (card = { ...card, column: "accepted" }) },
  });
  await waitFor(() => expect(slot.inspection.rpcCalls.length).toBeGreaterThan(0));
  expect(screen.queryByRole("button", { name: "Accept" })).toBeNull();
  expect(screen.getByRole("status", { name: "Kanban status" }).textContent).toContain("Active");
  card = { ...card, column: "done" };
  await slot.behavior.emitRealtime("board-changed", { threadId: "t1" });
  fireEvent.click(await screen.findByRole("button", { name: "Accept" }));
  await waitFor(() => expect(screen.queryByRole("button", { name: "Accept" })).toBeNull());
  expect(screen.getByRole("status", { name: "Kanban status" }).textContent).toContain("Accepted");
  card = { ...card, column: "waiting" };
  await slot.behavior.emitRealtime("board-changed", { threadId: "t1" });
  expect(screen.queryByRole("button", { name: "Accept" })).toBeNull();
  expect(screen.getByRole("status", { name: "Kanban status" }).textContent).toContain("Waiting");
  slot.lifecycle.unmount();
});

test("a stale review warns once and allows explicit acceptance despite more updates", async () => {
  const app = await loadPluginApp(() => import("./app"));
  let card = { ...initial.cards[0], column: "done" as BoardData["cards"][number]["column"] };
  const slot = renderSlot(app.composerCustomizations[0].banners![0], {}, {
    composer: { scope: { kind: "thread", threadId: "t1" } },
    rpc: {
      board_thread: () => card,
      board_accept: (input) => (input as { acknowledgeChanges?: boolean }).acknowledgeChanges
        ? (card = { ...card, column: "accepted" })
        : { ...card, updatedAt: ++card.updatedAt, reviewRequired: true },
    },
  });
  fireEvent.click(await screen.findByRole("button", { name: "Accept" }));
  await screen.findByRole("button", { name: "Accept anyway" });
  expect(screen.getByRole("alert").textContent).toContain("The thread changed");
  expect(slot.inspection.rpcCalls.filter(call => call.method === "board_accept")).toHaveLength(1);
  card = { ...card, updatedAt: card.updatedAt + 1 };
  await slot.behavior.emitRealtime("board-changed", { threadId: "t1" });
  fireEvent.click(await screen.findByRole("button", { name: "Accept anyway" }));
  await waitFor(() => expect(slot.inspection.rpcCalls.filter(call => call.method === "board_accept")).toHaveLength(2));
  expect(slot.inspection.rpcCalls.filter(call => call.method === "board_accept").at(-1)?.input).toMatchObject({ acknowledgeChanges: true });
  await waitFor(() => expect(screen.queryByRole("alert")).toBeNull());
  expect(screen.getByRole("status", { name: "Kanban status" }).textContent).toContain("Accepted");
  slot.lifecycle.unmount();
});

test("stale-review acknowledgement clears when work resumes and when changing threads", async () => {
  const app = await loadPluginApp(() => import("./app"));
  let column = "done";
  const slot = renderSlot(app.composerCustomizations[0].banners![0], {}, {
    composer: { scope: { kind: "thread", threadId: "t1" } },
    rpc: {
      board_thread: (input) => ({ ...initial.cards[0], id: (input as { threadId: string }).threadId, column }),
      board_accept: () => ({ ...initial.cards[0], column: "done", reviewRequired: true }),
    },
  });
  fireEvent.click(await screen.findByRole("button", { name: "Accept" }));
  await screen.findByRole("button", { name: "Accept anyway" });
  column = "active";
  await slot.behavior.emitRealtime("board-changed", {});
  await waitFor(() => expect(screen.queryByRole("button", { name: "Accept anyway" })).toBeNull());
  column = "done";
  await slot.behavior.emitRealtime("board-changed", {});
  fireEvent.click(await screen.findByRole("button", { name: "Accept" }));
  await screen.findByRole("button", { name: "Accept anyway" });
  await slot.behavior.setComposerScope({ kind: "thread", threadId: "t2" });
  await screen.findByRole("button", { name: "Accept" });
  expect(screen.queryByRole("alert")).toBeNull();
  slot.lifecycle.unmount();
});

test("accept completion from a previous thread cannot hide the current thread's review", async () => {
  const app = await loadPluginApp(() => import("./app"));
  let finish!: (value: unknown) => void;
  const slot = renderSlot(app.composerCustomizations[0].banners![0], {}, {
    composer: { scope: { kind: "thread", threadId: "t1" } },
    rpc: {
      board_thread: (input) => ({ ...initial.cards[0], id: (input as { threadId: string }).threadId, column: "done" }),
      board_accept: () => new Promise((resolve) => { finish = resolve; }),
    },
  });
  fireEvent.click(await screen.findByRole("button", { name: "Accept" }));
  await slot.behavior.setComposerScope({ kind: "thread", threadId: "t2" });
  await screen.findByRole("button", { name: "Accept" });
  await act(async () => finish({ ...initial.cards[0], column: "accepted" }));
  expect(screen.getByRole("button", { name: "Accept" })).toBeTruthy();
  expect(slot.inspection.rpcCalls.filter((call) => call.method === "board_thread").at(-1)?.input).toEqual({ threadId: "t2" });
  slot.lifecycle.unmount();
});

test("child cards link to parents across columns and preserve navigation with arrows hidden", async () => {
  const child = { ...initial.cards[0], id: "child", title: "Child", column: "done" as const, parentThreadId: "t1" };
  const slot = await mount({ board_list: () => ({ ...initial, cards: [...initial.cards, child] }) });
  const parentLink = screen.getByRole("button", { name: "↳ Parent: Alpha task" });
  expect(within(screen.getByRole("group", { name: "Alpha: Done" })).getByRole("article", { name: "Child" })).toBeTruthy();
  fireEvent.click(screen.getByRole("checkbox", { name: "Show links" }));
  fireEvent.click(parentLink);
  expect(slot.inspection.navigateCalls).toContainEqual({ method: "toThread", threadId: "t1" });
  slot.lifecycle.unmount();
});

test("parent-only view hides every subtask and restores them without changing project collapse", async () => {
  const child = { ...initial.cards[0], id: "child", title: "Child", column: "done" as const, parentThreadId: "t1" };
  const orphan = { ...initial.cards[1], id: "orphan", title: "Orphan child", parentThreadId: "missing" };
  const slot = await mount({ board_list: () => ({ ...initial, cards: [...initial.cards, child, orphan] }) });
  expect(screen.getByRole("article", { name: "Child" })).toBeTruthy();
  fireEvent.click(screen.getByRole("checkbox", { name: "Parent only" }));
  expect(screen.queryByRole("article", { name: "Child" })).toBeNull();
  expect(screen.queryByRole("article", { name: "Orphan child" })).toBeNull();
  expect(screen.getByRole("heading", { name: "Done0" })).toBeTruthy();
  expect(screen.getByText("2 threads")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Collapse project Alpha" }));
  expect(screen.queryByRole("article", { name: "Alpha task" })).toBeNull();
  expect(screen.getByRole("article", { name: "Beta task" })).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Refresh" }));
  await waitFor(() => expect(screen.getByRole("button", { name: "Expand project Alpha" })).toBeTruthy());
  fireEvent.click(screen.getByRole("button", { name: "Expand project Alpha" }));
  expect(screen.getByRole("article", { name: "Alpha task" })).toBeTruthy();
  fireEvent.click(screen.getByRole("checkbox", { name: "Parent only" }));
  expect(screen.getByRole("article", { name: "Child" })).toBeTruthy();
  expect(screen.getByRole("article", { name: "Orphan child" })).toBeTruthy();
  expect(screen.queryByText("Parent → child")).toBeNull();
  slot.lifecycle.unmount();
});

test("missing parents remain navigable without inventing a visible connection", async () => {
  const slot = await mount({ board_list: () => ({ ...initial, cards: [{ ...initial.cards[0], parentThreadId: "outside" }] }) });
  fireEvent.click(screen.getByRole("button", { name: "↳ Parent: Outside this view" }));
  expect(slot.inspection.navigateCalls).toContainEqual({ method: "toThread", threadId: "outside" });
  slot.lifecycle.unmount();
});


test("parents precede descendants in each column even when an intermediate parent is in another column", async () => {
  const parent = initial.cards[0];
  const child = { ...parent, id: "child", title: "Child", parentThreadId: parent.id };
  const middle = { ...parent, id: "middle", title: "Middle", column: "done" as const, parentThreadId: child.id };
  const grandchild = { ...parent, id: "grandchild", title: "Grandchild", parentThreadId: middle.id };
  const slot = await mount({ board_list: () => ({ ...initial, cards: [grandchild, child, middle, parent] }) });
  expect(within(screen.getByRole("group", { name: "Alpha: Active" })).getAllByRole("article").map((card) => card.getAttribute("aria-label")))
    .toEqual(["Alpha task", "Child", "Grandchild"]);
  expect(within(screen.getByRole("group", { name: "Alpha: Done" })).getByRole("article", { name: "Middle" })).toBeTruthy();
  slot.lifecycle.unmount();
});


test("project header creates a thread without adding controls or blank space to status columns", async () => {
  const slot = await mount();
  for (const [project, id] of [["Alpha", "p1"], ["Beta", "p2"]]) {
    const section = screen.getByRole("region", { name: `Project ${project}` });
    fireEvent.click(within(section).getByRole("button", { name: `New thread in ${project}` }));
    expect(slot.inspection.sidebarActionCalls.at(-1)).toEqual({method: "openNewThread", options: {projectId: id, focusPrompt: true}});
  }
  fireEvent.click(screen.getByRole("button", { name: "Collapse project Alpha" }));
  fireEvent.click(within(screen.getByRole("region", { name: "Project Alpha" })).getByRole("button", { name: "New thread in Alpha" }));
  expect(slot.inspection.sidebarActionCalls.at(-1)).toEqual({method: "openNewThread", options: {projectId: "p1", focusPrompt: true}});
  fireEvent.click(screen.getByRole("button", { name: "Expand project Alpha" }));
  const creationCount = slot.inspection.sidebarActionCalls.length;
  for (const column of ["Backlog", "Active", "Waiting", "Done", "Accepted"]) {
    const lane = screen.getByRole("group", {name: `Alpha: ${column}`});
    expect(within(lane).queryByRole("button", {name: /New thread/})).toBeNull();
    fireEvent.click(lane);
  }
  expect(slot.inspection.sidebarActionCalls).toHaveLength(creationCount);
  const card = screen.getByRole("article", { name: "Alpha task" });
  fireEvent.click(card);
  fireEvent.click(within(card).getByText("Agent: active"));
  fireEvent.click(within(card).getByRole("button", {name: "Alpha task"}));
  expect(slot.inspection.sidebarActionCalls).toHaveLength(creationCount);
  expect(slot.inspection.navigateCalls.at(-1)).toEqual({method: "toThread", threadId: "t1"});
  slot.lifecycle.unmount();
});

test("archive toggle and time frame add a sorted sixth column and hide it immediately", async () => {
  const calls: (number | null | undefined)[] = [];
  const slot = await mount({board_list: input => {
    const args = rpcContract.board_list.input.parse(input); calls.push(args.archiveDays);
    return {...initial, cards: [...initial.cards, ...(args.archiveDays ? [
      {...initial.cards[0], id: "archived-old", title: "Older accepted", column: "archived", acceptedAt: 100},
      {...initial.cards[0], id: "archived-new", title: "Newer accepted", column: "archived", acceptedAt: 200, parentThreadId: "archived-old"},
    ] : [])]};
  }});
  expect(screen.queryByRole("heading", {name: /Archived/})).toBeNull();
  fireEvent.click(screen.getByRole("checkbox", {name: "Show archive"}));
  await screen.findByRole("heading", {name: "Archived2"});
  expect(within(screen.getByRole("group", {name: "Alpha: Archived"})).getAllByRole("article").map(e => e.getAttribute("aria-label"))).toEqual(["Newer accepted", "Older accepted"]);
  expect(screen.getAllByRole("option").map(e => e.textContent)).toEqual(["1d", "1w", "2w", "1 month", "3 months", "6 months", "1 year"]);
  fireEvent.change(screen.getByRole("combobox", {name: "Archive time frame"}), {target: {value: "90"}});
  await waitFor(() => expect(calls.at(-1)).toBe(90));
  fireEvent.click(screen.getByRole("checkbox", {name: "Show archive"}));
  expect(screen.queryByRole("heading", {name: /Archived/})).toBeNull();
  expect(screen.queryByRole("article", {name: "Newer accepted"})).toBeNull();
  await waitFor(() => expect(calls.at(-1)).toBeNull());
  slot.lifecycle.unmount();
});

test("archive buttons confirm the correct selection and report partial failure", async () => {
  Object.defineProperty(HTMLDialogElement.prototype, "showModal", {configurable: true, value: function(this: HTMLDialogElement) {this.setAttribute("open", "");}});
  Object.defineProperty(HTMLDialogElement.prototype, "close", {configurable: true, value: function(this: HTMLDialogElement) {this.removeAttribute("open");}});
  const calls: unknown[] = [];
  const slot = await mount({board_archive: input => {calls.push(input); return {archived: 2, failed: 1, failures: [{threadId: "t1", reason: "Task changed"}]};}});
  fireEvent.click(screen.getByRole("button", {name: "Archive all accepted tasks"}));
  expect(calls).toHaveLength(0);
  fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", {name: "Cancel"}));
  expect(calls).toHaveLength(0);
  fireEvent.pointerDown(screen.getByRole("button", {name: "Archive options for Alpha"}), {button: 0, ctrlKey: false, pointerType: "mouse"});
  fireEvent.click(await screen.findByRole("menuitem", {name: "Archive all project tasks…"}));
  fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", {name: "Archive all"}));
  await screen.findByText("2 archived. 1 could not be archived.");
  expect(calls).toEqual([{kind: "project", projectId: "p1"}]);
  expect(screen.getByRole("alert").textContent).toContain("Task changed");
  fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", {name: "Close"}));
  fireEvent.pointerDown(screen.getByRole("button", {name: "Archive options for Alpha"}), {button: 0, ctrlKey: false, pointerType: "mouse"});
  fireEvent.click(await screen.findByRole("menuitem", {name: "Archive Accepted tasks…"}));
  fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", {name: "Archive all"}));
  await waitFor(() => expect(calls).toHaveLength(2));
  expect(calls[1]).toEqual({kind: "accepted", projectIds: ["p1"]});
  slot.lifecycle.unmount();
  Reflect.deleteProperty(HTMLDialogElement.prototype, "showModal");
  Reflect.deleteProperty(HTMLDialogElement.prototype, "close");
});

test("Done bulk actions preview the scope, cancel without accepting, and report partial success", async () => {
  Object.defineProperty(HTMLDialogElement.prototype, "showModal", { configurable: true, value: function(this: HTMLDialogElement) { this.setAttribute("open", ""); } });
  Object.defineProperty(HTMLDialogElement.prototype, "close", { configurable: true, value: function(this: HTMLDialogElement) { this.removeAttribute("open"); } });
  const previews: unknown[] = [], accepts: unknown[] = [];
  const slot = await mount({
    board_done: input => { previews.push(input); return [{ ...initial.cards[0], column: "done" }, { ...initial.cards[0], id: "t3", title: "Another Alpha task", column: "done" }]; },
    board_accept_all: input => { accepts.push(input); return { accepted: 0, merging: 1, failed: 1, failures: [{ threadId: "t1", reason: "Task changed" }] }; },
  });
  try {
    fireEvent.click(screen.getByRole("button", { name: "Accept all Done tasks" }));
    await screen.findByText("2 Done tasks to accept.");
    expect(previews).toEqual([{ projectIds: null }]);
    expect(within(screen.getByRole("dialog")).getByText("Alpha task")).toBeTruthy();
    fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Cancel" }));
    expect(accepts).toHaveLength(0);
    const doneColumn = within(screen.getByRole("region", { name: "Project Alpha" })).getByRole("group", { name: "Alpha: Done" });
    expect(within(doneColumn).queryByRole("button", { name: "Accept all Done tasks in Alpha" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Collapse project Alpha" }));
    const header = screen.getByRole("group", { name: "Project header for Alpha" });
    fireEvent.click(within(header).getByRole("button", { name: "Accept all Done tasks in Alpha" }));
    await screen.findByText("2 Done tasks to accept.");
    fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Accept all" }));
    await screen.findByText("0 accepted. 1 merging. 1 could not be accepted.");
    expect(previews[1]).toEqual({ projectIds: ["p1"] });
    expect(accepts).toEqual([{ projectIds: ["p1"], revisions: [{ threadId: "t1", expectedUpdatedAt: 2 }, { threadId: "t3", expectedUpdatedAt: 2 }] }]);
    expect(screen.getByRole("alert").textContent).toBe("Alpha task: Task changed");
  } finally {
    slot.lifecycle.unmount();
    Reflect.deleteProperty(HTMLDialogElement.prototype, "showModal");
    Reflect.deleteProperty(HTMLDialogElement.prototype, "close");
  }
});

test("restores all three display choices on remount before the first board query", async () => {
  const flags = ["Parent only", "Show links", "Show archive"];
  const checked = () => flags.map(name => (screen.getByRole("checkbox", { name }) as HTMLInputElement).checked);
  let slot = await mount();
  expect(checked()).toEqual([false, true, false]);
  for (const name of flags) fireEvent.click(screen.getByRole("checkbox", { name }));
  expect(checked()).toEqual([true, false, true]);
  slot.lifecycle.unmount();
  const queries: unknown[] = [];
  slot = await mount({ board_list: input => { queries.push(input); return initial; } });
  expect(checked()).toEqual([true, false, true]);
  expect(queries[0]).toMatchObject({ archiveDays: 7 });
  for (const name of flags) fireEvent.click(screen.getByRole("checkbox", { name }));
  slot.lifecycle.unmount();
  slot = await mount();
  expect(checked()).toEqual([false, true, false]);
  slot.lifecycle.unmount();
});

test("reconciles another window's saved preference without changing the other flags", async () => {
  const slot = await mount();
  window.localStorage.setItem("bb:kanban:board:parentOnly", "true");
  fireEvent(window, new StorageEvent("storage", { key: "bb:kanban:board:parentOnly", newValue: "true", storageArea: window.localStorage }));
  expect((screen.getByRole("checkbox", { name: "Parent only" }) as HTMLInputElement).checked).toBe(true);
  expect((screen.getByRole("checkbox", { name: "Show links" }) as HTMLInputElement).checked).toBe(true);
  expect((screen.getByRole("checkbox", { name: "Show archive" }) as HTMLInputElement).checked).toBe(false);
  slot.lifecycle.unmount();
});

test("storage failure keeps display controls usable and reports that the choice was not saved", async () => {
  vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("Storage quota exceeded"); });
  const slot = await mount();
  fireEvent.click(screen.getByRole("checkbox", { name: "Show links" }));
  expect((screen.getByRole("checkbox", { name: "Show links" }) as HTMLInputElement).checked).toBe(false);
  expect(screen.getByRole("alert").textContent).toContain("Could not save display preferences");
  expect(window.localStorage.getItem("bb:kanban:board:showLinks")).toBeNull();
  slot.lifecycle.unmount();
});

test("pinned projects appear in both filter sections while cards render once", async () => {
  const board = {...initial, folders: [
    {id: "pinned", name: "Pinned", projectIds: ["p1"], sign: "", iconName: "Star", iconColor: null},
    ...initial.folders,
  ]};
  const slot = await mount({board_list: input => subset(selectedIds(input), board)});
  expect(screen.getAllByRole("region", {name: "Project Alpha"})).toHaveLength(1);
  expect(screen.getAllByRole("article", {name: "Alpha task"})).toHaveLength(1);
  fireEvent.click(screen.getByLabelText("Filter by projects"));
  const checkboxes = screen.getAllByRole("checkbox", {name: "Show project Alpha"}) as HTMLInputElement[];
  expect(checkboxes).toHaveLength(2);
  expect(checkboxes.every(box => box.checked)).toBe(true);
  fireEvent.click(checkboxes[1]);
  await waitFor(() => expect(screen.queryByRole("region", {name: "Project Alpha"})).toBeNull());
  expect((screen.getAllByRole("checkbox", {name: "Show project Alpha"}) as HTMLInputElement[]).every(box => !box.checked)).toBe(true);
  slot.lifecycle.unmount();
});

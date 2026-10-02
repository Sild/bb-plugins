import { afterEach, expect, test, vi } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { loadPluginApp, renderSlot } from "@get-bb/plugin-sdk/testing/app";
import { IconPicker } from "./IconPicker";

afterEach(cleanup);
window.matchMedia = vi.fn().mockImplementation(() => ({ matches: false, addEventListener() {}, removeEventListener() {} }));
globalThis.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} };

const group = { id: "work", name: "Work", sign: "", iconName: null, iconColor: "#38c878", position: 0 };
const projects = [
  { id: "p", name: "Example", isPersonal: false, href: "/p", settingsHref: "/p/settings" },
  { id: "personal", name: "Personal", isPersonal: true, href: "/personal", settingsHref: "/personal/settings" },
];

test("icon picker exposes scoped SVG icons, search, and selection", async () => {
  const change = vi.fn();
  render(<IconPicker value={{sign: "", iconName: null, iconColor: "#38c878"}} onChange={change} />);
  await userEvent.click(screen.getByRole("button", { name: "Choose section icon" }));
  const folder = screen.getByRole("button", { name: "Folder", exact: true });
  expect(folder.querySelector("svg")?.getAttribute("width")).toBe("20");
  expect(folder.closest('[data-bb-plugin="project-groups"]')).not.toBeNull();
  await userEvent.type(screen.getByRole("searchbox"), "money");
  expect(screen.queryByRole("button", { name: "Folder", exact: true })).toBeNull();
  await userEvent.click(screen.getByRole("button", { name: "Money" }));
  expect(change).toHaveBeenCalledWith({sign: "", iconName: "CircleDollarSign", iconColor: "#38c878"});
});

test("defaults are last, project pin returns to its folder, and deletion is explicit", async () => {
  const app = await loadPluginApp(() => import("./app"));
  let state = { groups: [group], assignments: {p: "work"}, pinnedProjectIds: [] as string[] };
  const deleted = vi.fn(() => { state = {groups: [], assignments: {} as {p: string}, pinnedProjectIds: []}; return state; });
  const slot = renderSlot(app.threadLists[0], { activeProjectId: null, activeThreadId: null, onNavigate() {} }, {
    sdk: { threads: { getPluginMetadata: async () => ({column: "active"}) } },
    sidebarThreads: {status: "ready", projects, threads: [{
      id: "solo", projectId: "personal", title: "Standalone", displayTitle: "Standalone", titleFallback: null,
      href: "/personal/solo", status: "active", indicator: "runtime", indicatorLabel: "Thread working",
      isHidden: false, isArchived: false, isPinned: false, updatedAt: 1,
    }]},
    rpc: {
      groups_list: () => state,
      groups_pin_project: ({ pinned }: {pinned: boolean}) => { state = {...state, pinnedProjectIds: pinned ? ["p"] : []}; return state; },
      groups_delete: deleted,
    },
  });
  await screen.findByText("Work");
  await userEvent.click(screen.getByRole("button", {name: "New thread in Example"}));
  expect(slot.inspection.sidebarActionCalls).toContainEqual({method: "openNewThread", options: {projectId: "p", focusPrompt: true}});
  await userEvent.click(screen.getByRole("button", {name: "Project options for Example"}));
  expect(screen.queryByRole("menuitem", {name: "New thread"})).toBeNull();
  expect(screen.getByRole("menuitem", {name: "Project settings"})).toBeTruthy();
  await userEvent.keyboard("{Escape}");
  expect(screen.queryByText("Other projects")).toBeNull();
  expect(screen.queryByText("0")).toBeNull();
  expect(screen.queryByText("Personal")).toBeNull();
  expect(screen.getByRole("link", {name: /Standalone/}).closest("section")?.textContent).toContain("Other threads");
  expect(screen.getByLabelText("Thread working")).toBeTruthy();
  await userEvent.click(screen.getByRole("button", {name: "Archive Standalone"}));
  expect(slot.inspection.sidebarActionCalls.some(call => call.method === "archive")).toBe(true);
  expect(screen.getAllByRole("heading").map(e => e.textContent)).toEqual(["Other threads"]);
  await userEvent.click(screen.getByRole("button", {name: "Project options for Example"}));
  await userEvent.click(screen.getByRole("menuitem", {name: "Pin project"}));
  expect(screen.getByRole("link", {name: /Example/}).closest("section")?.textContent).toContain("Pinned");
  await userEvent.click(screen.getByRole("button", {name: "Project options for Example"}));
  await userEvent.click(screen.getByRole("menuitem", {name: "Unpin project"}));
  expect(screen.getByRole("link", {name: /Example/}).closest("section")?.textContent).toContain("Work");
  await userEvent.click(screen.getByRole("button", {name: "Section options for Work"}));
  await userEvent.click(screen.getByRole("menuitem", {name: "Delete section…"}));
  const dialog = await screen.findByRole("dialog");
  expect(dialog.textContent).toContain("Your projects and threads will be kept");
  expect(deleted).not.toHaveBeenCalled();
  await userEvent.click(within(dialog).getByRole("button", {name: "Delete section", exact: true}));
  expect(deleted).toHaveBeenCalled();
  expect(screen.getByRole("link", {name: /Example/}).closest("section")?.textContent).toContain("Other projects");
  slot.lifecycle.unmount();
});

test("settings follows the project when BB reuses its settings container", async () => {
  const app = await loadPluginApp(() => import("./app"));
  const container = document.createElement("div");
  container.className = "mx-auto w-full max-w-3xl space-y-6 pb-10";
  container.append(document.createElement("section"));
  document.body.append(container);
  window.history.replaceState({}, "", "/p/settings");
  const assign = vi.fn(() => ({groups: [group], assignments: {q: "work"}, pinnedProjectIds: []}));
  const slot = renderSlot(app.appOverlays[0], {}, {
    sidebarThreads: {projects: [...projects, {id: "q", name: "Second", isPersonal: false, href: "/q", settingsHref: "/q/settings"}]},
    rpc: {groups_list: () => ({groups: [group], assignments: {p: "work"}, pinnedProjectIds: []}), groups_assign: assign},
  });
  await screen.findByRole("combobox", {name: "Project folder"});
  expect(container.querySelector('[data-bb-plugin="project-groups"]')).not.toBeNull();
  window.history.pushState({}, "", "/q/settings");
  window.dispatchEvent(new PopStateEvent("popstate"));
  const { waitFor } = await import("@testing-library/react");
  await waitFor(() => expect(container.querySelector('[data-project-groups-settings="q"]')).not.toBeNull());
  await screen.findByRole("option", {name: /Work/});
  await userEvent.selectOptions(screen.getByRole("combobox", {name: "Project folder"}), "work");
  expect(assign.mock.calls[0][0]).toEqual({projectId: "q", groupId: "work"});
  slot.lifecycle.unmount();
  container.remove();
  window.history.replaceState({}, "", "/");
});

test("retry after assignment failure reuses the section already created", async () => {
  const app = await loadPluginApp(() => import("./app"));
  const container = document.createElement("div");
  container.className = "mx-auto w-full max-w-3xl space-y-6 pb-10";
  document.body.append(container);
  window.history.replaceState({}, "", "/p/settings");
  const state = {groups: [group], assignments: {}, pinnedProjectIds: []};
  const create = vi.fn(() => ({...state, createdId: "work"}));
  const assign = vi.fn().mockRejectedValueOnce(new Error("Connection lost")).mockResolvedValue({...state, assignments: {p: "work"}});
  const slot = renderSlot(app.appOverlays[0], {}, {
    sidebarThreads: {projects},
    rpc: {groups_list: () => state, groups_create: create, groups_update: () => state, groups_assign: assign},
  });
  await userEvent.click(await screen.findByRole("button", {name: "New folder"}));
  await userEvent.type(screen.getByRole("textbox", {name: "Section name"}), "Work");
  await userEvent.click(screen.getByRole("button", {name: "Save", exact: true}));
  await screen.findByText("Could not save the change. Please try again.");
  await userEvent.click(screen.getByRole("button", {name: "Save", exact: true}));
  expect(create).toHaveBeenCalledTimes(1);
  expect(assign).toHaveBeenCalledTimes(2);
  expect(screen.queryByRole("dialog")).toBeNull();
  slot.lifecycle.unmount();
  container.remove();
  window.history.replaceState({}, "", "/");
});


 test("counts use board columns, exclude hidden/archive, and omit zero labels", async () => {
  const {countThreads, ThreadCounts, sumProjectCounts} = await import("./ThreadCounts");
  const rows = ["a", "b", "c", "d", "e", "f"].map(id => ({id, projectId: "p", isHidden: id === "e", isArchived: id === "f"}));
  const result = countThreads(rows, {a: "review", b: "in-progress", c: "blocked", e: "active", f: "done"});
  expect(result.p).toEqual({backlog: 1, active: 1, waiting: 1, done: 1});
  expect(sumProjectCounts(["p", "q"], {...result, q: {backlog: 2, active: 0, waiting: 0, done: 3}})).toEqual({backlog: 3, active: 1, waiting: 1, done: 4});
  render(<ThreadCounts counts={{backlog: 0, active: 3, waiting: 0, done: 2}} />);
  expect(screen.getByText("3 Active")).toBeTruthy();
  expect(screen.getByText("2 Done")).toBeTruthy();
  expect(screen.queryByText(/Backlog|Waiting/)).toBeNull();
});


test("compact counts expose every status without repeated labels or zero badges", async () => {
  const { ThreadCounts } = await import("./ThreadCounts");
  const { rerender } = render(<ThreadCounts compact counts={{backlog: 2, active: 1, waiting: 1, done: 3}} />);
  expect(screen.getByLabelText("7 threads: 2 Backlog, 1 Active, 1 Waiting, 3 Done").textContent).toBe("7");
  rerender(<ThreadCounts compact counts={{backlog: 0, active: 0, waiting: 0, done: 0}} />);
  expect(screen.queryByText("0")).toBeNull();
});

test("keyboard disclosures preserve the project subtree and expose collapsed totals", async () => {
  const app = await loadPluginApp(() => import("./app"));
  const slot = renderSlot(app.threadLists[0], {activeProjectId: "p", activeThreadId: "t", onNavigate() {}}, {
    sdk: {threads: {getPluginMetadata: async () => ({column: "active"})}},
    sidebarThreads: {status: "ready", projects, threads: [{
      id: "t", projectId: "p", title: "Working thread", displayTitle: "Working thread", titleFallback: null,
      href: "/p/t", status: "active", indicator: "runtime", indicatorLabel: "Thread working",
      isHidden: false, isArchived: false, isPinned: false, updatedAt: 1,
    }]},
    rpc: {groups_list: () => ({groups: [group], assignments: {p: "work"}, pinnedProjectIds: []})},
  });
  await screen.findByLabelText("1 thread: 1 Active");
  const section = screen.getByRole("button", {name: /Work/, expanded: true});
  section.focus();
  await userEvent.keyboard("{Enter}");
  expect(section.getAttribute("aria-expanded")).toBe("false");
  expect(screen.queryByRole("link", {name: /Working thread/})).toBeNull();
  expect(within(section).getByLabelText("1 thread: 1 Active")).toBeTruthy();
  await userEvent.keyboard("{Enter}");
  expect(screen.getByRole("link", {name: /Working thread/}).getAttribute("aria-current")).toBe("page");
  const project = screen.getByRole("button", {name: "Collapse Example"});
  project.focus();
  await userEvent.keyboard(" ");
  expect(project.getAttribute("aria-expanded")).toBe("false");
  expect(screen.queryByRole("link", {name: /Working thread/})).toBeNull();
  slot.lifecycle.unmount();
});

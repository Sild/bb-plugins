import { afterEach, expect, test, vi } from "vitest";
import { cleanup, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { makeHostResponse } from "@get-bb/plugin-sdk/testing";
import { loadPluginApp, renderSlot } from "@get-bb/plugin-sdk/testing/app";

afterEach(cleanup);
window.matchMedia = vi.fn().mockImplementation(() => ({matches: false, addEventListener() {}, removeEventListener() {}}));
globalThis.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} };
const state = {groups: [{id: "work", name: "Work", sign: "", iconName: null, iconColor: "#38c878", position: 0}], assignments: {}, pinnedProjectIds: []};
const projects = ["First", "Second"].map(name => ({id: name, name, kind: "standard" as const, createdAt: 1, updatedAt: 1, gitRemoteUrl: null, sources: []}));

async function manager(rpc: Record<string, (...args: never[]) => unknown>) {
  const app = await loadPluginApp(() => import("./app"));
  const slot = renderSlot(app.threadLists[0], {activeProjectId: null, activeThreadId: null, onNavigate() {}}, {
    sidebarThreads: {status: "ready", projects: [], threads: []},
    sdk: {projects: {list: async () => projects}, hosts: {list: async () => [makeHostResponse({id: "host", name: "Laptop", status: "connected"})]}},
    rpc: {groups_list: () => state, ...rpc},
  });
  await userEvent.click(await screen.findByRole("button", {name: "Manage projects"}));
  await screen.findByText("First");
  return slot;
}

test("selects multiple projects and applies a single bulk folder/pin update", async () => {
  const update = vi.fn(() => state);
  const slot = await manager({groups_bulk_update: update});
  await userEvent.click(screen.getByRole("button", {name: "Select all shown"}));
  await userEvent.selectOptions(screen.getByRole("combobox", {name: "Destination folder"}), "work");
  await userEvent.click(screen.getByRole("button", {name: "Move to folder"}));
  expect(update).toHaveBeenLastCalledWith({projectIds: ["First", "Second"], groupId: "work"});
  await screen.findByText("Updated 2 projects.");
  await userEvent.click(screen.getByRole("button", {name: "Pin selected"}));
  expect(update).toHaveBeenLastCalledWith({projectIds: ["First", "Second"], pinned: true});
  slot.lifecycle.unmount();
});

test("adds multiple projects without a task and keeps only failed rows for retry", async () => {
  const add = vi.fn().mockResolvedValueOnce({results: [{name: "First", path: "/first", projectId: "First", error: null}, {name: "Second", path: "/bad", projectId: null, error: "Missing directory"}]})
    .mockResolvedValueOnce({results: [{name: "Second", path: "/second", projectId: "Second", error: null}]});
  const slot = await manager({projects_add: add});
  await userEvent.click(screen.getByRole("button", {name: "Add projects", exact: true}));
  await userEvent.type(screen.getByRole("textbox", {name: "Project name 1"}), "First");
  await userEvent.type(screen.getByRole("textbox", {name: "Project path 1"}), "/first");
  await userEvent.click(screen.getByRole("button", {name: "+ Add row"}));
  await userEvent.type(screen.getByRole("textbox", {name: "Project name 2"}), "Second");
  await userEvent.type(screen.getByRole("textbox", {name: "Project path 2"}), "/bad");
  await userEvent.click(screen.getByRole("button", {name: "Add 2 projects"}));
  await screen.findByText("Second: Missing directory");
  expect((screen.getByRole("textbox", {name: "Project name 1"}) as HTMLInputElement).value).toBe("Second");
  expect(screen.queryByRole("textbox", {name: "Project name 2"})).toBeNull();
  await userEvent.clear(screen.getByRole("textbox", {name: "Project path 1"}));
  await userEvent.type(screen.getByRole("textbox", {name: "Project path 1"}), "/second");
  await userEvent.click(screen.getByRole("button", {name: "Add 1 projects"}));
  expect(add).toHaveBeenLastCalledWith({hostId: "host", groupId: null, projects: [{name: "Second", path: "/second"}]});
  expect(slot.inspection.sidebarActionCalls).toHaveLength(0);
  slot.lifecycle.unmount();
});

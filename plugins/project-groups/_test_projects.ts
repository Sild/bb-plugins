// @vitest-environment node
import { expect, test, vi } from "vitest";
import { createFakePluginHost } from "@get-bb/plugin-sdk/testing";
import plugin from "./server";

const project = (id: string, path = `/projects/${id}`) => ({
  id, name: id, kind: "standard" as const, createdAt: 1, updatedAt: 1, gitRemoteUrl: null,
  sources: [{ id: `source-${id}`, projectId: id, hostId: "host", path, type: "local_path" as const, isDefault: true, createdAt: 1, updatedAt: 1 }],
});
const folder = { name: "Work", sign: "", iconName: null, iconColor: "#38c878" };

test("bulk folder moves are atomic, durable, and independent of pins", async () => {
  const {bb, harness} = createFakePluginHost({sdk: {projects: {list: async () => [project("p"), project("q")]}}});
  plugin(bb);
  try {
    const {createdId} = await harness.behavior.callRpc("groups_create", folder) as {createdId: string};
    await harness.behavior.callRpc("groups_bulk_update", {projectIds: ["p", "q"], groupId: createdId, pinned: true});
    await expect(harness.behavior.callRpc("groups_bulk_update", {projectIds: ["p", "missing"], groupId: null, pinned: false})).rejects.toThrow();
    await expect(harness.behavior.callRpc("groups_bulk_update", {projectIds: ["p", "q"], groupId: "missing", pinned: false})).rejects.toThrow();
    expect(await harness.behavior.callRpc("groups_list", null)).toMatchObject({assignments: {p: createdId, q: createdId}, pinnedProjectIds: expect.arrayContaining(["p", "q"])});
    await harness.behavior.callRpc("groups_bulk_update", {projectIds: ["p", "q"], pinned: false});
    expect(await harness.behavior.callRpc("groups_list", null)).toMatchObject({assignments: {p: createdId, q: createdId}, pinnedProjectIds: []});
    await harness.behavior.callRpc("groups_bulk_update", {projectIds: ["p", "q"], groupId: null});
    expect(await harness.behavior.callRpc("groups_list", null)).toMatchObject({assignments: {}});
  } finally { await harness.lifecycle.dispose(); }
});

test("batch creation preserves successful rows and retries reuse host/path", async () => {
  const projects: ReturnType<typeof project>[] = [];
  const create = vi.fn(async ({name, source}: {name: string; source: {path: string}}) => {
    if (source.path === "/bad") throw new Error("Directory does not exist");
    const next = {...project(name, source.path), name}; projects.push(next); return next;
  });
  const {bb, harness} = createFakePluginHost({sdk: {projects: {list: async () => [...projects], create}}});
  plugin(bb);
  try {
    const {createdId} = await harness.behavior.callRpc("groups_create", folder) as {createdId: string};
    const input = {hostId: "host", groupId: createdId, projects: [{name: "First", path: "/first"}, {name: "Bad", path: "/bad"}, {name: "Last", path: "/last"}]};
    expect(await harness.behavior.callRpc("projects_add", input)).toMatchObject({results: [
      {projectId: "First", error: null}, {projectId: null, error: "Directory does not exist"}, {projectId: "Last", error: null},
    ]});
    expect(await harness.behavior.callRpc("groups_list", null)).toMatchObject({assignments: {First: createdId, Last: createdId}});
    await harness.behavior.callRpc("projects_add", {...input, projects: [{name: "First", path: "/first/"}]});
    expect(create).toHaveBeenCalledTimes(3);
    expect(harness.inspection.sdk.callsTo("threads.spawn")).toHaveLength(0);
  } finally { await harness.lifecycle.dispose(); }
});

test("invalid destination is rejected before any projects are created", async () => {
  const create = vi.fn();
  const {bb, harness} = createFakePluginHost({sdk: {projects: {create}}});
  plugin(bb);
  try {
    await expect(harness.behavior.callRpc("projects_add", {hostId: "host", groupId: "missing", projects: [{name: "First", path: "/first"}]})).rejects.toThrow();
    expect(create).not.toHaveBeenCalled();
  } finally { await harness.lifecycle.dispose(); }
});


test("folder and pin assignments persist across plugin reload", async () => {
  const first = createFakePluginHost({pluginId: "project-groups"});
  plugin(first.bb);
  const {createdId} = await first.harness.behavior.callRpc("groups_create", folder) as {createdId: string};
  await first.harness.behavior.callRpc("groups_assign", {projectId: "p", groupId: createdId});
  await first.harness.behavior.callRpc("groups_pin_project", {projectId: "p", pinned: true});
  const second = await first.harness.lifecycle.reload(plugin);
  try {
    expect(await second.harness.behavior.callRpc("groups_list", null)).toMatchObject({assignments: {p: createdId}, pinnedProjectIds: ["p"]});
  } finally { await second.harness.lifecycle.dispose(); }
});

test("concurrent batches reuse the same project instead of creating duplicates", async () => {
  const projects: ReturnType<typeof project>[] = [];
  const create = vi.fn(async ({name, source}: {name: string; source: {path: string}}) => {
    await new Promise(resolve => setTimeout(resolve, 5));
    const next = project(`${name}-${projects.length}`, source.path);
    projects.push(next); return next;
  });
  const {bb, harness} = createFakePluginHost({sdk: {projects: {list: async () => [...projects], create}}});
  plugin(bb);
  try {
    const input = {hostId: "host", groupId: null, projects: [{name: "First", path: "/first"}]};
    const result = await Promise.all([harness.behavior.callRpc("projects_add", input), harness.behavior.callRpc("projects_add", input)]);
    expect(result[0]).toEqual(result[1]);
    expect(create).toHaveBeenCalledTimes(1);
  } finally { await harness.lifecycle.dispose(); }
});

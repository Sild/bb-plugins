import { randomUUID } from "node:crypto";
import { defineRpcContract, type BbPluginApi } from "@get-bb/plugin-sdk";
import { z } from "zod";
import { ICON_COLORS, ICON_NAMES } from "./appearance";

const iconColorSchema = z.enum(ICON_COLORS);
const groupSchema = z.object({
  id: z.string(), name: z.string(), sign: z.string(), position: z.number(),
  iconName: z.string().nullable(), iconColor: iconColorSchema,
});
export type ProjectGroup = z.infer<typeof groupSchema>;
const stateSchema = z.object({
  groups: z.array(groupSchema), assignments: z.record(z.string(), z.string()),
  pinnedProjectIds: z.array(z.string()),
});
export type GroupState = z.infer<typeof stateSchema>;
const nameSchema = z.string().trim().min(1).max(60);
const signSchema = z.string().trim().max(12);
const appearanceSchema = z.object({
  sign: signSchema,
  iconName: z.enum(ICON_NAMES).nullable(),
  iconColor: iconColorSchema,
});

export const rpcContract = defineRpcContract({
  groups_list: { input: z.null(), output: stateSchema },
  groups_create: {
    input: z.object({ name: nameSchema }).extend(appearanceSchema.shape),
    output: stateSchema.extend({ createdId: z.string() }),
  },
  groups_update: { input: z.object({ id: z.string(), name: nameSchema }).extend(appearanceSchema.shape), output: stateSchema },
  groups_delete: { input: z.object({ id: z.string() }), output: stateSchema },
  groups_move: { input: z.object({ id: z.string(), direction: z.enum(["up", "down"]) }), output: stateSchema },
  groups_assign: { input: z.object({ projectId: z.string(), groupId: z.string().nullable() }), output: stateSchema },
  groups_bulk_update: {
    input: z.object({ projectIds: z.array(z.string().min(1)).min(1).max(500), groupId: z.string().nullable().optional(), pinned: z.boolean().optional() })
      .refine(value => value.groupId !== undefined || value.pinned !== undefined, "Choose a folder or pin change"),
    output: stateSchema,
  },
  projects_add: {
    input: z.object({ hostId: z.string().min(1), groupId: z.string().nullable(), projects: z.array(z.object({ name: nameSchema, path: z.string().trim().min(1).max(4096) })).min(1).max(100) }),
    output: z.object({ results: z.array(z.object({ name: z.string(), path: z.string(), projectId: z.string().nullable(), error: z.string().nullable() })) }),
  },
  groups_pin_project: { input: z.object({ projectId: z.string(), pinned: z.boolean() }), output: stateSchema },
});

export default function plugin(bb: BbPluginApi) {
  const db = bb.storage.database();
  bb.storage.migrate(db, [
    "CREATE TABLE project_groups (id TEXT PRIMARY KEY, name TEXT NOT NULL, sign TEXT NOT NULL, position INTEGER NOT NULL)",
    "CREATE TABLE project_assignments (project_id TEXT PRIMARY KEY, group_id TEXT NOT NULL REFERENCES project_groups(id) ON DELETE CASCADE)",
    "ALTER TABLE project_groups ADD COLUMN icon_name TEXT",
    "ALTER TABLE project_groups ADD COLUMN icon_color TEXT NOT NULL DEFAULT '#38c878'",
    "CREATE TABLE pinned_projects (project_id TEXT PRIMARY KEY, pinned_at INTEGER NOT NULL)",
  ]);
  db.pragma("foreign_keys = ON");

  function state() {
    const groups = db.prepare("SELECT id, name, sign, position, icon_name AS iconName, icon_color AS iconColor FROM project_groups ORDER BY position, id").all() as ProjectGroup[];
    const assignments = Object.fromEntries(
      (db.prepare("SELECT project_id, group_id FROM project_assignments").all() as { project_id: string; group_id: string }[])
        .map(({ project_id, group_id }) => [project_id, group_id]),
    );
    const pinnedProjectIds = (db.prepare("SELECT project_id FROM pinned_projects ORDER BY pinned_at DESC, project_id").all() as { project_id: string }[])
      .map(({ project_id }) => project_id);
    return { groups, assignments, pinnedProjectIds };
  }
  function changed() {
    bb.realtime.publish("groups-changed", {});
    return state();
  }
  function requireGroup(id: string) {
    if (!db.prepare("SELECT id FROM project_groups WHERE id = ?").get(id)) {
      throw new Error("Project group no longer exists");
    }
  }
  function assign(projectId: string, groupId: string | null) {
    if (groupId === null) db.prepare("DELETE FROM project_assignments WHERE project_id = ?").run(projectId);
    else db.prepare("INSERT INTO project_assignments (project_id, group_id) VALUES (?, ?) ON CONFLICT(project_id) DO UPDATE SET group_id = excluded.group_id").run(projectId, groupId);
  }
  function pin(projectId: string, pinned: boolean) {
    if (pinned) db.prepare("INSERT INTO pinned_projects (project_id, pinned_at) VALUES (?, ?) ON CONFLICT(project_id) DO NOTHING").run(projectId, Date.now());
    else db.prepare("DELETE FROM pinned_projects WHERE project_id = ?").run(projectId);
  }
  // Queue batches so overlapping windows and retries reuse the latest project list.
  let additions = Promise.resolve();
  bb.rpc.register(rpcContract, {
    groups_list: () => state(),
    groups_create: ({ name, sign, iconName, iconColor }) => {
      const createdId = randomUUID();
      db.prepare("INSERT INTO project_groups (id, name, sign, icon_name, icon_color, position) VALUES (?, ?, ?, ?, ?, (SELECT COALESCE(MAX(position), 0) + 1 FROM project_groups))")
        .run(createdId, name, sign, iconName, iconColor);
      return { ...changed(), createdId };
    },
    groups_update: ({ id, name, sign, iconName, iconColor }) => {
      requireGroup(id);
      db.prepare("UPDATE project_groups SET name = ?, sign = ?, icon_name = ?, icon_color = ? WHERE id = ?")
        .run(name, sign, iconName, iconColor, id);
      return changed();
    },
    groups_delete: ({ id }) => {
      db.prepare("DELETE FROM project_groups WHERE id = ?").run(id);
      return changed();
    },
    groups_move: ({ id, direction }) => {
      const groups = state().groups;
      const index = groups.findIndex((group) => group.id === id);
      if (index < 0) throw new Error("Project group no longer exists");
      const other = groups[index + (direction === "up" ? -1 : 1)];
      if (!other) return state();
      db.transaction(() => {
        db.prepare("UPDATE project_groups SET position = ? WHERE id = ?").run(other.position, id);
        db.prepare("UPDATE project_groups SET position = ? WHERE id = ?").run(groups[index].position, other.id);
      })();
      return changed();
    },
    groups_assign: ({ projectId, groupId }) => {
      if (groupId !== null) requireGroup(groupId);
      assign(projectId, groupId);
      return changed();
    },
    groups_bulk_update: async ({ projectIds, groupId, pinned }) => {
      const projects = await bb.sdk.projects.list();
      const valid = new Set(projects.filter(project => project.kind !== "personal").map(project => project.id));
      if (projectIds.some(id => !valid.has(id))) throw new Error("A selected project no longer exists");
      db.transaction(() => {
        if (groupId != null) requireGroup(groupId);
        for (const id of new Set(projectIds)) {
          if (groupId !== undefined) assign(id, groupId);
          if (pinned !== undefined) pin(id, pinned);
        }
      })();
      return changed();
    },
    projects_add: (input) => {
      const operation = additions.then(async () => {
        const { hostId, groupId, projects } = input;
        if (groupId !== null) requireGroup(groupId);
        const existing: Awaited<ReturnType<typeof bb.sdk.projects.create>>[] = await bb.sdk.projects.list();
        const results = [];
        for (const entry of projects) {
          try {
            // Reuse the host/path on retries, including after a lost response.
            const path = entry.path.replace(/\/+$/, "") || "/";
            const project = existing.find(project => project.kind !== "personal" && project.sources.some(source => source.hostId === hostId && (source.path.replace(/\/+$/, "") || "/") === path))
              ?? await bb.sdk.projects.create({ name: entry.name, source: { type: "local_path", hostId, path } });
            if (!existing.some(item => item.id === project.id)) existing.push(project);
            if (groupId !== null) requireGroup(groupId);
            assign(project.id, groupId);
            results.push({ ...entry, projectId: project.id, error: null });
          } catch (cause) {
            results.push({ ...entry, projectId: null, error: cause instanceof Error ? cause.message : String(cause) });
          }
        }
        changed();
        return { results };
      });
      additions = operation.then(() => {}, () => {});
      return operation;
    },
    groups_pin_project: ({ projectId, pinned }) => {
      pin(projectId, pinned);
      return changed();
    },
  });
}

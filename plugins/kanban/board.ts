export const columns = [
  { id: "backlog", label: "Backlog", description: "Work has not started" },
  { id: "waiting", label: "Waiting", description: "Waiting for user input" },
  { id: "active", label: "Active", description: "Work is in progress, including subtasks" },
  { id: "done", label: "Done", description: "Complete and waiting for your review" },
  { id: "accepted", label: "Accepted", description: "Reviewed and accepted" },
] as const;

export const archivedColumn = { id: "archived", label: "Archived", description: "Most recently accepted first" } as const;
export const archivePeriods = [{days: 1, label: "1d"}, {days: 7, label: "1w"}, {days: 14, label: "2w"}, {days: 30, label: "1 month"}, {days: 90, label: "3 months"}, {days: 180, label: "6 months"}, {days: 365, label: "1 year"}] as const;

export type Column = (typeof columns)[number]["id"];

export interface AgentState {
  status: string;
  runtimeStatus?: string;
  hasPendingInteraction: boolean;
  activeBackgroundAgentCount: number;
  updatedAt: number;
  completionReported?: boolean;
  hasActiveDescendant?: boolean;
}

export function isWorking(status: string): boolean {
  return ["active", "starting", "provisioning", "waiting-for-host", "host-reconnecting", "stopping"].includes(status);
}

/** Board progress is derived from BB, never from an agent-written column. */
export function deriveColumn(state: AgentState, acceptedFor: unknown): Column {
  if (state.hasActiveDescendant || state.activeBackgroundAgentCount > 0) return "active";
  if (state.hasPendingInteraction || (state.runtimeStatus ?? state.status) === "error") return "waiting";
  if (isWorking(state.runtimeStatus ?? state.status)) return "active";
  if (state.status === "pending") return "backlog";
  if ((state.runtimeStatus ?? state.status) !== "idle") return "waiting";
  if (acceptedFor === state.updatedAt) return "accepted";
  return state.completionReported ? "done" : "waiting";
}

export interface BoardProject {
  id: string;
  name: string;
  isPersonal: boolean;
}

export interface ProjectFolder {
  id: string;
  name: string;
  sign: string;
  iconName: string | null;
  iconColor: string | null;
  projectIds: string[];
}

export interface ProjectGroups {
  groups: { id: string; name: string; sign: string; position: number; iconName: string | null; iconColor: string }[];
  assignments: Record<string, string>;
  pinnedProjectIds: string[];
}

/** Match Project Groups' sidebar: pinned, ordered folders, then other/personal. */
export function projectFolders(projects: BoardProject[], state: ProjectGroups | null): ProjectFolder[] {
  const ordinary = projects.filter((project) => !project.isPersonal);
  const pinned = state?.pinnedProjectIds.filter((id) => ordinary.some((project) => project.id === id)) ?? [];
  const assigned = new Set<string>();
  const folders: ProjectFolder[] = [];
  if (pinned.length) folders.push({ id: "pinned", name: "Pinned", sign: "", iconName: "Star", iconColor: null, projectIds: pinned });
  for (const group of [...(state?.groups ?? [])].sort((a, b) => a.position - b.position || a.id.localeCompare(b.id))) {
    const projectIds = ordinary.filter((project) => !assigned.has(project.id) && state?.assignments[project.id] === group.id).map((project) => project.id);
    projectIds.forEach((id) => assigned.add(id));
    if (projectIds.length) folders.push({ ...group, id: `folder:${group.id}`, projectIds });
  }
  const other = ordinary.filter((project) => !assigned.has(project.id));
  if (other.length) folders.push({ id: "other", name: "Other projects", sign: "", iconName: "Folder", iconColor: null, projectIds: other.map((project) => project.id) });
  const personal = projects.filter((project) => project.isPersonal);
  if (personal.length) folders.push({ id: "personal", name: "Other threads", sign: "", iconName: "MessageSquare", iconColor: null, projectIds: personal.map((project) => project.id) });
  return folders;
}

/** Keep families together in parent-first order, retaining root and sibling order. */
export function parentFirst<T extends { id: string; parentThreadId?: string | null }>(cards: readonly T[]): T[] {
  const ids = new Set(cards.map((card) => card.id));
  const children = new Map<string, T[]>();
  for (const card of cards) {
    if (card.parentThreadId && ids.has(card.parentThreadId)) {
      const siblings = children.get(card.parentThreadId) ?? [];
      siblings.push(card);
      children.set(card.parentThreadId, siblings);
    }
  }
  const result: T[] = [];
  const visited = new Set<string>();
  const visit = (card: T) => {
    if (visited.has(card.id)) return;
    visited.add(card.id);
    result.push(card);
    for (const child of children.get(card.id) ?? []) visit(child);
  };
  for (const card of cards) {
    if (!card.parentThreadId || !ids.has(card.parentThreadId)) visit(card);
  }
  // Malformed cycles must not hide cards or loop forever.
  for (const card of cards) visit(card);
  return result;
}

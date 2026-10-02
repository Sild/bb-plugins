import { describe, expect, it } from "vitest";
import { parentFirst, projectFolders, deriveColumn, type AgentState } from "./board";

describe("runtime-derived columns", () => {
  const idle: AgentState = { status: "idle", hasPendingInteraction: false, activeBackgroundAgentCount: 0, updatedAt: 20 };
  it("follows activity and pending input rather than old manual metadata", () => {
    expect(deriveColumn(idle, undefined)).toBe("waiting");
    expect(deriveColumn({ ...idle, completionReported: true }, undefined)).toBe("done");
    expect(deriveColumn({ ...idle, status: "pending" }, undefined)).toBe("backlog");
    expect(deriveColumn({ ...idle, status: "active" }, 20)).toBe("active");
    expect(deriveColumn({ ...idle, status: "active", hasPendingInteraction: true }, 20)).toBe("waiting");
    expect(deriveColumn({ ...idle, activeBackgroundAgentCount: 1 }, 20)).toBe("active");
    for (const runtimeStatus of ["error"])
      expect(deriveColumn({ ...idle, runtimeStatus }, 20)).toBe("waiting");
    for (const runtimeStatus of ["starting", "provisioning", "waiting-for-host", "host-reconnecting", "stopping"])
      expect(deriveColumn({ ...idle, runtimeStatus }, 20)).toBe("active");
  });
  it("keeps parent work Active until subtasks finish, including while parent input is pending", () => {
    const parent = { ...idle, completionReported: true, activeBackgroundAgentCount: 1 };
    expect(deriveColumn(parent, undefined)).toBe("active");
    expect(deriveColumn({ ...parent, hasPendingInteraction: true }, undefined)).toBe("active");
    expect(deriveColumn({ ...parent, activeBackgroundAgentCount: 0 }, undefined)).toBe("done");
  });
  it("accepts only the reviewed revision", () => {
    expect(deriveColumn(idle, 20)).toBe("accepted");
    expect(deriveColumn({ ...idle, updatedAt: 21 }, 20)).toBe("waiting");
  });
});

describe("sidebar project folders", () => {
  it("matches pinned/folder/other order, without dropping stale assignments or duplicating pinned projects", () => {
    const result = projectFolders([
      { id: "personal", name: "Personal", isPersonal: true },
      { id: "p1", name: "Pinned", isPersonal: false },
      { id: "p2", name: "Work", isPersonal: false },
      { id: "p3", name: "Rest", isPersonal: false },
    ], {
      groups: [
        { id: "late", name: "Later", sign: "", position: 2, iconName: null, iconColor: "#38c878" },
        { id: "first", name: "First", sign: "W", position: 1, iconName: null, iconColor: "#38c878" },
      ],
      assignments: { p1: "late", p2: "first", p3: "deleted-folder" }, pinnedProjectIds: ["deleted-project", "p1"],
    });
    expect(result.map(({ name, projectIds }) => ({ name, projectIds }))).toEqual([
      { name: "Pinned", projectIds: ["p1"] }, { name: "First", projectIds: ["p2"] }, { name: "Other projects", projectIds: ["p3"] }, { name: "Other threads", projectIds: ["personal"] },
    ]);
  });
});

describe("parent-first card ordering", () => {
  it("groups nested children after parents while retaining root and sibling order", () => {
    const cards = [
      { id: "child", parentThreadId: "parent" },
      { id: "unrelated" },
      { id: "grandchild", parentThreadId: "child" },
      { id: "parent" },
      { id: "sibling", parentThreadId: "parent" },
    ];
    expect(parentFirst(cards).map((card) => card.id)).toEqual(["unrelated", "parent", "child", "grandchild", "sibling"]);
    expect(cards[0].id).toBe("child");
  });
  it("retains missing-parent cards and malformed cycles exactly once", () => {
    const cards = [{ id: "orphan", parentThreadId: "hidden" }, { id: "a", parentThreadId: "b" }, { id: "b", parentThreadId: "a" }];
    expect(parentFirst(cards).map((card) => card.id)).toEqual(["orphan", "a", "b"]);
  });
});

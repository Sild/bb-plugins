import type { BbPluginApi } from "@get-bb/plugin-sdk";
import { z } from "zod";
import { gitContract } from "./git-contract";
import { taskWorktreeProvider } from "./task-worktree-provider";

const resourceSchema = z.object({ checkout: z.string(), pathKey: z.string(), branch: z.string() });
export function registerTaskEnvironment(bb: BbPluginApi) {
  const host = bb.hosts.experimental_client({ contract: gitContract });
  bb.experimental_environments.register({
    id: taskWorktreeProvider, displayName: "Task worktree", icon: "FolderGit",
    description: "An isolated task worktree from the project's currently checked-out local branch.",
    requires: { projectCheckout: true, gitCheckout: true }, inputs: z.object({}),
    async create(context) {
      const resource = { checkout: context.projectCheckout.path, pathKey: context.pathKey, branch: context.suggestedBranchName };
      context.report.step("Creating worktree from the active checkout branch");
      const options = { hostId: context.host.id, signal: context.signal, timeoutMs: 180_000 };
      const path = await host.call("worktreePath", { pathKey: resource.pathKey }, options);
      if (!await context.experimental_claimPath(path)) return { status: "failed", message: "The task worktree path is already owned by another environment." };
      const created = await host.call("createWorktree", resource, options);
      return { status: "created", path: created.path, ownsPath: true, mergeBaseBranch: created.baseBranch, resource };
    },
    async remove(context) {
      if (!context.hostId) return { status: "failed", message: "The worktree machine is unavailable." };
      try {
        await host.call("removeWorktree", context.resource === null ? { pathKey: context.pathKey } : resourceSchema.parse(context.resource), { hostId: context.hostId, signal: context.signal, timeoutMs: 180_000 });
        return { status: "removed" };
      } catch (cause) { if (context.signal.aborted) throw cause; return { status: "failed", message: cause instanceof Error ? cause.message : String(cause) }; }
    },
  });
}

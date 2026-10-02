import type { BbPluginApi } from "@get-bb/plugin-sdk";

/** Workflow agents use metadata ancestry to avoid core's automatic parent notices. */
export async function workflowParent(bb: BbPluginApi, thread: { id: string; parentThreadId?: string | null; originPluginId?: string | null }): Promise<string | null> {
  if (thread.originPluginId === "review-implement") {
    const metadata = await bb.sdk.threads.getPluginMetadata({ threadId: thread.id, pluginId: "review-implement" });
    if (typeof metadata.workflowParentThreadId === "string" && metadata.workflowParentThreadId.length > 0 && metadata.workflowParentThreadId !== thread.id) return metadata.workflowParentThreadId;
  }
  return thread.parentThreadId ?? null;
}

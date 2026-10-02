// @vitest-environment jsdom
import { afterEach, expect, test, vi } from "vitest";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import { NewThreadWorktree } from "./NewThreadWorktree";
import { ActiveBranchInputs } from "./ActiveBranchInputs";

const mocks = vi.hoisted(() => ({ projectId: "videogen" as string | null, selection: vi.fn(), lock: vi.fn(), rpc: { call: vi.fn() } }));
vi.mock("@get-bb/plugin-sdk/app", () => ({
  useComposer: () => ({ scope: { kind: "new-thread", projectId: mocks.projectId }, experimental_setSelection: mocks.selection, setInputLock: mocks.lock }),
  useRpc: () => mocks.rpc,
}));
afterEach(() => { cleanup(); vi.resetAllMocks(); vi.useRealTimers(); mocks.projectId = "videogen"; });
const agent = { providerId: "codex", model: "gpt-6.1-sol", reasoningLevel: "high" };
const environment = (provider: string) => ({ type: "provider", environmentProviderId: provider, machine: { type: "existing", hostId: "machine" }, inputs: {} });

test.each(["kanban-task-worktree", "project-checkout"])("seeds %s and reapplies the model after environment reconciliation", async provider => {
  mocks.selection.mockResolvedValueOnce({ environment: environment("project-checkout") })
    .mockResolvedValueOnce({ environment: environment(provider), model: "gpt-6-astra" })
    .mockResolvedValue({ ...agent, environment: environment(provider) });
  mocks.rpc.call.mockResolvedValue({ ...agent, environment: { hostId: "machine", environmentProviderId: provider } });
  render(<NewThreadWorktree />);
  await waitFor(() => expect(mocks.lock).toHaveBeenLastCalledWith(false));
  expect(mocks.rpc.call).toHaveBeenCalledWith("board_task_defaults", { projectId: "videogen", hostId: "machine" });
  expect(mocks.selection).toHaveBeenNthCalledWith(2, { ...agent, environment: environment(provider) });
  expect(mocks.selection).toHaveBeenLastCalledWith(agent);
  expect(screen.queryByRole("alert")).toBeNull();
});
test("the root composer with no project receives model defaults too", async () => {
  mocks.projectId = null;
  mocks.selection.mockResolvedValue(agent);
  mocks.rpc.call.mockResolvedValue({ ...agent, environment: null });
  render(<NewThreadWorktree />);
  await waitFor(() => expect(mocks.lock).toHaveBeenLastCalledWith(false));
  expect(mocks.rpc.call).toHaveBeenCalledWith("board_task_defaults", { projectId: null, hostId: null });
  expect(mocks.selection).toHaveBeenLastCalledWith(agent);
});
test("an unavailable model remains visible instead of silently using Astra", async () => {
  mocks.selection.mockResolvedValue({ ...agent, model: "gpt-6-astra" });
  mocks.rpc.call.mockResolvedValue({ ...agent, environment: null });
  render(<NewThreadWorktree />);
  expect((await screen.findByRole("alert")).textContent).toContain("Sol High is unavailable");
});
test("reports a reconciled environment mismatch", async () => {
  mocks.selection.mockResolvedValue({ ...agent, environment: environment("project-checkout") });
  mocks.rpc.call.mockResolvedValue({ ...agent, environment: { hostId: "machine", environmentProviderId: "kanban-task-worktree" } });
  render(<NewThreadWorktree />);
  expect((await screen.findByRole("alert")).textContent).toContain("default environment is unavailable");
});
test("Branch from follows the checkout's active branch without a dropdown", async () => {
  vi.useFakeTimers();
  mocks.rpc.call.mockResolvedValueOnce({ hostId: "machine", branch: "fix-restart" }).mockResolvedValue({ hostId: "machine", branch: "new-active" });
  const onChange = vi.fn();
  await act(async () => { render(<ActiveBranchInputs projectId="custody" target={{ kind: "existing-host", hostId: "machine" }} value={null} onChange={onChange} />); });
  expect(screen.getByText("fix-restart")).toBeTruthy();
  expect(screen.queryByRole("combobox")).toBeNull();
  expect(onChange).toHaveBeenLastCalledWith({ status: "ready", value: {} });
  await act(async () => { await vi.advanceTimersByTimeAsync(2000); });
  expect(screen.getByText("new-active")).toBeTruthy();
});

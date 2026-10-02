// @vitest-environment jsdom
import { afterEach, expect, test } from "vitest";
import { act, cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import { loadPluginApp, renderSlot } from "@get-bb/plugin-sdk/testing/app";

afterEach(cleanup);
test.each([
  { kind: "design", name: /Project design plan/, method: "startPlan" },
  { kind: "plan", name: /Detailed implementation plan/, method: "startPlan" },
  { kind: "implementation", name: /Implement the plan/, method: "startImplementation" },
].flatMap(action => [false, true].map(banner => ({ ...action, banner }))))("$kind sends the latest unsent input (banner=$banner)", async ({ kind, name, method, banner }) => {
  const app = await loadPluginApp(() => import("./app"));
  const customization = app.composerCustomizations[0];
  const slot = renderSlot(banner ? customization.banners![0] : customization.actions![0], {}, {
    composer: { scope: { kind: "thread", threadId: "root" }, text: "Earlier draft" },
    rpc: { startPlan: () => ({ childThreadId: "child" }), startImplementation: () => ({ childThreadId: "child" }) },
  });
  const instruction = "Prepare this for the new requirement.\n\nKeep the existing API.";
  await slot.behavior.setComposerText(instruction);
  fireEvent.click(screen.getByRole("button", { name }));
  await waitFor(() => expect(slot.inspection.navigateCalls).toHaveLength(1));
  expect(slot.inspection.rpcCalls).toHaveLength(1);
  expect(slot.inspection.rpcCalls[0]).toMatchObject({ method, input: { threadId: "root", instruction, ...(kind === "implementation" ? {} : { kind }) } });
  expect(slot.inspection.composer.text).toBe("");
});

test("a successful launch preserves text entered while the child is starting", async () => {
  const app = await loadPluginApp(() => import("./app"));
  let finish: (value: { childThreadId: string }) => void = () => {};
  const slot = renderSlot(app.composerCustomizations[0].actions![0], {}, {
    composer: { scope: { kind: "thread", threadId: "root" }, text: "Request for the child" },
    rpc: { startPlan: () => new Promise(resolve => { finish = resolve; }) },
  });
  fireEvent.click(screen.getByRole("button", { name: /Detailed implementation plan/ }));
  await slot.behavior.setComposerText("Another draft typed during launch");
  await act(async () => finish({ childThreadId: "child" }));
  expect(slot.inspection.rpcCalls[0]).toMatchObject({ input: { instruction: "Request for the child" } });
  expect(slot.inspection.composer.text).toBe("Another draft typed during launch");
  expect(slot.inspection.navigateCalls).toHaveLength(1);
});

test("three compact visible workflows replace manual Review and use the correct RPC and draft", async () => {
  const app = await loadPluginApp(() => import("./app"));
  const action = app.composerCustomizations[0].actions![0];
  const slot = renderSlot(action, {}, { composer: { scope: { kind: "thread", threadId: "root" }, text: "Latest goal" }, rpc: {
    startPlan: () => ({ childThreadId: "planner" }), startImplementation: () => ({ childThreadId: "implementer" }),
  } });
  expect(screen.getByRole("group", { name: "Reviewed agent workflows" })).toBeTruthy();
  expect(screen.getAllByRole("button")).toHaveLength(3);
  expect(screen.queryByText("Review")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: /Project design plan/ }));
  await waitFor(() => expect(slot.inspection.navigateCalls).toHaveLength(1));
  expect(slot.inspection.rpcCalls[0]).toMatchObject({ method: "startPlan", input: { threadId: "root", kind: "design", instruction: "Latest goal" } });
  expect(slot.inspection.composer.text).toBe("");
  fireEvent.click(screen.getByRole("button", { name: /Detailed implementation plan/ }));
  await waitFor(() => expect(slot.inspection.navigateCalls).toHaveLength(2));
  expect(slot.inspection.rpcCalls[1]).toMatchObject({ method: "startPlan", input: { kind: "plan" } });
  fireEvent.click(screen.getByRole("button", { name: /Implement the plan/ }));
  await waitFor(() => expect(slot.inspection.navigateCalls).toHaveLength(3));
  expect(slot.inspection.rpcCalls[2]).toMatchObject({ method: "startImplementation" });
});
test("a launch failure preserves the draft and presents a readable error", async () => {
  const app = await loadPluginApp(() => import("./app"));
  const slot = renderSlot(app.composerCustomizations[0].actions![0], {}, { composer: { scope: { kind: "thread", threadId: "root" }, text: "Do not lose this" }, rpc: { startPlan: () => { throw new Error("Source has no session"); } } });
  fireEvent.click(screen.getByRole("button", { name: /Detailed implementation plan/ }));
  expect((await screen.findByRole("alert")).textContent).toBe("Source has no session");
  expect(slot.inspection.composer.text).toBe("Do not lose this");
  expect(slot.inspection.navigateCalls).toHaveLength(0);
});
test("a pending launch locks all workflows and avoids duplicate starts", async () => {
  const app = await loadPluginApp(() => import("./app"));
  let finish: (value: { childThreadId: string }) => void = () => {};
  const slot = renderSlot(app.composerCustomizations[0].actions![0], {}, { composer: { scope: { kind: "thread", threadId: "root" } }, rpc: { startPlan: () => new Promise(resolve => { finish = resolve; }) } });
  const button = screen.getByRole("button", { name: /Detailed implementation plan/ });
  fireEvent.click(button); fireEvent.click(button);
  expect(screen.getAllByRole("button").every(button => (button as HTMLButtonElement).disabled)).toBe(true);
  expect(slot.inspection.rpcCalls).toHaveLength(1);
  await act(async () => finish({ childThreadId: "child" }));
  expect(screen.getAllByRole("button").every(button => !(button as HTMLButtonElement).disabled)).toBe(true);
});

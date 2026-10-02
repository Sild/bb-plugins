// @vitest-environment jsdom
import { afterEach, expect, test } from "vitest";
import { cleanup, fireEvent, screen } from "@testing-library/react";
import { loadPluginApp, renderSlot } from "@get-bb/plugin-sdk/testing/app";

afterEach(cleanup);

test.each(["new-thread", "thread"] as const)("%s composer saves the current draft in one click", async (kind) => {
  const app = await loadPluginApp(() => import("./app"));
  const action = app.composerCustomizations.find((item) => item.id === "save-draft")!;
  expect(action.scopes).toEqual(["thread", "new-thread"]);
  const slot = renderSlot(action.actions![0], {}, {
    composer: { scope: kind === "thread" ? { kind, threadId: "t1" } : { kind, projectId: "p1" } },
  });
  const button = screen.getByRole("button", { name: "Save draft" }) as HTMLButtonElement;
  expect(button.disabled).toBe(true);
  await slot.behavior.setComposerText("Review this later");
  expect(button.disabled).toBe(false);
  fireEvent.click(button);
  expect(slot.inspection.composer.submits).toEqual([{ experimental_data: { kind: "draft" } }]);
  slot.lifecycle.unmount();
});

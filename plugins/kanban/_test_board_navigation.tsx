// @vitest-environment jsdom
import { act, cleanup } from "@testing-library/react";
import { afterEach, expect, test } from "vitest";
import { loadPluginApp, renderSlot } from "@get-bb/plugin-sdk/testing/app";
import { openBoardCommand } from "./BoardNavigation";

afterEach(cleanup);
test("Open Kanban board navigates directly from a thread and disposes its listener", async () => {
  const app = await loadPluginApp(() => import("./app"));
  const slot = renderSlot(app.appOverlays.find(item => item.id === "board-navigation")!, {}, {
    context: { threadId: "thread", projectId: "project" },
  });
  act(() => openBoardCommand.run());
  expect(slot.inspection.navigateCalls).toEqual([{ method: "toPluginPanel", path: "board" }]);
  slot.lifecycle.unmount();
  act(() => openBoardCommand.run());
  expect(slot.inspection.navigateCalls).toHaveLength(1);
});

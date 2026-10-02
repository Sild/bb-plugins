// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import {
  act,
  cleanup,
  fireEvent,
  screen,
  waitFor,
} from "@testing-library/react";
import { loadPluginApp, renderSlot } from "@get-bb/plugin-sdk/testing/app";
import {
  createFakePluginHost,
  makeThreadResponse,
} from "@get-bb/plugin-sdk/testing";
import app from "./app";
import plugin, { rpcContract } from "./server";
import type { QuestionRecord } from "./model";
HTMLDialogElement.prototype.showModal = function () {
  this.setAttribute("open", "");
};
HTMLDialogElement.prototype.close = function () {
  this.removeAttribute("open");
};
const hosts: ReturnType<typeof createFakePluginHost>[] = [];
afterEach(async () => {
  cleanup();
  localStorage.clear();
  for (const h of hosts.splice(0)) await h.harness.lifecycle.dispose();
});
async function fixture() {
  const h = createFakePluginHost({
    pluginId: "question-inbox",
    sdk: {
      threads: {
        get: async () => makeThreadResponse({ id: "t", title: "Popup test" }),
      },
    },
  });
  hosts.push(h);
  plugin(h.bb);
  await h.harness.behavior.callAgentTool(
    "ask_persistent_question",
    {
      questions: [
        {
          id: "q",
          prompt: "Pick a color",
          options: [
            { value: "blue", label: "Blue" },
            { value: "green", label: "Green" },
          ],
        },
      ],
    },
    { threadId: "t" },
  );
  const r = (
    (await h.harness.behavior.callRpc("list", { offset: 0 })) as {
      records: QuestionRecord[];
    }
  ).records[0];
  const { appOverlays } = await loadPluginApp(app);
  const mount = (threadId: string | null = "t") =>
    renderSlot<{}, typeof rpcContract>(
      appOverlays[0],
      {},
      {
        context: { threadId, projectId: null },
        rpc: {
          revise: (input) =>
            h.harness.behavior.callRpc("revise", input) as never,
          list: (input) => h.harness.behavior.callRpc("list", input) as never,
          get: (input) => h.harness.behavior.callRpc("get", input) as never,
          save: (input) => h.harness.behavior.callRpc("save", input) as never,
          close: (input) => h.harness.behavior.callRpc("close", input) as never,
          answer: (input) =>
            h.harness.behavior.callRpc("answer", input) as never,
        },
      },
    );
  return { h, r, mount };
}
it("shows no selected default; Answer later preserves draft and reopening restores it", async () => {
  const { h, r, mount } = await fixture();
  const view = mount();
  await screen.findByText("Needs your answer · 1");
  expect(screen.queryByRole("dialog")).toBeNull();
  window.dispatchEvent(new CustomEvent("bb-question-inbox-open", { detail: r.id }));
  const dialog = await screen.findByRole("dialog");
  expect(dialog.parentElement).toBe(document.body);
  expect(
    (screen.getByRole("radio", { name: "Blue" }) as HTMLInputElement).checked,
  ).toBe(false);
  fireEvent.change(screen.getByRole("textbox"), {
    target: { value: "Saved for later" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Answer later" }));
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  const saved = (await h.harness.behavior.callRpc("get", {
    id: r.id,
  })) as QuestionRecord;
  expect(saved.draft.q.freeText).toBe("Saved for later");
  expect(saved.snoozed).toBe(true);
  view.unmount();
  mount();
  await screen.findByText("Needs your answer · 1");
  expect(screen.queryByRole("dialog")).toBeNull();
  window.dispatchEvent(
    new CustomEvent("bb-question-inbox-open", { detail: r.id }),
  );
  await screen.findByRole("dialog");
  expect((screen.getByRole("textbox") as HTMLTextAreaElement).value).toBe(
    "Saved for later",
  );
});
it("does not overwrite a newer server draft with recovered local text", async () => {
  const { h, r, mount } = await fixture();
  await h.harness.behavior.callRpc("save", {
    id: r.id,
    revision: 0,
    draft: { q: { selected: [], freeText: "New server draft" } },
  });
  localStorage.setItem(
    `bb-question-draft:${r.id}`,
    JSON.stringify({
      revision: 0,
      draft: { q: { selected: [], freeText: "Old local draft" } },
    }),
  );
  mount();
  window.dispatchEvent(new CustomEvent("bb-question-inbox-open", { detail: r.id }));
  await screen.findByText(/A newer draft was saved/);
  expect(
    (screen.getByRole("button", { name: "Submit answer" }) as HTMLButtonElement)
      .disabled,
  ).toBe(true);
  fireEvent.click(screen.getByRole("button", { name: "Use saved draft" }));
  expect((screen.getByRole("textbox") as HTMLTextAreaElement).value).toBe(
    "New server draft",
  );
  const saved = (await h.harness.behavior.callRpc("get", {
    id: r.id,
  })) as QuestionRecord;
  expect(saved.draft.q.freeText).toBe("New server draft");
});

it("retains draft conflict through editing, Answer later, and reopening", async () => {
  const { h, r, mount } = await fixture();
  await h.harness.behavior.callRpc("save", {
    id: r.id,
    revision: 0,
    draft: { q: { selected: [], freeText: "New server draft" } },
  });
  localStorage.setItem(
    `bb-question-draft:${r.id}`,
    JSON.stringify({
      revision: 0,
      draft: { q: { selected: [], freeText: "Old local draft" } },
    }),
  );
  const view = mount();
  window.dispatchEvent(new CustomEvent("bb-question-inbox-open", { detail: r.id }));
  await screen.findByText(/A newer draft was saved/);
  fireEvent.change(screen.getByRole("textbox"), {
    target: { value: "Edited conflicting draft" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Answer later" }));
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  view.unmount();
  mount();
  window.dispatchEvent(new CustomEvent("bb-question-inbox-open", { detail: r.id }));
  await screen.findByText(/A newer draft was saved/);
  vi.useFakeTimers();
  try {
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000);
    });
  } finally {
    vi.useRealTimers();
  }
  const saved = (await h.harness.behavior.callRpc("get", {
    id: r.id,
  })) as QuestionRecord;
  expect(saved.draft.q.freeText).toBe("New server draft");
  expect((screen.getByRole("textbox") as HTMLTextAreaElement).value).toBe(
    "Edited conflicting draft",
  );
});

it("opens a question without a focused thread", async () => {
  const { r, mount } = await fixture();
  mount(null);
  await screen.findByText("Needs your answer · 1");
  expect(screen.queryByRole("dialog")).toBeNull();
  window.dispatchEvent(new CustomEvent("bb-question-inbox-open", { detail: r.id }));
  await screen.findByRole("dialog");
});
it("Escape defers the question and preserves the draft", async () => {
  const { h, r, mount } = await fixture();
  mount();
  window.dispatchEvent(new CustomEvent("bb-question-inbox-open", { detail: r.id }));
  const dialog = await screen.findByRole("dialog");
  fireEvent.change(screen.getByRole("textbox"), {
    target: { value: "Later answer" },
  });
  fireEvent(dialog, new Event("cancel", { bubbles: false, cancelable: true }));
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  const saved = (await h.harness.behavior.callRpc("get", {
    id: r.id,
  })) as QuestionRecord;
  expect(saved.draft.q.freeText).toBe("Later answer");
  expect(saved.snoozed).toBe(true);
});

it("Custom answer clears suggested choices and survives Answer later", async () => {
  const { h, r, mount } = await fixture();
  mount();
  window.dispatchEvent(new CustomEvent("bb-question-inbox-open", { detail: r.id }));
  await screen.findByRole("dialog");
  expect(
    (screen.getByRole("radio", { name: "Custom answer" }) as HTMLInputElement)
      .checked,
  ).toBe(false);
  fireEvent.click(screen.getByRole("radio", { name: "Blue" }));
  expect(screen.getByText("Additional comments (optional)")).toBeTruthy();
  fireEvent.change(screen.getByRole("textbox"), {
    target: { value: "Neither suggested choice" },
  });
  fireEvent.click(screen.getByRole("radio", { name: "Custom answer" }));
  expect(
    (screen.getByRole("radio", { name: "Blue" }) as HTMLInputElement).checked,
  ).toBe(false);
  expect(screen.queryByText("Additional comments (optional)")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Answer later" }));
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  const saved = (await h.harness.behavior.callRpc("get", {
    id: r.id,
  })) as QuestionRecord;
  expect(saved.draft.q).toEqual({
    selected: [],
    freeText: "Neither suggested choice",
  });
  window.dispatchEvent(
    new CustomEvent("bb-question-inbox-open", { detail: r.id }),
  );
  await screen.findByRole("dialog");
  expect(
    (screen.getByRole("radio", { name: "Custom answer" }) as HTMLInputElement)
      .checked,
  ).toBe(true);
  fireEvent.click(screen.getByRole("radio", { name: "Green" }));
  expect(
    (screen.getByRole("radio", { name: "Custom answer" }) as HTMLInputElement)
      .checked,
  ).toBe(false);
  expect(screen.getByText("Additional comments (optional)")).toBeTruthy();
});

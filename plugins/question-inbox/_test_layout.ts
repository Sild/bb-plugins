// @vitest-environment jsdom
import { afterEach, expect, it } from "vitest";
import { questionContainer, questionPosition } from "./layout";
afterEach(() => document.body.replaceChildren());
it("centers within an offset thread pane and bounds long forms", () => {
  const result = questionPosition(
    { left: 600, top: 80, width: 800, height: 900 },
    { width: 1400, height: 980 },
  );
  expect(result).toEqual({ left: 1000, top: 530, width: 640, maxHeight: 720 });
  const narrow = questionPosition(
    { left: 280, top: 50, width: 340, height: 430 },
    { width: 620, height: 480 },
  );
  expect(narrow).toEqual({ left: 450, top: 265, width: 316, maxHeight: 406 });
});
it("uses the viewport when a stale thread pane is offscreen", () => {
  expect(
    questionPosition(
      { left: 1500, top: 0, width: 500, height: 800 },
      { width: 1400, height: 900 },
    ),
  ).toEqual({ left: 700, top: 450, width: 640, maxHeight: 720 });
});
it("uses the owning split pane instead of another thread or the sidebar", () => {
  document.body.innerHTML =
    '<aside></aside><main><div data-split-pane-id="left"></div><div data-split-pane-id="right"><span data-question-thread="t"></span></div></main>';
  expect(questionContainer("t", "right")).toBe(
    document.querySelector('[data-split-pane-id="right"]'),
  );
});
it("finds the thread container from its header in an unsplit window", () => {
  document.body.innerHTML =
    '<main><section id="thread"><header><span data-question-thread="t"></span></header></section></main>';
  const container = document.getElementById("thread")!;
  container.getBoundingClientRect = () =>
    ({ left: 280, top: 30, width: 900, height: 800 }) as DOMRect;
  expect(questionContainer("t")).toBe(container);
});

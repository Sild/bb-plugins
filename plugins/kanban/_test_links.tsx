// @vitest-environment jsdom
import { expect, test } from "vitest";
import { linkPath } from "./ProjectCards";

const bounds = new DOMRect(100, 200, 1000, 600);
const left = new DOMRect(120, 228, 160, 80);
const right = new DOMRect(720, 400, 160, 100);

test("cross-column routes attach to facing edges and stay on the top rail across intermediate columns", () => {
  const blocker = new DOMRect(400, 228, 160, 150);
  const forward = linkPath(left, right, bounds, [left, blocker, right]);
  expect(forward).toMatchObject({ x: 180, y: 68 });
  expect(forward.path).toMatch(/^M 180 68 H 190 V 17/);
  expect(forward.path).toContain("12 H 605");
  expect(forward.path).toMatch(/H 620$/);
  const backward = linkPath(right, left, bounds, [left, blocker, right]);
  expect(backward).toMatchObject({ x: 620, y: 250 });
  expect(backward.path).toMatch(/^M 620 250 H 610 V 17/);
  expect(backward.path).toMatch(/H 180$/);
});

test("same-column routes use the outer gutter in either vertical direction", () => {
  const lower = new DOMRect(120, 400, 160, 100);
  for (const [source, target] of [[left, lower], [lower, left]]) {
    const blocker = new DOMRect(120, 330, 160, 40);
    const route = linkPath(source, target, bounds, [source, blocker, target]);
    expect(route.x).toBe(20);
    expect(route.path).toContain("Q 10");
    expect(route.path).not.toContain("V 17");
    expect(route.path).toMatch(/H 20$/);
  }
});

test("shared scrolling preserves card-relative routes", () => {
  const shifted = (rect: DOMRect) => new DOMRect(rect.x - 75, rect.y - 300, rect.width, rect.height);
  expect(linkPath(shifted(left), shifted(right), shifted(bounds))).toEqual(linkPath(left, right, bounds));
});


test("adjacent cards use short vertical arrows and separate incoming/outgoing endpoints", () => {
  const next = new DOMRect(120, 320, 160, 100);
  expect(linkPath(left, next, bounds).path).toBe("M 100 108 V 120");
  expect(linkPath(next, left, bounds).path).toBe("M 100 120 V 108");
});

test("clear cross-column space uses a direct curve instead of the top rail", () => {
  expect(linkPath(left, right, bounds).path).toBe("M 180 68 C 400 68 400 250 620 250");
  expect(linkPath(right, left, bounds).path).toBe("M 620 250 C 400 250 400 68 180 68");
});

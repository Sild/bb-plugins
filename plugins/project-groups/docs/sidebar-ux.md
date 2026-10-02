# Sidebar UX refinement — 2026-09-29

## Evidence and scope

Heuristic evaluation of the supplied sidebar screenshot, inspection of the recovered
Project Groups plugin, and a review of published navigation guidance. This was not a
user study; no task-completion timings or usability improvement percentages were measured.

The screenshot gives section cards more visual weight than destinations, repeats
Backlog at section and project level, reserves permanent columns for pin/archive
controls, and shows an empty Other projects section. Deep indentation further reduces
title space. Keep the existing grouping model and direct new-thread action.

## Implemented decisions

- Replace tinted cards and vertical guide lines with compact section headers. Retain
  colored section icons and the section edit/delete menu for orientation and management.
- Use shallow indentation and one-line project rows. Show a nonzero thread total with
  full status breakdown in its title and accessible name. A dot highlights Waiting,
  or Active when nothing is waiting. This trades always-visible status detail for
  scanning space; exact details remain in the board and count description.
- Show aggregate section counts only while collapsed. Totals include pinned members.
- Keep the project + visible. Move pin/unpin into project options. Reveal secondary
  actions on hover/focus, keep them visible for coarse pointers, and retain focus rings.
- Hide empty fallback sections while preserving the distinction between ungrouped
  projects and standalone threads when populated.
- Mark the current thread with a background and accent edge; provide full title on hover.
- Expose disclosure expanded state and content relationships. Keep native button
  Enter/Space and Tab behavior; do not claim ARIA tree keyboard semantics.
- Keep project subtrees mounted while collapsing a section so expansion is preserved.

## Research references

[Nielsen Norman Group: Progressive Disclosure](https://www.nngroup.com/articles/progressive-disclosure/)
recommends leaving frequently used actions in the primary view and making secondary
features easy to discover. Here that means a persistent + and contextual management controls.

[W3C APG: Disclosure Navigation](https://www.w3.org/WAI/ARIA/apg/patterns/disclosure/examples/disclosure-navigation/)
provides the expanded-state, controlled-content, and native keyboard model used here.
It also calls for assistive-technology testing before claiming production accessibility.

## Verification and limits

TypeScript, the seven sidebar interaction tests, and BB plugin build validate the change.
The inline preview uses markup captured from the actual component with sample data;
its demonstration interactions are separate from BB. Computer Use access to BB was
not granted, so live desktop rendering and assistive-technology behavior are unverified.
No backend storage, group assignments, ordering, or Kanban classification was changed.

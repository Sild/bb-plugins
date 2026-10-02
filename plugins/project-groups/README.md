# Project Groups for BB

Adds named, ordered folders to BB's project sidebar. Each folder has a
Codex-style picker for emoji or a colored icon. Assign a project under
**Project folder** on its project settings page. Projects without a custom
folder appear under **Other projects**. Threads without a project appear directly
under **Other threads**. These two default sections stay at the bottom and are hidden when empty. A project belongs to one folder.

Use **Pin project** in the project options menu to show it in **Pinned** at the top. Unpinning returns it to
its assigned folder. Folder names, icons, order, project assignments, and pins
are stored on the BB host and update in other open windows.

## Install

```sh
npm install --include=dev
bb plugin build
bb plugin install .
```

BB permits one sidebar thread-list provider at a time. Select **Project
Groups** under **Settings → Appearance → Sidebar** if it does not become active
automatically.

Use **+ Section** to create a folder. Open its **⋯** menu to edit, reorder, or delete it. Deletion asks for confirmation. You can also create
or edit a folder on a project's settings page. Deleting a folder returns its
projects to **Other projects**; it does not delete BB projects.

The plugin replaces BB's Thread List sidebar surface. It displays active
threads inside their projects with status indicators, open and archive actions,
a visible **+** button to open the new-thread form, and a project menu for settings.

Project settings integration uses a DOM adapter because BB currently has no
project-settings slot. A host settings layout change may require updating this adapter.

## Checks

```sh
npx tsc --noEmit
npx vitest run
bb plugin build .
```
Advanced Thread List controls such as its organization modes and thread
context menu remain available by selecting **Thread list** as the sidebar
provider.

## Sidebar hierarchy and counts

Folders use compact headers with colored icons and shallow indentation. Project rows
show a single nonzero thread total; hover the total for Backlog, Active, Waiting,
and Done details. Waiting and Active counts also add a small status dot. A collapsed
folder shows its aggregate total, including pinned members; expanded folders omit
that duplicate count. Hidden and archived threads are excluded.

The project **+** remains visible. Pinning is in the project options menu. Secondary
options and archive controls appear on row hover or keyboard focus, and remain
visible on touch devices. Current threads have a selected background and accent
edge. Full thread titles are available on hover. Disclosure buttons expose expanded
state and associated content to assistive technology.

Counts read the Kanban plugin's persisted columns; idle runtime is not Done.
They refresh every 30 seconds while visible and when returning to the window.
If metadata cannot be loaded, counts are hidden and an unavailable notice appears.

## New thread defaults

The global sidebar **New thread** action starts with **No project** (BB’s personal
workspace) with Codex **6-Sol Medium**. Project-specific **+** actions retain their project. Native composer
controls, drafts, and attachments remain owned by BB. Other new task composers default
to Codex **6-Astra Medium**; users can choose another agent before submitting.
This also applies when opening a new project compose surface. Existing threads
are unchanged. The navigation adapter targets BB’s sidebar navigation row and
leaves its options menu and modified clicks to BB.

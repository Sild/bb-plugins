# Project organization

## Folders and pins

A project belongs to at most one custom folder. Unassigned projects and projects
with a stale folder ID appear in Other projects. The personal workspace appears
as standalone threads in Other threads and cannot be selected in the manager.
Folders are ordered and have names and icon/emoji appearance. Removing a folder
keeps projects, threads, and pins, returning its members to Other projects.

Pinned is an additional view: a pinned project appears both in Pinned and in its
assigned folder (or Other projects). Pinning and unpinning never change folder
membership. Both appearances expose the same project and thread actions. Folder
counts include pinned members once. Existing assignment and pin storage is retained;
no label migration is needed because assignments already enforce one folder per project.

## Manage projects

The sidebar's Manage projects action opens an independent project manager without
starting a task. Organize projects lists all non-personal BB projects. Users can
search by name, select individual projects or all shown projects, clear selection,
and apply one folder destination or pin/unpin to the entire selection. Selections
survive filtering. Folder moves replace the prior assignment; Other projects clears
it. Bulk updates validate every project and destination before a single local
transaction, so stale projects or missing folders cannot partially apply an update.

Add projects accepts up to 100 name/path rows, one connected host, and one destination
folder per submission. It uses BB's public project creation API with existing local
paths; it does not create tasks, clone repositories, or provision hosts. Existing
projects with the same host/path are reused and moved into the selected folder.
Successful additions remain when another row fails. Each failed row displays its
error and remains editable; successful rows are removed from the retry form. Repeating
a submission reuses projects by host/path, including after a lost response. Batches
are serialized within the plugin so concurrent windows and overlapping retries
read the latest project list before creating projects.

The manager disables mutations while a request is running and keeps errors and
results visible. Organization changes publish the existing groups-changed signal
and refresh other open windows. Project creation itself uses native SDK notifications.

## Compatibility and acceptance

The public groups_list shape, individual assignment/pin RPCs, and persisted tables
remain compatible with collection restoration and Kanban. User controls consistently
call the hierarchy folders. The Kanban filter shows pins in both Pinned and their
folder, selects by project ID, and renders each project's task cards once.

Behavioral checks cover atomic bulk updates, pin/folder independence and persistence,
partial creation and retry reuse, multi-selection, row failure recovery, and the
sidebar's simultaneous Pinned/folder appearances.

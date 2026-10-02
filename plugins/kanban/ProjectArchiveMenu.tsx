import * as Menu from "@radix-ui/react-dropdown-menu";
import * as Tooltip from "@radix-ui/react-tooltip";

export function ArchiveIcon() {
  return <svg aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><path d="M3 3h18v4H3z M5 7v13h14V7 M12 10v6m-3-3 3 3 3-3" /></svg>;
}

export function ProjectArchiveMenu({name, onAccepted, onAll}: {name: string; onAccepted: () => void; onAll: () => void}) {
  return <Menu.Root>
    <Tooltip.Provider delayDuration={150}>
      <Tooltip.Root>
        <Tooltip.Trigger asChild><Menu.Trigger asChild>
          <button type="button" aria-label={`Archive options for ${name}`} className="inline-flex h-7 items-center gap-1 rounded px-1.5 text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
            <ArchiveIcon /><span aria-hidden="true" className="text-[10px]">▾</span>
          </button>
        </Menu.Trigger></Tooltip.Trigger>
        <Tooltip.Portal><Tooltip.Content data-bb-plugin="kanban" sideOffset={6} className="z-[1100] rounded border border-border bg-popover px-2 py-1 text-xs text-popover-foreground shadow-md">Archive tasks in {name}</Tooltip.Content></Tooltip.Portal>
      </Tooltip.Root>
    </Tooltip.Provider>
    <Menu.Portal><Menu.Content data-bb-plugin="kanban" align="end" sideOffset={6} collisionPadding={8} className="z-[1100] min-w-48 rounded-lg border border-border bg-popover p-1 text-sm text-popover-foreground shadow-lg">
      <Menu.Label className="max-w-64 truncate px-2 py-1 text-xs text-muted-foreground">{name}</Menu.Label>
      <Menu.Item className="cursor-pointer rounded px-2 py-2 outline-none focus:bg-muted" onSelect={onAccepted}>Archive Accepted tasks…</Menu.Item>
      <Menu.Separator className="my-1 h-px bg-border" />
      <Menu.Item className="cursor-pointer rounded px-2 py-2 outline-none focus:bg-muted" onSelect={onAll}>Archive all project tasks…</Menu.Item>
    </Menu.Content></Menu.Portal>
  </Menu.Root>;
}

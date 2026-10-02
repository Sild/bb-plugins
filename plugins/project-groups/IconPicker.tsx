import { useState } from "react";
import * as Popover from "@radix-ui/react-popover";
import { usePortalScopeProps } from "./lib/portal-scope";
import {
  Asterisk, Atom, BookOpen, Braces, Brain, BriefcaseBusiness, ChartNoAxesColumn,
  CircleDollarSign, Dumbbell, FlaskConical, Flower2, Folder, Gift, Globe, Globe2,
  GraduationCap, Heart, Music2, NotebookPen, Palette, PawPrint, PenTool, Pencil,
  Plane, Popcorn, Scale, SquareTerminal, Stethoscope, Wrench,
  type LucideIcon,
} from "lucide-react";
import { EMOJIS, ICON_COLORS, ICONS } from "./appearance";

export type Appearance = {
  sign: string;
  iconName: string | null;
  iconColor: (typeof ICON_COLORS)[number];
};

const colorLabels = ["Gray", "Red", "Orange", "Yellow", "Green", "Blue", "Purple", "Pink"];

const iconComponents: Record<string, LucideIcon> = {
  Folder, CircleDollarSign, BookOpen, GraduationCap, Pencil, PenTool, Braces,
  SquareTerminal, Music2, Popcorn, Atom, Palette, Stethoscope, Asterisk, Flower2,
  BriefcaseBusiness, ChartNoAxesColumn, Dumbbell, NotebookPen, Scale, Globe2,
  Plane, Globe, Wrench, PawPrint, FlaskConical, Brain, Heart, Gift,
};

export function GroupMark({ value, className = "" }: { value: Appearance; className?: string }) {
  const Graphic = value.iconName ? iconComponents[value.iconName] : Folder;
  if (Graphic && !value.sign) {
    return <Graphic size={20} className={className || "size-4"} style={{ color: value.iconColor }} aria-hidden />;
  }
  return value.sign ? <span className={className} aria-hidden>{value.sign}</span> : null;
}

export function IconPicker({ value, onChange }: { value: Appearance; onChange: (value: Appearance) => void }) {
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<"emoji" | "icons">(value.sign ? "emoji" : "icons");
  const [search, setSearch] = useState("");
  const scope = usePortalScopeProps();

  const entries = (tab === "icons" ? ICONS : EMOJIS)
    .filter(([name, label]) => `${name} ${label}`.toLowerCase().includes(search.toLowerCase()));
  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger asChild>
      <button type="button"
        className="flex size-9 items-center justify-center rounded-md border border-border bg-background text-lg hover:bg-accent"
        aria-label="Choose folder icon" aria-expanded={open}>
        {value.sign || value.iconName
          ? <GroupMark value={value} className={value.iconName ? "size-5" : ""} />
          : <span className="text-sm text-muted-foreground">+</span>}
      </button>
      </Popover.Trigger>
      <Popover.Portal>
      <Popover.Content {...scope} sideOffset={8} collisionPadding={16} align="start"
        style={{ width: "min(340px, calc(100vw - 32px))" }}
        className="z-[1000] rounded-xl border border-border bg-popover p-4 text-popover-foreground shadow-xl">
        <div className="flex items-center gap-1">
          <button type="button" className={`rounded-full px-3 py-1 text-sm ${tab === "emoji" ? "bg-accent" : "text-muted-foreground"}`}
            onClick={() => { setTab("emoji"); setSearch(""); }}>Emoji</button>
          <button type="button" className={`rounded-full px-3 py-1 text-sm ${tab === "icons" ? "bg-accent" : "text-muted-foreground"}`}
            onClick={() => { setTab("icons"); setSearch(""); }}>Icons</button>
          <button type="button" className="ml-auto rounded-full px-3 py-1 text-sm hover:bg-accent"
            onClick={() => { onChange({ ...value, sign: "", iconName: null }); setOpen(false); }}>Clear</button>
        </div>
        <input type="search" value={search} onChange={(event) => setSearch(event.target.value)}
          placeholder={tab === "icons" ? "Search icons" : "Search emoji"}
          aria-label={tab === "icons" ? "Search icons" : "Search emoji"}
          className="mt-3 w-full rounded-md border border-border bg-background px-2 py-1.5 text-sm" />
        {tab === "icons" && <div className="mt-3 flex justify-between gap-1" aria-label="Icon color">
          {ICON_COLORS.map((color) => <button key={color} type="button" title={colorLabels[ICON_COLORS.indexOf(color)]}
            aria-label={`Icon color ${colorLabels[ICON_COLORS.indexOf(color)]}`} aria-pressed={value.iconColor === color}
            className={`size-7 rounded-full border-2 ${value.iconColor === color ? "border-foreground" : "border-transparent"}`}
            style={{ backgroundColor: color }}
            onClick={() => onChange({ ...value, iconColor: color })} />)}
        </div>}
        <div className="mt-3 grid max-h-56 grid-cols-7 gap-1 overflow-y-auto">
          {entries.map(([name, label]) => {
            const Graphic = iconComponents[name];
            return <button key={name} type="button" title={label}
            aria-label={label} aria-pressed={tab === "icons" ? value.iconName === name : value.sign === name && !value.iconName}
            className="flex size-9 items-center justify-center rounded-md hover:bg-accent aria-pressed:bg-accent"
            onClick={() => { onChange(tab === "icons" ? { ...value, sign: "", iconName: name } : { ...value, sign: name, iconName: null }); setOpen(false); }}>
            {tab === "icons"
              ? Graphic && <Graphic size={20} className="size-5" style={{ color: value.iconColor }} aria-hidden />
              : <span className="text-xl">{name}</span>}
          </button>;
          })}
          {entries.length === 0 && <p className="col-span-7 py-3 text-center text-xs text-muted-foreground">No matches</p>}
        </div>
      </Popover.Content></Popover.Portal>
    </Popover.Root>
  );
}

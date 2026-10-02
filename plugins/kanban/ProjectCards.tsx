import { useId, useLayoutEffect, useRef, useState } from "react";
import { useBbNavigate } from "@get-bb/plugin-sdk/app";
import { columns, archivedColumn, parentFirst, type BoardProject } from "./board";
import type { Card } from "./server";

type Link = { parent: string; child: string; path: string; x: number; y: number };

/** Prefer the shortest clear connection; use gutters only when cards block it. */
export function linkPath(source: DOMRect, target: DOMRect, bounds: DOMRect, obstacles: DOMRect[] = []) {
  const sameColumn = Math.abs(source.left - target.left) < 2;
  const right = target.left > source.left;
  const downward = target.top > source.top;
  const between = obstacles.filter((rect) => rect !== source && rect !== target);
  if (sameColumn) {
    const x = source.left + source.width / 2 - bounds.left;
    const sy = (downward ? source.bottom : source.top) - bounds.top;
    const ty = (downward ? target.top : target.bottom) - bounds.top;
    const blocked = between.some((rect) => rect.left < x + bounds.left && rect.right > x + bounds.left && rect.bottom > Math.min(sy, ty) + bounds.top && rect.top < Math.max(sy, ty) + bounds.top);
    if (!blocked) return { path: `M ${x} ${sy} V ${ty}`, x, y: sy };
  }
  const sx = (right ? source.right : source.left) - bounds.left;
  const tx = (right ? target.left : sameColumn ? target.left : target.right) - bounds.left;
  // Distinct incoming/outgoing ports keep nested gutter routes from doubling back.
  const sy = source.top + source.height * (sameColumn ? 0.75 : 0.5) - bounds.top;
  const ty = target.top + target.height * (sameColumn ? 0.25 : 0.5) - bounds.top;
  const blocked = between.some((rect) => rect.right > Math.min(sx, tx) + bounds.left && rect.left < Math.max(sx, tx) + bounds.left && rect.bottom >= Math.min(sy, ty) + bounds.top - 4 && rect.top <= Math.max(sy, ty) + bounds.top + 4);
  if (!sameColumn && !blocked) {
    const mid = (sx + tx) / 2;
    return { path: `M ${sx} ${sy} C ${mid} ${sy} ${mid} ${ty} ${tx} ${ty}`, x: sx, y: sy };
  }
  const a = sx + (right ? 10 : -10);
  const b = tx + (right || sameColumn ? -10 : 10);
  const r = Math.min(5, Math.abs(ty - sy) / 2);
  const direction = ty >= sy ? 1 : -1;
  const path = sameColumn
    ? `M ${sx} ${sy} H ${a + 5} Q ${a} ${sy} ${a} ${sy + direction * r} V ${ty - direction * r} Q ${a} ${ty} ${a + 5} ${ty} H ${tx}`
    : `M ${sx} ${sy} H ${a} V 17 Q ${a} 12 ${a + (right ? 5 : -5)} 12 H ${b + (right ? -5 : 5)} Q ${b} 12 ${b} 17 V ${ty - 5} Q ${b} ${ty} ${b + (right ? 5 : -5)} ${ty} H ${tx}`;
  return { path, x: sx, y: sy };
}

export function ProjectCards({ project, cards, allCards, showLinks, showArchive = false }: { project: BoardProject; cards: Card[]; allCards: Card[]; showLinks: boolean; showArchive?: boolean }) {
  const navigate = useBbNavigate();
  const orderedCards = parentFirst(cards);
  const shownColumns = showArchive ? [...columns, archivedColumn] : columns;
  const root = useRef<HTMLDivElement>(null);
  const marker = useId().replace(/:/g, "");
  const [links, setLinks] = useState<Link[]>([]);
  const [hovered, setHovered] = useState<string | null>(null);
  const [focused, setFocused] = useState<string | null>(null);
  const active = focused ?? hovered;
  useLayoutEffect(() => {
    const element = root.current;
    if (!element || !showLinks) { setLinks([]); return; }
    const measure = () => {
      const bounds = element.getBoundingClientRect();
      const rects = new Map(Array.from(element.querySelectorAll<HTMLElement>("[data-card-id]")).map((card) => [card.dataset.cardId, card.getBoundingClientRect()]));
      setLinks(cards.flatMap((card) => {
        const source = rects.get(card.parentThreadId ?? "");
        const target = rects.get(card.id);
        return source && target && source.width && card.parentThreadId !== card.id
          ? [{ parent: card.parentThreadId!, child: card.id, ...linkPath(source, target, bounds, [...rects.values()]) }] : [];
      }));
    };
    measure();
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(measure);
    observer?.observe(element);
    element.querySelectorAll("[data-card-id]").forEach((card) => observer?.observe(card));
    window.addEventListener("resize", measure);
    return () => { observer?.disconnect(); window.removeEventListener("resize", measure); };
  }, [cards, showLinks, showArchive]);
  const related = new Set(links.filter((link) => link.parent === active || link.child === active).flatMap((link) => [link.parent, link.child]));
  return <div ref={root} className="relative">
    {showLinks && <svg aria-hidden="true" className="pointer-events-none absolute inset-0 h-full w-full overflow-visible" style={{ zIndex: 1 }}>
      <defs><marker id={marker} viewBox="0 0 8 8" refX="7" refY="4" markerWidth="5" markerHeight="5" orient="auto-start-reverse"><path d="M 1 1 L 7 4 L 1 7" fill="none" stroke="context-stroke" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" /></marker></defs>
      {[...links].sort((a, b) => Number(a.parent === active || a.child === active) - Number(b.parent === active || b.child === active)).map((link) => {
        const highlighted = link.parent === active || link.child === active;
        return <g key={link.child} className={highlighted ? "text-primary" : "text-muted-foreground"} opacity={active ? highlighted ? 1 : 0.08 : 0.4}>
          <path d={link.path} fill="none" stroke="currentColor" strokeWidth={highlighted ? 1.75 : 1.1} strokeLinejoin="round" strokeLinecap="round" markerEnd={`url(#${marker})`} />
        </g>;
      })}
    </svg>}
    <div className="grid divide-x divide-border" style={{gridTemplateColumns: `repeat(${shownColumns.length}, minmax(0, 1fr))`}}>
      {shownColumns.map((column) => <div key={column.id} role="group" aria-label={`${project.name}: ${column.label}`} className="relative min-h-28 bg-muted/10" style={{ padding: "20px 16px 18px" }}>
        <div className="space-y-3">
          {(column.id === "archived" ? cards.filter(card => card.column === "archived").sort((a,b) => (b.acceptedAt ?? 0) - (a.acceptedAt ?? 0) || a.id.localeCompare(b.id)) : orderedCards.filter(card => card.column === column.id)).map((card) => {
            const parent = allCards.find((candidate) => candidate.id === card.parentThreadId);
            return <article key={card.id} data-card-id={card.id} aria-label={card.title}
              onMouseEnter={() => setHovered(card.id)} onMouseLeave={() => setHovered(null)}
              onFocus={() => setFocused(card.id)} onBlur={(event) => { if (!event.currentTarget.contains(event.relatedTarget)) setFocused(null); }}
              style={{ zIndex: 2 }} className={`relative rounded-lg border bg-card p-3 shadow-sm transition-colors hover:border-primary/50 ${related.has(card.id) ? "border-primary" : "border-border"}`}>
              <button type="button" className="w-full break-words text-left text-sm font-medium hover:underline" onClick={() => navigate.toThread(card.id)}>{card.title}</button>
              <p className="mt-2 inline-flex rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">Agent: {card.status}</p>
              {card.merging && <p className="mt-2 text-xs font-medium">Merging...</p>}
              {card.mergeError && <p className="mt-2 text-xs text-destructive">{card.mergeError}</p>}
              {card.parentThreadId && <button type="button" className="mt-2 block w-full truncate text-left text-xs text-muted-foreground hover:text-foreground hover:underline" title={`Open parent: ${parent?.title ?? card.parentThreadId}`} onClick={() => navigate.toThread(card.parentThreadId!)}>↳ Parent: {parent?.title ?? "Outside this view"}</button>}
            </article>;
          })}
        </div>
      </div>)}
    </div>
  </div>;
}

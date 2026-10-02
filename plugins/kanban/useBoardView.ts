import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { experimental_usePluginId } from "@get-bb/plugin-sdk/app";
import { z } from "zod";

const viewSchema = z.object({
  projectIds: z.array(z.string()).nullable(),
  collapsedProjects: z.array(z.string()),
  archiveDays: z.union([z.literal(1), z.literal(7), z.literal(14), z.literal(30), z.literal(90), z.literal(180), z.literal(365)]),
  top: z.number().finite().nonnegative(),
  left: z.number().finite().nonnegative(),
});
type BoardView = z.infer<typeof viewSchema>;

/** Keep this window's board location across thread navigation and route remounts. */
export function useBoardView(ready: boolean) {
  const pluginId = experimental_usePluginId();
  const key = `bb:${pluginId}:board:view`;
  const root = useRef<HTMLDivElement>(null);
  const [view, setView] = useState<BoardView>(() => {
    try {
      const saved = window.sessionStorage.getItem(key);
      if (saved) return viewSchema.parse(JSON.parse(saved));
    } catch { /* An unavailable or stale session cache starts at the default view. */ }
    return { projectIds: null, collapsedProjects: [], archiveDays: 7, top: 0, left: 0 };
  });
  const restored = useRef(false);
  useLayoutEffect(() => {
    if (!ready || restored.current || !root.current) return;
    root.current.scrollTop = view.top;
    root.current.scrollLeft = view.left;
    restored.current = true;
  }, [ready, view.top, view.left]);
  const save = () => {
    if (!restored.current || !root.current) return;
    try {
      window.sessionStorage.setItem(key, JSON.stringify({ ...view, top: root.current.scrollTop, left: root.current.scrollLeft }));
    } catch { /* Navigation remains available if browser storage is unavailable. */ }
  };
  useEffect(save, [key, view]);
  return { root, view, setView, save };
}

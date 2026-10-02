import { useEffect } from "react";
import { useBbNavigate } from "@get-bb/plugin-sdk/app";

const openBoardEvent = "bb-kanban-open-board";
export const openBoardCommand = {
  id: "open-board",
  title: "Open Kanban board",
  defaultShortcut: { key: "d", mod: true },
  run: () => { window.dispatchEvent(new Event(openBoardEvent)); },
};

/** Commands run outside React; the window overlay owns SDK navigation. */
export function BoardNavigation() {
  const navigate = useBbNavigate();
  useEffect(() => {
    const open = () => navigate.toPluginPanel("board");
    window.addEventListener(openBoardEvent, open);
    return () => window.removeEventListener(openBoardEvent, open);
  }, [navigate]);
  return null;
}

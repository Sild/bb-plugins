import { useEffect, useState } from "react";
import { experimental_usePluginId } from "@get-bb/plugin-sdk/app";

/** Persist display choices separately so another window cannot overwrite unrelated flags. */
export function useBoardPreference(name: "parentOnly" | "showLinks" | "showArchive", defaultValue: boolean) {
  const pluginId = experimental_usePluginId();
  const key = `bb:${pluginId}:board:${name}`;
  const read = () => {
    try {
      const saved = window.localStorage.getItem(key);
      return { value: saved === "true" ? true : saved === "false" ? false : defaultValue, error: null as string | null };
    } catch {
      return { value: defaultValue, error: "Could not load display preferences. Browser storage is unavailable." };
    }
  };
  const [state, setState] = useState(read);
  useEffect(() => {
    const onStorage = (event: StorageEvent) => {
      if (event.key === key || event.key === null) setState(read());
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, [key, defaultValue]);
  const update = (value: boolean) => {
    try {
      window.localStorage.setItem(key, String(value));
      setState({ value, error: null });
    } catch {
      setState({ value, error: "Could not save display preferences. This change will last only while the board is open." });
    }
  };
  return [state.value, update, state.error] as const;
}

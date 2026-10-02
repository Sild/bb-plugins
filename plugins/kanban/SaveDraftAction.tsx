import { useState } from "react";
import { useComposer, useComposerView } from "@get-bb/plugin-sdk/app";

export function SaveDraftAction() {
  const composer = useComposer();
  const view = useComposerView();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  return <div className="relative">
    <button type="button" aria-label="Save draft" title="Save draft"
      disabled={view.draft.isEmpty || view.run.isSubmitting || pending}
      className="inline-flex h-8 items-center gap-1.5 rounded-md border border-border bg-muted px-2.5 text-sm font-medium text-foreground shadow-sm hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:text-muted-foreground/50"
      onClick={async () => {
        setPending(true);
        setError(null);
        try {
          await composer.experimental_submit({ experimental_data: { kind: "draft" } });
        } catch (cause) {
          setError(cause instanceof Error ? cause.message : String(cause));
        } finally {
          setPending(false);
        }
      }}>
      <svg aria-hidden="true" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="m15 5 4 4M4 20l4.5-.8L20 7.7a2.1 2.1 0 0 0-3-3L5.5 16.2 4 20Z" /></svg>
      Save draft
    </button>
    {error && <span role="alert" className="absolute bottom-full left-0 z-20 mb-2 w-56 rounded-md border border-destructive bg-popover p-2 text-xs text-destructive shadow-md">{error}</span>}
  </div>;
}

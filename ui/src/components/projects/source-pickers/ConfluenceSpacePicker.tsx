"use client";

import { useState } from "react";
import { Check, Loader2, RefreshCw } from "lucide-react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useSourceOptions } from "./useSourceOptions";

/**
 * Confluence space source picker — pick the space this project documents from
 * your connected Atlassian, or paste a URL. Single-select (the project stores
 * one `confluence_url`).
 */
export function ConfluenceSpacePicker({
  selected,
  onChange,
}: {
  selected: string[];
  onChange: (next: string[]) => void;
}) {
  const { connected, connectedTo, options, loading, manageUrl, reload } =
    useSourceOptions("atlassian");
  const [manual, setManual] = useState("");
  const current = selected[0] ?? "";

  const pick = (value: string) => onChange(current === value ? [] : [value]);

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between text-sm">
        {connected ? (
          <span className="text-muted-foreground">
            Connected{connectedTo ? <> to <span className="font-medium text-emerald-500">{connectedTo}</span></> : null}
            {" · "}
            {loading ? "loading…" : `${options.length} spaces`}
          </span>
        ) : (
          <span className="text-muted-foreground">
            {manageUrl ? (
              <>
                Confluence not connected — link Atlassian in{" "}
                <a
                  href={manageUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="font-medium text-primary underline underline-offset-2 hover:text-primary/80"
                >
                  Connections
                </a>
                , or paste a space URL below.
              </>
            ) : (
              "Paste a Confluence space URL below."
            )}
          </span>
        )}
        <Button variant="ghost" size="sm" onClick={reload} title="Refresh">
          <RefreshCw className={cn("h-3.5 w-3.5", loading && "animate-spin")} />
        </Button>
      </div>

      <div className="max-h-72 overflow-y-auto rounded-lg border border-border/60">
        {options.length === 0 ? (
          <div className="flex items-center justify-center gap-2 py-8 text-sm text-muted-foreground">
            {loading ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" /> Loading spaces…
              </>
            ) : (
              "No spaces to show. Paste a URL below."
            )}
          </div>
        ) : (
          <ul className="divide-y divide-border/40">
            {options.map((o) => {
              const active = current === o.value;
              return (
                <li key={o.value}>
                  <button
                    type="button"
                    onClick={() => pick(o.value)}
                    className="flex w-full items-center gap-3 px-3 py-2 text-left text-sm transition hover:bg-accent/50"
                  >
                    <span
                      className={cn(
                        "flex h-4 w-4 shrink-0 items-center justify-center rounded-full border",
                        active
                          ? "border-primary bg-primary text-primary-foreground"
                          : "border-border",
                      )}
                    >
                      {active && <Check className="h-3 w-3" />}
                    </span>
                    <span className="truncate">{o.label}</span>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      <div className="flex items-center gap-2">
        <input
          value={manual}
          onChange={(e) => setManual(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && manual.trim()) {
              e.preventDefault();
              onChange([manual.trim()]);
              setManual("");
            }
          }}
          placeholder="https://your.atlassian.net/wiki/spaces/PROJ"
          className="flex-1 rounded-lg border border-border/60 bg-muted/30 px-3 py-2 text-sm outline-none focus:border-primary focus:ring-2 focus:ring-primary/30"
        />
        <Button
          variant="outline"
          size="sm"
          onClick={() => {
            if (manual.trim()) {
              onChange([manual.trim()]);
              setManual("");
            }
          }}
          disabled={!manual.trim()}
        >
          Use
        </Button>
      </div>

      {current && (
        <p className="truncate text-xs text-muted-foreground">
          Selected: <span className="font-medium text-foreground">{current}</span>
        </p>
      )}
    </div>
  );
}

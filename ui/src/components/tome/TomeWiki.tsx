"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { ArrowLeft, Eye, EyeOff, MessageSquare, RefreshCw } from "lucide-react";

import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { TooltipProvider } from "@/components/ui/tooltip";
import { ChatPanel } from "@/components/tome/ChatPanel";
import { WikiSidebar } from "@/components/tome/WikiSidebar";
import { WikiPageView } from "@/components/tome/WikiPageView";
import { IngestPanel } from "@/components/tome/IngestPanel";
import { IngestRunView } from "@/components/tome/IngestRunView";
import { PageHistoryView } from "@/components/tome/PageHistoryView";
import { Breadcrumb, type Crumb } from "@/components/tome/Breadcrumb";
import { parseFrontmatter, SPEC_BY_PATH } from "@/lib/tome/schema";
import { cn } from "@/lib/utils";
import type { PageTreeNode } from "@/types/tome";

interface PagesResponse {
  slug: string;
  tree: PageTreeNode[];
  pages: Record<string, string>;
}

type MainView =
  | { kind: "chat" }
  | { kind: "page"; path: string }
  | { kind: "pageHistory"; path: string }
  | { kind: "ingest" }
  | { kind: "ingestRun"; runId: string };

function pageTitleOf(path: string, markdown: string): string {
  const [fm] = parseFrontmatter(markdown);
  return typeof fm.title === "string"
    ? fm.title
    : (SPEC_BY_PATH.get(path)?.title ?? path);
}

export function TomeWiki({ slug }: { slug: string }) {
  const [data, setData] = useState<PagesResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Chat is the landing view; wiki + ingest live below it in the nav.
  const [view, setView] = useState<MainView>({ kind: "chat" });
  const [artifactPath, setArtifactPath] = useState<string | null>(null);
  const [showHidden, setShowHidden] = useState(false);
  const [seeding, setSeeding] = useState(false);

  const load = useCallback(async () => {
    setError(null);
    try {
      const res = await fetch(`/api/tome/projects/${slug}/pages`);
      if (!res.ok) throw new Error(`load failed (${res.status})`);
      const json = await res.json();
      setData(json?.data as PagesResponse);
    } catch (e) {
      setError(String((e as Error)?.message ?? e));
    }
  }, [slug]);

  useEffect(() => {
    void load();
  }, [load]);

  const openPage = useCallback((path: string) => {
    setView({ kind: "page", path });
  }, []);
  const openArtifact = useCallback((path: string) => setArtifactPath(path), []);

  const loading = data === null && !error;
  const isEmpty = data !== null && Object.keys(data.pages).length === 0;

  const writeMarkdown = useCallback(
    async (path: string, markdown: string, message: string) => {
      const res = await fetch(`/api/tome/projects/${slug}/pages/${path}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ markdown, message }),
      });
      if (!res.ok) throw new Error(`save failed (${res.status})`);
      setData((prev) =>
        prev ? { ...prev, pages: { ...prev.pages, [path]: markdown } } : prev,
      );
    },
    [slug],
  );

  const handleSeed = useCallback(async () => {
    setSeeding(true);
    setError(null);
    try {
      const res = await fetch(`/api/tome/projects/${slug}/pages`, { method: "POST" });
      if (!res.ok) throw new Error(`seed failed (${res.status})`);
      await load();
    } catch (e) {
      setError(String((e as Error)?.message ?? e));
    } finally {
      setSeeding(false);
    }
  }, [slug, load]);

  const crumbs = useMemo<Crumb[]>(() => {
    switch (view.kind) {
      case "chat":
        return [{ label: "Chat" }];
      case "page": {
        const md = data?.pages[view.path] ?? "";
        return [{ label: "Wiki" }, { label: pageTitleOf(view.path, md) }];
      }
      case "pageHistory": {
        const md = data?.pages[view.path] ?? "";
        const path = view.path;
        return [
          { label: "Wiki" },
          {
            label: pageTitleOf(path, md),
            onClick: () => setView({ kind: "page", path }),
          },
          { label: "History" },
        ];
      }
      case "ingest":
        return [{ label: "Run ingest agent" }];
      case "ingestRun":
        return [
          { label: "Run ingest agent", onClick: () => setView({ kind: "ingest" }) },
          { label: "Run" },
        ];
    }
  }, [view, data]);

  const navActive = {
    chat: view.kind === "chat",
    ingest: view.kind === "ingest" || view.kind === "ingestRun",
    page:
      view.kind === "page" || view.kind === "pageHistory" ? view.path : null,
  };

  return (
    <TooltipProvider>
      <div className="flex h-full min-h-[calc(100vh-4rem)] flex-col">
        <header className="flex items-center gap-3 border-b px-4 py-3">
          <Link href={`/projects/${slug}`}>
            <Button variant="ghost" size="sm">
              <ArrowLeft className="h-4 w-4" />
              {slug}
            </Button>
          </Link>
          <span className="text-muted-foreground">/</span>
          <Breadcrumb items={crumbs} />
        </header>

        {error && (
          <p className="border-b bg-destructive/10 px-4 py-2 text-sm text-destructive">
            {error}
          </p>
        )}

        <div className="flex flex-1 overflow-hidden">
          {/* Side nav: Chat + Ingest destinations, then the wiki page tree. */}
          <aside className="w-64 shrink-0 border-r">
            <ScrollArea className="h-full">
              <div className="flex flex-col p-3">
                <NavItem
                  icon={<MessageSquare className="h-4 w-4" />}
                  label="Chat"
                  active={navActive.chat}
                  onClick={() => setView({ kind: "chat" })}
                />
                <NavItem
                  icon={<RefreshCw className="h-4 w-4" />}
                  label="Run ingest agent"
                  active={navActive.ingest}
                  onClick={() => setView({ kind: "ingest" })}
                />

                <div className="mt-4 flex items-center justify-between px-2 pb-1">
                  <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                    Wiki
                  </span>
                  {!isEmpty && !loading && (
                    <button
                      type="button"
                      onClick={() => setShowHidden((v) => !v)}
                      title={showHidden ? "Hide agent-only pages" : "Show agent-only pages"}
                      className="text-muted-foreground hover:text-foreground"
                    >
                      {showHidden ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                    </button>
                  )}
                </div>

                {loading ? (
                  <SidebarSkeleton />
                ) : isEmpty ? (
                  <div className="px-2 py-2 text-xs text-muted-foreground">
                    <p className="mb-2">No wiki pages yet.</p>
                    <Button size="sm" onClick={handleSeed} disabled={seeding}>
                      {seeding ? "Seeding…" : "Seed wiki"}
                    </Button>
                  </div>
                ) : (
                  data && (
                    <WikiSidebar
                      tree={data.tree}
                      selectedPath={navActive.page}
                      onSelect={openPage}
                      showHidden={showHidden}
                    />
                  )
                )}
              </div>
            </ScrollArea>
          </aside>

          {/* Main pane: replaced wholesale by the active view. */}
          <main className="flex flex-1 overflow-hidden">
            {view.kind === "chat" ? (
              <>
                <div className="min-w-0 flex-1">
                  <ChatPanel slug={slug} onPagesChanged={load} onOpenPage={openArtifact} />
                </div>
                {artifactPath && (
                  <div className="w-[45%] min-w-[360px] shrink-0 border-l">
                    {data && data.pages[artifactPath] !== undefined ? (
                      <WikiPageView
                        slug={slug}
                        path={artifactPath}
                        markdown={data.pages[artifactPath]}
                        onWrite={writeMarkdown}
                        onReload={load}
                        onClose={() => setArtifactPath(null)}
                      />
                    ) : (
                      <ContentLoading />
                    )}
                  </div>
                )}
              </>
            ) : view.kind === "ingest" ? (
              <div className="min-w-0 flex-1">
                <IngestPanel
                  slug={slug}
                  canEdit
                  onOpenRun={(runId) => setView({ kind: "ingestRun", runId })}
                  onRunStarted={(runId) => setView({ kind: "ingestRun", runId })}
                />
              </div>
            ) : view.kind === "ingestRun" ? (
              <div className="min-w-0 flex-1">
                <IngestRunView slug={slug} runId={view.runId} onPagesChanged={load} />
              </div>
            ) : view.kind === "pageHistory" ? (
              <div className="min-w-0 flex-1">
                <PageHistoryView slug={slug} path={view.path} />
              </div>
            ) : (
              // page
              <div className="min-w-0 flex-1">
                {loading ? (
                  <ContentLoading />
                ) : data && data.pages[view.path] !== undefined ? (
                  <WikiPageView
                    slug={slug}
                    path={view.path}
                    markdown={data.pages[view.path]}
                    onWrite={writeMarkdown}
                    onReload={load}
                    onOpenHistory={() =>
                      setView({ kind: "pageHistory", path: view.path })
                    }
                  />
                ) : (
                  <p className="p-8 text-sm text-muted-foreground">Page not found.</p>
                )}
              </div>
            )}
          </main>
        </div>
      </div>
    </TooltipProvider>
  );
}

function NavItem({
  icon,
  label,
  active,
  onClick,
}: {
  icon: React.ReactNode;
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "flex items-center gap-2 rounded-md px-2 py-2 text-left text-sm font-medium transition-colors hover:bg-muted",
        active && "bg-muted text-primary",
      )}
    >
      {icon}
      {label}
    </button>
  );
}

function SidebarSkeleton() {
  const widths = ["w-3/4", "w-1/2", "w-2/3", "w-1/2", "w-3/5", "w-2/5"];
  return (
    <div className="space-y-2 px-2 py-1" aria-hidden>
      {widths.map((w, i) => (
        <div key={i} className={cn("h-4 animate-pulse rounded bg-muted", w)} />
      ))}
    </div>
  );
}

function ContentLoading() {
  return (
    <div className="mx-auto w-full max-w-3xl space-y-4 px-8 py-10" aria-hidden>
      <div className="h-7 w-1/3 animate-pulse rounded bg-muted" />
      <div className="space-y-2">
        <div className="h-4 w-full animate-pulse rounded bg-muted" />
        <div className="h-4 w-11/12 animate-pulse rounded bg-muted" />
        <div className="h-4 w-4/5 animate-pulse rounded bg-muted" />
      </div>
    </div>
  );
}

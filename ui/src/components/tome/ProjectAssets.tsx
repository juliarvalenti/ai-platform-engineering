"use client";

import { useCallback, useEffect, useState } from "react";
import { GitBranch, Pencil, Plus, X } from "lucide-react";

import { Button } from "@/components/ui/button";

/**
 * The sources attached to a project — the GitHub repos and Confluence space the
 * agent reads (and that scope its read-only MCP allowlist). Editing here PATCHes
 * the CAIPE project's `sources`, so the next ingest/chat picks them up.
 */

interface Sources {
  repos: string[];
  confluence_url: string;
}

function repoUrl(repo: string): string {
  return /^https?:\/\//.test(repo)
    ? repo
    : `https://github.com/${repo.replace(/^\/+/, "")}`;
}

export function ProjectAssets({
  slug,
  canEdit,
}: {
  slug: string;
  canEdit: boolean;
}) {
  const [sources, setSources] = useState<Sources | null>(null);
  const [editing, setEditing] = useState(false);
  const [draftRepos, setDraftRepos] = useState<string[]>([]);
  const [draftConfluence, setDraftConfluence] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/projects/${slug}`);
      if (!res.ok) throw new Error(`load failed (${res.status})`);
      const json = await res.json();
      const s = json?.data?.project?.sources ?? {};
      setSources({
        repos: Array.isArray(s.repos) ? s.repos : [],
        confluence_url: typeof s.confluence_url === "string" ? s.confluence_url : "",
      });
    } catch (e) {
      setError(String((e as Error)?.message ?? e));
    }
  }, [slug]);

  useEffect(() => {
    void load();
  }, [load]);

  const startEdit = () => {
    if (!sources) return;
    setDraftRepos(sources.repos.length ? sources.repos : [""]);
    setDraftConfluence(sources.confluence_url);
    setError(null);
    setEditing(true);
  };

  const save = useCallback(async () => {
    setSaving(true);
    setError(null);
    try {
      const repos = draftRepos.map((r) => r.trim()).filter(Boolean);
      const res = await fetch(`/api/projects/${slug}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sources: { repos, confluence_url: draftConfluence.trim() },
        }),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j?.error || `save failed (${res.status})`);
      }
      setEditing(false);
      await load();
    } catch (e) {
      setError(String((e as Error)?.message ?? e));
    } finally {
      setSaving(false);
    }
  }, [slug, draftRepos, draftConfluence, load]);

  return (
    <div className="rounded-lg border p-4">
      <div className="mb-3 flex items-center justify-between">
        <h3 className="text-sm font-semibold">Project sources</h3>
        {canEdit && !editing && (
          <Button variant="ghost" size="sm" onClick={startEdit} title="Edit sources">
            <Pencil className="h-3.5 w-3.5" />
            Edit
          </Button>
        )}
      </div>

      {sources === null ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : editing ? (
        <div className="space-y-4">
          <div>
            <label className="mb-1 block text-xs font-medium text-muted-foreground">
              GitHub repos <span className="font-normal">(owner/name or URL)</span>
            </label>
            <div className="space-y-2">
              {draftRepos.map((r, i) => (
                <div key={i} className="flex items-center gap-2">
                  <input
                    value={r}
                    onChange={(e) =>
                      setDraftRepos((prev) =>
                        prev.map((v, j) => (j === i ? e.target.value : v)),
                      )
                    }
                    placeholder="cnoe-io/ai-platform-engineering"
                    className="flex-1 rounded-md border bg-background px-2.5 py-1.5 text-sm outline-none focus:ring-2 focus:ring-ring"
                  />
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() =>
                      setDraftRepos((prev) => prev.filter((_, j) => j !== i))
                    }
                    title="Remove"
                  >
                    <X className="h-4 w-4" />
                  </Button>
                </div>
              ))}
              <Button
                variant="outline"
                size="sm"
                onClick={() => setDraftRepos((prev) => [...prev, ""])}
              >
                <Plus className="h-3.5 w-3.5" />
                Add repo
              </Button>
            </div>
          </div>

          <div>
            <label className="mb-1 block text-xs font-medium text-muted-foreground">
              Confluence space URL
            </label>
            <input
              value={draftConfluence}
              onChange={(e) => setDraftConfluence(e.target.value)}
              placeholder="https://your-org.atlassian.net/wiki/spaces/ABC"
              className="w-full rounded-md border bg-background px-2.5 py-1.5 text-sm outline-none focus:ring-2 focus:ring-ring"
            />
          </div>

          {error && <p className="text-sm text-destructive">{error}</p>}

          <div className="flex gap-2">
            <Button size="sm" onClick={() => void save()} disabled={saving}>
              {saving ? "Saving…" : "Save"}
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setEditing(false)}
              disabled={saving}
            >
              Cancel
            </Button>
          </div>
        </div>
      ) : (
        <div className="space-y-3 text-sm">
          <div>
            <div className="mb-1 text-xs font-medium text-muted-foreground">
              GitHub repos
            </div>
            {sources.repos.length === 0 ? (
              <p className="text-muted-foreground">None attached.</p>
            ) : (
              <ul className="space-y-1">
                {sources.repos.map((r) => (
                  <li key={r}>
                    <a
                      href={repoUrl(r)}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1.5 text-foreground hover:underline"
                    >
                      <GitBranch className="h-3.5 w-3.5 shrink-0" />
                      {r.replace(/^https?:\/\/github\.com\//, "")}
                    </a>
                  </li>
                ))}
              </ul>
            )}
          </div>
          {sources.confluence_url && (
            <div>
              <div className="mb-1 text-xs font-medium text-muted-foreground">
                Confluence
              </div>
              <a
                href={sources.confluence_url}
                target="_blank"
                rel="noopener noreferrer"
                className="text-foreground hover:underline"
              >
                {sources.confluence_url}
              </a>
            </div>
          )}
          {error && <p className="text-sm text-destructive">{error}</p>}
        </div>
      )}
    </div>
  );
}

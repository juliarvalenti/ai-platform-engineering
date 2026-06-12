"use client";

// assisted-by Cursor Composer

import { AnimatePresence, motion } from "framer-motion";
import {
  BookOpen,
  Bot,
  CheckCircle2,
  ChevronDown,
  FolderKanban,
  ListChecks,
  Loader2,
  MessageSquare,
  Rocket,
  Search,
  Sparkles,
  Video,
  type LucideIcon,
} from "lucide-react";
import Link from "next/link";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";

import { TeamPicker, type TeamPickerOption } from "@/components/ui/team-picker";
import { SourcePicker } from "@/components/projects/source-pickers";
import { cn } from "@/lib/utils";
import type { ProjectDocument } from "@/types/projects";

type SourceKind = "github" | "confluence" | "webex";

interface OnboardingStepConfig {
  id: string;
  title: string;
  subtitle: string;
  icon?: string;
  gradient?: string;
  checklist?: string[];
  provider?: "mock" | "none" | "http" | "link" | "source";
  source?: SourceKind;
}

interface WizardStepMeta {
  id: string;
  title: string;
  subtitle: string;
  icon: LucideIcon;
  gradient: string;
  checklist?: string[];
  /** create = name/team; source = a pre-create source picker; review = confirm + commit; provision = http/link/mock; complete = success. */
  kind: "create" | "source" | "review" | "provision" | "complete";
  source?: SourceKind;
}

const ICONS: Record<string, LucideIcon> = {
  sparkles: Sparkles,
  "book-open": BookOpen,
  video: Video,
  "message-square": MessageSquare,
  bot: Bot,
  "folder-kanban": FolderKanban,
  rocket: Rocket,
};

const DEFAULT_GRADIENT = "from-violet-600 via-indigo-600 to-blue-600";

function resolveIcon(name?: string): LucideIcon {
  if (!name) return Sparkles;
  return ICONS[name] ?? Sparkles;
}

function buildWizardSteps(configSteps: OnboardingStepConfig[]): WizardStepMeta[] {
  const create: WizardStepMeta = {
    id: "create",
    title: "Create Project",
    subtitle: "Name your initiative and assign a team",
    icon: FolderKanban,
    gradient: DEFAULT_GRADIENT,
    kind: "create",
  };
  const toMeta = (step: OnboardingStepConfig, kind: "source" | "provision"): WizardStepMeta => ({
    id: step.id,
    title: step.title,
    subtitle: step.subtitle,
    icon: resolveIcon(step.icon),
    gradient: step.gradient ?? DEFAULT_GRADIENT,
    checklist: step.checklist,
    kind,
    source: step.source,
  });
  // Source steps are pre-create (they feed the create payload), so they always
  // precede the provision steps regardless of YAML order.
  const sourceSteps = configSteps
    .filter((s) => s.provider === "source")
    .map((s) => toMeta(s, "source"));
  const provisionSteps = configSteps
    .filter((s) => s.provider !== "source")
    .map((s) => toMeta(s, "provision"));
  // The project is committed on the review step (provision steps POST against
  // its id), so review sits after sources and before provisioning.
  const review: WizardStepMeta = {
    id: "review",
    title: "Review & Create",
    subtitle: "Confirm and create the project",
    icon: ListChecks,
    gradient: DEFAULT_GRADIENT,
    kind: "review",
  };
  const complete: WizardStepMeta = {
    id: "complete",
    title: "Done",
    subtitle: "Your project is ready",
    icon: Rocket,
    gradient: "from-emerald-600 via-green-600 to-teal-600",
    kind: "complete",
  };
  return [create, ...sourceSteps, review, ...provisionSteps, complete];
}

interface StepRunState {
  phase: "idle" | "calling" | "done" | "failed";
  statusMessage?: string;
  mockRef?: string;
  error?: string;
}

export function ProjectOnboardingWizard({
  onComplete,
  initialOpen = false,
}: {
  onComplete?: (project: ProjectDocument) => void;
  initialOpen?: boolean;
}) {
  const [open, setOpen] = useState(initialOpen);
  const [configSteps, setConfigSteps] = useState<OnboardingStepConfig[]>([]);
  const [phaseIndex, setPhaseIndex] = useState(0);
  const [projectName, setProjectName] = useState("");
  const [description, setDescription] = useState("");
  const [teamId, setTeamId] = useState("");
  const [initiativesRaw, setInitiativesRaw] = useState("");
  const [swimlanesRaw, setSwimlanesRaw] = useState("");
  // User-shared data sources (collected by the configured `source` steps;
  // forwarded to connected external apps on onboarding).
  const [githubReposRaw, setGithubReposRaw] = useState("");
  const [confluenceUrl, setConfluenceUrl] = useState("");
  // "Look up from Backstage" — pre-fill the create form from an existing System.
  type BackstageResult = {
    slug: string;
    title: string;
    description: string;
    tags: string[];
    repos: string[];
  };
  const [bsConfigured, setBsConfigured] = useState(false);
  const [bsOpen, setBsOpen] = useState(false);
  const [bsQuery, setBsQuery] = useState("");
  const [bsResults, setBsResults] = useState<BackstageResult[]>([]);
  const [bsLoading, setBsLoading] = useState(false);
  const bsTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Existing label values (for dropdown suggestions on BHAG / Swim Lane).
  const [labelFacets, setLabelFacets] = useState<{ initiatives: string[]; swimlanes: string[] }>({
    initiatives: [],
    swimlanes: [],
  });
  const [teams, setTeams] = useState<TeamPickerOption[]>([]);
  const [project, setProject] = useState<ProjectDocument | null>(null);
  const [provisioning, setProvisioning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [stepRuns, setStepRuns] = useState<Record<string, StepRunState>>({});
  const stepRunLock = useRef<string | null>(null);

  const wizardSteps = useMemo(() => buildWizardSteps(configSteps), [configSteps]);
  const phase = wizardSteps[phaseIndex] ?? wizardSteps[0];
  const completeIndex = wizardSteps.length - 1;
  const sourceStepCount = useMemo(
    () => wizardSteps.filter((s) => s.kind === "source").length,
    [wizardSteps],
  );
  const hasProvisionSteps = useMemo(
    () => wizardSteps.some((s) => s.kind === "provision"),
    [wizardSteps],
  );
  // Layout: create=0, source steps occupy 1..sourceStepCount, then the review
  // step (where the project is committed), then provision steps, then complete.
  const reviewIndex = 1 + sourceStepCount;
  const firstProvisionIndex = reviewIndex + 1;
  const isSourcePhase = phase.kind === "source";
  const isReviewPhase = phase.kind === "review";
  const isProvisionPhase = phase.kind === "provision";
  const currentStepRun = isProvisionPhase ? stepRuns[phase.id] : undefined;
  const currentStepDone =
    project?.onboarding?.[phase.id]?.status === "completed" ||
    currentStepRun?.phase === "done";
  const currentStepFailed =
    project?.onboarding?.[phase.id]?.status === "failed" ||
    currentStepRun?.phase === "failed";

  // Backstage lookup: debounced search of existing Systems.
  const lookupBackstage = useCallback((q: string) => {
    if (bsTimer.current) clearTimeout(bsTimer.current);
    setBsLoading(true);
    bsTimer.current = setTimeout(() => {
      fetch(`/api/projects/backstage/lookup?q=${encodeURIComponent(q)}`)
        .then((r) => (r.ok ? r.json() : null))
        .then((b) => {
          const d = b?.data ?? b;
          setBsConfigured(Boolean(d?.configured));
          setBsResults(Array.isArray(d?.results) ? d.results : []);
        })
        .catch(() => setBsResults([]))
        .finally(() => setBsLoading(false));
    }, 300);
  }, []);

  // Apply a chosen Backstage System to the create form. Picking a system always
  // overwrites the prefilled fields so the user can switch selections and the
  // form reflects the latest pick (fields stay hand-editable afterwards).
  const applyBackstageResult = useCallback((r: BackstageResult) => {
    setProjectName(r.title);
    setDescription(r.description);
    setInitiativesRaw(r.tags.join(", "));
    setGithubReposRaw(r.repos.join(", "));
    setBsOpen(false);
  }, []);

  useEffect(() => {
    if (!open) return;
    // Probe whether Backstage lookup is available (shows the button if so).
    fetch("/api/projects/backstage/lookup")
      .then((r) => (r.ok ? r.json() : null))
      .then((b) => setBsConfigured(Boolean((b?.data ?? b)?.configured)))
      .catch(() => undefined);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    fetch("/api/projects/onboarding-config")
      .then((res) => res.json())
      .then((body) => {
        setConfigSteps((body.data?.config?.steps ?? []) as OnboardingStepConfig[]);
      })
      .catch(() => setConfigSteps([]));

    // Existing label values → datalist suggestions for BHAG / Swim Lane.
    fetch("/api/projects/facets")
      .then((res) => (res.ok ? res.json() : null))
      .then((body) => {
        const f = body?.data?.facets ?? body?.data ?? body;
        const vals = (arr: unknown): string[] =>
          Array.isArray(arr)
            ? arr
                .map((x) => (typeof x === "string" ? x : (x?.value ?? x?.label)))
                .filter((v): v is string => typeof v === "string" && v.length > 0)
            : [];
        if (f) {
          setLabelFacets({
            initiatives: vals(f.initiatives),
            swimlanes: vals(f.swimlanes),
          });
        }
      })
      .catch(() => undefined);

    fetch("/api/dynamic-agents/teams")
      .then((res) => res.json())
      .then((data) => {
        const list = (data.data ?? data.teams ?? []) as Array<{
          _id: string;
          name: string;
          slug?: string;
        }>;
        setTeams(
          list.map((t) => ({
            slug: t.slug ?? t._id,
            name: t.name,
            id: t._id,
            _id: t._id,
          })),
        );
      })
      .catch(() => setTeams([]));
  }, [open]);

  const reset = useCallback(() => {
    setPhaseIndex(0);
    setProjectName("");
    setDescription("");
    setTeamId("");
    setInitiativesRaw("");
    setSwimlanesRaw("");
    setProject(null);
    setProvisioning(false);
    setError(null);
    setStepRuns({});
    stepRunLock.current = null;
  }, []);

  const close = useCallback(() => {
    setOpen(false);
    reset();
  }, [reset]);

  const runSingleStep = useCallback(
    async (stepId: string) => {
      if (!project?._id) return;
      const existing = project.onboarding?.[stepId]?.status;
      if (existing === "completed" || stepRunLock.current === stepId) {
        return;
      }

      stepRunLock.current = stepId;
      setError(null);
      setProvisioning(true);
      setStepRuns((prev) => ({
        ...prev,
        [stepId]: { phase: "calling" },
      }));

      try {
        const res = await fetch("/api/projects/onboard", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ project_id: project._id, steps: [stepId] }),
        });
        const body = await res.json();
        if (!res.ok) {
          throw new Error(body.error ?? body.message ?? "Onboarding failed");
        }

        const updated = body.data?.project as ProjectDocument;
        const result = (
          body.data?.results as Array<{
            step: string;
            status: string;
            mock_ref?: string;
            status_message?: string;
            error?: string;
          }>
        )?.find((entry) => entry.step === stepId);

        if (updated) {
          setProject(updated);
        }

        if (result?.status === "failed") {
          setStepRuns((prev) => ({
            ...prev,
            [stepId]: {
              phase: "failed",
              error: result.error ?? "Provisioning failed",
            },
          }));
          return;
        }

        setStepRuns((prev) => ({
          ...prev,
          [stepId]: {
            phase: "done",
            statusMessage: result?.status_message ?? "Provisioned successfully",
            mockRef: result?.mock_ref,
          },
        }));
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        setError(message);
        setStepRuns((prev) => ({
          ...prev,
          [stepId]: { phase: "failed", error: message },
        }));
      } finally {
        stepRunLock.current = null;
        setProvisioning(false);
      }
    },
    [project],
  );

  useEffect(() => {
    if (!open || !project?._id || !isProvisionPhase || provisioning) return;
    const stepStatus = project.onboarding?.[phase.id]?.status;
    if (stepStatus === "completed" || stepStatus === "failed") return;
    const runState = stepRuns[phase.id]?.phase;
    if (runState === "calling" || runState === "done") return;
    void runSingleStep(phase.id);
  }, [
    open,
    project?._id,
    project?.onboarding,
    phase.id,
    isProvisionPhase,
    provisioning,
    stepRuns,
    runSingleStep,
  ]);

  async function createProject() {
    setError(null);
    setProvisioning(true);
    try {
      const res = await fetch("/api/projects", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: projectName.trim(),
          description: description.trim() || undefined,
          team_id: teamId,
          initiatives: initiativesRaw.split(",").map((s) => s.trim()).filter(Boolean),
          swimlanes: swimlanesRaw.split(",").map((s) => s.trim()).filter(Boolean),
          github_repos: githubReposRaw.split(/[\n,]/).map((s) => s.trim()).filter(Boolean),
          confluence_url: confluenceUrl.trim() || undefined,
        }),
      });
      const body = await res.json();
      if (!res.ok || !body.data?.project) {
        throw new Error(body.error ?? body.message ?? "Failed to create project");
      }
      const created = body.data.project as ProjectDocument;
      setProject(created);
      if (hasProvisionSteps) {
        setPhaseIndex(firstProvisionIndex);
      } else {
        setPhaseIndex(completeIndex);
        onComplete?.(created);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setProvisioning(false);
    }
  }

  function advanceFromCurrentStep() {
    if (phaseIndex >= completeIndex) return;
    const nextIndex = phaseIndex + 1;
    setPhaseIndex(nextIndex);
    if (nextIndex === completeIndex && project) {
      onComplete?.(project);
    }
  }

  async function handlePrimaryAction() {
    // Create + source steps just advance toward the review step — nothing is
    // committed yet.
    if (phase.kind === "create" || phase.kind === "source") {
      advanceFromCurrentStep();
      return;
    }
    // Review is the commit: this is the only place the project is POSTed.
    if (isReviewPhase) {
      await createProject();
      return;
    }
    if (isProvisionPhase && currentStepFailed) {
      void runSingleStep(phase.id);
      return;
    }
    if (isProvisionPhase && currentStepDone) {
      advanceFromCurrentStep();
      return;
    }
    if (phase.id === "complete") {
      close();
    }
  }

  const isPreCreate = phase.kind === "create" || phase.kind === "source";

  const primaryLabel = isPreCreate
    ? "Continue"
    : isReviewPhase
      ? provisioning
        ? "Creating…"
        : "Create project"
      : isProvisionPhase
        ? provisioning || currentStepRun?.phase === "calling"
          ? "Provisioning…"
          : currentStepFailed
            ? "Retry"
            : currentStepDone
              ? phaseIndex === completeIndex - 1
                ? "Finish"
                : "Continue"
              : "Provision"
        : phase.id === "complete"
          ? "Close"
          : "";

  const showPrimary =
    isPreCreate || isReviewPhase || isProvisionPhase || phase.id === "complete";

  const primaryDisabled =
    provisioning ||
    // Name + team are required; enforce on the create step and again at the
    // review/commit step as a guard.
    ((phase.kind === "create" || isReviewPhase) &&
      (!projectName.trim() || !teamId)) ||
    (isProvisionPhase &&
      !currentStepDone &&
      !currentStepFailed &&
      (currentStepRun?.phase === "calling" || provisioning));

  const stepSummary =
    configSteps.length > 0
      ? configSteps.map((step) => step.title).join(" · ")
      : "Create project and finish";

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="group relative overflow-hidden rounded-2xl border border-primary/20 bg-gradient-to-br from-violet-600/20 via-indigo-600/10 to-blue-600/20 px-8 py-5 text-left shadow-lg transition hover:scale-[1.01] hover:shadow-xl"
      >
        <div className="relative flex items-center gap-4">
          <div className="flex h-14 w-14 items-center justify-center rounded-xl bg-gradient-to-br from-violet-600 to-indigo-600 text-white shadow-lg">
            <Rocket className="h-7 w-7" />
          </div>
          <div>
            <p className="text-lg font-semibold text-foreground">
              Launch project onboarding
            </p>
            <p className="text-sm text-muted-foreground">{stepSummary}</p>
          </div>
        </div>
      </button>
    );
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm">
      <motion.div
        initial={{ opacity: 0, scale: 0.96, y: 12 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        className="relative flex max-h-[90vh] w-full max-w-5xl flex-col overflow-hidden rounded-3xl border border-white/10 bg-background shadow-2xl"
      >
        <div
          className={cn(
            "relative overflow-hidden px-8 pt-10 pb-14 text-white",
            "bg-gradient-to-br",
            phase.gradient,
          )}
        >
          <div className="relative flex items-start justify-between gap-4">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.2em] text-white/70">
                Project Onboarding · Step {phaseIndex + 1} of {wizardSteps.length}
              </p>
              <h2 className="mt-2 text-3xl font-bold tracking-tight">{phase.title}</h2>
              <p className="mt-2 max-w-xl text-sm text-white/85">{phase.subtitle}</p>
            </div>
            <button
              type="button"
              onClick={close}
              className="rounded-full border border-white/20 px-3 py-1 text-xs text-white/80 transition hover:bg-white/10"
            >
              Close
            </button>
          </div>

          <div className="relative mt-6 flex gap-2 overflow-x-auto pb-2">
            {wizardSteps.map((step, index) => {
              const Icon = step.icon;
              const done = index < phaseIndex;
              const active = index === phaseIndex;
              return (
                <div
                  key={step.id}
                  className={cn(
                    "flex min-w-[4.5rem] flex-col items-center gap-1.5 rounded-lg px-2 py-2 transition",
                    active && "bg-white/15",
                    done && "opacity-90",
                    !active && !done && "opacity-40",
                  )}
                >
                  <div
                    className={cn(
                      "flex h-9 w-9 items-center justify-center rounded-full border",
                      done
                        ? "border-emerald-300 bg-emerald-500/30"
                        : active
                          ? "border-white bg-white/20"
                          : "border-white/30",
                    )}
                  >
                    {done ? (
                      <CheckCircle2 className="h-4 w-4 text-emerald-100" />
                    ) : (
                      <Icon className="h-4 w-4" />
                    )}
                  </div>
                  <span className="w-20 text-[10px] font-medium text-center leading-tight text-white/80">
                    {step.title}
                  </span>
                </div>
              );
            })}
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-8">
          <AnimatePresence mode="wait">
            <motion.div
              key={phase.id}
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -20 }}
              transition={{ duration: 0.25 }}
            >
              {phase.id === "create" ? (
                <div className="grid gap-6 md:grid-cols-2">
                  {bsConfigured ? (
                    <div className="md:col-span-2">
                      <button
                        type="button"
                        onClick={() => {
                          const next = !bsOpen;
                          setBsOpen(next);
                          if (next) lookupBackstage("");
                        }}
                        className="inline-flex items-center gap-2 rounded-xl border border-border/60 bg-muted/30 px-4 py-2.5 text-sm font-medium transition hover:border-primary/40 hover:bg-accent/40"
                      >
                        <FolderKanban className="h-4 w-4 text-muted-foreground" />
                        Pick from Backstage
                        <ChevronDown className={cn("h-4 w-4 text-muted-foreground transition-transform", bsOpen && "rotate-180")} />
                      </button>
                      {bsOpen ? (
                        <div className="mt-3 rounded-xl border border-border/60 bg-card/40 p-3">
                          <p className="px-1 pb-2 text-xs text-muted-foreground">
                            Select a Backstage system to pre-fill this project — name, description,
                            initiatives, and repos (all still editable).
                          </p>
                          {/* Optional filter over the listed systems. */}
                          <div className="relative">
                            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                            <input
                              value={bsQuery}
                              autoFocus
                              onChange={(e) => {
                                setBsQuery(e.target.value);
                                lookupBackstage(e.target.value);
                              }}
                              placeholder="Filter systems…"
                              className="w-full rounded-lg border border-border/60 bg-muted/30 py-2 pl-9 pr-3 text-sm outline-none ring-primary/30 focus:border-primary focus:ring-2"
                            />
                          </div>
                          <ul className="mt-2 max-h-56 divide-y divide-border/60 overflow-y-auto rounded-lg border border-border/60">
                            {bsLoading && bsResults.length === 0 ? (
                              <li className="flex items-center gap-2 px-3 py-3 text-xs text-muted-foreground">
                                <Loader2 className="h-4 w-4 animate-spin" />
                                Loading Backstage systems…
                              </li>
                            ) : bsResults.length === 0 ? (
                              <li className="px-3 py-3 text-xs text-muted-foreground">
                                No Backstage systems found. Check BACKSTAGE_URL and BACKSTAGE_API_TOKEN.
                              </li>
                            ) : (
                              bsResults.map((r) => (
                                <li key={r.slug}>
                                  <button
                                    type="button"
                                    onClick={() => applyBackstageResult(r)}
                                    className="block w-full px-3 py-2.5 text-left transition hover:bg-accent/50"
                                  >
                                    <span className="flex items-center gap-2">
                                      <span className="text-sm font-medium text-foreground">{r.title}</span>
                                      <span className="text-xs text-muted-foreground">{r.slug}</span>
                                    </span>
                                    {r.description ? (
                                      <span className="mt-0.5 line-clamp-2 block text-xs text-muted-foreground">
                                        {r.description}
                                      </span>
                                    ) : null}
                                  </button>
                                </li>
                              ))
                            )}
                          </ul>
                        </div>
                      ) : null}
                    </div>
                  ) : null}
                  <div className="space-y-4">
                    <label className="block space-y-1.5">
                      <span className="text-sm font-medium">Project name</span>
                      <input
                        value={projectName}
                        onChange={(e) => setProjectName(e.target.value)}
                        placeholder="My Platform Initiative"
                        className="w-full rounded-xl border border-border/60 bg-muted/30 px-4 py-3 text-sm outline-none ring-primary/30 focus:border-primary focus:ring-2"
                      />
                    </label>
                    <label className="block space-y-1.5">
                      <span className="text-sm font-medium">Description</span>
                      <textarea
                        value={description}
                        onChange={(e) => setDescription(e.target.value)}
                        rows={3}
                        placeholder="What is this project building?"
                        className="w-full rounded-xl border border-border/60 bg-muted/30 px-4 py-3 text-sm outline-none ring-primary/30 focus:border-primary focus:ring-2"
                      />
                    </label>
                  </div>
                  <div className="space-y-4">
                    <label className="block space-y-1.5">
                      <span className="text-sm font-medium">BHAG / Initiatives</span>
                      <ComboBox
                        ariaLabel="BHAG / Initiatives"
                        value={initiativesRaw}
                        onChange={setInitiativesRaw}
                        options={labelFacets.initiatives.map((v) => ({ value: v, label: v }))}
                        placeholder="Agentic-2026, Platform Modernization"
                        multi
                      />
                      <span className="text-xs text-muted-foreground">Pick existing or type a new one (comma-separated).</span>
                    </label>
                    <label className="block space-y-1.5">
                      <span className="text-sm font-medium">Swim Lanes</span>
                      <ComboBox
                        ariaLabel="Swim Lanes"
                        value={swimlanesRaw}
                        onChange={setSwimlanesRaw}
                        options={labelFacets.swimlanes.map((v) => ({ value: v, label: v }))}
                        placeholder="Now, Next, Later"
                        multi
                      />
                      <span className="text-xs text-muted-foreground">Pick existing or type a new one (comma-separated).</span>
                    </label>
                    {/* Sources are strictly YAML-driven: they live in their own
                        `source` wizard steps when the onboarding config defines
                        them, and are not collected on the create step. */}
                    <div className="rounded-xl border border-dashed border-primary/30 bg-primary/5 p-4 text-xs text-muted-foreground">
                      Projects belong to teams and can sync to Backstage as{" "}
                      <code className="text-primary">kind: System</code>. Labels (Domain ·
                      BHAG · Swim Lane) power the executive dashboard.
                    </div>
                  </div>
                  {/* Team gets its own full-width row — it's required. */}
                  <div className="space-y-1.5 md:col-span-2">
                    <span className="text-sm font-medium">Team</span>
                    <TeamPicker
                      options={teams}
                      value={teamId}
                      onChange={setTeamId}
                      placeholder="Select owning team"
                      hideSlugSuffix
                    />
                    {teams.length === 0 && (
                      <span className="text-xs text-muted-foreground">
                        No teams available — ask an admin to add you to one (a
                        project must belong to a team).
                      </span>
                    )}
                  </div>
                </div>
              ) : null}

              {isSourcePhase ? (
                <div className="space-y-3">
                  <SourcePicker
                    source={phase.source}
                    selected={
                      phase.source === "github"
                        ? githubReposRaw
                            .split(/[\n,]/)
                            .map((s) => s.trim())
                            .filter(Boolean)
                        : phase.source === "confluence"
                          ? confluenceUrl.trim()
                            ? [confluenceUrl.trim()]
                            : []
                          : []
                    }
                    onChange={(next) => {
                      if (phase.source === "github")
                        setGithubReposRaw(next.join(", "));
                      else if (phase.source === "confluence")
                        setConfluenceUrl(next[0] ?? "");
                    }}
                  />
                </div>
              ) : null}

              {isReviewPhase
                ? (() => {
                    const repos = githubReposRaw
                      .split(/[\n,]/)
                      .map((s) => s.trim())
                      .filter(Boolean);
                    const initiatives = initiativesRaw
                      .split(",")
                      .map((s) => s.trim())
                      .filter(Boolean);
                    const swimlanes = swimlanesRaw
                      .split(",")
                      .map((s) => s.trim())
                      .filter(Boolean);
                    const team = teams.find(
                      (t) =>
                        t.id === teamId || t._id === teamId || t.slug === teamId,
                    );
                    const teamLabel = team?.name?.trim() || team?.slug || teamId;
                    const Row = ({
                      label,
                      children,
                    }: {
                      label: string;
                      children: ReactNode;
                    }) => (
                      <div className="grid grid-cols-[8rem_1fr] gap-3 px-4 py-3 text-sm">
                        <span className="text-muted-foreground">{label}</span>
                        <span className="min-w-0 break-words">{children}</span>
                      </div>
                    );
                    const muted = (
                      <span className="text-muted-foreground">—</span>
                    );
                    return (
                      <div className="space-y-4">
                        <p className="text-sm text-muted-foreground">
                          Nothing has been created yet. Confirm the details below
                          — clicking <span className="font-medium">Create project</span>{" "}
                          commits it
                          {hasProvisionSteps ? " and starts onboarding." : "."}
                        </p>
                        <div className="divide-y divide-border/50 rounded-xl border border-border/60 bg-muted/10">
                          <Row label="Project">
                            <span className="font-medium">
                              {projectName.trim() || muted}
                            </span>
                          </Row>
                          <Row label="Team">{teamLabel || muted}</Row>
                          {description.trim() ? (
                            <Row label="Description">{description.trim()}</Row>
                          ) : null}
                          <Row label="GitHub repos">
                            {repos.length ? (
                              <span className="flex flex-wrap gap-1.5">
                                {repos.map((r) => (
                                  <span
                                    key={r}
                                    className="rounded-md bg-muted px-2 py-0.5 text-xs"
                                  >
                                    {r.replace(/^https?:\/\/github\.com\//i, "")}
                                  </span>
                                ))}
                              </span>
                            ) : (
                              muted
                            )}
                          </Row>
                          <Row label="Confluence">
                            {confluenceUrl.trim() || muted}
                          </Row>
                          {initiatives.length ? (
                            <Row label="BHAG / Initiatives">
                              {initiatives.join(", ")}
                            </Row>
                          ) : null}
                          {swimlanes.length ? (
                            <Row label="Swim Lanes">{swimlanes.join(", ")}</Row>
                          ) : null}
                        </div>
                      </div>
                    );
                  })()
                : null}

              {isProvisionPhase ? (
                <ProvisioningCard
                  title={phase.title}
                  runState={currentStepRun}
                  done={currentStepDone}
                  failed={currentStepFailed}
                  integrationUrl={project?.integrations?.[`${phase.id}_url`]}
                />
              ) : null}

              {phase.id === "complete" ? (
                <div className="space-y-6 text-center">
                  <div className="mx-auto flex h-20 w-20 items-center justify-center rounded-full bg-emerald-500/15 text-emerald-600">
                    <CheckCircle2 className="h-10 w-10" />
                  </div>
                  <div>
                    <h3 className="text-xl font-semibold">Project ready</h3>
                    <p className="mt-2 text-muted-foreground">
                      {hasProvisionSteps
                        ? "Configured onboarding steps completed."
                        : "Your project was created. Add onboarding steps via configuration when needed."}
                    </p>
                  </div>
                  {project ? (
                    <div className="mx-auto max-w-md rounded-xl border border-border/50 bg-muted/20 p-4 text-left text-sm">
                      <p className="font-medium">{project.title}</p>
                      <p className="text-muted-foreground">{project.team_name}</p>
                      <Link
                        href={`/projects/${project.slug}`}
                        className="mt-2 inline-block text-primary hover:underline"
                      >
                        Open project →
                      </Link>
                    </div>
                  ) : null}
                </div>
              ) : null}
            </motion.div>
          </AnimatePresence>

          {error ? (
            <p className="mt-4 rounded-lg border border-red-300 bg-red-50 px-4 py-2 text-sm text-red-700">
              {error}
            </p>
          ) : null}
        </div>

        <div className="flex items-center justify-end border-t border-border/50 px-8 py-5">
          <div className="flex gap-3">
            {phase.id === "complete" && project ? (
              <Link
                href={`/projects/${project.slug}`}
                onClick={close}
                className="inline-flex items-center gap-2 rounded-xl bg-primary px-5 py-2.5 text-sm font-medium text-primary-foreground shadow"
              >
                View project
              </Link>
            ) : null}
            {showPrimary && phase.id !== "complete" ? (
              <button
                type="button"
                disabled={primaryDisabled}
                onClick={() => void handlePrimaryAction()}
                className="inline-flex items-center gap-2 rounded-xl bg-primary px-5 py-2.5 text-sm font-medium text-primary-foreground shadow transition hover:opacity-90 disabled:opacity-50"
              >
                {(provisioning || currentStepRun?.phase === "calling") ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : null}
                {primaryLabel}
              </button>
            ) : null}
            {phase.id === "complete" ? (
              <button
                type="button"
                onClick={close}
                className="rounded-xl border border-border px-5 py-2.5 text-sm"
              >
                Close
              </button>
            ) : null}
          </div>
        </div>
      </motion.div>
    </div>
  );
}

function ProvisioningCard({
  title,
  runState,
  done,
  failed,
  integrationUrl,
}: {
  title: string;
  runState?: StepRunState;
  done: boolean;
  failed: boolean;
  integrationUrl?: string;
}) {
  return (
    <div className="flex min-h-[180px] flex-col items-center justify-center gap-3 rounded-2xl border border-border/50 bg-gradient-to-br from-muted/40 to-muted/10 p-8 text-center">
      {failed ? (
        <>
          <p className="font-semibold text-red-600">Provisioning failed</p>
          <p className="text-sm text-muted-foreground">{runState?.error ?? "Unknown error"}</p>
        </>
      ) : done ? (
        <>
          <CheckCircle2 className="h-8 w-8 text-emerald-500" />
          <p className="font-semibold text-emerald-600">{title} provisioned</p>
          <p className="text-sm text-muted-foreground">
            {runState?.statusMessage ?? "Completed successfully"}
          </p>
          {integrationUrl ? (
            <p className="break-all text-xs text-primary">{integrationUrl}</p>
          ) : null}
        </>
      ) : (
        <>
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
          <p className="text-sm font-medium">Provisioning {title}…</p>
          <p className="text-xs text-muted-foreground">This can take a few seconds.</p>
        </>
      )}
    </div>
  );
}

/** Replace the active token (last comma/newline segment) for multi-value fields. */
function applyComboSelection(current: string, selected: string, multi: boolean): string {
  if (!multi) return selected;
  const lastDelim = Math.max(current.lastIndexOf(","), current.lastIndexOf("\n"));
  const head = lastDelim >= 0 ? current.slice(0, lastDelim + 1) : "";
  return `${head ? head.trimEnd() + " " : ""}${selected}, `;
}

/**
 * Styled, scrollable combobox: a text input with a filtered dropdown of
 * suggestions that stays inside the dialog (unlike the native <datalist>).
 * Free-text is always allowed; `multi` appends comma-separated selections.
 */
function ComboBox({
  value,
  onChange,
  options,
  placeholder,
  multi = false,
  onType,
  ariaLabel,
}: {
  value: string;
  onChange: (v: string) => void;
  options: { value: string; label: string }[];
  placeholder?: string;
  multi?: boolean;
  onType?: (v: string) => void;
  ariaLabel?: string;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);

  const lastToken = (multi ? (value.split(/[\n,]/).pop() ?? "") : value).trim().toLowerCase();
  const filtered = options
    .filter(
      (o) =>
        !lastToken ||
        o.label.toLowerCase().includes(lastToken) ||
        o.value.toLowerCase().includes(lastToken),
    )
    .slice(0, 50);

  return (
    <div ref={ref} className="relative">
      <input
        aria-label={ariaLabel}
        value={value}
        placeholder={placeholder}
        onChange={(e) => {
          onChange(e.target.value);
          onType?.(e.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        className="w-full rounded-xl border border-border/60 bg-muted/30 px-4 py-2.5 text-sm outline-none ring-primary/30 focus:border-primary focus:ring-2"
      />
      {open && filtered.length > 0 ? (
        <div className="absolute left-0 right-0 z-50 mt-1 max-h-56 overflow-auto rounded-xl border border-border/60 bg-card shadow-xl">
          {filtered.map((o) => (
            <button
              type="button"
              key={o.value}
              onMouseDown={(e) => {
                e.preventDefault();
                onChange(applyComboSelection(value, o.value, multi));
                onType?.("");
                setOpen(false);
              }}
              className="block w-full px-3 py-2 text-left transition hover:bg-accent/60"
            >
              <span className="block truncate text-sm">{o.label}</span>
              {o.label !== o.value ? (
                <span className="block truncate text-xs text-muted-foreground">{o.value}</span>
              ) : null}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

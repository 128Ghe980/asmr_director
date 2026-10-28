import type { AsmrProject, SpeechWorkspaceMode } from "./schema";
import { ensureSpeechWorkspaces, getSpeechWorkspaceMode } from "./speech-workspace";
import {
  PlannerSourceSchema,
  compilePlannerDraft,
  type PlannerBrief,
  type PlannerDraft,
  type PlannerSource,
} from "./planner";
import {
  PROJECT_STORAGE_KEY,
  type StorageLike,
  parseImportedProject,
  serializeProject,
} from "./project-persistence";
import { safeParseAsmrProject } from "./validate";
import { effectiveStoryboardStyle } from "./storyboard-style";

export const PROJECT_LIBRARY_STORAGE_KEY =
  "ai-asmr-studio:v1:project-library";
export const MAX_PROJECT_REVISIONS = 12;

export type ProjectRevision = {
  revisionId: string;
  createdAt: string;
  label: string;
  project: AsmrProject;
  plannerSource?: PlannerSource;
};

export type AudioCandidateAcceptance = {
  version: 1;
  candidateId: string;
  clipId: string;
  adoptedAt: string;
  beforeProject: AsmrProject;
  beforePlannerSource?: PlannerSource;
  afterFingerprint: string;
  workspaceMode?: SpeechWorkspaceMode;
};

export type ProjectLibraryEntry = {
  projectId: string;
  title: string;
  updatedAt: string;
  project: AsmrProject;
  revisions: ProjectRevision[];
  mixFingerprint?: string;
  plannerSource?: PlannerSource;
  candidateAcceptance?: AudioCandidateAcceptance;
  candidateAcceptances?: Partial<Record<SpeechWorkspaceMode, AudioCandidateAcceptance>>;
};

export type ProjectLibrary = {
  version: 1;
  currentProjectId: string;
  projects: ProjectLibraryEntry[];
};

export type ProjectLibrarySummary = Pick<
  ProjectLibraryEntry,
  "projectId" | "title" | "updatedAt"
> & {
  revisionCount: number;
};

function cloneProject(project: AsmrProject): AsmrProject {
  const cloned = parseImportedProject(serializeProject(project));

  if (!cloned.success) {
    throw new Error("Project could not be cloned.");
  }

  return cloned.project;
}

function compactTimestamp(now: Date): string {
  return now
    .toISOString()
    .replace(/[-:]/g, "")
    .replace("T", "_")
    .slice(0, 15);
}

function makeUniqueId(base: string, usedIds: Set<string>): string {
  if (!usedIds.has(base)) {
    return base;
  }

  let suffix = 2;

  while (usedIds.has(`${base}_${suffix}`)) {
    suffix += 1;
  }

  return `${base}_${suffix}`;
}

function makeEntry(
  project: AsmrProject,
  now: Date,
  revisions: ProjectRevision[] = [],
  mixFingerprint?: string,
  plannerSource?: PlannerSource,
  candidateAcceptance?: AudioCandidateAcceptance,
  candidateAcceptances?: Partial<Record<SpeechWorkspaceMode, AudioCandidateAcceptance>>,
): ProjectLibraryEntry {
  const cloned = cloneProject(project);
  const acceptanceRecords = cloned.speechWorkspace && candidateAcceptance
    ? { [candidateAcceptance.workspaceMode ?? "short"]: candidateAcceptance, ...candidateAcceptances }
    : candidateAcceptances;

  return {
    projectId: cloned.project_id,
    title: cloned.title,
    updatedAt: now.toISOString(),
    project: cloned,
    revisions,
    mixFingerprint: cloned.speechWorkspace ? cloned.speechWorkspace[cloned.speechWorkspace.activeMode].mixFingerprint : mixFingerprint,
    plannerSource: plannerSource ? PlannerSourceSchema.parse(plannerSource) : undefined,
    candidateAcceptance: cloned.speechWorkspace ? acceptanceRecords?.[getSpeechWorkspaceMode(cloned)]
      ?? (candidateAcceptance && (candidateAcceptance.workspaceMode ?? "short") === getSpeechWorkspaceMode(cloned) ? candidateAcceptance : undefined) : candidateAcceptance,
    ...(acceptanceRecords ? { candidateAcceptances: acceptanceRecords } : {}),
  };
}

function parseCandidateAcceptance(input: unknown, projectId: string): AudioCandidateAcceptance | undefined {
  if (!input || typeof input !== "object") return undefined;
  const candidate = input as Partial<AudioCandidateAcceptance>;
  const project = safeParseAsmrProject(candidate.beforeProject);
  if (
    candidate.version !== 1 || !project.success || project.data.project_id !== projectId ||
    typeof candidate.candidateId !== "string" || !/^[A-Za-z0-9_-]+$/.test(candidate.candidateId) ||
    typeof candidate.clipId !== "string" || !candidate.clipId ||
    typeof candidate.adoptedAt !== "string" || Number.isNaN(Date.parse(candidate.adoptedAt)) ||
    typeof candidate.afterFingerprint !== "string" || !candidate.afterFingerprint ||
    !project.data.timeline.tracks.some((track) => track.track_type === "voice" && track.clips.some((clip) => clip.id === candidate.clipId))
  ) return undefined;
  const source = PlannerSourceSchema.safeParse(candidate.beforePlannerSource);
  if (candidate.beforePlannerSource !== undefined && !source.success) return undefined;
  return {
    version: 1, candidateId: candidate.candidateId, clipId: candidate.clipId,
    adoptedAt: candidate.adoptedAt, beforeProject: project.data,
    beforePlannerSource: source.data, afterFingerprint: candidate.afterFingerprint,
    ...(candidate.workspaceMode === "short" || candidate.workspaceMode === "paragraph" ? { workspaceMode: candidate.workspaceMode } : {}),
  };
}

export function createInitialProjectLibrary(
  project: AsmrProject,
  now: Date = new Date(),
): ProjectLibrary {
  return {
    version: 1,
    currentProjectId: project.project_id,
    projects: [makeEntry(project, now)],
  };
}

function parseRevision(
  input: unknown,
  parentProjectId: string,
): ProjectRevision | undefined {
  if (!input || typeof input !== "object") {
    return undefined;
  }

  const candidate = input as Partial<ProjectRevision>;
  const project = safeParseAsmrProject(candidate.project);

  if (
    !project.success ||
    project.data.project_id !== parentProjectId ||
    typeof candidate.revisionId !== "string" ||
    typeof candidate.createdAt !== "string" ||
    typeof candidate.label !== "string"
  ) {
    return undefined;
  }

  return {
    revisionId: candidate.revisionId,
    createdAt: candidate.createdAt,
    label: candidate.label,
    project: project.data,
    plannerSource: PlannerSourceSchema.safeParse(candidate.plannerSource).data,
  };
}

function parseStoredLibrary(
  text: string,
  fallbackProject: AsmrProject,
  now: Date,
): ProjectLibrary {
  let raw: unknown;

  try {
    raw = JSON.parse(text);
  } catch {
    return createInitialProjectLibrary(fallbackProject, now);
  }

  if (!raw || typeof raw !== "object") {
    return createInitialProjectLibrary(fallbackProject, now);
  }

  const candidate = raw as {
    version?: unknown;
    currentProjectId?: unknown;
    projects?: unknown;
  };

  if (candidate.version !== 1 || !Array.isArray(candidate.projects)) {
    return createInitialProjectLibrary(fallbackProject, now);
  }

  const usedIds = new Set<string>();
  const projects: ProjectLibraryEntry[] = [];

  for (const rawEntry of candidate.projects) {
    if (!rawEntry || typeof rawEntry !== "object") {
      continue;
    }

    const entry = rawEntry as Partial<ProjectLibraryEntry>;
    const parsedProject = safeParseAsmrProject(entry.project);

    if (!parsedProject.success || usedIds.has(parsedProject.data.project_id)) {
      continue;
    }

    const revisions = Array.isArray(entry.revisions)
      ? entry.revisions
          .map((revision) =>
            parseRevision(revision, parsedProject.data.project_id),
          )
          .filter((revision): revision is ProjectRevision => Boolean(revision))
          .slice(-MAX_PROJECT_REVISIONS)
      : [];
    const parsedEntry = makeEntry(
      parsedProject.data,
      typeof entry.updatedAt === "string" ? new Date(entry.updatedAt) : now,
      revisions,
      typeof entry.mixFingerprint === "string"
        ? entry.mixFingerprint
        : undefined,
      PlannerSourceSchema.safeParse(entry.plannerSource).data,
      parseCandidateAcceptance(entry.candidateAcceptance, parsedProject.data.project_id),
      entry.candidateAcceptances && typeof entry.candidateAcceptances === "object" ? Object.fromEntries(
        (["short", "paragraph"] as const).flatMap((mode) => {
          const record = parseCandidateAcceptance((entry.candidateAcceptances as Partial<Record<SpeechWorkspaceMode, unknown>>)[mode], parsedProject.data.project_id);
          return record && (record.workspaceMode ?? "short") === mode ? [[mode, record]] : [];
        }),
      ) : undefined,
    );

    if (Number.isNaN(new Date(parsedEntry.updatedAt).getTime())) {
      parsedEntry.updatedAt = now.toISOString();
    }

    usedIds.add(parsedEntry.projectId);
    projects.push(parsedEntry);
  }

  if (projects.length === 0) {
    return createInitialProjectLibrary(fallbackProject, now);
  }

  const requestedId =
    typeof candidate.currentProjectId === "string"
      ? candidate.currentProjectId
      : undefined;

  return {
    version: 1,
    currentProjectId: projects.some((entry) => entry.projectId === requestedId)
      ? requestedId!
      : projects[0].projectId,
    projects,
  };
}

export function saveProjectLibrary(
  storage: StorageLike,
  library: ProjectLibrary,
) {
  storage.setItem(PROJECT_LIBRARY_STORAGE_KEY, JSON.stringify(library));
}

export function loadProjectLibrary(
  storage: StorageLike,
  fallbackProject: AsmrProject,
  now: Date = new Date(),
): ProjectLibrary {
  try {
    const storedLibrary = storage.getItem(PROJECT_LIBRARY_STORAGE_KEY);

    if (storedLibrary) {
      const library = parseStoredLibrary(storedLibrary, fallbackProject, now);
      saveProjectLibrary(storage, library);
      return library;
    }

    const legacyProject = storage.getItem(PROJECT_STORAGE_KEY);
    const imported = legacyProject
      ? parseImportedProject(legacyProject)
      : undefined;
    const library = createInitialProjectLibrary(
      imported?.success ? imported.project : fallbackProject,
      now,
    );

    saveProjectLibrary(storage, library);
    storage.removeItem(PROJECT_STORAGE_KEY);
    return library;
  } catch {
    return createInitialProjectLibrary(fallbackProject, now);
  }
}

export function getCurrentLibraryEntry(
  library: ProjectLibrary,
): ProjectLibraryEntry {
  return (
    library.projects.find(
      (entry) => entry.projectId === library.currentProjectId,
    ) ?? library.projects[0]
  );
}

export function getProjectLibrarySummaries(
  library: ProjectLibrary,
): ProjectLibrarySummary[] {
  return library.projects.map((entry) => ({
    projectId: entry.projectId,
    title: entry.title,
    updatedAt: entry.updatedAt,
    revisionCount: entry.revisions.length,
  }));
}

export function updateLibraryProject(
  library: ProjectLibrary,
  project: AsmrProject,
  now: Date = new Date(),
): ProjectLibrary {
  const existing = library.projects.find(
    (entry) => entry.projectId === project.project_id,
  );
  const nextEntry = makeEntry(
    project,
    now,
    existing?.revisions ?? [],
    existing?.mixFingerprint,
    existing?.plannerSource,
    existing?.candidateAcceptance,
    existing?.candidateAcceptances,
  );
  const projects = existing
    ? library.projects.map((entry) =>
        entry.projectId === project.project_id ? nextEntry : entry,
      )
    : [...library.projects, nextEntry];

  return {
    ...library,
    currentProjectId: project.project_id,
    projects,
  };
}

export function selectLibraryProject(
  library: ProjectLibrary,
  projectId: string,
): ProjectLibrary {
  if (!library.projects.some((entry) => entry.projectId === projectId)) {
    return library;
  }

  return { ...library, currentProjectId: projectId };
}

export function setLibraryProjectMixFingerprint(
  library: ProjectLibrary,
  projectId: string,
  mixFingerprint: string | undefined,
): ProjectLibrary {
  if (!library.projects.some((entry) => entry.projectId === projectId)) {
    return library;
  }

  return {
    ...library,
    projects: library.projects.map((entry) =>
      entry.projectId === projectId
        ? { ...entry, mixFingerprint, project: entry.project.speechWorkspace ? { ...entry.project, speechWorkspace: {
          ...entry.project.speechWorkspace, [entry.project.speechWorkspace.activeMode]: {
            ...entry.project.speechWorkspace[entry.project.speechWorkspace.activeMode], mixFingerprint,
          },
        } } : entry.project }
        : entry,
    ),
  };
}

export function replaceLibraryProject(
  library: ProjectLibrary,
  project: AsmrProject,
  now: Date = new Date(),
  safetyLabel = "替换前",
): ProjectLibrary {
  const existing = library.projects.find(
    (entry) => entry.projectId === project.project_id,
  );
  const protectedLibrary = existing
    ? createProjectRevision(
        library,
        existing.projectId,
        now,
        safetyLabel,
      )
    : library;
  const updated = updateLibraryProject(protectedLibrary, project, now);

  return {
    ...updated,
    projects: updated.projects.map((entry) =>
      entry.projectId === project.project_id
        ? { ...entry, mixFingerprint: undefined, plannerSource: undefined, candidateAcceptance: undefined, candidateAcceptances: undefined }
        : entry,
    ),
  };
}

function cleanTemplateProject(
  template: AsmrProject,
  projectId: string,
): AsmrProject {
  const cleaned = cloneProject({
    ...template,
    speechWorkspace: undefined,
    project_id: projectId,
    title: "未命名项目",
    status: "draft",
    timeline: {
      ...template.timeline,
      tracks: template.timeline.tracks.map((track) => ({
        ...track,
        clips: track.clips.map((clip) => ({
          ...clip,
          generation: {
            ...clip.generation,
            status: "asset_pending",
            retry_count: 0,
            error: null,
          },
          asset: { asset_id: null, uri: null, duration: null },
        })),
      })) as AsmrProject["timeline"]["tracks"],
    },
    exports: template.exports.map((entry) => ({
      ...entry,
      status: "not_started",
      uri: null,
    })),
  });
  return template.speechWorkspace ? ensureSpeechWorkspaces(cleaned) : cleaned;
}

export function createLibraryProject(
  library: ProjectLibrary,
  template: AsmrProject,
  now: Date = new Date(),
): ProjectLibrary {
  const usedIds = new Set(library.projects.map((entry) => entry.projectId));
  const projectId = makeUniqueId(`asmr_${compactTimestamp(now)}`, usedIds);

  return updateLibraryProject(
    library,
    cleanTemplateProject(template, projectId),
    now,
  );
}

export function adoptPlannerDraft(
  library: ProjectLibrary,
  brief: PlannerBrief,
  draft: PlannerDraft,
  now: Date = new Date(),
  storyboard?: import("./storyboard").PlannerStoryboard,
  sceneDescription?: string,
): ProjectLibrary {
  const source = PlannerSourceSchema.parse({ brief, draft, ...(storyboard ? { storyboard } : {}), ...(sceneDescription !== undefined ? { sceneDescription } : {}) });
  const usedIds = new Set(library.projects.map((entry) => entry.projectId));
  const projectId = makeUniqueId(`asmr_planner_${compactTimestamp(now)}`, usedIds);
  // Compile and validate everything before creating the safety revision. Failures
  // leave the caller's project and planning workspace untouched.
  const compiled = compilePlannerDraft(source.brief, source.draft, projectId);
  if (source.draft.performanceVersion === 1 || source.sceneDescription !== undefined || source.brief.referenceTemplate || source.brief.storyboardStyle) {
    compiled.videoPlan = { version: 1, sceneDescription: source.sceneDescription ?? source.draft.scene, shots: {},
      ...(source.brief.storyboardStyle || source.brief.referenceTemplate ? { storyboardStyle: effectiveStoryboardStyle(source.brief) } : {}),
      ...(source.brief.referenceTemplate ? { referenceTemplate: structuredClone(source.brief.referenceTemplate) } : {}),
      ...(source.brief.referenceTemplate || effectiveStoryboardStyle(source.brief) === "listener_pov"
        ? { templateDirections: source.draft.sections.filter(section => section.kind !== "silent").map(({ text, direction, soundSuggestions }) => ({ text, direction, soundSuggestions })) } : {}) };
  }
  const project = ensureSpeechWorkspaces(compiled);
  const protectedLibrary = createProjectRevision(
    library,
    library.currentProjectId,
    now,
    "采用策划前",
  );
  const adopted = updateLibraryProject(protectedLibrary, project, now);
  return {
    ...adopted,
    projects: adopted.projects.map((entry) =>
      entry.projectId === projectId ? { ...entry, plannerSource: source } : entry,
    ),
  };
}

export function duplicateLibraryProject(
  library: ProjectLibrary,
  projectId: string,
  now: Date = new Date(),
): ProjectLibrary {
  const source = library.projects.find((entry) => entry.projectId === projectId);

  if (!source) {
    return library;
  }

  const usedIds = new Set(library.projects.map((entry) => entry.projectId));
  const duplicateId = makeUniqueId(
    `${source.projectId}_copy_${compactTimestamp(now)}`,
    usedIds,
  );
  const duplicate = cloneProject({
    ...source.project,
    project_id: duplicateId,
    title: `${source.project.title} 副本`,
  });

  const duplicated = updateLibraryProject(library, duplicate, now);
  return {
    ...duplicated,
    projects: duplicated.projects.map((entry) =>
      entry.projectId === duplicateId && source.plannerSource
        ? { ...entry, plannerSource: PlannerSourceSchema.parse(source.plannerSource) }
        : entry,
    ),
  };
}

export function deleteLibraryProject(
  library: ProjectLibrary,
  projectId: string,
): ProjectLibrary {
  if (
    library.projects.length <= 1 ||
    !library.projects.some((entry) => entry.projectId === projectId)
  ) {
    return library;
  }

  const projects = library.projects.filter(
    (entry) => entry.projectId !== projectId,
  );

  return {
    ...library,
    currentProjectId:
      library.currentProjectId === projectId
        ? projects[0].projectId
        : library.currentProjectId,
    projects,
  };
}

export function createProjectRevision(
  library: ProjectLibrary,
  projectId: string,
  now: Date = new Date(),
  label = "手动版本",
): ProjectLibrary {
  const entry = library.projects.find((item) => item.projectId === projectId);

  if (!entry) {
    return library;
  }

  const fingerprint = serializeProject(entry.project);
  const latest = entry.revisions.at(-1);
  const plannerSource = entry.plannerSource
    ? PlannerSourceSchema.parse(entry.plannerSource)
    : undefined;

  if (
    latest &&
    serializeProject(latest.project) === fingerprint &&
    JSON.stringify(latest.plannerSource) === JSON.stringify(plannerSource)
  ) {
    return library;
  }

  const usedIds = new Set(entry.revisions.map((revision) => revision.revisionId));
  const revisionId = makeUniqueId(
    `${projectId}_rev_${compactTimestamp(now)}`,
    usedIds,
  );
  const revisions = [
    ...entry.revisions,
    {
      revisionId,
      createdAt: now.toISOString(),
      label,
      project: cloneProject(entry.project),
      plannerSource,
    },
  ].slice(-MAX_PROJECT_REVISIONS);

  return {
    ...library,
    projects: library.projects.map((item) =>
      item.projectId === projectId ? { ...item, revisions } : item,
    ),
  };
}

export function restoreProjectRevision(
  library: ProjectLibrary,
  projectId: string,
  revisionId: string,
  now: Date = new Date(),
): ProjectLibrary {
  const entry = library.projects.find((item) => item.projectId === projectId);
  const revision = entry?.revisions.find(
    (item) => item.revisionId === revisionId,
  );

  if (!entry || !revision) {
    return library;
  }

  const protectedLibrary = createProjectRevision(
    library,
    projectId,
    now,
    "恢复前",
  );
  const protectedEntry = protectedLibrary.projects.find(
    (item) => item.projectId === projectId,
  )!;
  const restoredProject = cloneProject(revision.project);

  return {
    ...protectedLibrary,
    currentProjectId: projectId,
    projects: protectedLibrary.projects.map((item) =>
      item.projectId === projectId
        ? {
          ...protectedEntry,
          title: restoredProject.title,
          updatedAt: now.toISOString(),
          project: restoredProject,
          mixFingerprint: undefined,
          candidateAcceptance: undefined,
          candidateAcceptances: undefined,
          plannerSource: revision.plannerSource
            ? PlannerSourceSchema.parse(revision.plannerSource)
            : undefined,
          }
        : item,
    ),
  };
}

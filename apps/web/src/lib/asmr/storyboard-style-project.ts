import type { AsmrProject } from "./schema";
import { captureSpeechWorkspace } from "./speech-workspace";
import { effectiveStoryboardStyle, type StoryboardStyle } from "./storyboard-style";

/** Camera preference is shared; each workspace keeps its own shots and audio. */
export function setProjectStoryboardStyle(project: AsmrProject, style: StoryboardStyle): AsmrProject {
  if (project.videoPlan?.referenceTemplate || effectiveStoryboardStyle(project.videoPlan) === style) return project;
  const captured = captureSpeechWorkspace(project);
  const updatePlan = (plan: AsmrProject["videoPlan"]) => plan?.referenceTemplate ? plan : {
    ...plan, version: 1 as const, sceneDescription: plan?.sceneDescription ?? captured.scene.name,
    shots: plan?.shots ?? {}, storyboardStyle: style,
  };
  const workspace = captured.speechWorkspace!;
  return {
    ...captured, videoPlan: updatePlan(captured.videoPlan),
    speechWorkspace: {
      ...workspace,
      short: { ...workspace.short, videoPlan: updatePlan(workspace.short.videoPlan) },
      paragraph: { ...workspace.paragraph, videoPlan: updatePlan(workspace.paragraph.videoPlan) },
    },
  };
}

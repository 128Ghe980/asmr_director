import { StudioApp } from "@/components/studio/studio-app";
import { demoProject } from "@/lib/asmr/mock-project";

export default function Home() {
  return <StudioApp project={demoProject} />;
}

import { useParams, type RouteSectionProps } from "@solidjs/router";
import { createMemo } from "solid-js";
import { ProjectCanvas } from "../../components/ProjectCanvas";
import { ProjectContext, createProjectStore } from "../../lib/store";

/**
 * Layout route: owns the project store and the canvas. Child routes only
 * change params, so moving between workspace and review never remounts the
 * canvas — transitions are camera moves, not page loads.
 */
export default function ProjectLayout(props: RouteSectionProps) {
  const params = useParams();
  // recreate the store only when the project itself changes
  const store = createMemo(() =>
    createProjectStore(params.projectId as string),
  );

  return (
    <ProjectContext.Provider value={store()}>
      <ProjectCanvas />
      <span class="hidden">{props.children}</span>
    </ProjectContext.Provider>
  );
}

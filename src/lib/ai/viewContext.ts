import { createSignal } from "solid-js";

// What the user is currently looking at, published for the assistant panel.
//
// The panel mounts once at the Router root (see AiPanel / app.tsx), outside the
// project canvas, so it only has ids from the pathname — not the human names of
// the project/deliverable in view. The canvas fills this singleton (same
// module-signal pattern as panelState.ts) so the panel can show readable
// context chips and send them to the model. Entity scope comes straight from
// useScope(); only project/deliverable need publishing here.

export type ViewContext = {
  project?: { id: string; name: string };
  deliverable?: { id: string; name: string };
};

const [viewContext, setViewContext] = createSignal<ViewContext>({});

export { viewContext, setViewContext };

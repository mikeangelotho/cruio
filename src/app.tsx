import { Router } from "@solidjs/router";
import { FileRoutes } from "@solidjs/start/router";
import { Suspense } from "solid-js";
import { ScopeProvider } from "./components/ScopeProvider";
import { AiPanel } from "./components/ai/AiPanel";
import "./app.css";

export default function App() {
  return (
    <Router
      root={props => (
        <Suspense>
          <ScopeProvider>
            <div class="h-screen bg-canvas">{props.children}</div>
            {/* The panel itself: fixed-position, takes no layout space. Its
                trigger lives in AppFooter (real chrome, in the layout flow);
                the panel is mounted here instead so chat state survives
                navigation rather than resetting on every route (AppFooter
                remounts per page). Own Suspense boundary: the whole app
                shares the root Suspense, so a session read here would
                otherwise blank the page. */}
            <Suspense fallback={null}>
              <AiPanel />
            </Suspense>
          </ScopeProvider>
        </Suspense>
      )}
    >
      <FileRoutes />
    </Router>
  );
}

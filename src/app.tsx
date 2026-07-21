import { Router } from "@solidjs/router";
import { FileRoutes } from "@solidjs/start/router";
import { Suspense } from "solid-js";
import { ScopeProvider } from "./components/ScopeProvider";
import "./app.css";

export default function App() {
  return (
    <Router
      root={props => (
        <Suspense>
          <ScopeProvider>{props.children}</ScopeProvider>
        </Suspense>
      )}
    >
      <FileRoutes />
    </Router>
  );
}

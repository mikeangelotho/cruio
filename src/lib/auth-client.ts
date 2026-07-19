import { createAuthClient } from "better-auth/solid";
import { organizationClient } from "better-auth/client/plugins";
import { ac, roles } from "./permissions";

export const authClient = createAuthClient({
  plugins: [organizationClient({ ac, roles })],
});

export const { useSession } = authClient;

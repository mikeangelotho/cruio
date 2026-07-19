import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { organization } from "better-auth/plugins/organization";
import { db } from "~/db";
import { ac, roles } from "./permissions";

// Server-only. Client code must import auth-client.ts instead.
export const auth = betterAuth({
  database: drizzleAdapter(db, { provider: "sqlite" }),
  secret: process.env.BETTER_AUTH_SECRET ?? "cruio-dev-secret-change-me",
  // baseURL is inferred from the request when BETTER_AUTH_URL is unset
  baseURL: process.env.BETTER_AUTH_URL,
  trustedOrigins: [
    "http://localhost:5173",
    "http://localhost:3000",
    "https://bippy.tail44eee4.ts.net",
  ],
  emailAndPassword: { enabled: true },
  session: { cookieCache: { enabled: true, maxAge: 60 } },
  plugins: [
    organization({
      ac,
      roles,
      creatorRole: "owner",
      invitationExpiresIn: 60 * 60 * 24 * 7,
      // No sendInvitationEmail: invite links are copied manually in the UI.
    }),
  ],
});

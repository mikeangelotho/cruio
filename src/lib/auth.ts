import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { organization } from "better-auth/plugins/organization";
import { db } from "~/db";
import { ac, roles } from "./permissions";

// The secret must always come from the environment in production; the dev
// fallback exists only so a fresh clone boots, and it never ships.
const secret = process.env.BETTER_AUTH_SECRET;
if (!secret && process.env.NODE_ENV === "production") {
  throw new Error("BETTER_AUTH_SECRET must be set in production");
}
if (!secret) {
  console.warn("[auth] BETTER_AUTH_SECRET is not set — using an insecure dev-only secret");
}

// Trusted origins. better-auth rejects auth POSTs (e.g. an invitee accepting an
// invite) from any origin not listed here, so the production origin MUST be
// present. In production these come only from the environment — APP_ORIGINS
// (comma-separated) plus BETTER_AUTH_URL. In development we also allow localhost
// and the Tailscale host the app is reached over locally.
const isProd = process.env.NODE_ENV === "production";
const devOrigins = isProd
  ? []
  : [
      "http://localhost:5173",
      "http://localhost:3000",
      "http://bippy.tail44eee4.ts.net:3000",
      "https://bippy.tail44eee4.ts.net:3000",
      "https://bippy.tail44eee4.ts.net",
    ];
const trustedOrigins = [
  ...devOrigins,
  ...(process.env.APP_ORIGINS ?? "")
    .split(",")
    .map(o => o.trim())
    .filter(Boolean),
  ...(process.env.BETTER_AUTH_URL ? [process.env.BETTER_AUTH_URL.trim()] : []),
];

// Server-only. Client code must import auth-client.ts instead.
export const auth = betterAuth({
  database: drizzleAdapter(db, { provider: "sqlite" }),
  secret: secret ?? "cruio-dev-secret-change-me",
  rateLimit: { enabled: true, window: 60, max: 30 },
  // baseURL is inferred from the request when BETTER_AUTH_URL is unset
  baseURL: process.env.BETTER_AUTH_URL,
  trustedOrigins,
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

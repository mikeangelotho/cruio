import { auth } from "~/lib/auth";

// Hand-rolled handler using the same { request } event contract as upload.ts,
// instead of better-auth's SolidStart helper (SolidStart 2 is alpha).
export function GET(event: { request: Request }) {
  return auth.handler(event.request);
}

export function POST(event: { request: Request }) {
  return auth.handler(event.request);
}

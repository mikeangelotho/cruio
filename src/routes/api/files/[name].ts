import { createReadStream, existsSync, statSync } from "node:fs";
import { Readable } from "node:stream";
import { basename, extname, join } from "node:path";
import { UPLOADS_DIR } from "../../../db";
import { getSession, requireProjectAccess, resolveVersionProject } from "../../../lib/guard";

const MIME: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".gif": "image/gif",
  ".svg": "image/svg+xml",
  ".avif": "image/avif",
};

export async function GET(event: { request: Request; params: { name: string } }) {
  const session = await getSession(event.request.headers);
  if (!session) return new Response("Unauthorized", { status: 401 });

  // basename() forecloses path traversal
  const name = basename(event.params.name);

  const projectId = await resolveVersionProject(name);
  if (!projectId) return new Response("Not found", { status: 404 });
  try {
    await requireProjectAccess(projectId, undefined, event.request.headers);
  } catch {
    return new Response("Forbidden", { status: 403 });
  }

  const path = join(UPLOADS_DIR, name);
  if (!existsSync(path)) return new Response("Not found", { status: 404 });

  const stat = statSync(path);
  const stream = Readable.toWeb(createReadStream(path)) as ReadableStream;
  return new Response(stream, {
    headers: {
      "Content-Type": MIME[extname(name).toLowerCase()] ?? "application/octet-stream",
      "Content-Length": String(stat.size),
      // Version files are immutable — named by UUID, never rewritten.
      // Private: access is per-user (org membership / guest shares).
      "Cache-Control": "private, max-age=31536000, immutable",
    },
  });
}

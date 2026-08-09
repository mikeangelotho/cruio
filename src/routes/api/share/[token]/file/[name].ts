import { createReadStream, existsSync, statSync } from "node:fs";
import { Readable } from "node:stream";
import { basename, extname, join } from "node:path";
import { and, eq, isNull } from "drizzle-orm";
import { getDb, UPLOADS_DIR } from "../../../../../db";
import { deliverables, shareLinks, versions } from "../../../../../db/schema";
import { INLINE_KINDS, fileTypeFor } from "../../../../../lib/filetypes";

/**
 * GET /api/share/[token]/file/[name] — public, no session. Serves a version
 * file ONLY when it belongs to the deliverable the (valid, non-revoked,
 * non-expired) share token points at. Everything else 404s so a token can't be
 * used to enumerate or fetch arbitrary files.
 */
export async function GET(event: {
  request: Request;
  params: { token: string; name: string };
}) {
  const token = event.params.token;
  const name = basename(event.params.name); // forecloses path traversal
  if (!token || token.length < 16 || token.length > 128) {
    return new Response("Not found", { status: 404 });
  }

  const db = await getDb();
  const [link] = await db.select().from(shareLinks).where(eq(shareLinks.token, token));
  if (!link || link.revokedAt) return new Response("Not found", { status: 404 });
  if (link.expiresAt && link.expiresAt < Date.now()) return new Response("Not found", { status: 404 });
  if (link.subjectType !== "deliverable") return new Response("Not found", { status: 404 });

  const [d] = await db
    .select({ id: deliverables.id, deletedAt: deliverables.deletedAt })
    .from(deliverables)
    .where(eq(deliverables.id, link.subjectId));
  if (!d || d.deletedAt) return new Response("Not found", { status: 404 });

  const [v] = await db
    .select({ id: versions.id })
    .from(versions)
    .where(
      and(
        eq(versions.deliverableId, link.subjectId),
        eq(versions.fileName, name),
        isNull(versions.deletedAt),
      ),
    );
  if (!v) return new Response("Not found", { status: 404 });

  const path = join(UPLOADS_DIR, name);
  if (!existsSync(path)) return new Response("Not found", { status: 404 });

  const stat = statSync(path);
  const ext = extname(name).toLowerCase();
  const type = fileTypeFor(ext);
  const headers: Record<string, string> = {
    "Content-Type": type?.mime ?? "application/octet-stream",
    "Cache-Control": "private, max-age=3600",
    "X-Content-Type-Options": "nosniff",
    "Content-Disposition": type && INLINE_KINDS.has(type.kind) ? "inline" : "attachment",
  };
  if (ext === ".svg") {
    headers["Content-Security-Policy"] = "default-src 'none'; style-src 'unsafe-inline'";
  }
  const stream = Readable.toWeb(createReadStream(path)) as ReadableStream;
  return new Response(stream, { headers: { ...headers, "Content-Length": String(stat.size) } });
}

import { createReadStream, existsSync } from "node:fs";
import { basename, join } from "node:path";
import { Readable } from "node:stream";
import { ZipArchive } from "archiver";
import { UPLOADS_DIR } from "../../../db";
import { authorizeFileByName, getSession } from "../../../lib/guard";

/**
 * POST /api/download/zip — bundle several files into one .zip download.
 * Body: `{ files: { name: string; displayName?: string }[] }` where `name` is
 * the on-disk (UUID) file name. Every file is authorized individually via the
 * same gate as GET /api/files/[name]; `displayName` is cosmetic (the entry
 * name inside the archive) and never affects access. Streams the archive so
 * large media never buffers in memory.
 */
export async function POST(event: { request: Request }) {
  const session = await getSession(event.request.headers);
  if (!session) return new Response("Unauthorized", { status: 401 });

  let body: { files?: { name?: string; displayName?: string }[] } | null = null;
  try {
    body = await event.request.json();
  } catch {
    return new Response("Bad request", { status: 400 });
  }
  const requested = (body?.files ?? []).filter(f => typeof f?.name === "string");
  if (requested.length === 0) return new Response("No files", { status: 400 });

  // Resolve + authorize each file up front so an access failure is a clean 403
  // rather than a half-streamed, corrupt archive.
  const entries: { path: string; entryName: string }[] = [];
  const usedNames = new Set<string>();
  for (const f of requested) {
    const name = basename(f.name as string); // forecloses path traversal
    let displayName: string;
    try {
      ({ displayName } = await authorizeFileByName(name, event.request.headers));
    } catch (e) {
      // Only distinguish not-found from forbidden; never echo the raw error
      // text back to the client.
      const notFound = e instanceof Error && e.message === "Not found";
      return new Response(notFound ? "Not found" : "Forbidden", {
        status: notFound ? 404 : 403,
      });
    }
    const path = join(UPLOADS_DIR, name);
    if (!existsSync(path)) continue;
    // prefer the caller-supplied label, fall back to the resolved display name
    let entryName = (f.displayName?.trim() || displayName).replace(/[^\w.\- ]/g, "_");
    // de-dupe collisions so unzippers don't clobber same-named entries
    if (usedNames.has(entryName)) {
      const dot = entryName.lastIndexOf(".");
      const stem = dot > 0 ? entryName.slice(0, dot) : entryName;
      const ext = dot > 0 ? entryName.slice(dot) : "";
      let i = 2;
      while (usedNames.has(`${stem} (${i})${ext}`)) i++;
      entryName = `${stem} (${i})${ext}`;
    }
    usedNames.add(entryName);
    entries.push({ path, entryName });
  }
  if (entries.length === 0) return new Response("Not found", { status: 404 });

  const archive = new ZipArchive({ zlib: { level: 6 } });
  for (const e of entries) archive.file(e.path, { name: e.entryName });
  void archive.finalize();

  const stream = Readable.toWeb(archive as unknown as Readable) as ReadableStream;
  return new Response(stream, {
    headers: {
      "Content-Type": "application/zip",
      "Content-Disposition": 'attachment; filename="cruio-download.zip"',
      "Cache-Control": "no-store",
    },
  });
}

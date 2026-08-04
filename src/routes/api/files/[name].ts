import { createReadStream, existsSync, statSync } from "node:fs";
import { Readable } from "node:stream";
import { basename, extname, join } from "node:path";
import { UPLOADS_DIR } from "../../../db";
import {
  getSession,
  requireMember,
  requireProjectAccess,
  resolveLibraryFile,
  resolveVersionProject,
} from "../../../lib/guard";
import { INLINE_KINDS, fileTypeFor } from "../../../lib/filetypes";

/**
 * GET /api/files/[name] — serves version files and library files from the
 * shared uploads dir. Authorization: version files and project-folder library
 * files gate on project access (guests need a share); workspace-folder
 * library files gate on org membership (guests excluded). Supports Range
 * requests so video/audio can scrub.
 */
export async function GET(event: { request: Request; params: { name: string } }) {
  const session = await getSession(event.request.headers);
  if (!session) return new Response("Unauthorized", { status: 401 });

  // basename() forecloses path traversal
  const name = basename(event.params.name);

  let displayName = name;
  const projectId = await resolveVersionProject(name);
  if (projectId) {
    try {
      await requireProjectAccess(projectId, undefined, event.request.headers);
    } catch {
      return new Response("Forbidden", { status: 403 });
    }
  } else {
    const lib = await resolveLibraryFile(name);
    if (!lib) return new Response("Not found", { status: 404 });
    displayName = lib.file.name;
    try {
      if (lib.folder.projectId) {
        await requireProjectAccess(lib.folder.projectId, undefined, event.request.headers);
      } else {
        const { role } = await requireMember(lib.folder.organizationId, event.request.headers);
        if (role === "guest") return new Response("Forbidden", { status: 403 });
      }
    } catch {
      return new Response("Forbidden", { status: 403 });
    }
  }

  const path = join(UPLOADS_DIR, name);
  if (!existsSync(path)) return new Response("Not found", { status: 404 });

  const stat = statSync(path);
  const ext = extname(name).toLowerCase();
  const type = fileTypeFor(ext);

  // `?download=1` forces a save dialog even for inline-renderable kinds; the
  // download buttons in the UI append it so images/PDFs don't open in a tab.
  const forceDownload = new URL(event.request.url).searchParams.has("download");
  const safeName = displayName.replace(/[^\w.\- ]/g, "_");

  const headers: Record<string, string> = {
    "Content-Type": type?.mime ?? "application/octet-stream",
    // Files are immutable — named by UUID, never rewritten.
    // Private: access is per-user (org membership / guest shares).
    "Cache-Control": "private, max-age=31536000, immutable",
    "X-Content-Type-Options": "nosniff",
    "Accept-Ranges": "bytes",
    "Content-Disposition":
      type && INLINE_KINDS.has(type.kind) && !forceDownload
        ? "inline"
        : `attachment; filename="${safeName}"`,
  };
  // SVG can carry scripts; this CSP neutralizes them when the file is opened
  // directly in a browsing context while <img> embedding keeps working.
  if (ext === ".svg") {
    headers["Content-Security-Policy"] = "default-src 'none'; style-src 'unsafe-inline'";
  }

  // Single-range support (bytes=start-end), enough for media scrubbing.
  const range = event.request.headers.get("range");
  if (range) {
    const m = /^bytes=(\d*)-(\d*)$/.exec(range.trim());
    if (m && (m[1] || m[2])) {
      let start = m[1] ? parseInt(m[1], 10) : stat.size - parseInt(m[2], 10);
      let end = m[1] ? (m[2] ? parseInt(m[2], 10) : stat.size - 1) : stat.size - 1;
      if (Number.isNaN(start) || start < 0) start = 0;
      if (Number.isNaN(end) || end >= stat.size) end = stat.size - 1;
      if (start > end || start >= stat.size) {
        return new Response(null, {
          status: 416,
          headers: { "Content-Range": `bytes */${stat.size}` },
        });
      }
      const stream = Readable.toWeb(createReadStream(path, { start, end })) as ReadableStream;
      return new Response(stream, {
        status: 206,
        headers: {
          ...headers,
          "Content-Range": `bytes ${start}-${end}/${stat.size}`,
          "Content-Length": String(end - start + 1),
        },
      });
    }
  }

  const stream = Readable.toWeb(createReadStream(path)) as ReadableStream;
  return new Response(stream, {
    headers: { ...headers, "Content-Length": String(stat.size) },
  });
}

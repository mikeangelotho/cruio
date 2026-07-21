import { randomUUID } from "node:crypto";
import { writeFile } from "node:fs/promises";
import { join, extname } from "node:path";
import { imageSize } from "image-size";
import { getDb, UPLOADS_DIR } from "../../../db";
import { libraryFiles } from "../../../db/schema";
import { getSession, requireFolderAccess } from "../../../lib/guard";
import { fileTypeFor } from "../../../lib/filetypes";

/**
 * POST /api/library/upload — multipart form: { folderId, file }
 * Broad safelisted types (see filetypes.ts); canvas uploads stay image-only.
 */
export async function POST(event: { request: Request }) {
  const session = await getSession(event.request.headers);
  if (!session) return Response.json({ error: "Unauthorized" }, { status: 401 });

  // Reject oversized bodies before buffering the form into memory.
  const contentLength = Number(event.request.headers.get("content-length") ?? 0);
  const maxAny = 500 * 1024 * 1024;
  if (contentLength > maxAny + 1024 * 1024) {
    return Response.json({ error: "File too large" }, { status: 413 });
  }

  const form = await event.request.formData();
  const folderId = form.get("folderId");
  const file = form.get("file");

  if (typeof folderId !== "string" || !(file instanceof File)) {
    return Response.json({ error: "folderId and file are required" }, { status: 400 });
  }

  const ext = extname(file.name).toLowerCase();
  const type = fileTypeFor(ext);
  if (!type) {
    return Response.json({ error: `Unsupported file type ${ext || "(none)"}` }, { status: 400 });
  }
  if (file.size > type.maxBytes) {
    return Response.json(
      { error: `${ext} files are limited to ${Math.round(type.maxBytes / 1024 / 1024)} MB` },
      { status: 413 },
    );
  }
  // The browser's declared MIME must agree with the extension (empty is
  // allowed — some platforms omit it). Content is additionally sniffed for
  // images below; other types rely on the safelist + nosniff serving.
  if (file.type && file.type !== type.mime) {
    return Response.json({ error: "File content does not match its extension" }, { status: 400 });
  }

  let access: Awaited<ReturnType<typeof requireFolderAccess>>;
  try {
    access = await requireFolderAccess(folderId, "upload", event.request.headers);
  } catch {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }

  const buffer = Buffer.from(await file.arrayBuffer());
  let width: number | null = null;
  let height: number | null = null;
  if (type.kind === "image") {
    try {
      const dim = imageSize(buffer);
      width = dim.width ?? null;
      height = dim.height ?? null;
    } catch {
      return Response.json({ error: "Could not read image data" }, { status: 400 });
    }
  }

  const id = randomUUID();
  const fileName = `${id}${ext}`;
  await writeFile(join(UPLOADS_DIR, fileName), buffer);

  const db = await getDb();
  const row = {
    id,
    folderId,
    organizationId: access.folder.organizationId,
    name: file.name,
    fileName,
    mime: type.mime,
    size: buffer.length,
    width,
    height,
    versionId: null,
    uploadedBy: access.session.userId,
    createdAt: Date.now(),
  };
  await db.insert(libraryFiles).values(row);

  return Response.json(row);
}

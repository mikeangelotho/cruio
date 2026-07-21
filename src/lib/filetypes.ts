// Single source of truth for what the Library accepts and how files are
// served. Canvas/deliverable uploads stay image-only (see api/upload.ts).

export type FileKind = "image" | "pdf" | "video" | "audio" | "font" | "archive" | "doc";

export interface FileType {
  mime: string;
  maxBytes: number;
  kind: FileKind;
}

const MB = 1024 * 1024;

export const FILE_TYPES: Record<string, FileType> = {
  ".png": { mime: "image/png", maxBytes: 25 * MB, kind: "image" },
  ".jpg": { mime: "image/jpeg", maxBytes: 25 * MB, kind: "image" },
  ".jpeg": { mime: "image/jpeg", maxBytes: 25 * MB, kind: "image" },
  ".webp": { mime: "image/webp", maxBytes: 25 * MB, kind: "image" },
  ".gif": { mime: "image/gif", maxBytes: 25 * MB, kind: "image" },
  ".svg": { mime: "image/svg+xml", maxBytes: 25 * MB, kind: "image" },
  ".avif": { mime: "image/avif", maxBytes: 25 * MB, kind: "image" },
  ".pdf": { mime: "application/pdf", maxBytes: 50 * MB, kind: "pdf" },
  ".mp4": { mime: "video/mp4", maxBytes: 500 * MB, kind: "video" },
  ".webm": { mime: "video/webm", maxBytes: 500 * MB, kind: "video" },
  ".mov": { mime: "video/quicktime", maxBytes: 500 * MB, kind: "video" },
  ".mp3": { mime: "audio/mpeg", maxBytes: 100 * MB, kind: "audio" },
  ".wav": { mime: "audio/wav", maxBytes: 100 * MB, kind: "audio" },
  ".m4a": { mime: "audio/mp4", maxBytes: 100 * MB, kind: "audio" },
  ".woff": { mime: "font/woff", maxBytes: 10 * MB, kind: "font" },
  ".woff2": { mime: "font/woff2", maxBytes: 10 * MB, kind: "font" },
  ".ttf": { mime: "font/ttf", maxBytes: 10 * MB, kind: "font" },
  ".otf": { mime: "font/otf", maxBytes: 10 * MB, kind: "font" },
  ".zip": { mime: "application/zip", maxBytes: 250 * MB, kind: "archive" },
  ".doc": { mime: "application/msword", maxBytes: 50 * MB, kind: "doc" },
  ".docx": {
    mime: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    maxBytes: 50 * MB,
    kind: "doc",
  },
  ".xls": { mime: "application/vnd.ms-excel", maxBytes: 50 * MB, kind: "doc" },
  ".xlsx": {
    mime: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    maxBytes: 50 * MB,
    kind: "doc",
  },
  ".ppt": { mime: "application/vnd.ms-powerpoint", maxBytes: 50 * MB, kind: "doc" },
  ".pptx": {
    mime: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    maxBytes: 50 * MB,
    kind: "doc",
  },
};

/** Kinds the browser can render inline; everything else downloads as attachment. */
export const INLINE_KINDS: ReadonlySet<FileKind> = new Set(["image", "pdf", "video", "audio"]);

export function fileTypeFor(ext: string): FileType | null {
  return FILE_TYPES[ext.toLowerCase()] ?? null;
}

export function kindOfMime(mime: string): FileKind {
  for (const t of Object.values(FILE_TYPES)) if (t.mime === mime) return t.kind;
  return "doc";
}

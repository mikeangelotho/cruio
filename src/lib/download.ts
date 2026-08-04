import { fileUrl } from "./types";

/** Trigger a browser download of a single stored file (forces attachment). */
export function downloadFile(fileName: string) {
  const a = document.createElement("a");
  a.href = `${fileUrl(fileName)}?download=1`;
  a.download = "";
  document.body.appendChild(a);
  a.click();
  a.remove();
}

/** Bundle several stored files into one .zip via the server and save it. */
export async function downloadZip(
  files: { name: string; displayName?: string }[],
): Promise<void> {
  if (files.length === 0) return;
  if (files.length === 1) {
    downloadFile(files[0].name);
    return;
  }
  const res = await fetch("/api/download/zip", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ files }),
  });
  if (!res.ok) throw new Error((await res.text().catch(() => "")) || "Download failed");
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "cruio-download.zip";
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

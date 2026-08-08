import { api } from "./client";
import type { ArtifactView } from "./generated/openapi.types";

export async function downloadArtifactBlob(artifactId: string): Promise<Blob> {
  const res = await api.get<Blob>(`/v1/artifacts/${artifactId}`, {
    responseType: "blob",
    timeout: 120_000,
  });
  return res.data;
}

export async function sha256Hex(blob: Blob): Promise<string> {
  const buf = await blob.arrayBuffer();
  const hash = await crypto.subtle.digest("SHA-256", buf);
  return Array.from(new Uint8Array(hash))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export async function downloadAndVerify(artifact: ArtifactView): Promise<{
  blob: Blob;
  computedSha256: string;
  matches: boolean;
}> {
  const blob = await downloadArtifactBlob(artifact.id);
  const computedSha256 = await sha256Hex(blob);
  return {
    blob,
    computedSha256,
    matches: computedSha256.toLowerCase() === artifact.sha256.toLowerCase(),
  };
}

export function triggerBrowserDownload(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

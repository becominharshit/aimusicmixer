import { createAudioBlobCache, type AudioBlobCache } from "@/daw/storage/audioBlobCache";

const STUDIO_NAMESPACE = "studio_analyses";
const MAX_CACHED_BLOB_BYTES = 55 * 1024 * 1024; // 55 MB cap matches single-file limit

let cacheInstance: AudioBlobCache | null = null;

function getStudioAudioCache(): AudioBlobCache {
  if (!cacheInstance) {
    cacheInstance = createAudioBlobCache({
      dbName: "mixit-studio-audio-v1",
      storeName: "studio_mix_blobs",
    });
  }
  return cacheInstance;
}

/**
 * Stores a mix audio Blob locally in IndexedDB keyed by analysis_id / report_id
 * so reloading /studio or signing back in restores instant playable audio.
 */
export async function cacheStudioAudioBlob(
  keys: Array<string | null | undefined>,
  blob: Blob | null | undefined
): Promise<boolean> {
  if (!blob || blob.size === 0 || blob.size > MAX_CACHED_BLOB_BYTES) return false;
  const uniqueKeys = Array.from(
    new Set(keys.filter((k): k is string => typeof k === "string" && k.trim().length > 0))
  );
  if (uniqueKeys.length === 0) return false;

  const cache = getStudioAudioCache();
  try {
    await Promise.all(uniqueKeys.map((key) => cache.put(STUDIO_NAMESPACE, key, blob)));
    return true;
  } catch {
    return false;
  }
}

/**
 * Looks up a locally cached audio Blob across candidate keys (analysis_id first, then report_id).
 */
export async function getCachedStudioAudioBlob(
  keys: Array<string | null | undefined>
): Promise<Blob | null> {
  const uniqueKeys = Array.from(
    new Set(keys.filter((k): k is string => typeof k === "string" && k.trim().length > 0))
  );
  if (uniqueKeys.length === 0) return null;

  const cache = getStudioAudioCache();
  for (const key of uniqueKeys) {
    try {
      const hit = await cache.get(STUDIO_NAMESPACE, key);
      if (hit && hit.size > 0) return hit;
    } catch {
      // Try next candidate key
    }
  }
  return null;
}

export async function deleteCachedStudioAudioBlob(
  keys: Array<string | null | undefined>
): Promise<void> {
  const uniqueKeys = Array.from(
    new Set(keys.filter((k): k is string => typeof k === "string" && k.trim().length > 0))
  );
  if (uniqueKeys.length === 0) return;

  const cache = getStudioAudioCache();
  await Promise.all(
    uniqueKeys.map((key) => cache.delete(STUDIO_NAMESPACE, key).catch(() => {}))
  );
}

export async function clearStudioAudioCache(): Promise<void> {
  try {
    await getStudioAudioCache().deleteProject(STUDIO_NAMESPACE);
  } catch {
    // Non-fatal
  }
}

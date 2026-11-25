// The videos the Worker serves from R2, and their Content-Types. No imports and no side effects: main.mjs (the Worker
// bundle) and files.mjs (deploy side, which needs node:fs) both read it, so node code never rides into the Worker.

/** A video extension (lower case) and its Content-Type. */
export const VIDEO_TYPES = { ".mp4": "video/mp4", ".webm": "video/webm" };

/** A path's video extension, lower-cased (/A.MP4 → ".mp4"), or undefined when it isn't a video. */
export function videoExt(pathname) {
  const ext = /\.[^./]+$/.exec(pathname)?.[0].toLowerCase();
  return ext && Object.hasOwn(VIDEO_TYPES, ext) ? ext : undefined;
}

/**
 * The Content-Type to answer for a video: the R2 object's stored type only when it names the extension's type
 * (parameters such as codecs kept); a missing, application/octet-stream or mismatched type gets the extension's.
 */
export function videoType(ext, stored) {
  const want = VIDEO_TYPES[ext];
  return typeof stored === "string" && stored.split(";")[0].trim().toLowerCase() === want ? stored : want;
}

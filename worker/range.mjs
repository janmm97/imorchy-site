// Byte ranges for the launch video (main.mjs). Kept out of main.mjs because the Worker's main module may only
// export its handler: Cloudflare reads any other export as an entrypoint.

/** A Range header against a file of `size` bytes: undefined for the whole file, null when it can't be satisfied (416). One range only; anything else gets the whole file. */
export function byteRange(header, size) {
  const m = /^bytes=(\d*)-(\d*)$/.exec(header || "");
  if (!m || (!m[1] && !m[2])) return undefined;
  const start = m[1] ? Number(m[1]) : Math.max(0, size - Number(m[2]));
  const end = m[1] && m[2] ? Math.min(Number(m[2]), size - 1) : size - 1;
  return start > end || start >= size ? null : { start, end };
}

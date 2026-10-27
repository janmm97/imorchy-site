// Sealed values for the playground: AES-GCM with a key derived from the Worker's SESSION_SECRET. Used for the
// session cookie (the visitor's One grant reference and address) and for approval tokens, so the browser can carry
// them but can neither read nor change them. Web Crypto only, so it runs in the Worker and in Node's tests alike.
const enc = new TextEncoder(),
  dec = new TextDecoder();
const keys = new Map();

function key(secret) {
  if (!secret || secret.length < 32) throw new Error("SESSION_SECRET must be at least 32 characters.");
  if (!keys.has(secret))
    keys.set(
      secret,
      crypto.subtle
        .digest("SHA-256", enc.encode(`orchy-playground/v1/${secret}`))
        .then((raw) => crypto.subtle.importKey("raw", raw, "AES-GCM", false, ["encrypt", "decrypt"])),
    );
  return keys.get(secret);
}

const b64url = (bytes) => btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const unb64url = (s) => Uint8Array.from(atob(s.replace(/-/g, "+").replace(/_/g, "/")), (c) => c.charCodeAt(0));

/** Seals `value` (JSON) for `ttlSeconds`. `purpose` binds it to one use: a session can't pass as an approval. */
export async function seal(secret, purpose, value, ttlSeconds) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const body = enc.encode(JSON.stringify({ p: purpose, exp: Date.now() + ttlSeconds * 1000, v: value }));
  const box = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv }, await key(secret), body));
  const out = new Uint8Array(iv.length + box.length);
  out.set(iv);
  out.set(box, iv.length);
  return b64url(out);
}

/** The sealed value, or null when it's missing, tampered with, expired or sealed for another purpose. */
export async function open(secret, purpose, token) {
  if (!token || typeof token !== "string" || token.length > 6000) return null;
  try {
    const raw = unb64url(token);
    const plain = await crypto.subtle.decrypt({ name: "AES-GCM", iv: raw.slice(0, 12) }, await key(secret), raw.slice(12));
    const { p, exp, v } = JSON.parse(dec.decode(plain));
    return p === purpose && exp > Date.now() ? v : null;
  } catch {
    return null;
  }
}

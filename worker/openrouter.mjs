// The playground's model, through OpenRouter's chat completions API (OpenAI-shaped). Plain fetch: no SDK in the Worker.
export const ENDPOINT = "https://openrouter.ai/api/v1/chat/completions";
export const DEFAULT_MODEL = "anthropic/claude-haiku-5.5";

/** Returns chat(body) → OpenRouter's JSON reply. Errors carry `status` (HTTP, or OpenRouter's error code). */
export function openrouter(apiKey, { site, title = "Orchy playground", fetch: send = (...a) => fetch(...a) } = {}) {
  return async (body) => {
    const res = await send(ENDPOINT, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        ...(site ? { "HTTP-Referer": site } : {}),
        "X-Title": title,
      },
      // Visitors' mail goes only to providers that don't keep or train on prompts.
      body: JSON.stringify({ ...body, provider: { data_collection: "deny" } }),
    });
    const data = await res.json().catch(() => null);
    if (!res.ok || data?.error || !data?.choices?.length) {
      const status = Number(data?.error?.code) || res.status;
      throw Object.assign(new Error(data?.error?.message || `OpenRouter answered ${res.status}`), { status });
    }
    return data;
  };
}

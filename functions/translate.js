// functions/translate.js
// Lightweight UI-text translator (tips, hints, how-to / intro messages).
// Uses gpt-4o-mini for speed/cost. Translates plain text into the target language,
// preserving line breaks and not adding commentary.

const https = require("https");

const TRANSLATE_SYSTEM = `You are a translator for a TOEFL speaking-practice app's interface text (study tips, how-to instructions, and interview prompts).
Translate the user's text into the requested target language.
Rules:
- Output ONLY the translation. No preamble, no quotes, no explanations, no notes.
- Preserve line breaks and list structure exactly.
- Keep it natural and concise, as UI guidance for a student.
- Do NOT translate the proper noun "TOEFL".
- If the text is already in the target language, return it unchanged.`;

function callOpenAI(apiKey, systemPrompt, userContent, maxTokens) {
  return new Promise((resolve, reject) => {
    const payload = JSON.stringify({
      model: "gpt-4o",
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user",   content: userContent  }
      ],
      temperature: 0.2,
      max_tokens: maxTokens || 2000
    });

    const req = https.request(
      {
        hostname: "api.openai.com",
        path: "/v1/chat/completions",
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
          "Content-Length": Buffer.byteLength(payload)
        }
      },
      (res) => {
        const _chunks = [];
        res.on("data", chunk => _chunks.push(chunk));
        res.on("end", () => {
          const data = Buffer.concat(_chunks).toString("utf8");
          if (res.statusCode < 200 || res.statusCode >= 300) {
            let msg = data;
            try { const j = JSON.parse(data); if (j.error) msg = j.error.message; } catch (e) {}
            const err = new Error(`OpenAI ${res.statusCode}: ${msg}`);
            err.statusCode = res.statusCode;
            reject(err);
            return;
          }
          try {
            const json = JSON.parse(data);
            if (json.error) reject(new Error(json.error.message));
            else resolve(json.choices[0].message.content.trim());
          } catch(e) {
            reject(new Error("Failed to parse GPT response: " + data.slice(0, 200)));
          }
        });
      }
    );
    req.on("error", reject);
    req.write(payload);
    req.end();
  });
}

exports.handler = async (event) => {
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, body: "Method Not Allowed" };
  }

  // Trim keys; prefer ALT_OPENAI_KEY (translation has always used it), fall back
  // to OPENAI_API_KEY. Trimming guards against stray whitespace/newlines.
  const _keys = [];
  for (const k of [process.env.ALT_OPENAI_KEY, process.env.OPENAI_API_KEY]) {
    const t = (k || "").trim();
    if (!t || _keys.indexOf(t) !== -1) continue;
    // Skip malformed keys (e.g. a JWT accidentally set in the env var) — sending
    // one as a bearer token makes OpenAI drop the connection instead of 401ing,
    // which would otherwise prevent falling back to the good key.
    if (!t.startsWith("sk-")) {
      console.warn("Ignoring malformed OpenAI key: length " + t.length +
                   ", starts '" + t.slice(0, 4) + "'");
      continue;
    }
    _keys.push(t);
  }
  if (!_keys.length) {
    return { statusCode: 500, body: JSON.stringify({ error: "No OpenAI API key set (ALT_OPENAI_KEY / OPENAI_API_KEY)" }) };
  }
  // Try each usable key in turn rather than dying on the first. A bad primary
  // otherwise takes down every translation even when a good key is present.
  async function callWithFallback(systemPrompt, userContent, maxTokens) {
    let lastErr;
    for (const key of _keys) {
      try { return await callOpenAI(key, systemPrompt, userContent, maxTokens); }
      catch (e) {
        lastErr = e;
        if (e.statusCode && e.statusCode !== 401 && e.statusCode !== 403) break;
      }
    }
    throw lastErr;
  }

  let body;
  try { body = JSON.parse(event.body); }
  catch(e) { return { statusCode: 400, body: JSON.stringify({ error: "Invalid request" }) }; }

  const { text, texts, language } = body;

  // No language or English → return as-is, no call.
  const isEnglish = !language || language.trim().toLowerCase() === "english";

  // ── BATCH MODE: translate an array of strings in ONE call ──
  if (Array.isArray(texts)) {
    if (!texts.length) {
      return { statusCode: 200, headers: { "Content-Type": "application/json; charset=utf-8" }, body: JSON.stringify({ translations: [] }) };
    }
    if (isEnglish) {
      return { statusCode: 200, headers: { "Content-Type": "application/json; charset=utf-8" }, body: JSON.stringify({ translations: texts }) };
    }
    // Number each item; ask for a JSON array back, same order/length.
    const numbered = texts.map((t, i) => `[${i}] ${String(t).replace(/\n/g, "\\n")}`).join("\n");
    const batchUser =
      `Target language: ${language.trim()}\n\n` +
      `Translate each numbered item below into the target language. ` +
      `Return ONLY a JSON array of strings (no keys, no numbering, no commentary), with EXACTLY ${texts.length} items in the SAME order. ` +
      `Within a string, write any line breaks as \\n.\n\nItems:\n${numbered}`;
    try {
      const raw = await callWithFallback(TRANSLATE_SYSTEM, batchUser, 4000);
      let arr;
      try {
        const cleaned = raw.replace(/^```(?:json)?/i, "").replace(/```$/,"").trim();
        arr = JSON.parse(cleaned);
      } catch(e) { arr = null; }
      if (!Array.isArray(arr) || arr.length !== texts.length) {
        // Fallback: signal partial failure so the client can retry per-string.
        return { statusCode: 200, headers: { "Content-Type": "application/json; charset=utf-8" }, body: JSON.stringify({ translations: null }) };
      }
      const translations = arr.map(s => String(s).replace(/\\n/g, "\n"));
      return { statusCode: 200, headers: { "Content-Type": "application/json; charset=utf-8" }, body: JSON.stringify({ translations }) };
    } catch(e) {
      return { statusCode: 500, body: JSON.stringify({ error: e.message }) };
    }
  }

  // ── SINGLE MODE (unchanged) ──
  if (!text || !text.trim()) {
    return { statusCode: 200, headers: { "Content-Type": "application/json; charset=utf-8" }, body: JSON.stringify({ translation: "" }) };
  }
  if (isEnglish) {
    return { statusCode: 200, headers: { "Content-Type": "application/json; charset=utf-8" }, body: JSON.stringify({ translation: text }) };
  }

  const userContent = `Target language: ${language.trim()}\n\nText to translate:\n${text}`;

  try {
    const translation = await callWithFallback(TRANSLATE_SYSTEM, userContent);
    return {
      statusCode: 200,
      headers: { "Content-Type": "application/json; charset=utf-8" },
      body: JSON.stringify({ translation })
    };
  } catch(e) {
    return { statusCode: 500, body: JSON.stringify({ error: e.message }) };
  }
};

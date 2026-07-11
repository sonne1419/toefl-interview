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
      model: "gpt-4o-mini",
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user",   content: userContent  }
      ],
      temperature: 0.2,
      max_tokens: maxTokens || 800
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
          try {
            const json = JSON.parse(data);
            if (json.error) reject(new Error(json.error.message));
            else resolve(json.choices[0].message.content.trim());
          } catch(e) {
            reject(new Error("Failed to parse GPT response"));
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

  const apiKey = process.env.ALT_OPENAI_KEY;
  if (!apiKey) {
    return { statusCode: 500, body: JSON.stringify({ error: "ALT_OPENAI_KEY not set" }) };
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
      const raw = await callOpenAI(apiKey, TRANSLATE_SYSTEM, batchUser, 4000);
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
    const translation = await callOpenAI(apiKey, TRANSLATE_SYSTEM, userContent);
    return {
      statusCode: 200,
      headers: { "Content-Type": "application/json; charset=utf-8" },
      body: JSON.stringify({ translation })
    };
  } catch(e) {
    return { statusCode: 500, body: JSON.stringify({ error: e.message }) };
  }
};

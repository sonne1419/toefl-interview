// functions/why-not-5-speaking.js
// Call B for the SPEAKING interview tool: compares a student's spoken response to
// the Stage 0 golden sample for the SAME question and explains the gap.
//
// Does NOT assign, mention, or change a band — analyze.js already scored it.
// The caller is responsible for only invoking this when band < 5.
//
// Accepts: POST { question, answer, sample, band, language }
// Returns: { explanation: string }
//
// Adapted from the Academic Discussion tool's why-not-5.js, with three changes:
//   1. The sample answers the SAME question (AD's sample is a different topic).
//   2. Speaking rubric (Organization / Fluency & Intelligibility / Language Use)
//      instead of the AD writing rubric.
//   3. Whisper-artifact rules: never mention punctuation, capitalization, spelling.

const https = require("https");

function buildSystem(language, sameTopic) {
  let s = `This response has already been scored by another grader. Explain only how it falls short of the sample. Never mention or assign a band or score.

Compare it to the sample on three points, saying what is specifically weaker:
1. Organization: how the ideas are structured and build on each other.
2. Fluency & Intelligibility: whether the meaning comes through and develops steadily.
3. Language Use: range and control of vocabulary and sentence structures.

Point to the actual parts you mean. Be brief. No generic advice that could apply to any response.

${sameTopic
  ? "The sample answers the same question and the student may have it on screen. Refer to what it DOES, never to its specific wording — the student may be building their own answer on purpose."
  : "The sample answers a DIFFERENT question. It shows what a top-band response looks like, not what this student should have said. Compare only structure, development and language — never fault the student for not covering the sample's topic or content."}

A personal example is valid support; never treat it as a weakness.

The transcript comes from speech recognition, so say nothing about capitalization, punctuation, or spelling, and nothing about pronunciation or intonation.`;

  if (language && language.trim() &&
      language.trim().toLowerCase() !== "english" &&
      language.trim().toLowerCase() !== "en") {
    s += `\n\nWrite your entire explanation in ${language.trim()}. Keep any quoted student words in their original English.`;
  }
  return s;
}

function callOpenAI(apiKey, systemPrompt, userPrompt) {
  return new Promise((resolve, reject) => {
    const payload = JSON.stringify({
      model: "gpt-4o",
      temperature: 0.4,
      max_tokens: 1000,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user",   content: userPrompt   }
      ]
    });

    const req = https.request({
      hostname: "api.openai.com",
      path: "/v1/chat/completions",
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${apiKey}`,
        "Content-Length": Buffer.byteLength(payload)
      }
    }, (res) => {
      const chunks = [];
      res.on("data", c => chunks.push(c));
      res.on("end", () => {
        const data = Buffer.concat(chunks).toString("utf8");
        if (res.statusCode < 200 || res.statusCode >= 300) {
          let msg = data;
          try { const j = JSON.parse(data); if (j.error) msg = j.error.message; } catch (e) {}
          const err = new Error(`OpenAI ${res.statusCode}: ${msg}`);
          err.statusCode = res.statusCode;
          reject(err);
          return;
        }
        try {
          const parsed = JSON.parse(data);
          if (parsed.error) return reject(new Error(parsed.error.message));
          resolve((parsed.choices && parsed.choices[0] &&
                   parsed.choices[0].message.content || "").trim());
        } catch (e) {
          reject(new Error("Failed to parse OpenAI response: " + data.slice(0, 200)));
        }
      });
    });

    req.on("error", reject);
    req.write(payload);
    req.end();
  });
}

exports.handler = async (event) => {
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, body: "Method Not Allowed" };
  }

  // Trim keys (stray whitespace/newlines from adjacent multi-line env vars can
  // corrupt a key -> 401) and fall back between them on auth errors.
  const _keys = [];
  for (const k of [process.env.OPENAI_API_KEY, process.env.ALT_OPENAI_KEY]) {
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
    return { statusCode: 500, body: JSON.stringify({ error: "No OpenAI API key set (OPENAI_API_KEY / ALT_OPENAI_KEY)" }) };
  }

  let body;
  try {
    body = JSON.parse(event.body);
  } catch (e) {
    return { statusCode: 400, body: JSON.stringify({ error: "Invalid request body" }) };
  }

  // same_topic defaults to true so Stage 0 (per-question golden samples) is
  // unaffected; Stage 4 passes false because its sample answers another question.
  const { question, answer, sample, band, language, same_topic } = body;
  const sameTopic = (same_topic !== false);
  if (!answer || !answer.trim()) {
    return { statusCode: 400, body: JSON.stringify({ error: "answer is required" }) };
  }
  if (!sample || !sample.trim()) {
    return { statusCode: 400, body: JSON.stringify({ error: "sample is required" }) };
  }

  let userContent = "";
  userContent += sameTopic
    ? `SAMPLE ANSWER (a strong response to this same question):\n${sample.trim()}\n\n`
    : `BAND 5 SAMPLE ANSWER (a different question — shows top-band quality only):\n${sample.trim()}\n\n`;
  if (question && question.trim()) {
    userContent += `Interview question (for reference only — do not evaluate it):\n${question.trim()}\n\n`;
  }
  if (band != null) {
    userContent += `(The grader scored this response as band ${band}.)\n\n`;
  }
  userContent += `Student's response (transcribed speech):\n${answer.trim()}`;

  const systemPrompt = buildSystem(language, sameTopic);

  try {
    let explanation, lastErr;
    for (const key of _keys) {
      try {
        explanation = await callOpenAI(key, systemPrompt, userContent);
        lastErr = null;
        break;
      } catch (e) {
        lastErr = e;
        // Retry on auth errors and on connection-level failures (no status).
        if (e.statusCode && e.statusCode !== 401 && e.statusCode !== 403) break;
      }
    }
    if (lastErr) throw lastErr;

    return {
      statusCode: 200,
      headers: { "Content-Type": "application/json; charset=utf-8" },
      body: JSON.stringify({ explanation })
    };
  } catch (e) {
    console.error("why-not-5-speaking error:", e.message);
    return { statusCode: 500, body: JSON.stringify({ error: e.message }) };
  }
};

// functions/generate-speaking-idea.js
// Idea-frame generator for the SPEAKING interview practice app.
//
// Produces a 3-part "logic structure" (spine) the student expands into speech:
//   Statement & Reason / Before Example / After Example
//
// Infra: Node https + OpenAI gpt-4o, key from process.env.ALT_OPENAI_KEY.
// The prompt shows ONE example per bucket (opening_type x question_type).

const https = require("https");

const MODEL = "gpt-4o";

// --- The prompt (minimal, validated). {EXAMPLE} and {REASON_LINE} are filled per request. ---
const PROMPT_HEADER =
`You generate the logic structure of one response to a TOEFL speaking question.

The logic structure has three parts:
- Statement & Reason — your POSITION on the question, plus the reason for it
- Before Example — the situation in the past, showing POSITION not taken or not available, causing reason to be unfulfilled
- After Example — the situation now, showing POSITION working, causing the reason to be fulfilled

Each part is a short "spine" — keywords linked by arrows (→) — that a student can expand into full spoken sentences.

Output:
Statement & Reason:
Before Example:
After Example:
`;

// --- The 4 shared bucket examples (opening_type|question_type) ---
const EX_OPEN_FREE =
`Here is a sample:

QUESTION: if someone wants to start exercising, what would you recommend?
Statement & Reason: exercise with others → build new relationships
Before Example: in the past exercised alone → gym every day → boring → made no new friends
After Example: now work out with others → trained together → shared tips → became close friends`;

const EX_PICK1_FREE =
`Here is a sample:

QUESTION: Is it better to exercise alone or with others?
Statement & Reason: better to exercise with others → build new relationships
Before Example: in the past exercised alone → gym every day → boring → made no new friends
After Example: now work out with others → trained together → shared tips → became close friends`;

const EX_PICK1_REQUIRED =
`Here is a sample (the required phrase for this sample is "more popular in the future"):

QUESTION: Will AI become more popular in the future?
Statement & Reason: AI more popular in the future → learn more efficiently (→ more popular in the future)
Before Example: in the past people rarely used AI → learning new skills was hard → had to ask others → not efficient
After Example: now AI is everywhere → ask anytime → learn instantly → more popular in the future`;

const EX_OPEN_REQUIRED =
`Here is a sample (the required phrase for this sample is "more popular in the future"):

QUESTION: What technology will become more popular in the future
Statement & Reason: AI more popular in the future → learn more efficiently (→ more popular in the future)
Before Example: in the past people rarely used AI → learning new skills was hard → had to ask others → not efficient
After Example: now AI is everywhere → ask anytime → learn instantly → more popular in the future`;

function pickExample(openingType, questionType) {
  // opening_type in data is "pick_1_of_2" / "wh_q" (legacy: "pick1" / "open").
  var isPick = (openingType === "pick_1_of_2" || openingType === "pick1");
  var o = isPick ? "pick1" : "open";
  var q = (questionType === "required_wording") ? "required" : "free";
  if (o === "open"  && q === "free")     return EX_OPEN_FREE;
  if (o === "pick1" && q === "free")     return EX_PICK1_FREE;
  if (o === "pick1" && q === "required") return EX_PICK1_REQUIRED;
  return EX_OPEN_REQUIRED; // open + required
}

function callOpenAI(apiKey, prompt) {
  return new Promise((resolve, reject) => {
    const payload = JSON.stringify({
      model: MODEL,
      messages: [{ role: "user", content: prompt }],
      temperature: 0.5,
      max_tokens: 400
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
        const chunks = [];
        res.on("data", c => chunks.push(c));
        res.on("end", () => {
          const data = Buffer.concat(chunks).toString("utf8");
          // Surface the HTTP status so the caller can tell an auth failure
          // (worth retrying with the other key) from a real error.
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
          } catch (e) { reject(new Error("Failed to parse response: " + data.slice(0, 200))); }
        });
      }
    );
    req.on("error", reject);
    req.write(payload);
    req.end();
  });
}

exports.handler = async (event) => {
  if (event.httpMethod !== "POST") return { statusCode: 405, body: "Method Not Allowed" };

  // Same key handling as the other functions: trim, reject anything that is not
  // shaped like an OpenAI key (a corrupted env var otherwise gets sent as a
  // bearer token and the connection is dropped), and fall back between them.
  const _keys = [];
  for (const k of [process.env.ALT_OPENAI_KEY, process.env.OPENAI_API_KEY]) {
    const t = (k || "").trim();
    if (!t || _keys.indexOf(t) !== -1) continue;
    if (!t.startsWith("sk-")) {
      console.warn("Ignoring malformed OpenAI key: length " + t.length +
                   ", starts '" + t.slice(0, 4) + "'");
      continue;
    }
    _keys.push(t);
  }
  if (!_keys.length) {
    return { statusCode: 500, body: JSON.stringify({ error: "No usable OpenAI API key set (ALT_OPENAI_KEY / OPENAI_API_KEY)" }) };
  }

  let body;
  try { body = JSON.parse(event.body); }
  catch (e) { return { statusCode: 400, body: JSON.stringify({ error: "Invalid request" }) }; }

  const question   = (body.question || body.q || "").toString().trim();
  const reasonRaw  = (body.reason || "").toString().trim();
  const isAuto     = !reasonRaw || reasonRaw.toUpperCase() === "AUTO";
  const reason     = isAuto ? "" : reasonRaw;
  const qType      = (body.question_type || "free").toString().trim();
  const oType      = (body.opening_type || "open").toString().trim();

  if (!question) return { statusCode: 400, body: JSON.stringify({ error: "question required" }) };

  const example = pickExample(oType, qType);
  const reasonLine = isAuto
    ? "Reason: choose one that is suitable"
    : `use one of these reason: ${reason}`;

  const prompt =
    PROMPT_HEADER + "\n" +
    example + "\n\n" +
    "Here's a new question:\n" + question + "\n\n" +
    "Provide the logic structure of one response.\n" +
    reasonLine;

  try {
    let answer, lastErr;
    for (const key of _keys) {
      try { answer = await callOpenAI(key, prompt); lastErr = null; break; }
      catch (e) {
        lastErr = e;
        // Retry on auth errors and on connection-level failures (no status).
        if (e.statusCode && e.statusCode !== 401 && e.statusCode !== 403) break;
      }
    }
    if (lastErr) throw lastErr;
    // Strip any preamble before the first "Statement & Reason:" label.
    const idx = answer.indexOf("Statement & Reason:");
    if (idx > 0) answer = answer.slice(idx);
    return {
      statusCode: 200,
      headers: { "Content-Type": "application/json; charset=utf-8" },
      body: JSON.stringify({ answer: answer.trim() })
    };
  } catch (e) {
    return { statusCode: 500, body: JSON.stringify({ error: e.message }) };
  }
};

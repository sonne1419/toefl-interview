// functions/grammar.js
// Receives all transcripts from a session, runs grammar check via GPT-4o.
// Ignores punctuation, capitalization, formality, and tone.
// Returns per-sentence errors and top 2 common error patterns.

const https = require("https");

const GRAMMAR_SYSTEM = `You are an English grammar checker for TOEFL speaking transcripts.

These responses are SPOKEN and transcribed by speech recognition, so punctuation and capitalization are NOT the student's own choices — they are transcription artifacts. Check only for genuine errors in the WORDS themselves.

IGNORE (these are NOT errors — do not flag them):
- Punctuation errors
- Capitalization errors
- Run-on sentences, comma splices, and sentence-boundary / sentence-length issues (these are punctuation, not grammar — speech transcripts have no real punctuation)
- Missing or misplaced commas, periods, or other punctuation
- Sentence fragments that exist only because punctuation is missing
- Formality or tone issues
- Word choice or style preferences
- Filler words (um, uh, like, you know)
- Phrasing that is grammatically valid but could merely be smoother or "more natural"
- OPTIONAL changes that are not required: if both the original and a possible alternative are grammatically acceptable, the original is NOT an error — leave it alone.

CRITICAL PRINCIPLE — MUST-FIX ONLY: Flag a sentence ONLY if it contains a MUST-FIX error in the words: a mistake that is unambiguously wrong and that a teacher would definitely mark as incorrect (for example: subject-verb disagreement, wrong verb tense, missing main verb, wrong word form, wrong preposition, missing or wrong article). The test is "Must this be corrected to be grammatically acceptable?" — not "Could this be changed?" If the original wording is already grammatically acceptable, leave it completely alone. When in doubt, treat it as correct and do not flag it. Do not invent errors to appear thorough.

DECISIVE TEST: If your "Revised" version differs from the "Original" ONLY by adding, removing, or changing punctuation or capitalization (e.g. inserting commas, splitting one sentence into shorter ones), it is NOT an error — skip it entirely. Only flag an error if the WORDS themselves are grammatically wrong.

For each transcript, go sentence by sentence.
Only include sentences that contain a real, must-fix word-level error.
Skip correct sentences entirely.

If a sentence has MULTIPLE errors, give ONE Original/Revised pair that fixes all of them in the single Revised sentence, and on the Error line name each type, separated by "; ".

Use this EXACT format:

=== Q{number} ===
Original: [original sentence]
Error: [name the type(s) of error in specific terms that genuinely fit the actual mistake — e.g. "Subject-verb agreement", "Wrong verb tense", "Missing article". Describe what it actually is; do not force into a fixed preset list. Separate multiple with "; ".]
Revised: [corrected sentence with all word-level errors fixed]

[repeat for each error sentence in this question]

=== PATTERNS ===
1. [Most common recurring error pattern across all responses]
2. [Second most common recurring error pattern]

Rules:
- If a question has no grammar errors, write: === Q{number} ===\n(No grammar errors found)
- The Error label must accurately describe the real mistake. Never mislabel.
- Keep each error label short (a few words).
- Only list a PATTERN if it recurs in two or more corrections; if nothing recurs, leave the PATTERNS list empty.
- Do not comment on punctuation, capitalization, or style under any circumstances.
- Do not repeat the question text.`;

function withLanguage(systemPrompt, language) {
  const lang = (language || "").trim();
  if (!lang || lang.toLowerCase() === "english" || lang.toLowerCase() === "en") {
    return systemPrompt;
  }
  return systemPrompt +
    `\n\nLANGUAGE INSTRUCTION: Write the error type names (the text after "Error:") and the ` +
    `PATTERNS descriptions in ${lang}. Everything else stays in English: the "Original:" sentence, ` +
    `the "Revised:" corrected sentence (it is the corrected English the student is learning), and ` +
    `the format labels "Original:", "Error:", "Revised:" themselves. ` +
    `\n\nCRITICAL — DO NOT TRANSLATE THESE MARKERS: the section headers ("=== Q1 ===", "=== Q2 ===", ` +
    `"=== PATTERNS ===") and the labels "Original:", "Error:", "Revised:" must remain EXACTLY in ` +
    `this English/ASCII format — they are required for parsing. Translate only the descriptive ` +
    `error-type text and the pattern descriptions into ${lang}.`;
}

function callOpenAI(apiKey, systemPrompt, userContent) {
  return new Promise((resolve, reject) => {
    const payload = JSON.stringify({
      model: "gpt-4o",
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user",   content: userContent  }
      ],
      temperature: 0.2,
      max_tokens: 1500
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
        let data = "";
        res.on("data", chunk => (data += chunk));
        res.on("end", () => {
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

  // Trim keys + fall back from OPENAI_API_KEY to ALT_OPENAI_KEY on auth errors
  // (a corrupted OPENAI_API_KEY was causing 401s).
  const _keys = [];
  for (const k of [process.env.OPENAI_API_KEY, process.env.ALT_OPENAI_KEY]) {
    if (k && k.trim() && _keys.indexOf(k.trim()) === -1) _keys.push(k.trim());
  }
  if (!_keys.length) {
    return { statusCode: 500, body: JSON.stringify({ error: "No OpenAI API key set (OPENAI_API_KEY / ALT_OPENAI_KEY)" }) };
  }

  let body;
  try {
    body = JSON.parse(event.body);
  } catch(e) {
    return { statusCode: 400, body: JSON.stringify({ error: "Invalid request" }) };
  }

  const { questions, language } = body; // array of { question, transcript }
  if (!questions || !Array.isArray(questions) || questions.length === 0) {
    return { statusCode: 400, body: JSON.stringify({ error: "Missing questions array" }) };
  }

  const questionBlocks = questions.map((q, i) =>
    `Q${i + 1}:\nQuestion: ${q.question}\nStudent response: ${q.transcript}`
  ).join("\n\n");

  try {
    let result, lastErr;
    for (const key of _keys) {
      try {
        result = await callOpenAI(key, withLanguage(GRAMMAR_SYSTEM, language), questionBlocks);
        lastErr = null;
        break;
      } catch (e) {
        lastErr = e;
        if (e.statusCode !== 401 && e.statusCode !== 403) break;
      }
    }
    if (lastErr) throw lastErr;
    return {
      statusCode: 200,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ grammar: result })
    };
  } catch(e) {
    return {
      statusCode: 500,
      body: JSON.stringify({ error: e.message })
    };
  }
};

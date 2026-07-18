// netlify/functions/analyze.js
// Receives question text + transcript, calls GPT-4o with interview scoring prompt.
// Returns band score + feedback.

const https = require("https");

const INTERVIEW_SAMPLES = `
Sample Question (for band reference only — the student's actual questions are different):
These days many people try to improve their mornings with habits like stretching or journaling. Do you think such structured morning routines will become even more popular in the future? Why or why not?

Interview Band 5 Sample (Fully Successful — addresses question clearly and fluently, with well-developed ideas and natural pacing):
I do believe that structured morning routines will become more popular in the future because more books are being published to encourage people to change their morning habits. For example, last year I felt stuck in life, so I went to a bookstore, and I found a good book about journaling in the morning. After I started writing, I realized that many solutions to my problems were already in my mind, I just had to write them down. So now I don't feel stuck anymore. I think more people in the future will do what I do and make structured routines more popular.

Interview Band 4 Sample (Generally Successful — answers the question clearly; minor pauses or language mistakes, but meaning remains solid):
I believe that people would follow these structured routines in the future. That is because, first of all, they can feel more confident because these morning routines help them express their feelings. Also, people nowadays are care about their mental health because have too much stress every day. Also, having a clear routine, especially a fixed schedule for journaling can make lots of benefits in many aspects, such as creative writing and maybe become a writer one day. So I believe that people would accept this kind of morning routine in the future.

Interview Band 3 Sample (Partially Successful — addresses the question, but development is limited and language errors reduce clarity):
In my opinion, I don't think that will be happen in the future. This is because people need more time to sleep and do many things for family in the morning. Because. For example. Take myself for example, I can't follow this kind of morning schedule now. This is because I need to take care of family and prepare my clothes and thinking about what I need to do next, so. And fix up my mood. If I write journal or stretching in morning that will loss a lot of opportunity to finish my work and feel more calm.

Interview Band 2 Sample (Mostly Unsuccessful — attempts to answer but very limited development; frequent errors and hesitations impede meaning):
I think... maybe no. Because people, uh, busy now. Morning routine maybe good. But many people too busy. I try before, but I not continue because school and sleep and many thing. So future... maybe maybe no, depends on people.

Interview Band 1 Sample (Largely Unsuccessful — minimal response; ideas are fragmented and mostly incomprehensible):
Morning routine... maybe good. But I don't know. uh. People so busy now. I busy too. I try exercise before, but I need sleep. sleep is important. I can not get up.

Interview Band 0 Sample (No Credit — does not address the question; off-topic or no meaningful attempt):
ehmm... morning routine is good. I like exercise. it's healthy. it's good for your body.
`;

// Band-only variant: Stage 0 sends mode="band_only" because the gap analysis
// (why-not-5-speaking) carries all the written feedback there. Other stages
// have no golden sample, so they keep the full three-criterion output.
const INTERVIEW_SYSTEM_BAND_ONLY = `You are a TOEFL teacher scoring transcribed Speaking Interview responses.

The transcript comes from speech recognition. It has no real capitalization or punctuation of its own — read it as if it were entirely lowercase and unpunctuated. Score only the words the student chose.

Evaluate ONLY the text under "Student's response". The question is context.

Bands:
- Band 0: no response, no English, entirely unintelligible, or nothing connected to the question.
- Band 1: connected to the question but barely — isolated words or phrases, no developed idea.
- Band 2: attempts an answer with little or no elaboration.
- Band 3-5: match against the band samples provided.

Any content genuinely tied to the question earns at least Band 1, however short or indirect. Grammar errors only lower the band when they obscure meaning.

Output exactly two lines per question — the header line and the band line — and nothing else. No evaluation, no explanation, no advice. The "=== Q1 ===" header is required and must be kept exactly as shown, including for a single question:

=== Q1 ===
BAND:X

=== Q2 ===
BAND:X`;

const INTERVIEW_SYSTEM = `You are a TOEFL teacher scoring transcribed Speaking Interview responses.

The transcript comes from speech recognition. It has no real capitalization or punctuation of its own — read it as if it were entirely lowercase and unpunctuated. Score only the words the student chose.

Evaluate ONLY the text under "Student's response". The question is context.

Bands:
- Band 0: no response, no English, entirely unintelligible, or nothing connected to the question.
- Band 1: connected to the question but barely — isolated words or phrases, no developed idea.
- Band 2: attempts an answer with little or no elaboration.
- Band 3-5: match against the band samples provided.

Any content genuinely tied to the question earns at least Band 1, however short or indirect. Grammar errors only lower the band when they obscure meaning.

Format for each question, exactly:

=== Q1 ===
1. Organization: ...
2. Fluency & Intelligibility (inferred from text only): ...
3. Language Use (Vocabulary & Grammar): ...
BAND:X

BAND:X is always the last line, always present, never before the evaluation. Do not repeat the question or transcript.

You cannot hear the recording, so say nothing about pronunciation, intonation, or rhythm — and nothing about capitalization, punctuation, or spelling.`;

function withLanguage(systemPrompt, language) {
  const lang = (language || "").trim();
  if (!lang || lang.toLowerCase() === "english" || lang.toLowerCase() === "en") {
    return systemPrompt;
  }
  return systemPrompt +
    `\n\nLANGUAGE INSTRUCTION: Write all of your evaluation prose, explanations, and feedback in ${lang}. ` +
    `Keep grammar/linguistic terminology clear and understandable. ` +
    `\n\nCRITICAL — DO NOT TRANSLATE THESE MARKERS: the section headers (such as "=== Q1 ===", "=== Q2 ===") ` +
    `and the score line "BAND:X" must remain EXACTLY in this English/ASCII format. ` +
    `Do not translate, localize, or alter "Q", "BAND", the digits, the equals signs, or the colon. ` +
    `Only the descriptive text around them should be in ${lang}.`;
}

function callOpenAI(apiKey, systemPrompt, userContent) {
  return new Promise((resolve, reject) => {
    const payload = JSON.stringify({
      model: "gpt-4o",
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userContent }
      ],
      temperature: 0.4,
      max_tokens: 1200
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
        res.on("data", (chunk) => (data += chunk));
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

  // Trim keys (stray whitespace/newlines from adjacent multi-line env vars can
  // corrupt a key -> 401) and fall back from OPENAI_API_KEY to ALT_OPENAI_KEY.
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
  } catch(e) {
    return { statusCode: 400, body: JSON.stringify({ error: "Invalid JSON body" }) };
  }

  const { questions, language, mode } = body; // array of { question, transcript, index }
  if (!questions || !Array.isArray(questions) || questions.length === 0) {
    return { statusCode: 400, body: JSON.stringify({ error: "Missing questions array" }) };
  }

  // Build user content with all questions
  const questionBlocks = questions.map((q, i) =>
    `Q${i + 1}:\nQuestion: ${q.question}\nStudent's response: ${q.transcript}`
  ).join("\n\n");

  const userContent = `${INTERVIEW_SAMPLES}\n\n${questionBlocks}`;

  try {
    let analysis, lastErr;
    for (const key of _keys) {
      try {
        const _system = (mode === "band_only") ? INTERVIEW_SYSTEM_BAND_ONLY : INTERVIEW_SYSTEM;
        // band_only returns no prose, so there is nothing to translate.
        analysis = await callOpenAI(key, (mode === "band_only") ? _system : withLanguage(_system, language), userContent);
        lastErr = null;
        break;
      } catch (e) {
        lastErr = e;
        // Retry on auth errors and on connection-level failures (no status).
        if (e.statusCode && e.statusCode !== 401 && e.statusCode !== 403) break;
      }
    }
    if (lastErr) throw lastErr;

    // Parse per-question results using === Q1 === markers
    const parts = analysis.split(/={2,}\s*(Q\d+|OVERALL)\s*={2,}/);
    const parsed = {};

    // Fallback: a terse reply (especially in band_only mode) may drop the
    // "=== Q1 ===" header and return just "BAND:3". With no markers to split
    // on, parsed would come back empty and the caller would see no result, so
    // map any bare BAND lines onto Q1, Q2, ... in order.
    if (parts.length === 1) {
      const bares = analysis.match(/BAND:\s*\d/g) || [];
      bares.forEach((line, i) => {
        parsed["Q" + (i + 1)] = {
          band: parseInt(line.match(/\d/)[0]),
          feedback: ""
        };
      });
    }
    for (let i = 1; i < parts.length; i += 2) {
      const key     = parts[i] ? parts[i].trim() : "";
      const block   = parts[i + 1] ? parts[i + 1].trim() : "";
      if (!key) continue;
      // Band is at the END of the block
      const bandM   = block.match(/BAND:\s*(\d)/);
      // Remove BAND:X line from feedback display
      const feedback = block
        .split("\n")
        .filter(l => !/^BAND:\s*\d/.test(l.trim()))
        .join("\n")
        .trim();
      parsed[key] = {
        band:     bandM ? parseInt(bandM[1]) : null,
        feedback: feedback
      };
    }

    return {
      statusCode: 200,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ parsed, raw: analysis }),
    };
  } catch(e) {
    return {
      statusCode: 500,
      body: JSON.stringify({ error: e.message })
    };
  }
};

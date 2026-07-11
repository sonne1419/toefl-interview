// functions/stage0-feedback.js
// Compares student's Stage 0 recording transcript to the model answer.
// Returns: word count comparison + similarity assessment.

const https = require("https");

const STAGE0_SYSTEM = `You are a TOEFL speaking coach evaluating a student's attempt to reproduce a model answer.

The student was given a model answer to read and memorize, then asked to reproduce it from memory using only a structural skeleton as a guide.

Your job is to compare the student's spoken response to the model answer in terms of:
1. Discourse structure — did they follow the same logical flow (statement → before example → after example)?
2. Grammar patterns — did they use similar grammatical structures?
3. Syntactic similarity — are the sentence constructions similar?

Do NOT evaluate content accuracy — the student may use slightly different words.
Do NOT penalize for minor word substitutions if the structure is preserved.
Do NOT comment on pronunciation, intonation, or delivery.
Note that capitalization and punctuation in the transcript may be Whisper artifacts — ignore them.

Give a Similarity rating: High / Moderate / Low
Then 2-3 sentences explaining what matched well and what differed structurally.
Keep response under 100 words total.`;

function withLanguage(systemPrompt, language) {
  const lang = (language || "").trim();
  if (!lang || lang.toLowerCase() === "english" || lang.toLowerCase() === "en") {
    return systemPrompt;
  }
  return systemPrompt +
    `\n\nLANGUAGE INSTRUCTION: Write your explanation in ${lang}. ` +
    `For the Similarity rating, keep the English word (High / Moderate / Low) and you may add the ${lang} ` +
    `translation in parentheses after it.`;
}

function callOpenAI(apiKey, systemPrompt, userContent) {
  return new Promise((resolve, reject) => {
    const payload = JSON.stringify({
      model: "gpt-4o",
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user",   content: userContent  }
      ],
      temperature: 0.3,
      max_tokens: 300
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

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    return { statusCode: 500, body: JSON.stringify({ error: "OPENAI_API_KEY not set" }) };
  }

  let body;
  try {
    body = JSON.parse(event.body);
  } catch(e) {
    return { statusCode: 400, body: JSON.stringify({ error: "Invalid request" }) };
  }

  const { model_answer, transcript, language } = body;
  if (!model_answer || !transcript) {
    return { statusCode: 400, body: JSON.stringify({ error: "Missing model_answer or transcript" }) };
  }

  const modelWords  = model_answer.trim().split(/\s+/).length;
  const studentWords = transcript.trim().split(/\s+/).length;

  const userContent = `Model answer (${modelWords} words):
${model_answer}

Student's response (${studentWords} words):
${transcript}`;

  try {
    const feedback = await callOpenAI(apiKey, withLanguage(STAGE0_SYSTEM, language), userContent);
    return {
      statusCode: 200,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        feedback,
        model_words:   modelWords,
        student_words: studentWords
      })
    };
  } catch(e) {
    return {
      statusCode: 500,
      body: JSON.stringify({ error: e.message })
    };
  }
};

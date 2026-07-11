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

const INTERVIEW_SYSTEM = `You are a TOEFL teacher evaluating a student's Speaking Interview responses.
This is a text-based analysis of transcribed speech.

IMPORTANT: Fluency and Intelligibility can only be inferred from the text — do NOT comment on pronunciation, intonation, rhythm, or stress. Make this limitation clear.

IMPORTANT: Evaluate ONLY the text under "Student's response". The question is provided for context only.

STEP 1 — Before assigning a band, identify the student's original contribution:
What idea, reason, or example did the student add that relates to the question? If there is none, the response cannot score higher than Band 1.

STEP 2 — Check for these scoring rules:

Band 0 rules (assign Band 0 ONLY if ANY of these apply):
- No response
- Entirely unintelligible
- No English
- The response has no meaningful connection to the prompt
- The response consists only of filler, repeated stock phrases, or generic refusal with no prompt-connected content
IMPORTANT:
Do NOT assign Band 0 if the student gives any content that is meaningfully tied to the prompt, even if the response is incomplete, indirect, evasive, very short, or says they cannot answer.
A response is prompt-connected if it:
- refers to the topic, situation, choice, opinion, problem, experience, or task in the question
- gives a related reason, example, explanation, feeling, preference, or condition
- partially answers one part of the question
- discusses why the prompt is difficult to answer in a way that is related to the prompt
Prompt-connected but weak responses should be Band 1 or Band 2, not Band 0.

Band 1 rules (assign Band 1 if ANY of these apply):
- The response is only vaguely connected to the question
- Consists mainly of isolated words or phrases with no coherent idea
- Mostly unintelligible with severely limited vocabulary
- No meaningful elaboration beyond acknowledging the topic exists

CRITICAL FORMAT RULE: BAND:X must ALWAYS appear as the last line of each question section — even for Band 0 responses. Never skip this line regardless of response quality.

Use these official rubric definitions for Band 0 and Band 1:

Band 0: No response OR the response is entirely unintelligible OR there is no English in the response OR the content is entirely unconnected to the prompt.

Band 1 (An unsuccessful response): The response minimally addresses the question, and it may demonstrate very limited control of language. A typical response exhibits the following:
- The response is only vaguely connected to language in the interviewer's question
- The response is mostly unintelligible
- The response consists mainly of isolated words or phrases

For Band 2, also use this official rubric definition:

Band 2 (A mostly unsuccessful response): The response reflects an attempt to address the question, but it is not supported in a meaningful and/or intelligible way. A typical response exhibits the following:
- The response is minimally connected to the interviewer's question, but it has little or no relevant elaboration or consists mainly of language from the question
- Intelligibility is limited; the speaker's intended meaning is often difficult to discern
- The response shows a very limited range of grammar and vocabulary

For Band 3–5, compare each response to the band samples to determine the band.

Use this EXACT format for each question — no deviations:

=== Q1 ===
[Your evaluation here]
1. Organization: ...
2. Fluency & Intelligibility (inferred from text only): ...
3. Language Use (Vocabulary & Grammar): ...
BAND:X

=== Q2 ===
[repeat structure]
BAND:X

Rules:
- X is the band (0, 1, 2, 3, 4, or 5).
- BAND:X must always be the LAST line of each question section, after the evaluation.
- Do not state the band before the evaluation.
- Do not repeat the question or transcript in your response.
- Treat grammar errors as minor issues unless they significantly impede meaning. Do not let grammar alone lower the band score.
- Ignore all capitalization and punctuation in the transcripts. These are Whisper speech recognition artifacts and do not reflect the student's actual speech.
- This is a SPOKEN response. NEVER mention, comment on, or criticize punctuation, capitalization, or spelling in your feedback. Do not raise them as issues, examples, or suggestions under any circumstances — they are irrelevant to a speaking task.`;

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
    return { statusCode: 400, body: JSON.stringify({ error: "Invalid JSON body" }) };
  }

  const { questions, language } = body; // array of { question, transcript, index }
  if (!questions || !Array.isArray(questions) || questions.length === 0) {
    return { statusCode: 400, body: JSON.stringify({ error: "Missing questions array" }) };
  }

  // Build user content with all questions
  const questionBlocks = questions.map((q, i) =>
    `Q${i + 1}:\nQuestion: ${q.question}\nStudent's response: ${q.transcript}`
  ).join("\n\n");

  const userContent = `${INTERVIEW_SAMPLES}\n\n${questionBlocks}`;

  try {
    const analysis = await callOpenAI(apiKey, withLanguage(INTERVIEW_SYSTEM, language), userContent);

    // Parse per-question results using === Q1 === markers
    const parts = analysis.split(/={2,}\s*(Q\d+|OVERALL)\s*={2,}/);
    const parsed = {};
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

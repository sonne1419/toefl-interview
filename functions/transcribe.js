// netlify/functions/transcribe.js
// Receives a base64-encoded audio blob, sends to OpenAI Whisper API, returns transcript.

const https = require("https");
const { Readable } = require("stream");

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

  const { audio_base64, filename } = body;
  if (!audio_base64) {
    return { statusCode: 400, body: JSON.stringify({ error: "Missing audio_base64" }) };
  }

  const audioBuffer = Buffer.from(audio_base64, "base64");
  const fname = filename || "recording.webm";

  // Build multipart/form-data manually
  const boundary = "----WhisperBoundary" + Date.now();
  const CRLF = "\r\n";

  const modelPart =
    `--${boundary}${CRLF}` +
    `Content-Disposition: form-data; name="model"${CRLF}${CRLF}` +
    `whisper-1${CRLF}`;

  const languagePart =
    `--${boundary}${CRLF}` +
    `Content-Disposition: form-data; name="language"${CRLF}${CRLF}` +
    `en${CRLF}`;

  const fileHeader =
    `--${boundary}${CRLF}` +
    `Content-Disposition: form-data; name="file"; filename="${fname}"${CRLF}` +
    `Content-Type: audio/webm${CRLF}${CRLF}`;

  const closing = `${CRLF}--${boundary}--${CRLF}`;

  const bodyBuffer = Buffer.concat([
    Buffer.from(modelPart),
    Buffer.from(languagePart),
    Buffer.from(fileHeader),
    audioBuffer,
    Buffer.from(closing),
  ]);

  const transcript = await new Promise((resolve, reject) => {
    const req = https.request(
      {
        hostname: "api.openai.com",
        path: "/v1/audio/transcriptions",
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": `multipart/form-data; boundary=${boundary}`,
          "Content-Length": bodyBuffer.length,
        },
      },
      (res) => {
        let data = "";
        res.on("data", (chunk) => (data += chunk));
        res.on("end", () => {
          try {
            const json = JSON.parse(data);
            if (json.error) reject(new Error(json.error.message));
            else resolve(json.text || "");
          } catch(e) {
            reject(new Error("Failed to parse Whisper response"));
          }
        });
      }
    );
    req.on("error", reject);
    req.write(bodyBuffer);
    req.end();
  });

  return {
    statusCode: 200,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ transcript }),
  };
};

// netlify/functions/transcribe.js
// Receives a base64-encoded audio blob, sends to OpenAI Whisper API, returns transcript.

const https = require("https");
const { Readable } = require("stream");

// Safe fingerprint of a key: length, first/last 4 chars, and whether it has
// leading/trailing whitespace or stray quotes (signs of env corruption).
function keyFingerprint(k) {
  if (!k) return { present: false };
  return {
    present: true,
    length: k.length,
    first4: k.slice(0, 4),
    last4: k.slice(-4),
    hasLeadingSpace: /^\s/.test(k),
    hasTrailingSpace: /\s$/.test(k),
    hasQuote: /['"]/.test(k),
    hasNewline: /[\r\n]/.test(k)
  };
}

// Debug mode is opt-in via {"debug_keys":true} in the POST body.
function body_debug_keys(event) {
  try { return JSON.parse(event.body || "{}").debug_keys === true; }
  catch (e) { return false; }
}

exports.handler = async (event) => {
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, body: "Method Not Allowed" };
  }

  // Candidate keys in priority order, trimmed (stray whitespace/newlines in an
  // env var cause "authentication token is not from a valid issuer"). We try
  // each until one succeeds, so a bad OPENAI_API_KEY falls back to ALT_OPENAI_KEY.
  const rawPrimary = process.env.OPENAI_API_KEY || "";
  const rawAlt     = process.env.ALT_OPENAI_KEY || "";

  // Safe diagnostic: report only lengths + last 4 chars, never the full key.
  // Lets us see if OPENAI_API_KEY was corrupted (e.g. trailing newline/quote
  // bleeding in from an adjacent multi-line env var like GOOGLE_SERVICE_ACCOUNT_JSON).
  if (body_debug_keys(event)) {
    return {
      statusCode: 200,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        OPENAI_API_KEY: keyFingerprint(rawPrimary),
        ALT_OPENAI_KEY: keyFingerprint(rawAlt),
        identical_trimmed: rawPrimary.trim() === rawAlt.trim(),
        identical_raw: rawPrimary === rawAlt
      })
    };
  }

  const rawKeys = [rawPrimary, rawAlt];
  const apiKeys = [];
  for (const k of rawKeys) {
    if (k && k.trim() && apiKeys.indexOf(k.trim()) === -1) apiKeys.push(k.trim());
  }
  if (!apiKeys.length) {
    return { statusCode: 500, body: JSON.stringify({ error: "No OpenAI API key set (OPENAI_API_KEY / ALT_OPENAI_KEY)" }) };
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

  function callWhisper(key) {
    return new Promise((resolve, reject) => {
      const req = https.request(
        {
          hostname: "api.openai.com",
          path: "/v1/audio/transcriptions",
          method: "POST",
          headers: {
            Authorization: `Bearer ${key}`,
            "Content-Type": `multipart/form-data; boundary=${boundary}`,
            "Content-Length": bodyBuffer.length,
          },
        },
        (res) => {
          let data = "";
          res.on("data", (chunk) => (data += chunk));
          res.on("end", () => {
            if (res.statusCode < 200 || res.statusCode >= 300) {
              let msg = data;
              try { const j = JSON.parse(data); if (j.error) msg = j.error.message; } catch (e) {}
              const err = new Error(`Whisper ${res.statusCode}: ${msg}`);
              err.statusCode = res.statusCode;
              reject(err);
              return;
            }
            try {
              const json = JSON.parse(data);
              if (json.error) reject(new Error(json.error.message));
              else resolve(json.text || "");
            } catch(e) {
              reject(new Error("Failed to parse Whisper response: " + data.slice(0, 200)));
            }
          });
        }
      );
      req.on("error", reject);
      req.write(bodyBuffer);
      req.end();
    });
  }

  let transcript;
  let lastErr;
  for (const key of apiKeys) {
    try {
      transcript = await callWhisper(key);
      lastErr = null;
      break;
    } catch (err) {
      lastErr = err;
      // Only fall through to the next key on auth errors (401/403).
      if (err.statusCode !== 401 && err.statusCode !== 403) break;
    }
  }

  if (lastErr) {
    return {
      statusCode: 502,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ error: lastErr.message || String(lastErr) }),
    };
  }

  return {
    statusCode: 200,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ transcript }),
  };
};

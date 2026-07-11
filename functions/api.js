// functions/api.js
// Handles key validation + dynamic data serving
// Replaces validate-key.js and eliminates need for practice/index.json

const fs   = require("fs");
const path = require("path");
const https = require("https");
const http  = require("http");

// ── Key validation ────────────────────────────────
function fetchURL(url) {
  return new Promise((resolve, reject) => {
    const client = url.startsWith("https") ? https : http;
    client.get(url, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        return fetchURL(res.headers.location).then(resolve).catch(reject);
      }
      let data = "";
      res.on("data", chunk => (data += chunk));
      res.on("end", () => resolve(data));
    }).on("error", reject);
  });
}

function parseCSV(text) {
  const lines = text.trim().split("\n").map(l => l.trim()).filter(Boolean);
  if (lines.length < 2) return [];
  const headers = lines[0].split(",").map(h => h.trim().replace(/^"|"$/g, ""));
  return lines.slice(1).map(line => {
    const values = line.split(",").map(v => v.trim().replace(/^"|"$/g, ""));
    const obj = {};
    headers.forEach((h, i) => { obj[h] = values[i] || ""; });
    return obj;
  });
}

function isExpired(activatedAt, durationDays) {
  if (!activatedAt || !durationDays) return false;
  const start    = new Date(activatedAt);
  const duration = parseInt(durationDays);
  if (isNaN(start.getTime()) || isNaN(duration)) return false;
  const expiry = new Date(start.getTime() + duration * 24 * 60 * 60 * 1000);
  return new Date() > expiry;
}

async function validateKey(key) {
  const csvUrl = process.env.KEYS_CSV_URL;
  if (!csvUrl) return { valid: false, error: "KEYS_CSV_URL not configured" };

  let csvText;
  try {
    csvText = await fetchURL(csvUrl);
  } catch(e) {
    return { valid: false, error: "Could not reach key database." };
  }

  const rows = parseCSV(csvText);
  const row  = rows.find(r => r.key && r.key.trim().toLowerCase() === key.trim().toLowerCase());

  if (!row) return { valid: false, error: "Invalid access key." };
  if (row.status && row.status.trim().toLowerCase() !== "active")
    return { valid: false, error: "This key is no longer active." };
  if (isExpired(row.activatedAt, row.durationDays))
    return { valid: false, error: "This key has expired." };

  return { valid: true };
}

// ── Data helpers ──────────────────────────────────
// In Netlify Lambda, included_files land next to the bundle root (process.cwd()).
// In local netlify dev, the project root is process.cwd().
// Fall back through several candidates so it works in both environments.
function findDir(subdir) {
  const candidates = [
    path.resolve(process.cwd(), subdir),          // Lambda & netlify dev (project root)
    path.resolve(__dirname, subdir),              // same-level as function file
    path.resolve(__dirname, "..", subdir),        // one level up
    path.resolve(__dirname, "../..", subdir),     // two levels up (legacy)
  ];
  return candidates.find(p => fs.existsSync(p)) || candidates[0];
}

const SETS_DIR   = findDir("practice/sets");
const STAGE0_DIR = findDir("practice/stage0");

function listSets() {
  const results = [];

  if (fs.existsSync(SETS_DIR)) {
    fs.readdirSync(SETS_DIR).filter(f => f.endsWith(".json")).sort().forEach(f => {
      try {
        const data = JSON.parse(fs.readFileSync(path.join(SETS_DIR, f), "utf8"));
        results.push({
          file:      f,
          dir:       "sets",
          set_id:    data.set_id    || data.id    || f.replace(".json", ""),
          label:     data.set_label || data.set_id || data.label || data.id || f.replace(".json", ""),
          order:     (typeof data.order === "number") ? data.order : null,
          questions: (data.questions || []).length
        });
      } catch(e) {
        results.push({ file: f, dir: "sets", set_id: f.replace(".json",""), label: f.replace(".json",""), order: null, questions: 0 });
      }
    });
  }

  // Sort by explicit `order` (serial 1..N) when present; sets without an order
  // sink to the bottom. Filename is the tiebreaker so ties/unordered stay stable.
  results.sort((a, b) => {
    const ao = (a.order == null) ? Infinity : a.order;
    const bo = (b.order == null) ? Infinity : b.order;
    if (ao !== bo) return ao - bo;
    return a.file.localeCompare(b.file);
  });

  return results;
}

function listStage0() {
  if (!fs.existsSync(STAGE0_DIR)) return [];
  const files = fs.readdirSync(STAGE0_DIR)
    .filter(f => f.endsWith(".json"))
    .sort();

  return files.map(f => {
    try {
      const raw  = fs.readFileSync(path.join(STAGE0_DIR, f), "utf8");
      const data = JSON.parse(raw);
      return {
        file:  f,
        id:    data.id    || f.replace(".json", ""),
        label: data.label || data.id || f.replace(".json", "")
      };
    } catch(e) {
      return { file: f, id: f.replace(".json", ""), label: f.replace(".json", "") };
    }
  });
}

// ── Handler ───────────────────────────────────────
exports.handler = async (event) => {
  const method = event.httpMethod;

  // POST — key validation
  if (method === "POST") {
    let body;
    try { body = JSON.parse(event.body); } catch(e) {
      return { statusCode: 400, body: JSON.stringify({ valid: false, error: "Invalid request" }) };
    }
    const result = await validateKey(body.key || "");
    return {
      statusCode: 200,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(result)
    };
  }

  // GET — data serving (requires valid key as query param)
  if (method === "GET") {
    const params = event.queryStringParameters || {};
    const key    = params.key || "";
    const op     = params.op  || "";

    // Validate key for all GET requests
    const auth = await validateKey(key);
    if (!auth.valid) {
      return { statusCode: 403, body: JSON.stringify({ error: auth.error }) };
    }

    // List all practice sets
    if (op === "list_sets") {
      return {
        statusCode: 200,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(listSets())
      };
    }

    // List all stage0 samples
    if (op === "list_stage0") {
      return {
        statusCode: 200,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(listStage0())
      };
    }

    // Serve a specific set JSON
    if (op === "get_set" && params.file) {
      const basename = path.basename(params.file);
      const dir      = params.dir === "stage0" ? STAGE0_DIR : SETS_DIR;
      const filePath = path.resolve(dir, basename);

      // Fallback: check stage0 dir if not found in sets dir
      const fallback = path.resolve(STAGE0_DIR, basename);
      const target   = fs.existsSync(filePath) ? filePath
                     : fs.existsSync(fallback)  ? fallback
                     : null;

      if (!target) {
        return { statusCode: 404, body: JSON.stringify({ error: "Set not found" }) };
      }

      const raw  = fs.readFileSync(target, "utf8");
      const data = JSON.parse(raw);

      // If this is a stage0 file, wrap it into the set format the frontend expects
      if (!data.questions) {
        const audioName    = basename.replace(".json", ".mp3");
        const derivedAudio = `/practice/stage0/audio/${audioName}`;
        const wrapped = {
          set_id:    data.id    || basename.replace(".json", ""),
          set_label: data.label || data.id || basename.replace(".json", ""),
          format:    "stage0",
          questions: [{
            question_id: data.id || "q1",
            q:           data.question,
            audio:       derivedAudio,   // always use stage0/audio/<name>.mp3
            blocks:      data.blocks
          }]
        };
        return {
          statusCode: 200,
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(wrapped)
        };
      }

      return {
        statusCode: 200,
        headers: { "Content-Type": "application/json" },
        body: raw
      };
    }

    // Serve a specific stage0 sample JSON
    if (op === "get_stage0" && params.file) {
      const filePath = path.resolve(STAGE0_DIR, path.basename(params.file));
      if (!fs.existsSync(filePath)) {
        return { statusCode: 404, body: JSON.stringify({ error: "Stage0 sample not found" }) };
      }
      return {
        statusCode: 200,
        headers: { "Content-Type": "application/json" },
        body: fs.readFileSync(filePath, "utf8")
      };
    }

    return { statusCode: 400, body: JSON.stringify({ error: "Invalid operation" }) };
  }

  return { statusCode: 405, body: "Method Not Allowed" };
};

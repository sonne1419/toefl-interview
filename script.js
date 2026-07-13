// ═══════════════════════════════════════════════════
// INTERVIEW PRACTICE — script.js
// ═══════════════════════════════════════════════════

const PRACTICE_REASONS = {
  r1: "Relationship / Image",
  r2: "Efficiency / Performance",
  r3: "Energy / Stress"
};

const STAGE_META = {
  1: { title: "Statement & Reason",  instruction: "Say your answer and one reason.",
       intro: "Read the question and focus on just the first two sentences of your answer. When you are ready, press the record button. As you become more comfortable with the structure, try hiding the question text and the answer cues. Transcript and analysis will be shown after Q4." },
  2: { title: "Before Example",      instruction: "Practice the before/past example block.",
       intro: "Read the question and focus on just the Before Example part of your answer. When you are ready, press the record button. As you become more comfortable with the structure, try hiding the question text and the answer cues. Transcript and analysis will be shown after Q4." },
  3: { title: "After Example",       instruction: "Practice the after/current result block.",
       intro: "Read the question and focus on just the After Example part of your answer. When you are ready, press the record button. As you become more comfortable with the structure, try hiding the question text and the answer cues. Transcript and analysis will be shown after Q4." },
  4: { title: "Full Answer",         instruction: "Use the short cues to speak the full answer.",
       intro: "Read the question and focus on the full answer. When you are ready, press the record button. As you become more comfortable with the structure, try hiding the question text and the answer cues. Transcript and analysis will be shown after Q4." },
  5: { title: "Exam Mode",           instruction: "Exam mode — no cues.",
       intro: "" }
};

// Fixed time limits per stage (seconds)
const STAGE_TIME = { 1: 10, 2: 15, 3: 20 };

const STATE = {
  micStream:        null,
  mediaRecorder:    null,
  audioChunks:      [],
  recordings:       [],
  timerInterval:    null,
  micWarmedUp:      false,
  selectedStage:    null,
  testIndex:        [],
  currentQuestion:  null,
  currentTask:      null,
  _timerResolve:    null,
  _endCalled:       false,
  _audioResolve:    null,   // resolve handle to abort audio early
  _recordResolve:   null,   // resolve handle for record button press
  _saveResolve:     null,   // resolve handle for save/re-record wait
  _questionActive:  false   // true while a question is running
};

// ═══════════════════════════════════════════════════
// UTILITIES
// ═══════════════════════════════════════════════════

function $(id) { return document.getElementById(id); }
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// Resolve the interviewer image. interviewer_image (e.g. "assets/af.webp") is
// authoritative; if it's missing, fall back to a gendered PNG derived from the
// speaker code (bm/am -> male, bf/af -> female).
function analysisLang() {
  return localStorage.getItem("analysis_lang") || "";
}

function interviewerImageSrc(task) {
  if (task.interviewer_image) return task.interviewer_image;
  const code = (task.interviewer_gender || "").toLowerCase();
  const isMale = code === "bm" || code === "am" || code === "male";
  return isMale ? "assets/interviewer_male.png" : "assets/interviewer_female.png";
}

async function warmupAudioContext() {
  try {
    const ctx    = new (window.AudioContext || window.webkitAudioContext)();
    const buffer = ctx.createBuffer(1, 1, 22050);
    const source = ctx.createBufferSource();
    source.buffer = buffer;
    source.connect(ctx.destination);
    source.start(0);
    await ctx.resume();
  } catch(e) {
    console.log("Audio warmup failed:", e);
  }
}

function showScreen(id) {
  // Stop the Stage 0 sample player when navigating away from the Stage 0 screen,
  // so its audio never bleeds into another mode (e.g. exam).
  if (id !== "screen-stage0") {
    const s0 = $("stage0-audio-player");
    if (s0) { try { s0.pause(); s0.currentTime = 0; } catch (e) {} }
  }
  document.querySelectorAll(".screen").forEach(s => {
    s.classList.add("hidden");
    s.classList.remove("active");
  });
  $(id).classList.remove("hidden");
  $(id).classList.add("active");
}

function escapeHTML(str) {
  return String(str || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function normalizeTranscript(text) {
  if (!text) return "";
  return text.replace(/\s+/g, " ").trim();
}

// ── Grammar change highlighting (ported from the Academic Discussion tool) ──
// Highlights the changed words on BOTH sides: removed words in the Original
// and added words in the Revised, plus bolds the format labels.
function highlightGrammarChanges(text) {
  if (!text) return text;
  // Strip the === Qn === section markers (parsing artifacts, not for display)
  text = text.replace(/===\s*Q\d+\s*===/gi, "").replace(/^\s*\n/gm, "").trim();
  const lines = text.split(/\n/);
  // Find adjacent Original/Revised pairs and diff them
  for (let i = 0; i < lines.length; i++) {
    const om = lines[i].match(/^(\s*Original:\s*)([\s\S]*)$/i);
    if (!om) continue;
    // find the next Revised line (an Error line may sit between)
    let j = i + 1;
    while (j < lines.length && !/^\s*Revised:/i.test(lines[j]) && !/^\s*Error:/i.test(lines[j])) j++;
    let k = j;
    while (k < lines.length && !/^\s*Revised:/i.test(lines[k])) k++;
    if (k >= lines.length) continue;
    const rm = lines[k].match(/^(\s*Revised:\s*)([\s\S]*)$/i);
    if (!rm) continue;

    const oWords = om[2].split(/(\s+)/); // keep whitespace tokens
    const rWords = rm[2].split(/(\s+)/);
    const diff = wordDiff(oWords.filter(w => w.trim()), rWords.filter(w => w.trim()));

    lines[i] = om[1] + markWords(om[2], diff.removed);
    lines[k] = rm[1] + markWords(rm[2], diff.added);
  }
  return lines.join("\n");
}

// LCS-based word diff → which words are removed (in original) / added (in revised)
function wordDiff(a, b) {
  const n = a.length, m = b.length;
  const dp = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--)
    dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
  const removed = new Set(), added = new Set();
  let i = 0, j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) { i++; j++; }
    else if (dp[i + 1][j] >= dp[i][j + 1]) { removed.add(i); i++; }
    else { added.add(j); j++; }
  }
  while (i < n) { removed.add(i); i++; }
  while (j < m) { added.add(j); j++; }
  return { removed, added };
}

// Re-walk the sentence's non-space words, wrapping flagged ones in ⟦…⟧ sentinels
function markWords(sentence, idxSet) {
  if (!idxSet || !idxSet.size) return sentence;
  let wi = -1;
  return sentence.replace(/\S+/g, (w) => {
    wi++;
    return idxSet.has(wi) ? "⟦" + w + "⟧" : w;
  });
}

// Escape text, bold the format labels, and convert ⟦…⟧ sentinels into styled spans
function escWithLabels(str) {
  const safe = escapeHTML(str);
  const labels = ["Original", "Error", "Revised"];
  let out = safe;
  labels.forEach(lbl => {
    const escLbl = escapeHTML(lbl).replace(/[.*+?^${}()|[\]\\/]/g, "\\$&");
    const re = new RegExp("(^|\\n|<br>)([\\-•]\\s*)?(" + escLbl + ")(:)", "g");
    out = out.replace(re, (_, br, bullet, name, colon) => `${br}${bullet || ""}<strong>${name}${colon}</strong>`);
  });
  // ⟦…⟧ change sentinels → bold red (escapeHTML left them intact)
  out = out.replace(/⟦([\s\S]*?)⟧/g, '<strong style="color:#c0392b;">$1</strong>');
  return out;
}

// ── UI translation (ported from the Academic Discussion tool) ──
// Translates an ENGLISH source string into the student's analysis_lang and writes
// it into element `el`. Caches each unique (language + source) pair in localStorage,
// so each string is fetched from the API only once. English / no language → shows
// the original immediately with no API call. asHTML=true renders "\n" as <br>.
async function translateUI(text, el, asHTML) {
  if (!el) return;
  const raw = (text || "").trim();
  const render = (t) => {
    if (asHTML) el.innerHTML = escapeHTML(t).replace(/\n/g, "<br>");
    else el.textContent = t;
  };
  if (!raw) { render(""); return; }

  const lang = (localStorage.getItem("analysis_lang") || "").trim();
  if (!lang || lang.toLowerCase() === "english") { render(raw); return; }

  // Cache lookup — key is language + exact English source
  const cacheKey = "ui_tr::" + lang.toLowerCase() + "::" + raw;
  try {
    const cached = localStorage.getItem(cacheKey);
    if (cached !== null) { render(cached); return; }
  } catch(e) {}

  // Show English first (no blank flash), then replace when the translation lands
  render(raw);
  try {
    const res = await fetch("/.netlify/functions/translate", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: raw, language: lang })
    });
    const data = await res.json();
    const tr = (data.translation || "").trim();
    if (tr) {
      render(tr);
      try { localStorage.setItem(cacheKey, tr); } catch(e) {}
    }
  } catch(e) {
    console.warn("UI translation failed:", e.message);  // leave English showing
  }
}

// Translate all [data-tr] static UI elements within a container (AD pattern).
// Each element's data-tr holds the English source; translateUI handles cache/fetch.
function translateStaticEls(containerSelector) {
  const root = containerSelector ? document.querySelector(containerSelector) : document;
  if (!root) return;
  root.querySelectorAll("[data-tr]").forEach(el => {
    translateUI(el.getAttribute("data-tr"), el, false);
  });
}

// Pre-fill the translation cache in the background so static UI text doesn't
// flash English on first view. (AD pattern: one batch call, per-string fallback.)
async function warmUpTranslations() {
  const lang = (localStorage.getItem("analysis_lang") || "").trim();
  if (!lang || lang.toLowerCase() === "english") return;

  // Build the string list from where the text actually lives (no hardcoded
  // duplicates, so it can't drift from what's displayed):
  //  - every STAGE_META intro + instruction
  //  - the stage-4 word-count note
  //  - every [data-tr] element currently in the DOM
  const set = new Set();
  Object.keys(STAGE_META).forEach(k => {
    if (STAGE_META[k].intro)       set.add(STAGE_META[k].intro.trim());
    if (STAGE_META[k].instruction) set.add(STAGE_META[k].instruction.trim());
  });
  set.add("Responses of 80 words and above are recommended.");
  if (STAGE_META[4] && STAGE_META[4].instruction) {
    set.add((STAGE_META[4].instruction + "\nResponses of 80 words and above are recommended.").trim());
  }
  document.querySelectorAll("[data-tr]").forEach(el => {
    const t = (el.getAttribute("data-tr") || "").trim();
    if (t) set.add(t);
  });

  const all = [...set].filter(Boolean);
  const uncached = [];
  for (const raw of all) {
    const cacheKey = "ui_tr::" + lang.toLowerCase() + "::" + raw;
    try { if (localStorage.getItem(cacheKey) !== null) continue; } catch(e) {}
    uncached.push(raw);
  }
  if (!uncached.length) return;

  // Try ONE batch call for all uncached strings.
  try {
    const res = await fetch("/.netlify/functions/translate", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ texts: uncached, language: lang })
    });
    const data = await res.json();
    if (data && Array.isArray(data.translations) && data.translations.length === uncached.length) {
      uncached.forEach((src, i) => {
        const tr = (data.translations[i] || "").trim();
        if (tr) { try { localStorage.setItem("ui_tr::" + lang.toLowerCase() + "::" + src, tr); } catch(e) {} }
      });
      return; // done in one call
    }
  } catch(e) {
    // fall through to per-string
  }

  // Fallback: per-string (only if the batch failed or returned null).
  for (const raw of uncached) {
    const cacheKey = "ui_tr::" + lang.toLowerCase() + "::" + raw;
    try {
      const res = await fetch("/.netlify/functions/translate", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: raw, language: lang })
      });
      const data = await res.json();
      const tr = (data.translation || "").trim();
      if (tr) localStorage.setItem(cacheKey, tr);
    } catch(e) {
      // Silently skip — translateUI will retry live when needed
    }
  }
}

function countWords(text) {
  if (!text || !text.trim()) return 0;
  return text.trim().split(/\s+/).length;
}

function applyHighlights(escapedText, phrases) {
  if (!phrases || phrases.length === 0) return escapedText;
  let result = escapedText;
  for (const phrase of phrases) {
    if (!phrase) continue;
    const ep = escapeHTML(phrase);
    result = result.split(ep).join(
      `<mark class="practice-question-highlight">${ep}</mark>`
    );
  }
  return result;
}

function getRunLabel(keyPrefix, stage, qid) {
  const date  = new Date().toISOString().slice(0, 10).replace(/-/g, "");
  const key   = `${keyPrefix}_interview_stage${stage}_${qid}_${date}`;
  const count = STATE.recordings.filter(r => r.filename.startsWith(key)).length;
  return count === 0 ? key : `${key}_run${count + 1}`;
}

// ═══════════════════════════════════════════════════
// AUDIO — matches playAudioReliable pattern
// ═══════════════════════════════════════════════════

function playAudioReliable(src) {
  return new Promise(resolve => {
    if (!src) { resolve(); return; }
    const audio = $("question-audio-player");
    audio.pause();
    audio.currentTime = 0;
    audio.src = src;
    audio.volume = 1.0;

    STATE._audioResolve = resolve;

    function cleanup() {
      STATE._audioResolve = null;
      audio.onended = null;
      audio.onerror = null;
      audio.oncanplaythrough = null;
      resolve();
    }

    audio.onended = cleanup;
    audio.onerror = cleanup;
    audio.oncanplaythrough = () => {
      setTimeout(() => {
        audio.play().catch(() => cleanup());
      }, 800);
    };
    audio.load();
  });
}

function stopAudio() {
  const audio = $("question-audio-player");
  audio.pause();
  audio.currentTime = 0;   // rewind but keep the src so the bar stays replayable
  if (STATE._audioResolve) {
    const r = STATE._audioResolve;
    STATE._audioResolve = null;
    r();
  }
}

// ═══════════════════════════════════════════════════
// MICROPHONE — held for entire session
// ═══════════════════════════════════════════════════

async function ensureMic() {
  if (STATE.micStream) return true;
  try {
    STATE.micStream = await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: false,
        noiseSuppression: false,
        autoGainControl: false
      }
    });
    return true;
  } catch(e) {
    return false;
  }
}

function startRecording() {
  STATE.audioChunks = [];
  STATE.mediaRecorder = new MediaRecorder(STATE.micStream);
  STATE.mediaRecorder.ondataavailable = e => STATE.audioChunks.push(e.data);
  STATE.mediaRecorder.start();
}

function stopRecording() {
  return new Promise(resolve => {
    if (!STATE.mediaRecorder || STATE.mediaRecorder.state === "inactive") {
      resolve(new Blob([], { type: "audio/webm" })); return;
    }
    STATE.mediaRecorder.onstop = () => {
      resolve(new Blob(STATE.audioChunks, { type: "audio/webm" }));
    };
    STATE.mediaRecorder.stop();
  });
}

// Read-only check of the browser's microphone permission. Returns
// "granted" | "denied" | "prompt" | "unknown" (unknown on browsers like Safari
// that can't query the microphone permission).
async function micPermissionState() {
  try {
    const status = await navigator.permissions.query({ name: "microphone" });
    return status.state;
  } catch (e) {
    return "unknown";
  }
}

function releaseMic() {
  if (STATE.micStream) {
    STATE.micStream.getTracks().forEach(t => t.stop());
    STATE.micStream = null;
  }
}

// ═══════════════════════════════════════════════════
// TIMER
// ═══════════════════════════════════════════════════

function startResponseTimer(seconds) {
  clearInterval(STATE.timerInterval);
  return new Promise(resolve => {
    STATE._timerResolve = resolve;
    let remaining = seconds;
    updateTimerDisplay(remaining);
    $("response-timer-box").classList.remove("hidden");

    STATE.timerInterval = setInterval(() => {
      remaining--;
      updateTimerDisplay(remaining);
      if (remaining <= 0) {
        clearInterval(STATE.timerInterval);
        STATE._timerResolve = null;
        resolve();
      }
    }, 1000);
  });
}

function abortTimer() {
  clearInterval(STATE.timerInterval);
  if (STATE._timerResolve) {
    STATE._timerResolve();
    STATE._timerResolve = null;
  }
}

function updateTimerDisplay(seconds) {
  const s   = Math.max(0, seconds);
  const m   = Math.floor(s / 60).toString().padStart(2, "0");
  const sec = (s % 60).toString().padStart(2, "0");
  $("response-timer-digits").textContent = `${m}:${sec}`;
}

// ═══════════════════════════════════════════════════
// RECORD BUTTON STATE
// ═══════════════════════════════════════════════════

function setRecordBtn(state) {
  const btn = $("btn-record");
  btn.classList.remove("pulse", "recording", "hidden");
  if (state === "hidden") btn.classList.add("hidden");
  else btn.classList.add(state);
}

function showPostRecordButtons() {
  setRecordBtn("hidden");
  $("response-timer-box").classList.add("hidden");
  $("post-record-buttons").classList.remove("hidden");
}

function hidePostRecordButtons() {
  $("post-record-buttons").classList.add("hidden");
}

// Wait for Save & Next or Record Again
async function waitForSaveOrRerecord(responseTime) {
  while (true) {
    // Wait for either button
    const action = await new Promise(resolve => {
      STATE._saveResolve = resolve;
      $("btn-save-next").onclick   = () => { STATE._saveResolve = null; resolve("save"); };
      $("btn-record-again").onclick = () => { STATE._saveResolve = null; resolve("rerecord"); };
    });

    if (STATE._endCalled) return;

    if (action === "save") return;

    // Re-record — start immediately, no extra press needed
    hidePostRecordButtons();
    STATE._lastBlob = null;

    const ok = await ensureMic();
    if (!ok || STATE._endCalled) return;

    setRecordBtn("recording");
    startRecording();

    await startResponseTimer(responseTime);
    if (STATE._endCalled) return;

    if (STATE.mediaRecorder && STATE.mediaRecorder.state === "recording") {
      const blob = await stopRecording();
      STATE._lastBlob = blob;
    }

    showPostRecordButtons();
  }
}

// Wait for record button press
function waitForRecordPress() {
  return new Promise(resolve => {
    STATE._recordResolve = resolve;
  });
}

$("btn-record").onclick = async () => {
  if ($("btn-record").classList.contains("hidden")) return;

  if ($("btn-record").classList.contains("recording")) {
    // Stop recording early — show post-record buttons
    abortTimer();
    const blob = await stopRecording();
    STATE._lastBlob = blob;
    showPostRecordButtons();
    return;
  }

  // Pulsing state — start recording
  STATE._recordPressed = true;
  stopAudio();
  if (STATE._recordResolve) {
    const r = STATE._recordResolve;
    STATE._recordResolve = null;
    r();
  }
};

// ═══════════════════════════════════════════════════
// SCREEN: START
// ═══════════════════════════════════════════════════

async function loadTestIndex() {
  try {
    const key = sessionStorage.getItem("access_key") || "";
    const res = await fetch(`/.netlify/functions/api?op=list_sets&key=${encodeURIComponent(key)}`);
    if (!res.ok) throw new Error();
    STATE.testIndex = await res.json();
  } catch(e) {
    $("start-status").textContent = "⚠ Could not load test list.";
    return;
  }

  const sel = $("test-selector");
  sel.innerHTML = '<option value="">-- Select a test --</option>';
  STATE.testIndex.forEach(t => {
    const opt = document.createElement("option");
    opt.value = t.file;
    opt.dataset.dir = t.dir || "sets";
    opt.textContent = t.label;
    sel.appendChild(opt);
  });
}

function checkStartReady() {
  const stage = $("stage-selector").value;
  if (stage === "") {
    $("btn-start-session").disabled = true;
    return;
  }
  if (stage === "0") {
    // Stage 0 needs no test
    $("test-selector-group").style.display = "none";
    $("btn-start-session").disabled = false;
  } else {
    // Stages 1-4 need a test
    $("test-selector-group").style.display = "";
    $("btn-start-session").disabled = $("test-selector").value === "";
  }
}

$("test-selector").onchange  = checkStartReady;
$("stage-selector").onchange = checkStartReady;

$("btn-start-session").onclick = async () => {
  const testFile = $("test-selector").value;
  const stageVal = $("stage-selector").value;
  const stage    = stageVal === "" ? null : parseInt(stageVal);

  $("btn-start-session").disabled = true;
  $("start-status").textContent   = stage === 0 ? "" : "Loading...";
  STATE.selectedStage = stage;

  if (stage !== 0) {
    try {
      const key         = sessionStorage.getItem("access_key") || "";
      const selectedOpt = $("test-selector").selectedOptions[0];
      const dir         = selectedOpt ? (selectedOpt.dataset.dir || "sets") : "sets";
      const res = await fetch(`/.netlify/functions/api?op=get_set&file=${encodeURIComponent(testFile)}&dir=${encodeURIComponent(dir)}&key=${encodeURIComponent(key)}`);
      if (!res.ok) throw new Error();
      STATE.currentTask = await res.json();
    } catch(e) {
      $("start-status").textContent = "❌ Could not load test file.";
      $("btn-start-session").disabled = false;
      return;
    }
  }

  // Only reset recordings on first session start, not when continuing
  if (!STATE.micWarmedUp) {
    STATE.recordings = [];
  }
  STATE._endCalled  = false;
  $("start-status").textContent = "";

  // Mic setup. The 3-second warmup ALWAYS runs (it prevents the start-of-clip
  // cut-off). But if the browser already has microphone permission granted,
  // skip the instruction/checkbox screen and go straight to the warmup.
  if (!STATE.micWarmedUp) {
    const perm = await micPermissionState();
    if (perm === "granted") {
      showScreen("screen-warmup");
      runMicWarmup();           // still warms the mic, just no instruction step
    } else {
      showScreen("screen-mic-instruction");
    }
  } else if (STATE.selectedStage === 0) {
    startStage0();
  } else {
    startPractice();
  }
};

// ═══════════════════════════════════════════════════
// SCREEN: MIC INSTRUCTION
// ═══════════════════════════════════════════════════

$("mic-understand-check").onchange = (e) => {
  $("btn-mic-continue").disabled = !e.target.checked;
};

$("btn-mic-continue").onclick = () => {
  showScreen("screen-warmup");
};

// ═══════════════════════════════════════════════════
// SCREEN: MIC WARMUP
// ═══════════════════════════════════════════════════

async function runMicWarmup() {
  $("warmup-status").textContent = "Requesting microphone access...";

  const ok = await ensureMic();
  if (!ok) {
    $("warmup-status").textContent = "❌ Microphone access denied. Please refresh and click Allow on every visit.";
    $("btn-enable-mic").disabled = false;
    return;
  }

  $("warmup-status").textContent = "Setting up... please do not speak yet.";
  await warmupAudioContext();
  startRecording();
  await sleep(3000);
  await stopRecording(); // discard warmup blob
  // Keep mic stream alive for entire session

  STATE.micWarmedUp = true;
  $("warmup-status").textContent = "✓ Microphone ready. Starting practice...";
  await sleep(700);
  if (STATE.selectedStage === 0) {
    startStage0();
  } else {
    startPractice();
  }
}

$("btn-enable-mic").onclick = async () => {
  $("btn-enable-mic").disabled = true;
  await runMicWarmup();
};

// ═══════════════════════════════════════════════════
// END SESSION
// ═══════════════════════════════════════════════════

$("btn-end-session").onclick          = triggerEndSession;
$("btn-end-session-complete").onclick = triggerEndSession;

// Stage intro toggle
window.toggleStageIntro = function() {
  STATE._stageIntroExpanded = !STATE._stageIntroExpanded;
  $("stage-intro-body").style.display      = STATE._stageIntroExpanded ? "" : "none";
  $("stage-intro-chevron").style.transform = STATE._stageIntroExpanded ? "rotate(0deg)" : "rotate(-90deg)";
};

// Skip to next question — stop everything in the current question and advance now
$("btn-skip-question").onclick = () => {
  if (!STATE._questionActive) return;
  STATE._skipQuestion = true;

  // Stop active audio / timer
  stopAudio();
  abortTimer();

  // Stop the recorder if it is currently running (discard the take)
  if (STATE.mediaRecorder && STATE.mediaRecorder.state === "recording") {
    try { STATE.mediaRecorder.stop(); } catch (e) {}
  }

  // Reset record button UI
  setRecordBtn("hidden");
  hidePostRecordButtons();

  // Unblock whichever wait the question loop is parked on
  if (STATE._recordResolve) {
    const r = STATE._recordResolve; STATE._recordResolve = null; r();
  }
  if (STATE._saveResolve) {
    const r = STATE._saveResolve; STATE._saveResolve = null; r("save");
  }
};

function triggerEndSession() {
  if (STATE._endCalled) return;
  STATE._endCalled = true;

  stopAudio();
  abortTimer();

  // Resolve any waiting record press
  if (STATE._recordResolve) {
    STATE._recordResolve();
    STATE._recordResolve = null;
  }

  if (STATE.mediaRecorder && STATE.mediaRecorder.state === "recording") {
    STATE.mediaRecorder.onstop = () => {
      const blob = new Blob(STATE.audioChunks, { type: "audio/webm" });
      saveRecording(blob);
      releaseMic();
      endSession();
    };
    STATE.mediaRecorder.stop();
  } else {
    // Not actively recording, but a finished take may be waiting unsaved
    // (e.g. user stopped, saw post-record buttons, then ended the session).
    if (STATE._lastBlob) {
      saveRecording(STATE._lastBlob);
      STATE._lastBlob = null;
    }
    releaseMic();
    endSession();
  }
}

function saveRecording(blob) {
  const q         = STATE.currentQuestion;
  if (!q) return;
  const stage     = STATE.selectedStage;
  const qId       = q.question_id;
  const task      = STATE.currentTask;
  const keyPrefix = (sessionStorage.getItem("access_key") || "").slice(0, 3).toLowerCase();
  const setLabel  = task ? (task.set_label || task.set_id || "Set") : "Set";
  const qIndex    = STATE.currentQuestionIndex || 0;
  const fname     = getRunLabel(keyPrefix, stage, qId) + ".webm";
  STATE.recordings.push({
    stage, question_id: qId, q: q.q, audio: q.audio, blob, filename: fname,
    set_label: setLabel, test_id: task?.set_id || "test", question_index: qIndex
  });
}



// ═══════════════════════════════════════════════════
// PRACTICE FLOW
// ═══════════════════════════════════════════════════

async function startPractice() {
  const task  = STATE.currentTask;
  const stage = STATE.selectedStage;

  // Prime the audio OUTPUT pipeline once per session so the first question's
  // audio doesn't get its opening clipped. (Matches the mock-test tool's fix.)
  if (!STATE.audioPrimed) {
    await warmupAudioContext();
    STATE.audioPrimed = true;
    await sleep(200);
  }

  // Load stage meta and reasons from JSON if present, else use defaults
  if (task.stage_meta) {
    Object.keys(task.stage_meta).forEach(k => {
      const n = parseInt(k);
      if (STAGE_META[n]) {
        STAGE_META[n].title       = task.stage_meta[k].title       || STAGE_META[n].title;
        STAGE_META[n].instruction = task.stage_meta[k].instruction || STAGE_META[n].instruction;
      }
    });
  }
  if (task.reasons) {
    Object.keys(task.reasons).forEach(k => {
      if (PRACTICE_REASONS[k]) PRACTICE_REASONS[k] = task.reasons[k];
    });
  }

  // Clear any stale state from previous run
  STATE._recordResolve = null;
  STATE._recordPressed = false;
  STATE._timerResolve  = null;
  STATE._audioResolve  = null;
  STATE._endCalled     = false;
  clearInterval(STATE.timerInterval);



  // Stage 5 — Exam Mode: separate screen and flow
  if (stage === 5) {
    await runExamSession(task);
    return;
  }

  // Set interviewer image from JSON
  const imgEl = $("interview-img");
  if (imgEl) {
    imgEl.src = interviewerImageSrc(task);
  }

  // Stage intro — show expanded at session start (translated to native language)
  const introText = STAGE_META[stage] ? STAGE_META[stage].intro : "";
  translateUI(introText || "", $("stage-intro-text"), true);
  $("stage-intro-bar-text").textContent = "📋 About this stage — " + (STAGE_META[stage] ? STAGE_META[stage].title : "");
  $("stage-intro-body").style.display = "";
  $("stage-intro-chevron").style.transform = "rotate(0deg)";
  STATE._stageIntroExpanded = true;

  showScreen("screen-interview");

  const questions    = task.questions || [];
  const responseTime = stage === 4 ? (task.response_time || 45) : STAGE_TIME[stage];

  for (let i = 0; i < questions.length; i++) {
    if (STATE._endCalled) return;

    STATE._skipQuestion = false;  // reset skip flag for each question
    const question = questions[i];
    STATE.currentQuestion = question;
    STATE.currentQuestionIndex = i + 1;
    STATE._questionActive = true;

    // Validate
    for (const rKey of Object.keys(PRACTICE_REASONS)) {
      if (!question.blocks || !question.blocks[rKey]) {
        console.warn(`Question ${question.question_id} missing ${rKey}`);
      }
    }

    // Header
    const setLabel = task.set_label || task.set_id || "Set";
    $("interview-question-label").textContent =
      `${setLabel} — Q${i + 1} of ${questions.length} — ${STAGE_META[stage] ? STAGE_META[stage].title : "Stage " + stage}`;

    // Reset UI
    $("response-timer-box").classList.add("hidden");
    hidePostRecordButtons();

    // Render support panel
    renderPracticeSupport(task, question, stage);

    // Show pulsing record button immediately
    setRecordBtn("pulse");
    STATE._recordPressed = false;

    // Play audio — student can pause/resume via the visible player bar
    await playAudioReliable(question.audio);
    if (STATE._endCalled) return;
    if (STATE._skipQuestion) continue;

    // If record not yet pressed during audio, wait for it now
    if (!STATE._recordPressed) {
      await waitForRecordPress();
    }
    if (STATE._endCalled) return;
    if (STATE._skipQuestion) continue;

    // Stop audio in case it is still playing
    stopAudio();

    // Ensure mic is available (may have been released on previous End Session)
    const micOk = await ensureMic();
    if (!micOk) {
      console.error("Microphone unavailable");
      return;
    }
    if (STATE._endCalled) return;
    if (STATE._skipQuestion) continue;

    // Start recording
    setRecordBtn("recording");
    startRecording();

    // Timer — may be aborted early by stop button
    STATE._lastBlob = null;
    await startResponseTimer(responseTime);
    if (STATE._endCalled) return;
    if (STATE._skipQuestion) { stopRecording(); hidePostRecordButtons(); setRecordBtn("hidden"); continue; }

    // Timer expired naturally — stop recording if still active
    if (STATE.mediaRecorder && STATE.mediaRecorder.state === "recording") {
      const blob = await stopRecording();
      STATE._lastBlob = blob;
    }

    // Show post-record buttons (same UI whether timer expired or stopped early)
    showPostRecordButtons();

    // Wait for Save & Next (or re-record loop)
    await waitForSaveOrRerecord(responseTime);
    if (STATE._endCalled) return;
    if (STATE._skipQuestion) { hidePostRecordButtons(); setRecordBtn("hidden"); continue; }

    hidePostRecordButtons();
    setRecordBtn("hidden");

    // Save final blob
    const finalBlob = STATE._lastBlob || new Blob([], { type: "audio/webm" });
    STATE._lastBlob = null;

    $("saving-modal").classList.remove("hidden");
    saveRecording(finalBlob);
    await sleep(800);
    $("saving-modal").classList.add("hidden");

    STATE._questionActive = false;
    // Auto-advance to next question
  }

  // All questions done
  if (!STATE._endCalled) showSetComplete(task);
}

// ═══════════════════════════════════════════════════
// EXAM SESSION (STAGE 5)
// ═══════════════════════════════════════════════════

async function runExamSession(task) {
  const questions    = task.questions || [];
  const responseTime = task.response_time || 45;

  // Prime the audio OUTPUT pipeline once so the first audio isn't clipped.
  if (!STATE.audioPrimed) {
    await warmupAudioContext();
    STATE.audioPrimed = true;
    await sleep(200);
  }

  const imgEl = $("exam-img");
  if (imgEl) {
    imgEl.src = interviewerImageSrc(task);
  }

  showScreen("screen-exam");

  // Play the set intro once, before the first question (exam mode only)
  if (task.intro_audio) {
    // Show intro text; hide the countdown clock and the default prompt line
    const introEl  = $("exam-intro-text");
    const promptEl = $("exam-prompt-line");
    if (introEl)  { introEl.textContent = task.intro_text || ""; introEl.style.display = ""; }
    if (promptEl) { promptEl.style.display = "none"; }
    $("exam-timer-box").style.visibility = "hidden";

    await playAudioReliable(task.intro_audio);

    // Restore the normal exam view
    if (introEl)  { introEl.style.display = "none"; }
    if (promptEl) { promptEl.style.display = ""; }
    if (STATE._endCalled) return;
  }

  for (let i = 0; i < questions.length; i++) {
    if (STATE._endCalled) return;
    STATE._skipQuestion = false;

    const question = questions[i];
    STATE.currentQuestion      = question;
    STATE.currentQuestionIndex = i + 1;

    const setLabel = task.set_label || task.set_id || "Set";
    $("exam-question-label").textContent =
      `${setLabel} — Q${i + 1} of ${questions.length}`;

    // Hide timer box while audio plays
    $("exam-timer-box").style.visibility = "hidden";
    $("exam-mic-icon").style.opacity     = ".4";

    // Play question audio
    await playAudioReliable(question.audio);
    if (STATE._endCalled) return;

    // Ensure mic is ready
    const micOk = await ensureMic();
    if (!micOk || STATE._endCalled) return;

    // Show timer box, auto-start recording
    const secStr = s => Math.floor(s/60).toString().padStart(2,"0") + ":" + (s%60).toString().padStart(2,"0");
    $("exam-timer-digits").textContent   = secStr(responseTime);
    $("exam-timer-digits").style.color   = "#fff";
    $("exam-timer-box").style.visibility = "visible";
    $("exam-mic-icon").style.opacity     = "1";

    startRecording();

    // Countdown
    await new Promise(resolve => {
      let remaining = responseTime;
      STATE.timerInterval = setInterval(() => {
        remaining--;
        $("exam-timer-digits").textContent = secStr(remaining);
        if (remaining <= 0 || STATE._endCalled) {
          clearInterval(STATE.timerInterval);
          resolve();
        }
      }, 1000);
    });

    if (STATE._endCalled) return;

    // Stop recording and save
    $("exam-mic-icon").style.opacity = ".4";
    const blob = await stopRecording();
    $("saving-modal").classList.remove("hidden");
    saveRecording(blob);
    await sleep(600);
    $("saving-modal").classList.add("hidden");
  }

  if (!STATE._endCalled) showSetComplete(task);
}

$("btn-end-exam").onclick = triggerEndSession;



// ═══════════════════════════════════════════════════
// SET COMPLETE
// ═══════════════════════════════════════════════════

function showSetComplete(task) {
  const setLabel = task.set_label || task.set_id || "Set";
  const stage    = STATE.selectedStage;
  const count    = STATE.recordings.length;

  $("set-complete-title").textContent =
    `${setLabel} — ${STAGE_META[stage] ? STAGE_META[stage].title : "Stage " + stage} complete`;
  $("set-complete-desc").textContent =
    `You have recorded ${count} question${count !== 1 ? "s" : ""} in ${STAGE_META[stage] ? STAGE_META[stage].title : "Stage " + stage}. Would you like to continue practicing or end the session?`;

  showScreen("screen-set-complete");
}

$("btn-continue-practice").onclick = () => {
  STATE._endCalled = false;
  // Go back to start screen, keep stage pre-selected
  const currentStage = STATE.selectedStage;
  $("test-selector").value  = "";
  if (currentStage) $("stage-selector").value = String(currentStage);
  checkStartReady();
  $("start-status").textContent = "";
  showScreen("screen-start");
};

// ═══════════════════════════════════════════════════
// PRACTICE SUPPORT RENDERER
// ═══════════════════════════════════════════════════

function renderPracticeSupport(task, question, stage) {
  const questionCard = $("practice-question-card");
  const supportCard  = $("practice-support-card");
  const reasonList   = $("practice-reason-list");

  // Question card — default hidden
  questionCard.classList.remove("hidden");
  const escaped     = escapeHTML(question.q);
  const highlighted = applyHighlights(escaped, question.highlight_phrases || []);
  $("practice-question-text").innerHTML = highlighted;
  $("toggle-question").checked = false;
  $("practice-question-text").style.display = "none";
  const toggleQSpan = $("toggle-question-label").querySelector(".toggle-text");
  if (toggleQSpan) toggleQSpan.textContent = "Show text";

  // Support card
  supportCard.classList.remove("hidden");
  const stageNum = parseInt(stage) || 1;
  const meta = STAGE_META[stageNum] || STAGE_META[1];
  $("practice-stage-title").textContent       = meta.title;
  const instrEl = $("practice-stage-instruction");
  instrEl.style.color = "#555";
  if (stageNum === 4) {
    // Instruction + the 80-words note, translated together (asHTML keeps the line break)
    translateUI(meta.instruction + "\nResponses of 80 words and above are recommended.", instrEl, true);
  } else {
    translateUI(meta.instruction, instrEl, false);
  }

  reasonList.innerHTML = "";
  reasonList.style.display = $("toggle-support").checked ? "" : "none";

  // All stages: area-based layout
  const qtype = (question.question_type === "required_wording") ? "required" : "free";
  const stageAreas = (task.areas && task.areas[qtype] && task.areas[qtype][String(stageNum)]) || {};

  const area1 = (stageAreas.area1 || "").trim();
  const area2 = (stageAreas.area2 || "").trim();
  const area3 = (stageAreas.area3 || "").trim();
  // Normalize escaped newlines from JSON
  const normalize = s => s.replace(/\\n/g, "\n");

  // Area 4: per-question content
  // Stage 4: cues per reason; Stages 1-3: block sentences per reason
  const area4Lines = [];
  if (stageNum === 4) {
    for (const rKey of Object.keys(PRACTICE_REASONS)) {
      const rData = question.blocks && question.blocks[rKey];
      if (!rData) continue;
      // Only add if at least one cue exists
      if (!rData.cue_1 && !rData.cue_2 && !rData.cue_3) continue;
      const label = PRACTICE_REASONS[rKey];
      area4Lines.push(label + ":");
      if (rData.cue_1) area4Lines.push("  B1: " + rData.cue_1);
      if (rData.cue_2) area4Lines.push("  B2: " + rData.cue_2);
      if (rData.cue_3) area4Lines.push("  B3: " + rData.cue_3);
      area4Lines.push("");
    }
  } else {
    const blocks = question.blocks || {};
    const STAGE0_KEY_MAP = { 1: "statement_reason", 2: "before_example", 3: "after_example" };
    const s0Key = STAGE0_KEY_MAP[stageNum];

    if (s0Key && blocks[s0Key]) {
      // Stage0 format: { statement_reason, before_example, after_example }
      const b = blocks[s0Key];
      if (b.structure) area4Lines.push("Structure: " + b.structure);
      if (b.full)      area4Lines.push("Full: "      + b.full);
    } else {
      // Standard r1/r2/r3 format
      const blockKey = "block_" + stageNum;
      for (const rKey of Object.keys(PRACTICE_REASONS)) {
        const rData = blocks[rKey];
        if (rData && rData[blockKey]) area4Lines.push(rData[blockKey]);
      }
    }
  }
  const area4 = area4Lines.join("\n").trim();

  // Render areas — skip empty
  const areasToShow = [
    { text: normalize(area1), cls: "support-area area1" },
    { text: normalize(area2), cls: "support-area area2" },
    { text: normalize(area3), cls: "support-area area3", showWordCount: true },
    { text: normalize(area4), cls: "support-area area4" },
  ];

  for (const { text, cls, showWordCount } of areasToShow) {
    if (!text) continue;
    const div = document.createElement("div");
    div.className = cls;
    div.innerHTML = text.split(/\n|\r\n|\r/).map(line => escapeHTML(line)).join("<br>");
    if (showWordCount) {
      const words = countWords(text);
      const wc = document.createElement("div");
      wc.style.cssText = "font-size:11px;color:#999;margin-top:6px;text-align:right;";
      wc.textContent = words + " words";
      div.appendChild(wc);
    }
    reasonList.appendChild(div);
  }
}


function addText(parent, text) {
  const p = document.createElement("div");
  p.className = "reason-text";
  p.textContent = text || "";
  parent.appendChild(p);
}

function addCue(parent, prefix, text) {
  const line = document.createElement("div");
  line.className = "cue-line";
  line.textContent = `${prefix}: ${text || ""}`;
  parent.appendChild(line);
}

// Toggles — one-time per session, persist across questions
$("toggle-question").onchange = () => {
  const show = $("toggle-question").checked;
  $("practice-question-text").style.display = show ? "" : "none";
  const span = $("toggle-question-label").querySelector(".toggle-text");
  if (span) span.textContent = show ? "Hide text" : "Show text";
};
$("toggle-support").onchange = () => {
  const show = $("toggle-support").checked;
  $("practice-reason-list").style.display = show ? "" : "none";
  const span = $("toggle-support-label").querySelector(".toggle-text");
  if (span) span.textContent = show ? "Hide text" : "Show text";
};

// ═══════════════════════════════════════════════════
// END SESSION
// ═══════════════════════════════════════════════════

function endSession() {
  $("saving-modal").classList.add("hidden");
  clearInterval(STATE.timerInterval);
  showScreen("screen-end");
  $("results-list").innerHTML = "";
  $("end-summary").textContent =
    `${STATE.recordings.length} question${STATE.recordings.length !== 1 ? "s" : ""} recorded.`;
  runTranscriptionFlow();
}

// ═══════════════════════════════════════════════════
// TRANSCRIPTION FLOW
// ═══════════════════════════════════════════════════

async function blobToBase64(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload  = () => resolve(reader.result.split(",")[1]);
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

async function transcribeRecording(recording) {
  const audio_base64 = await blobToBase64(recording.blob);
  const res = await fetch("/.netlify/functions/transcribe", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ audio_base64, filename: recording.filename })
  });
  if (!res.ok) throw new Error("Transcription failed");
  const data = await res.json();
  return data.transcript || "";
}



async function runTranscriptionFlow() {
  const stage    = STATE.selectedStage;
  const isStage4 = stage === 4 || stage === 5;
  const list     = $("results-list");
  const status   = $("transcription-status");

  status.classList.remove("hidden");
  status.textContent = "Transcribing your responses... Results will appear one by one.";

  const transcripts = {};

  for (let i = 0; i < STATE.recordings.length; i++) {
    const r = STATE.recordings[i];
    const audioUrl = URL.createObjectURL(r.blob);

    // Create result card with transcribing placeholder
    const card = document.createElement("div");
    card.className = "result-item";
    card.id = `result-card-${i}`;
    card.innerHTML =
      '<div class="result-num">' + escapeHTML(r.set_label || "") + ' — Q' + r.question_index + ' — ' + (STAGE_META[r.stage] ? STAGE_META[r.stage].title : 'Stage ' + r.stage) + '</div>' +
      '<p class="result-q">' + escapeHTML(r.q) + '</p>' +
      '<div class="result-audio-block">' +
        '<div class="result-audio-label">Your Recording</div>' +
        '<audio controls src="' + audioUrl + '"></audio>' +
      '</div>' +
      '<div class="result-transcript-block">' +
        '<div class="result-transcript-label">Transcript</div>' +
        '<div class="result-transcript-text transcribing" id="transcript-text-' + i + '">Transcribing...</div>' +
      '</div>' +
      (isStage4 ? '<div class="result-analysis-block hidden" id="analysis-block-' + i + '"></div>' : '');

    list.appendChild(card);

    // Transcribe this recording (skip API call if already transcribed, e.g. stage 0)
    try {
      let transcript;
      if (r.transcript) {
        transcript = r.transcript;
      } else {
        const rawTranscript = await transcribeRecording(r);
        transcript = normalizeTranscript(rawTranscript);
      }
      transcripts[i] = transcript;
      r.transcript   = transcript;

      const words  = countWords(transcript);
      const textEl = $("transcript-text-" + i);
      textEl.classList.remove("transcribing");
      textEl.textContent = transcript || "(no speech detected)";

      // Show word count next to transcript label
      const transcriptBlock = textEl.parentElement;
      if (transcriptBlock) {
        const labelEl = transcriptBlock.querySelector(".result-transcript-label");
        if (labelEl) {
          labelEl.textContent = "Transcript — " + words + " words · Responses of 80 words and above are recommended.";
          labelEl.style.color = "#555";
        }
      }


    } catch(e) {
      const textEl = $(`transcript-text-${i}`);
      textEl.classList.remove("transcribing");
      textEl.textContent = "(transcription failed)";
      textEl.style.color = "#c0392b";
    }
  }

  // All transcribed — download
  status.textContent = "Transcription complete. Downloading your recordings...";
  await autoDownload(transcripts);

  STATE._transcripts = transcripts;

  // Guard: if nothing was recorded/transcribed, skip analysis (avoids empty-array 400)
  const hasContent = STATE.recordings.length > 0 &&
    Object.values(transcripts).some(t => t && t.trim().length > 0);

  if (!hasContent) {
    status.textContent = "No responses to analyze.";
    return;
  }

  if (isStage4) {
    status.textContent = "Analyzing & scoring...";
    await runAnalysisAll(transcripts);
  } else {
    status.textContent = "Running grammar check...";
    await runGrammarCheck(transcripts);
  }
}

async function runAnalysisAll(transcripts) {
  const btnAll = $("btn-analyze-all");
  if (btnAll) { btnAll.disabled = true; btnAll.textContent = "Analyzing..."; }

  try {
    const questions = STATE.recordings.map((r, i) => ({
      question:   r.q,
      transcript: transcripts[i] || r.transcript || ""
    }));

    const res = await fetch("/.netlify/functions/analyze", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ questions, language: analysisLang() })
    });
    if (!res.ok) throw new Error("Analysis failed");
    const data = await res.json();
    const parsed = data.parsed || {};

    // Fill per-question analysis blocks
    STATE.recordings.forEach((r, i) => {
      const block  = $("analysis-block-" + i);
      if (!block) return;
      const qKey   = "Q" + (i + 1);
      const result = parsed[qKey];
      if (result) {
        const words    = countWords(transcripts[i] || r.transcript || "");
        const bandHtml = result.band !== null
          ? "<div class=\"analysis-band\">Band " + result.band + " · " + words + " words</div>"
          : "";
        const feedbackHtml = (result.feedback || "")
          .split("\n")
          .filter(l => l.trim())
          .map(l => "<div class=\"analysis-feedback-line\">" + escapeHTML(l) + "</div>")
          .join("");
        block.innerHTML = bandHtml + "<div class=\"analysis-feedback\">" + feedbackHtml + "</div>";
        block.classList.remove("hidden");
      } else {
        block.innerHTML = "<div class=\"analysis-error\">No result for this question.</div>";
        block.classList.remove("hidden");
      }
    });

    if (btnAll) btnAll.classList.add("hidden");
    $("transcription-status").textContent = "Analysis complete.";

    // Consolidated Google Doc report (transcript + band + feedback + audio links)
    await exportResultsDoc({ parsed, transcripts });

  } catch(e) {
    const errDiv = document.createElement("div");
    errDiv.className = "result-item";
    errDiv.innerHTML = "<div class=\"analysis-error\">Analysis failed. Please try again.</div>";
    $("results-list").appendChild(errDiv);
    if (btnAll) { btnAll.disabled = false; btnAll.textContent = "Analyze & Score"; }
  }
}


// ═══════════════════════════════════════════════════
// GRAMMAR CHECK
// ═══════════════════════════════════════════════════

async function runGrammarCheck(transcripts) {
  const btnG = $("btn-grammar-check");
  if (btnG) { btnG.disabled = true; btnG.textContent = "Checking..."; }

  try {
    const questions = STATE.recordings.map((r, i) => ({
      question:   r.q,
      transcript: transcripts[i] || r.transcript || ""
    }));

    const res = await fetch("/.netlify/functions/grammar", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ questions, language: analysisLang() })
    });
    if (!res.ok) throw new Error("Grammar check failed");
    const data = await res.json();

    // Parse grammar result by === Q1 === markers
    const grammarRaw = data.grammar || "";
    const grammarParts = grammarRaw.split(/={2,}\s*(Q\d+|PATTERNS)\s*={2,}/);
    const grammarParsed = {};
    for (let i = 1; i < grammarParts.length; i += 2) {
      const key = grammarParts[i] ? grammarParts[i].trim() : "";
      const val = grammarParts[i + 1] ? grammarParts[i + 1].trim() : "";
      if (key) grammarParsed[key] = val;
    }

    // Display under each recording card
    STATE.recordings.forEach((r, i) => {
      const card = $("result-card-" + i);
      if (!card) return;
      const qKey = "Q" + (i + 1);
      const grammarText = grammarParsed[qKey] || "(No grammar errors found)";
      const grammarBlock = document.createElement("div");
      grammarBlock.className = "result-grammar-block";
      grammarBlock.innerHTML =
        "<div class=\"result-transcript-label\">Grammar Check</div>" +
        "<div class=\"analysis-feedback\">" +
        escWithLabels(highlightGrammarChanges(grammarText)).replace(/\n/g, "<br>") +
        "</div>";
      card.appendChild(grammarBlock);
    });

    // Show patterns block at bottom
    if (grammarParsed["PATTERNS"]) {
      const patternsDiv = document.createElement("div");
      patternsDiv.className = "result-item overall-block";
      patternsDiv.innerHTML =
        "<div class=\"result-num\">Common Error Patterns</div>" +
        "<div class=\"analysis-feedback\">" +
        grammarParsed["PATTERNS"].split("\n").join("<br>") +
        "</div>";
      $("results-list").appendChild(patternsDiv);
    }

    if (btnG) btnG.classList.add("hidden");

    // Consolidated Google Doc report (transcript + grammar feedback + audio links)
    await exportResultsDoc({ grammarParsed });

    $("transcription-status").textContent = "Grammar check complete.";

  } catch(e) {
    const errDiv = document.createElement("div");
    errDiv.className = "result-item";
    errDiv.innerHTML = "<div class=\"analysis-error\">Grammar check failed. Please try again.</div>";
    $("results-list").appendChild(errDiv);
    if (btnG) { btnG.disabled = false; btnG.textContent = "Grammar Check"; }
  }
}

// Build a consistent base name for the session ZIP and CSV,
// format: {key3}_interview_stage{N}_{testId}_{YYYYMMDD}
function sessionBaseName() {
  const stage     = STATE.selectedStage;
  const _dt = new Date(); const date = _dt.toISOString().slice(0, 10).replace(/-/g, "") + "_" + _dt.toTimeString().slice(0, 8).replace(/:/g, "");
  const slug      = s => (s || "").toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
  const keyPrefix = (sessionStorage.getItem("access_key") || "").slice(0, 3).toLowerCase();

  const stagePart = `stage${stage}`;
  let   testPart  = "";

  if (stage === 0) {
    // Stage 0 has no test — use the sample id from the first recording
    testPart = slug(STATE.recordings[0]?.question_id || "");
  } else {
    testPart = slug(STATE.currentTask?.set_id || STATE.currentTask?.set_label || "");
  }

  return [keyPrefix, "interview", stagePart, testPart, date].filter(Boolean).join("_");
}

async function uploadToDrive(filename, content, mimeType, studentKey, isBase64 = false, convertTo, subfolder) {
  try {
    const res  = await fetch("/.netlify/functions/upload-to-drive", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ filename, content, mimeType, studentKey, isBase64, convertTo, subfolder })
    });
    const data = await res.json();
    if (!res.ok || !data.success) { console.error("Drive upload failed:", data.error || res.status); return null; }
    console.log("Drive upload OK:", data.name);
    return data;   // { success, fileId, name, link }
  } catch(e) {
    console.warn("Drive upload error:", e.message);
    return null;
  }
}

// Turn a relative prompt-audio path (e.g. "practice/audio/set01/q1.mp3") into an
// absolute URL so it's clickable from inside a Google Doc.
function absoluteAudioUrl(src) {
  if (!src) return "";
  if (/^https?:\/\//i.test(src)) return src;
  return window.location.origin + "/" + String(src).replace(/^\/+/, "");
}

// Build ONE consolidated report and upload it as a native Google Doc.
// opts.parsed        → scored stages (4/5): per-Q { band, feedback }
// opts.grammarParsed → grammar stages (1-3): per-Q grammar text (Original/Error/Revised)
async function exportResultsDoc(opts) {
  if (!STATE.recordings.length) return;
  const parsed        = opts && opts.parsed;
  const grammarParsed = opts && opts.grammarParsed;
  const studentKey    = (sessionStorage.getItem("access_key") || "").slice(0, 3).toLowerCase();

  const rowsHtml = STATE.recordings.map((r, i) => {
    const qKey    = "Q" + (i + 1);
    const origUrl = absoluteAudioUrl(r.audio);
    const yourUrl = r.driveLink || "";

    const origLink = origUrl
      ? `<a href="${escapeHTML(origUrl)}">▶ Play original audio</a>`
      : `<span style="color:#999">Original audio unavailable</span>`;
    const yourLink = yourUrl
      ? `<a href="${escapeHTML(yourUrl)}">▶ Play your recording</a>`
      : `<span style="color:#999">Your recording unavailable</span>`;

    const stageTitle = STAGE_META[r.stage] ? STAGE_META[r.stage].title : ("Stage " + r.stage);
    const header = `<h2 style="color:#00736b;font-size:16px">${escapeHTML(r.set_label || "")} — Q${r.question_index || (i + 1)} — ${escapeHTML(stageTitle)}</h2>`;
    const question = r.q ? `<p><strong>Question:</strong> ${escapeHTML(r.q)}</p>` : "";
    const words = countWords(r.transcript || "");
    const transcript =
      `<p><strong>Transcript — ${words} words · Responses of 80 words and above are recommended.</strong><br>` +
      `${escapeHTML(r.transcript || "(no speech detected)")}</p>`;
    const links = `<p>${origLink} &nbsp;|&nbsp; ${yourLink}</p>`;

    // Feedback section: band+feedback (scored) OR grammar feedback (grammar stages)
    let feedback = "";
    if (parsed) {
      const result = parsed[qKey] || {};
      const band   = (result.band != null) ? result.band : "N/A";
      const fb     = (result.feedback || "").split("\n").map(escapeHTML).join("<br>");
      feedback = `<p><strong>Band ${escapeHTML(String(band))} &middot; ${words} words</strong></p>` +
                 (fb ? `<p><strong>Feedback:</strong><br>${fb}</p>` : "");
    } else if (grammarParsed) {
      const gtext = grammarParsed[qKey] || "(No grammar errors found)";
      // Reuse the on-screen highlighter so the Doc matches the app's grammar view
      const ghtml = escWithLabels(highlightGrammarChanges(gtext)).replace(/\n/g, "<br>");
      feedback = `<p><strong>Grammar:</strong><br>${ghtml}</p>`;
    }

    return header + question + transcript + links + feedback + "<hr>";
  }).join("");

  // Optional overall/patterns section
  let overall = "";
  if (parsed && parsed.OVERALL && parsed.OVERALL.feedback) {
    overall = `<h2>Overall</h2><p>${parsed.OVERALL.feedback.split("\n").map(escapeHTML).join("<br>")}</p>`;
  } else if (grammarParsed && grammarParsed["PATTERNS"]) {
    overall = `<h2>Common Error Patterns</h2><p>${grammarParsed["PATTERNS"].split("\n").map(escapeHTML).join("<br>")}</p>`;
  }

  // Average score (scored sessions only)
  let summary = "";
  if (parsed) {
    const bands = STATE.recordings
      .map((r, i) => (parsed["Q" + (i + 1)] || {}).band)
      .filter(b => typeof b === "number");
    const avg = bands.length ? (bands.reduce((a, b) => a + b, 0) / bands.length).toFixed(1) : "N/A";
    summary = `<p style="font-size:20px;font-weight:700;color:#00736b">Average Score: ${avg} / 5 (${bands.length} scored)</p>`;
  }

  const setLabel = STATE.recordings[0] ? (STATE.recordings[0].set_label || "") : "";
  const html = `<!DOCTYPE html><html><head><meta charset="utf-8"></head>
    <body style="font-family:Arial,sans-serif">
      <h1>Interview — Results</h1>
      <p>${escapeHTML(setLabel)}</p>
      <p>Generated ${escapeHTML(new Date().toLocaleString())}</p>
      ${summary}${rowsHtml}${overall}
    </body></html>`;

  const docName = `${sessionBaseName()}_report`;
  try {
    await uploadToDrive(
      docName, html, "text/html", studentKey,
      false,                                    // isBase64
      "application/vnd.google-apps.document",   // convertTo → native Google Doc
      "04_speaking_interview"                   // report sits in the tool's folder
    );
  } catch(e) {
    console.warn("Report upload failed:", e.message);
  }
}

async function autoDownload(transcripts) {
  if (STATE.recordings.length === 0) return;

  const keyPrefix = (sessionStorage.getItem("access_key") || "").slice(0, 3).toLowerCase();

  // Make sure each record carries its transcript (used later by the report)
  STATE.recordings.forEach((r, i) => {
    if (transcripts && transcripts[i] !== undefined) r.transcript = transcripts[i];
  });

  // Upload each recording to Drive (into the tool's audio subfolder) and capture
  // its webViewLink onto the record, so the results report can link to it.
  const statusEl = document.getElementById("transcription-status");
  if (statusEl) statusEl.textContent = "Saving to your records…";

  await Promise.all(STATE.recordings.map(async r => {
    const b64 = await blobToBase64(r.blob);
    const result = await uploadToDrive(r.filename, b64, "audio/webm", keyPrefix, true, undefined, "04_speaking_interview/audio_interview");
    if (result && result.link) r.driveLink = result.link;
  }));

  if (statusEl) statusEl.textContent = "✓ Saved to your records.";
}

// ═══════════════════════════════════════════════════
// NEW SESSION
// ═══════════════════════════════════════════════════

$("btn-new-session").onclick = () => {
  STATE.recordings      = [];
  STATE._endCalled      = false;
  STATE.selectedStage   = null;
  STATE.currentTask     = null;
  STATE.currentQuestion = null;
  $("test-selector").value        = "";
  $("stage-selector").value       = "";
  $("btn-start-session").disabled = true;
  $("start-status").textContent   = "";
  $("mic-understand-check").checked = false;
  $("btn-mic-continue").disabled    = true;
  $("btn-enable-mic").disabled      = false;
  $("warmup-status").textContent    = "Click below to begin setup.";
  hidePostRecordButtons();
  STATE._transcripts = {};
  STATE._lastBlob = null;
  showScreen("screen-start");
};

// ═══════════════════════════════════════════════════
// ACCESS GATE
// ═══════════════════════════════════════════════════

async function validateKey(key) {
  const res = await fetch("/.netlify/functions/api", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ key })
  });
  return await res.json();
}

function initGate() {
  // Check sessionStorage for already-validated key
  if (sessionStorage.getItem("access_granted") === "true") {
    showScreen("screen-start");
    loadTestIndex();
    return;
  }
  // Pre-fill a remembered key (student still clicks Continue)
  const remembered = localStorage.getItem("remembered_key");
  if (remembered) {
    if ($("key-input"))    $("key-input").value = remembered;
    if ($("remember-key")) $("remember-key").checked = true;
  }
  // Pre-fill saved analysis language (typed once, reused thereafter)
  const savedLang = localStorage.getItem("analysis_lang");
  if (savedLang && $("analysis-lang-input")) {
    $("analysis-lang-input").value = savedLang;
  }
  showScreen("screen-gate");
}

$("btn-gate-submit").onclick = async () => {
  const key = $("key-input").value.trim();
  if (!key) {
    $("gate-status").textContent = "Please enter your access key.";
    return;
  }

  const lang = $("analysis-lang-input") ? $("analysis-lang-input").value.trim() : "";
  if (!lang) {
    $("gate-status").textContent = "Please type your native language.";
    return;
  }

  $("btn-gate-submit").disabled = true;
  $("gate-status").textContent  = "Checking...";

  try {
    const result = await validateKey(key);
    if (result.valid) {
      sessionStorage.setItem("access_granted", "true");
      sessionStorage.setItem("access_key", key);
      // Analysis language: save once, reused on future visits
      localStorage.setItem("analysis_lang", lang);
      // Remember-my-key: persist to localStorage if checked, else clear it
      const remember = $("remember-key") && $("remember-key").checked;
      if (remember) localStorage.setItem("remembered_key", key);
      else          localStorage.removeItem("remembered_key");
      warmUpTranslations(); // fire-and-forget background cache warmup
      showScreen("screen-start");
      loadTestIndex();
    } else {
      $("gate-status").textContent  = result.error || "Invalid key.";
      $("btn-gate-submit").disabled = false;
    }
  } catch(e) {
    $("gate-status").textContent  = "Connection error. Please try again.";
    $("btn-gate-submit").disabled = false;
  }
};

// Allow Enter key to submit
$("key-input").onkeydown = (e) => {
  if (e.key === "Enter") $("btn-gate-submit").click();
};

// Eye toggle for password field
$("btn-toggle-key").onclick = () => {
  const input = $("key-input");
  const btn   = $("btn-toggle-key");
  if (input.type === "password") {
    input.type = "text";
    btn.textContent = "🙈";
  } else {
    input.type = "password";
    btn.textContent = "👁";
  }
};


// ═══════════════════════════════════════════════════
// STAGE 0
// ═══════════════════════════════════════════════════

let STAGE0_SAMPLES    = [];
let STAGE0_LANG       = "native";   // Stage 0 language mode; resets to native per sample
let STAGE0_CURRENT    = null;
let STAGE0_BLOB       = null;
let STAGE0_TRANSCRIPT = "";

async function loadStage0List() {
  try {
    const key = sessionStorage.getItem("access_key") || "";
    const res = await fetch(`/.netlify/functions/api?op=list_stage0&key=${encodeURIComponent(key)}`);
    if (!res.ok) throw new Error();
    STAGE0_SAMPLES = await res.json();
  } catch(e) {
    console.warn("Could not load Stage 0 samples");
    STAGE0_SAMPLES = [];
  }
}

async function startStage0() {
  showScreen("screen-stage0");
  translateStaticEls("#screen-stage0");
  await loadStage0List();

  const listEl = $("stage0-sample-list");
  listEl.innerHTML = "";

  if (STAGE0_SAMPLES.length === 0) {
    listEl.innerHTML = "<p style=\"color:#aaa;font-size:13px;padding:8px;\">No samples found.</p>";
    return;
  }

  STAGE0_SAMPLES.forEach((s) => {
    const item = document.createElement("div");
    item.className = "stage0-list-item";
    item.textContent = s.label;
    item.onclick = () => {
      loadStage0Sample(s, item);
    };
    listEl.appendChild(item);
  });

  loadStage0Sample(STAGE0_SAMPLES[0], listEl.children[0]);
}

// ── Stage 0 language rendering (adapted from the AD tool) ──
// English source is kept on each element's dataset.en; native comes from the
// translation cache (translateUI), falling back to English on a cold cache.
function stage0IsEnglish() {
  const lang = (localStorage.getItem("analysis_lang") || "").trim();
  return STAGE0_LANG === "en" || !lang || lang.toLowerCase() === "english";
}

function renderStage0Structure(el) {
  if (!el) return;
  const en = el.dataset.en || "";
  if (stage0IsEnglish()) el.innerHTML = escapeHTML(en).replace(/\n/g, "<br>");
  else translateUI(en, el, true);
}

function renderStage0Full(el) {
  if (!el) return;
  const en = el.dataset.en || "";
  if (stage0IsEnglish()) el.innerHTML = escapeHTML(en).replace(/\n/g, "<br>");
  else translateUI(en, el, true);
}

function renderStage0Question() {
  const el = $("stage0-question-text");
  if (!el) return;
  const en = el.dataset.en || "";
  let phrases = [];
  try { phrases = JSON.parse(el.dataset.phrases || "[]"); } catch(e) {}
  // Question text always stays in English (with highlight phrases), even when
  // the rest of Stage 0 is toggled to the native language.
  el.innerHTML = highlightPhrases(en, phrases);
}

function updateStage0LangToggle() {
  const knob = $("stage0-lang-knob");
  const segN = $("stage0-lang-seg-native");
  const segE = $("stage0-lang-seg-en");
  if (knob) knob.style.left = (STAGE0_LANG === "en") ? "115px" : "2px";
  if (segN) segN.style.color = (STAGE0_LANG === "native") ? "#fff" : "#00736b";
  if (segE) segE.style.color = (STAGE0_LANG === "en")     ? "#fff" : "#00736b";
}

function setStage0Lang(lang) {
  STAGE0_LANG = (lang === "en") ? "en" : "native";
  renderStage0Question();
  [1, 2, 3].forEach(i => {
    renderStage0Structure($(`stage0-structure-${i}`));
    renderStage0Full($(`stage0-full-${i}`));
  });
  updateStage0LangToggle();
}

function toggleStage0Lang() {
  setStage0Lang(STAGE0_LANG === "native" ? "en" : "native");
}

async function loadStage0Sample(sample, itemEl) {
  document.querySelectorAll(".stage0-list-item").forEach(el => el.classList.remove("active"));
  if (itemEl) itemEl.classList.add("active");

  try {
    const key = sessionStorage.getItem("access_key") || "";
    const res = await fetch(`/.netlify/functions/api?op=get_stage0&file=${encodeURIComponent(sample.file)}&key=${encodeURIComponent(key)}`);
    if (!res.ok) throw new Error();
    STAGE0_CURRENT = await res.json();
  } catch(e) {
    console.warn("Could not load Stage 0 sample");
    return;
  }

  const data   = STAGE0_CURRENT;
  const blocks = data.blocks || {};

  // New sample → start in native (understand-first), matching AD
  STAGE0_LANG = "native";

  // Question: keep English source for the toggle, then render in current mode
  const qEl = $("stage0-question-text");
  qEl.dataset.en = data.question || "";
  qEl.dataset.phrases = JSON.stringify(data.highlight_phrases || []);
  renderStage0Question();

  const audioEl = $("stage0-audio-player");
  // Derive audio URL from the sample filename — ignore the JSON's audio field
  // (the JSON may reference another set's audio before stage0/audio/ files are uploaded)
  const derivedAudio = `/practice/stage0/audio/${sample.file.replace(".json", ".mp3")}`;
  audioEl.src = derivedAudio;
  audioEl.onerror = () => { audioEl.removeAttribute("src"); audioEl.load(); };
  $("stage0-question-area").classList.remove("hidden");

  // Structures + full sentences: store English source, then render in current mode
  const pairs = [
    [1, blocks.statement_reason],
    [2, blocks.before_example],
    [3, blocks.after_example],
  ];
  pairs.forEach(([i, b]) => {
    $(`stage0-structure-${i}`).dataset.en = b ? (b.structure || "") : "";
    $(`stage0-full-${i}`).dataset.en      = b ? (b.full || "")      : "";
    renderStage0Structure($(`stage0-structure-${i}`));
    renderStage0Full($(`stage0-full-${i}`));
  });
  updateStage0LangToggle();

  // Calculate model answer word count from all three full sentences
  const fullText = [
    blocks.statement_reason ? blocks.statement_reason.full : "",
    blocks.before_example   ? blocks.before_example.full   : "",
    blocks.after_example    ? blocks.after_example.full    : ""
  ].filter(Boolean).join(" ");
  const modelWords = fullText.trim() ? fullText.trim().split(/\s+/).length : 0;
  $("stage0-word-count").textContent = modelWords;

  document.querySelectorAll(".stage0-full").forEach(el => el.style.visibility = "");
  $("stage0-full-header").style.visibility = "";
  $("stage0-table-area").classList.remove("hidden");


  // Reset toggle to ON state
  $("toggle-stage0-full").checked = true;
  setStage0FullVisible(true);

  // Reset record button to pulse state
  const recBtn = $("btn-stage0-record");
  recBtn.classList.remove("recording", "hidden");
  recBtn.classList.add("pulse");
  $("stage0-post-record").classList.add("hidden");
  $("stage0-timer-box").classList.add("hidden");
  $("stage0-results-area").classList.add("hidden");
  $("stage0-feedback-text").classList.add("hidden");
  STAGE0_BLOB = null;
  STAGE0_TRANSCRIPT = "";

  stage0BindRecordButton();
}

// ── Instructions collapse toggle ──────────────────
let STAGE0_INSTR_EXPANDED = true;
window.toggleStage0Instructions = function() {
  STAGE0_INSTR_EXPANDED = !STAGE0_INSTR_EXPANDED;
  const body    = $("stage0-instr-body");
  const chevron = $("stage0-instr-chevron");
  body.style.display      = STAGE0_INSTR_EXPANDED ? "" : "none";
  chevron.style.transform = STAGE0_INSTR_EXPANDED ? "rotate(0deg)" : "rotate(-90deg)";
};

// ── Highlight required phrases in question text ───
function highlightPhrases(text, phrases) {
  if (!phrases || phrases.length === 0) return escapeHTML(text);
  let result = escapeHTML(text);
  phrases.forEach(phrase => {
    if (!phrase) return;
    const escaped = escapeHTML(phrase);
    const re = new RegExp(escaped.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi');
    result = result.replace(re, m => `<mark style="background:#ffe066;border-radius:3px;padding:0 2px;">${m}</mark>`);
  });
  return result;
}

function setStage0FullVisible(show) {
  document.querySelectorAll(".stage0-full").forEach(el => el.style.visibility = show ? "" : "hidden");
  $("stage0-full-header").style.visibility = show ? "" : "hidden";
  const label = $("stage0-full-toggle-label");
  if (label) {
    label.style.borderColor = show ? "#00736b" : "#c0392b";
    label.style.background  = show ? "#e8f5f4"  : "#fdecea";
    label.style.color       = show ? "#00736b" : "#c0392b";
  }
  const icon = $("stage0-toggle-icon");
  if (icon) icon.textContent = show ? "👁" : "🙈";
  const text = $("stage0-toggle-text");
  if (text) text.textContent = show ? "Full sentences: ON" : "Full sentences: OFF";
  $("toggle-stage0-full").checked = show;
}

// Toggle: show/hide full sentences (works before and during recording)
$("toggle-stage0-full").onchange = () => {
  setStage0FullVisible($("toggle-stage0-full").checked);
};

// Stage 0 native ⇄ English language switch
(function () {
  const sw = $("stage0-lang-switch");
  if (!sw) return;
  sw.onclick = () => toggleStage0Lang();
  sw.onkeydown = (e) => {
    if (e.key === "Enter" || e.key === " ") { e.preventDefault(); toggleStage0Lang(); }
  };
})();

function stage0BindRecordButton() {
  const btn = $("btn-stage0-record");
  let timerInterval = null;
  const STAGE0_TIME = 45;

  const autoStop = async () => {
    clearInterval(timerInterval);
    $("stage0-timer-box").classList.add("hidden");
    btn.classList.remove("recording");
    btn.classList.add("hidden");
    const blob = await stopRecording();
    STAGE0_BLOB = blob;
    $("stage0-post-record").classList.remove("hidden");
  };

  btn.onclick = async () => {
    if (btn.classList.contains("pulse")) {
      // ── Start recording ──────────────────────────
      const ok = await ensureMic();
      if (!ok) return;

      btn.classList.remove("pulse");
      btn.classList.add("recording");
      startRecording();

      // Pause question audio
      $("stage0-audio-player").pause();

      // Auto-hide full sentences
      setStage0FullVisible(false);

      // 45 s countdown
      let remaining = STAGE0_TIME;
      $("stage0-timer-digits").textContent = "00:45";
      $("stage0-timer-value").classList.remove("danger");
      $("stage0-timer-box").classList.remove("hidden");
      timerInterval = setInterval(async () => {
        remaining--;
        const m = Math.floor(remaining / 60).toString().padStart(2, "0");
        const s = (remaining % 60).toString().padStart(2, "0");
        $("stage0-timer-digits").textContent = `${m}:${s}`;
        $("stage0-timer-value").classList.toggle("danger", remaining <= 5);
        if (remaining <= 0) await autoStop();
      }, 1000);

    } else if (btn.classList.contains("recording")) {
      // ── Manual stop ──────────────────────────────
      await autoStop();
    }
  };
}

$("btn-stage0-record-again").onclick = async () => {
  STAGE0_BLOB = null;
  $("stage0-post-record").classList.add("hidden");
  $("stage0-results-area").classList.add("hidden");
  $("stage0-feedback-text").classList.add("hidden");

  // Restore full sentences and reset toggle pill
  setStage0FullVisible(true);

  // Reset record button and re-bind
  const btn = $("btn-stage0-record");
  btn.classList.remove("recording", "hidden");
  btn.classList.add("pulse");
  stage0BindRecordButton();
};

$("btn-stage0-save").onclick = async () => {
  if (!STAGE0_BLOB) return;
  $("btn-stage0-save").disabled = true;
  $("btn-stage0-save").textContent = "Transcribing...";

  const url = URL.createObjectURL(STAGE0_BLOB);
  $("stage0-playback").src = url;
  $("stage0-results-area").classList.remove("hidden");
  $("stage0-transcript-text").textContent = "Transcribing...";

  try {
    const audio_base64 = await blobToBase64(STAGE0_BLOB);
    const res = await fetch("/.netlify/functions/transcribe", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ audio_base64, filename: "stage0.webm" })
    });
    const data = await res.json();
    STAGE0_TRANSCRIPT = normalizeTranscript(data.transcript || "");
    const words = countWords(STAGE0_TRANSCRIPT);
    $("stage0-transcript-text").textContent = STAGE0_TRANSCRIPT || "(no speech detected)";
    $("stage0-transcript-label").textContent = "Transcript — " + words + " words";

    // Add to STATE.recordings so it's included in the end-session CSV + audio export
    const sampleId = STAGE0_CURRENT ? (STAGE0_CURRENT.id || "s0") : "s0";
    const fname    = getRunLabel(sampleId, 0, "q1") + ".webm";  // e.g. s0_001_stage0_q1.webm
    // Replace any previous recording for the same sample (re-record scenario)
    const existing = STATE.recordings.findIndex(r => r.stage === 0 && r.question_id === sampleId);
    const entry = {
      stage: 0, question_id: sampleId,
      q: STAGE0_CURRENT ? (STAGE0_CURRENT.question || "") : "",
      audio: "", blob: STAGE0_BLOB, filename: fname,
      set_label: "Stage 0", test_id: "stage0", question_index: 1,
      transcript: STAGE0_TRANSCRIPT
    };
    if (existing >= 0) STATE.recordings[existing] = entry;
    else               STATE.recordings.push(entry);

  } catch(e) {
    $("stage0-transcript-text").textContent = "(transcription failed)";
  }

  $("btn-stage0-save").disabled = false;
  $("btn-stage0-save").textContent = "Save & Get Transcript";
};

$("btn-stage0-feedback").onclick = async () => {
  if (!STAGE0_TRANSCRIPT || !STAGE0_CURRENT) return;
  $("btn-stage0-feedback").disabled = true;
  $("btn-stage0-feedback").textContent = "Checking...";

  const blocks = STAGE0_CURRENT.blocks || {};
  const modelAnswer = [
    blocks.statement_reason ? blocks.statement_reason.full : "",
    blocks.before_example   ? blocks.before_example.full   : "",
    blocks.after_example    ? blocks.after_example.full    : ""
  ].filter(Boolean).join(" ");

  try {
    const res = await fetch("/.netlify/functions/stage0-feedback", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model_answer: modelAnswer, transcript: STAGE0_TRANSCRIPT, language: analysisLang() })
    });
    const data = await res.json();
    const feedbackEl = $("stage0-feedback-text");
    feedbackEl.innerHTML =
      "<div class=\"result-transcript-label\">Similarity Check</div>" +
      "<div style=\"margin-top:6px;font-size:12px;color:#555;\">Model: " + (data.model_words || "?") + " words &nbsp;·&nbsp; Yours: " + (data.student_words || "?") + " words</div>" +
      "<div class=\"analysis-feedback\" style=\"margin-top:6px;\">" + (data.feedback || "").split("\n").join("<br>") + "</div>";
    feedbackEl.classList.remove("hidden");

    // Capture similarity result and upload to Drive
    const sampleId   = STAGE0_CURRENT ? (STAGE0_CURRENT.id || "s0") : "s0";
    const _dt2 = new Date(); const date = _dt2.toISOString().slice(0, 10).replace(/-/g, "") + "_" + _dt2.toTimeString().slice(0, 8).replace(/:/g, "");
    const keyPrefix  = (sessionStorage.getItem("access_key") || "").slice(0, 3).toLowerCase();
    const simLines   = [
      `Stage 0 Similarity Check — ${sampleId} — ${date}`,
      `Model words: ${data.model_words || "?"}  |  Your words: ${data.student_words || "?"}`,
      `Transcript: ${STAGE0_TRANSCRIPT || ""}`,
      "",
      data.feedback || ""
    ];
    const simFilename = `${keyPrefix}_interview_stage0_${sampleId}_${date}_similarity.txt`;
    uploadToDrive(simFilename, simLines.join("\n"), "text/plain", keyPrefix);

  } catch(e) {
    $("stage0-feedback-text").innerHTML = "<div class=\"analysis-error\">Similarity check failed. Please try again.</div>";
    $("stage0-feedback-text").classList.remove("hidden");
  }

  $("btn-stage0-feedback").disabled = false;
  $("btn-stage0-feedback").textContent = "Similarity Check";
};

$("btn-end-stage0").onclick = () => {
  if (STATE.recordings.some(r => r.stage === 0)) {
    // Has saved stage 0 recordings — go through normal end-session flow (downloads CSV + audio)
    STATE._endCalled = false;
    triggerEndSession();
  } else {
    // Nothing saved — just return to start
    releaseMic();
    showScreen("screen-start");
  }
};

// ═══════════════════════════════════════════════════
// INIT
// ═══════════════════════════════════════════════════
initGate();

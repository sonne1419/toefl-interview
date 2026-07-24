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
       blurb: "Practise just the opening: your position and one reason for it. Two sentences, checked for grammar.",
       intro: "This stage is only the first move of an answer — what you think, and why. Two sentences is enough; you are not telling the whole story yet.\n\n" +
              "You have 10 seconds. The check starts on its own as soon as you stop — there is no button to press. Because this is a single block, there is no band score: you get a grammar check instead, showing any words that need correcting.\n\n" +
              "💡 Stuck for an idea? Pick a reason and press Help me with ideas.\n" +
              "💡 As the pattern gets easier, hide the question text and the cues and try again from memory.\n" +
              "💡 Record Again is worth using — you have already seen what to fix." },

  2: { title: "Before Example",      instruction: "Practice the before/past example block.",
       blurb: "Practise the 'before' half of your example: how things used to be. Checked for grammar.",
       intro: "This stage is the middle of an answer — the situation in the past, before anything changed. It sets up the contrast that makes your point land.\n\n" +
              "You have 15 seconds. The check starts on its own as soon as you stop. Because this is a single block, there is no band score: you get a grammar check instead, showing any words that need correcting.\n\n" +
              "💡 Stuck for an idea? Pick a reason and press Help me with ideas.\n" +
              "💡 As the pattern gets easier, hide the question text and the cues and try again from memory.\n" +
              "💡 Record Again is worth using — you have already seen what to fix." },

  3: { title: "After Example",       instruction: "Practice the after/current result block.",
       blurb: "Practise the 'after' half: what changed, and the result. Checked for grammar.",
       intro: "This stage is the end of an answer — what happens now, and the concrete outcome. A strong ending shows a real result, not a repeat of your reason.\n\n" +
              "You have 20 seconds. The check starts on its own as soon as you stop. Because this is a single block, there is no band score: you get a grammar check instead, showing any words that need correcting.\n\n" +
              "💡 Stuck for an idea? Pick a reason and press Help me with ideas.\n" +
              "💡 As the pattern gets easier, hide the question text and the cues and try again from memory.\n" +
              "💡 Record Again is worth using — you have already seen what to fix." },

  4: { title: "Full Answer",         instruction: "Use the short cues to speak the full answer.",
       blurb: "Put the three blocks together into a complete answer. Scored, and compared with a Band 5 response.",
       intro: "This is the whole answer, start to finish — statement and reason, a before example, then an after example. The reference structure gives you the shape; the content is yours.\n\n" +
              "You have 45 seconds. Scoring starts on its own as soon as you stop — there is no button to press. You will get a band score, and when the band is below 5, a comparison with a Band 5 answer showing what a strong response does differently.\n\n" +
              "💡 Stuck for an idea? Pick a reason and press Help me with ideas.\n" +
              "💡 The Band 5 sample answers a different question. Read it for how it is built, not for what it says.\n" +
              "💡 Record Again is worth using — you have already seen what was missing." },

  5: { title: "Exam Mode",           instruction: "Exam mode — no cues.",
       blurb: "A full test with no cues and no feedback until the end — the closest thing to the real exam.",
       intro: "" }
};

// Stage 0 is not in STAGE_META (it runs its own screen), but the selector still
// needs a line describing it.
const STAGE0_BLURB = "Read a strong sample answer, then say it back — copy it, adapt it, or speak your own. Scored, and compared with the sample.";

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
  allSets:          [],   // all sets loaded upfront (for browse sidebar + search)
  currentQuestion:  null,
  currentTask:      null,
  _timerResolve:    null,
  _endCalled:       false,
  _audioResolve:    null,   // resolve handle to abort audio early
  _audioPlayTimer:  null,   // pending delayed play() timer (cancel on stop)
  _recordResolve:   null,   // resolve handle for record button press
  _saveResolve:     null,   // resolve handle for save/re-record wait
  _questionActive:  false,  // true while a question is running
  _restartRequested: false, // signal the practice loop to bail for a test/question switch
  _setCompleteTimer: null,  // timer for auto-return to picker after a set completes
  _loginWarmupStarted: false, // guard: mic warmup kicked off after login
  _browseWarmupStarted: false, // guard: fallback warmup on practice entry
  _gradeToken:       0,     // bumped per take so a stale grade can't overwrite a newer one
  _lastTranscript:   "",
  _lastBand:         null,
  _lastGap:          "",
  _lastGrammar:      "",
  _gradePromise:     null,  // in-flight grading, awaited before Save & Next
  _sessionFileId:    null   // Drive file for this session's report; redos update it
};

// ═══════════════════════════════════════════════════
// UTILITIES
// ═══════════════════════════════════════════════════

function $(id) { return document.getElementById(id); }
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// Build the small pattern hint for a question, e.g. "(WH-Q + required ending)".
// Reads opening_type (wh_q / pick_1_of_2; legacy open / pick1) and
// question_type (required_wording / free).
function questionHintLabel(q) {
  if (!q) return "";
  var o = (q.opening_type || "").toString();
  var opening = (o === "wh_q" || o === "open") ? "WH-Q" : "Pick 1 of 2";
  var ending = (q.question_type === "required_wording") ? "required ending" : "free ending";
  return "(" + opening + " + " + ending + ")";
}

// Render the question-list sidebar for the current task.
// currentIndex is 1-based (matches STATE.currentQuestionIndex); 0 = none yet.
function renderQuestionSidebar(task, currentIndex) {
  var wrap = $("interview-qlist-items");
  if (!wrap) return;
  var questions = (task && task.questions) || [];
  wrap.innerHTML = "";
  questions.forEach(function (q, i) {
    var n = i + 1;
    var item = document.createElement("div");
    item.className = "qlist-item";
    if (n === currentIndex) item.classList.add("is-current");
    else if (currentIndex && n < currentIndex) item.classList.add("is-done");
    var no = document.createElement("div");
    no.className = "qlist-qno";
    no.textContent = "Q" + n;
    var hint = document.createElement("div");
    hint.className = "qlist-hint";
    hint.textContent = questionHintLabel(q);
    item.appendChild(no);
    item.appendChild(hint);
    wrap.appendChild(item);
  });
}

// ═══════════════════════════════════════════════════
// INTERVIEW: test dropdown + question tabs
// ═══════════════════════════════════════════════════
function buildWhqSequence() {
  var out = [];
  browseRealSets().forEach(function (set) {
    (set.questions || []).forEach(function (q) {
      var o = (q.opening_type || "");
      if (o === "wh_q" || o === "open") {
        var qq = Object.assign({}, q);
        qq._sourceSetId = set.set_id;
        qq._sourceSetName = set.set_name || set.set_id;
        out.push(qq);
      }
    });
  });
  return out;
}

function makeWhqTask() {
  var qs = buildWhqSequence();
  var base = browseRealSets()[0] || {};
  return {
    set_id: "WHQ",
    set_name: "WH-Q only (" + qs.length + ")",
    _isWhq: true,
    interviewer_gender: base.interviewer_gender || "af",
    interviewer_image: base.interviewer_image,
    questions: qs,
    areas: base.areas,
    reasons: base.reasons,
    stage_meta: base.stage_meta
  };
}

function populateInterviewDropdown() {
  var sel = $("interview-test-select");
  if (!sel) return;
  var sets = browseRealSets();
  sel.innerHTML = "";

  var placeholder = document.createElement("option");
  placeholder.value = "";
  placeholder.textContent = "— Select a test —";
  sel.appendChild(placeholder);

  var whqCount = buildWhqSequence().length;
  var whqOpt = document.createElement("option");
  whqOpt.value = "WHQ";
  whqOpt.textContent = "WH-Q only (" + whqCount + ")";
  sel.appendChild(whqOpt);

  var divider = document.createElement("option");
  divider.disabled = true;
  divider.textContent = "──────────";
  sel.appendChild(divider);

  sets.forEach(function (set) {
    var opt = document.createElement("option");
    opt.value = set.set_id;
    opt.textContent = set.set_name ? (set.set_id + " — " + set.set_name) : set.set_id;
    sel.appendChild(opt);
  });

  var cur = STATE.currentTask;
  sel.value = cur ? (cur._isWhq ? "WHQ" : cur.set_id) : "";
}

function renderQTabs(task, currentIndex) {
  var wrap = $("interview-qtabs");
  if (!wrap) return;
  var questions = (task && task.questions) || [];
  wrap.innerHTML = "";
  questions.forEach(function (q, i) {
    var tab = document.createElement("div");
    tab.className = "qtab" + ((i + 1 === currentIndex) ? " is-current" : "");
    var label = task._isWhq ? (q._sourceSetId || ("Q" + (i + 1))) : ("Q" + (i + 1));
    tab.innerHTML = label + '<span class="qtab-hint">' + questionHintLabel(q) + "</span>";
    tab.addEventListener("click", function () { jumpToQuestion(i); });
    wrap.appendChild(tab);
  });
}

function switchInterviewTest(value) {
  var task;
  if (value === "WHQ") {
    task = makeWhqTask();
  } else {
    task = browseRealSets().find(function (s) { return s.set_id === value; });
  }
  if (!task) return;
  STATE.currentTask = task;
  STATE._startQIndex = 0;
  // If practice hasn't warmed the mic yet, take the one-time warmup path.
  if (!STATE.micWarmedUp) {
    STATE._endCalled = false;
    if (!STATE.recordings) STATE.recordings = [];
    micPermissionState().then(function (perm) {
      if (perm === "granted") { showScreen("screen-warmup"); runMicWarmup(); }
      else { showScreen("screen-mic-instruction"); }
    });
    return;
  }
  restartPractice();
}

// Show the interview screen in "pick a test first" state: dropdown ready,
// no test loaded, a prompt in the practice area.
function showInterviewPicker() {
  showScreen("screen-interview");
  initInterviewControls();
  populateInterviewDropdown();
  var sel = $("interview-test-select");
  if (sel) sel.value = "";
  var tabs = $("interview-qtabs"); if (tabs) tabs.innerHTML = "";
  var label = $("interview-question-label"); if (label) label.textContent = "";

  // Show the stage intro (depends only on the stage, not the test).
  var stage = STATE.selectedStage;
  var introText = (STAGE_META[stage] ? STAGE_META[stage].intro : "") || "";
  if ($("stage-intro-text")) translateUI(introText, $("stage-intro-text"), true);
  if ($("stage-intro-bar-text"))
    $("stage-intro-bar-text").textContent = "📋 About this stage — " + (STAGE_META[stage] ? STAGE_META[stage].title : "");
  if ($("stage-intro-body")) $("stage-intro-body").style.display = "";

  // Hide the practice cards (question card + support card) so only the picker
  // prompt shows. Force display:none so nothing can override it.
  var card = $("practice-question-card");
  if (card) { card.classList.add("hidden"); card.style.display = "none"; }
  var supportCard = $("practice-support-card");
  if (supportCard) { supportCard.classList.add("hidden"); supportCard.style.display = "none"; }
  var ideaWrap = $("idea-frame-wrap");
  if (ideaWrap) ideaWrap.style.display = "none";
  // Hide record controls + timer so the picker state is clean.
  var recBtn = $("btn-record"); if (recBtn) recBtn.classList.add("hidden");
  var postRec = $("post-record-buttons"); if (postRec) postRec.classList.add("hidden");
  var timerBox = $("response-timer-box"); if (timerBox) timerBox.classList.add("hidden");
  var panel = $("interview-practice-panel");
  if (panel) {
    var msg = $("interview-pick-msg");
    if (!msg) {
      msg = document.createElement("div");
      msg.id = "interview-pick-msg";
      msg.style.cssText = "padding:40px 24px;text-align:center;color:#6b7280;font-size:15px;";
      panel.insertBefore(msg, panel.firstChild);
    }
    msg.textContent = STATE._justCompletedSet
      ? "After you finish a test, pick another test from the dropdown menu, or press End Session to see your transcript and analysis."
      : "Pick a test from the dropdown menu to begin.";
    msg.style.display = "";
  }
  STATE._justCompletedSet = false;
}

function jumpToQuestion(qIndex) {
  STATE._startQIndex = qIndex || 0;
  restartPractice();
}

function restartPractice() {
  STATE._restartRequested = true;
  stopAudio();
  if (typeof abortTimer === "function") abortTimer();
  if (STATE._recordResolve) { var r = STATE._recordResolve; STATE._recordResolve = null; r(); }
  setTimeout(function () {
    STATE._restartRequested = false;
    STATE._endCalled = false;
    startPractice();
  }, 80);
}

function initInterviewControls() {
  var sel = $("interview-test-select");
  if (sel && !sel._wired) {
    sel._wired = true;
    sel.addEventListener("change", function () {
      if (sel.value && sel.value !== "──────────") switchInterviewTest(sel.value);
    });
  }
}

// ═══════════════════════════════════════════════════
// BROWSE SCREEN (fusion: dropdown + sidebar + search)
// ═══════════════════════════════════════════════════
const BROWSE = { search: "", whqOnly: "", selectedSetId: "" };

// Real sets only (exclude old placeholders like test01/02/03).
function browseIsRealSet(s) {
  return /^SET-/i.test(String(s.set_id || ""));
}
function browseRealSets() {
  return STATE.allSets.filter(browseIsRealSet);
}

function browseMatchesQ(q) {
  if (BROWSE.whqOnly) {
    var o = (q.opening_type || "");
    if (!(o === "wh_q" || o === "open")) return false;
  }
  var s = (BROWSE.search || "").trim().toLowerCase();
  if (s && !String(q.q || "").toLowerCase().includes(s)) return false;
  return true;
}

// Populate the top-bar test dropdown from STATE.allSets.
function populateBrowseDropdown() {
  var sel = $("browse-test-select");
  if (!sel) return;
  var prev = BROWSE.selectedSetId || "";
  sel.innerHTML = "";
  var allOpt = document.createElement("option");
  allOpt.value = "";
  var real = browseRealSets();
  allOpt.textContent = "All tests (" + real.length + ")";
  sel.appendChild(allOpt);
  real.forEach(function (set) {
    var opt = document.createElement("option");
    opt.value = set.set_id || set._file;
    var name = set.set_name || "";
    opt.textContent = name ? (set.set_id + " — " + name) : set.set_id;
    sel.appendChild(opt);
  });
  sel.value = prev;
}

// Render the sidebar list, grouped by set, applying search + WH-Q filters.
function renderBrowseSidebar() {
  var list = $("browse-list");
  if (!list) return;
  list.innerHTML = "";

  var searching = (BROWSE.search || "").trim().length > 0;
  var sets = browseRealSets();
  // Active search spans ALL tests; the dropdown only narrows when NOT searching.
  if (!searching && BROWSE.selectedSetId) {
    sets = sets.filter(function (s) { return (s.set_id || s._file) === BROWSE.selectedSetId; });
  }

  var anyShown = false;
  sets.forEach(function (set) {
    var shown = (set.questions || []).filter(browseMatchesQ);
    if (!shown.length) return;
    anyShown = true;

    var group = document.createElement("div");
    group.className = "browse-set-group";
    group.textContent = (set.set_name) ? (set.set_id + " — " + set.set_name) : set.set_id;
    list.appendChild(group);

    (set.questions || []).forEach(function (q, qi) {
      if (!browseMatchesQ(q)) return;
      var item = document.createElement("div");
      item.className = "browse-q-item";
      item.dataset.setId = set.set_id || set._file || "";
      item.dataset.qIndex = qi;

      var head = document.createElement("div");
      head.innerHTML =
        '<span class="browse-q-serial">' + (q.serial != null ? "#" + q.serial + "  " : "") + '</span>' +
        '<span class="browse-q-no">Q' + (qi + 1) + '</span>';
      var hint = document.createElement("div");
      hint.className = "browse-q-hint";
      hint.textContent = questionHintLabel(q);
      var preview = document.createElement("div");
      preview.className = "browse-q-preview";
      preview.textContent = browseQPreview(q.q);

      item.appendChild(head);
      item.appendChild(hint);
      item.appendChild(preview);
      item.addEventListener("click", function () {
        startPracticeFromBrowse(set, qi);
      });
      list.appendChild(item);
    });
  });

  if (!anyShown) {
    list.innerHTML = '<div style="padding:10px 8px;font-size:12px;color:#9ca3af">No questions match.</div>';
  }
}

// Short preview of the question (strip interviewer lead-ins, trim length).
function browseQPreview(text) {
  var t = String(text || "").replace(/\s+/g, " ").trim();
  t = t.replace(/^(I see\.|Interesting\.[^.]*\.|Interesting\.|Good points\.[^.]*\.|Good points\.|Thank you[^.]*\.|Alright\.|OK\.)\s*/i, "");
  if (t.length > 90) t = t.slice(0, 90) + "…";
  return t;
}

function refreshBrowse() {
  populateBrowseDropdown();
  renderBrowseSidebar();
}

function initBrowseControls() {
  var search = $("browse-search");
  if (search && !search._wired) {
    search._wired = true;
    search.addEventListener("input", function () {
      BROWSE.search = search.value || "";
      // Search is its own mode: clear the other filters.
      if (BROWSE.search) {
        BROWSE.whqOnly = "";
        BROWSE.selectedSetId = "";
        var whqEl = $("browse-whq-only"); if (whqEl) whqEl.checked = false;
        var selEl = $("browse-test-select"); if (selEl) selEl.value = "";
      }
      renderBrowseSidebar();
    });
  }
  var whq = $("browse-whq-only");
  if (whq && !whq._wired) {
    whq._wired = true;
    whq.addEventListener("change", function () {
      BROWSE.whqOnly = whq.checked ? "1" : "";
      // WH-Q filter is its own mode: clear search + test filters.
      if (BROWSE.whqOnly) {
        BROWSE.search = "";
        BROWSE.selectedSetId = "";
        var sEl = $("browse-search"); if (sEl) sEl.value = "";
        var selEl = $("browse-test-select"); if (selEl) selEl.value = "";
      }
      renderBrowseSidebar();
    });
  }
  var sel = $("browse-test-select");
  if (sel && !sel._wired) {
    sel._wired = true;
    sel.addEventListener("change", function () {
      BROWSE.selectedSetId = sel.value || "";
      // Test filter is its own mode: clear search + WH-Q.
      if (BROWSE.selectedSetId) {
        BROWSE.search = "";
        BROWSE.whqOnly = "";
        var sEl = $("browse-search"); if (sEl) sEl.value = "";
        var whqEl = $("browse-whq-only"); if (whqEl) whqEl.checked = false;
      }
      renderBrowseSidebar();
    });
  }
  var endBtn = $("btn-end-session-browse");
  if (endBtn && !endBtn._wired) {
    endBtn._wired = true;
    endBtn.addEventListener("click", function () { triggerEndSession(); });
  }
}

async function enterBrowseScreen() {
  showScreen("screen-browse");
  initBrowseControls();
  var list = $("browse-list");
  if (list) list.innerHTML = '<div style="padding:12px 8px;font-size:12px;color:#9ca3af">Loading tests…</div>';
  await loadAllSets();
  refreshBrowse();

  // Warm up the mic once per session, in the background, so clicking a question
  // goes straight into practice. Authorization (permission prompt) only appears
  // the first time after login; the silent warmup runs each session.
  if (!STATE.micWarmedUp && !STATE._browseWarmupStarted) {
    STATE._browseWarmupStarted = true;
    const perm = await micPermissionState();
    if (perm === "granted") {
      // Silent background warmup: request mic, do the 3s priming, no screen switch.
      backgroundMicWarmup();
    }
    // If not granted, we defer to the first click (which shows the mic-instruction
    // screen once); after that the session is warm.
  }
}

// Silent warmup that does NOT switch screens (used from the browse screen).
async function backgroundMicWarmup() {
  try {
    const ok = await ensureMic();
    if (!ok) return;
    await warmupAudioContext();
    startRecording();
    await sleep(3000);
    await stopRecording();       // discard warmup blob
    STATE.micWarmedUp = true;
  } catch (e) { /* if it fails, the normal warmup path still runs on click */ }
}

// Start practicing a specific set at a specific question index (from the browse
// list). Mic is usually already warm (from browse entry) -> go straight in.
async function startPracticeFromBrowse(set, qIndex) {
  STATE.currentTask   = set;
  STATE._startQIndex  = qIndex || 0;
  STATE._endCalled    = false;
  if (STATE.micWarmedUp) {
    startPractice();
    return;
  }
  // Not warm yet (permission wasn't granted at browse entry): run the normal
  // one-time path (instruction if needed, then warmup, then practice).
  if (!STATE.recordings) STATE.recordings = [];
  const perm = await micPermissionState();
  if (perm === "granted") {
    showScreen("screen-warmup");
    runMicWarmup();
  } else {
    showScreen("screen-mic-instruction");
  }
}


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

let audioContextWarmed = false;

async function warmupAudioContext() {
  // Run once, and close the context afterwards. Leaving contexts open (this
  // used to be called from four places, each creating a new one) attenuates
  // the start of audio played through the <audio> element — the very problem
  // this warmup was meant to prevent.
  if (audioContextWarmed) return;
  audioContextWarmed = true;
  let ctx = null;
  try {
    ctx = new (window.AudioContext || window.webkitAudioContext)();
    const buffer = ctx.createBuffer(1, 1, 22050);
    const source = ctx.createBufferSource();
    source.buffer = buffer;
    source.connect(ctx.destination);
    source.start(0);
    await ctx.resume();
  } catch(e) {
    console.log("Audio warmup failed:", e);
  } finally {
    if (ctx) { try { await ctx.close(); } catch (e) { /* already closed */ } }
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

// Tally the "Error:" labels from grammar feedback into count pills. Deterministic
// — computed from the text, so it cannot invent a pattern the model did not flag.
// Ported from the Academic Discussion tool.
function grammarErrorCounts(text) {
  const counts = {};
  if (!text) return counts;
  // Match "Error: …" up to the next label or the end, so it works whether the
  // feedback is newline-separated or run together.
  const re = /Error:\s*([\s\S]*?)(?=\s*(?:Revised:|Original:|Error:|===|$))/gi;
  let m;
  while ((m = re.exec(text)) !== null) {
    m[1].split(/[;；]/).forEach(part => {
      const label = part.trim().replace(/\s+/g, " ");
      if (label) counts[label] = (counts[label] || 0) + 1;
    });
  }
  return counts;
}

// Render a counts object as pills, most frequent first.
function grammarPillsHTML(counts, heading) {
  const labels = Object.keys(counts || {});
  if (!labels.length) return "";
  labels.sort((a, b) => counts[b] - counts[a] || a.localeCompare(b));
  const pills = labels.slice(0, 8).map(l =>
    '<span class="grammar-pill">' + escapeHTML(l) +
    (counts[l] > 1 ? ' ×' + counts[l] : '') + '</span>').join("");
  return '<div class="grammar-pills">' +
    (heading ? '<div class="grammar-pills-title" data-tr="' + escapeHTML(heading) + '">' +
               escapeHTML(heading) + '</div>' : "") +
    pills + '</div>';
}

// Pool the counts from several grammar results into one tally.
function grammarPoolCounts(texts) {
  const total = {};
  (texts || []).forEach(t => {
    const c = grammarErrorCounts(t);
    Object.keys(c).forEach(k => { total[k] = (total[k] || 0) + c[k]; });
  });
  return total;
}

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

  // One-time cleanup: "Band" and "words" were briefly sent to the translator,
  // which turned "Band" into 樂團 (a musical band). They are score labels, not
  // prose, so drop any cached translations left over from that.
  try {
    ["Band", "words"].forEach(k => {
      localStorage.removeItem("ui_tr::" + lang.toLowerCase() + "::" + k);
    });
  } catch (e) {}

  // Build the string list from where the text actually lives (no hardcoded
  // duplicates, so it can't drift from what's displayed):
  //  - every STAGE_META intro + instruction
  //  - the stage-4 word-count note
  //  - every [data-tr] element currently in the DOM
  const set = new Set();
  Object.keys(STAGE_META).forEach(k => {
    if (STAGE_META[k].intro)       set.add(STAGE_META[k].intro.trim());
    if (STAGE_META[k].instruction) set.add(STAGE_META[k].instruction.trim());
    if (STAGE_META[k].blurb)       set.add(STAGE_META[k].blurb.trim());
  });
  if (typeof STAGE0_BLURB === "string" && STAGE0_BLURB) set.add(STAGE0_BLURB.trim());
  set.add("Responses of 80 words and above are recommended.");
  // "Show sample" only appears in the DOM after the student ticks Hide sample,
  // so it would miss the [data-tr] sweep below. Add it explicitly.
  set.add("Show sample");
  // The Stage 0 results page is built after End Session, so its labels are not
  // in the DOM during warm-up. Add them explicitly to avoid an English flash.
  ["Your answer", "Not scored — try recording this one again.", "Your Recording",
   "5-point sample answer benchmark", "Compared with the 5-point sample",
   "Band 5 sample answer (a different question)", "Compared with a Band 5 answer",
   "Compared with the sample above", "Comparing with the sample above…",
   "Could not compare with the sample above.",
   "About the third column",
   "Grammar Check", "No grammar errors found — well done.", "Optional grammar check",
   "Check grammar", "Most common grammar mistakes",
   "No grammar errors found across this session — well done.",
   "I'll use my own idea", "Type your reason first.", "Type your reason…",
   "Pick a reason and generate ideas", "Generate",
   "The sample answers a different question:", "It answers:",
   "Try this question again",
   "Re-record your answer and compare it with the 5-point sample again. You have 45 seconds."
  ].forEach(t => set.add(t));
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
  // Send in chunks: one oversized batch would blow max_tokens, return null and
  // force every string onto the slow per-string path.
  const CHUNK = 12;
  try {
    const chunks = [];
    for (let i = 0; i < uncached.length; i += CHUNK) chunks.push(uncached.slice(i, i + CHUNK));

    let allOk = true;
    for (const part of chunks) {
      const r = await fetch("/.netlify/functions/translate", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ texts: part, language: lang })
      });
      const d = await r.json();
      if (d && Array.isArray(d.translations) && d.translations.length === part.length) {
        part.forEach((src, i) => {
          const tr = (d.translations[i] || "").trim();
          if (tr) { try { localStorage.setItem("ui_tr::" + lang.toLowerCase() + "::" + src, tr); } catch(e) {} }
        });
      } else {
        allOk = false;   // this chunk failed; the per-string pass below covers it
      }
    }
    if (allOk) return;
  } catch(e) {
    // fall through to per-string
  }

  // Fallback: per-string, for whatever the chunked pass did not manage to cache.
  for (const raw of uncached) {
    const cacheKey = "ui_tr::" + lang.toLowerCase() + "::" + raw;
    try { if (localStorage.getItem(cacheKey) !== null) continue; } catch(e) {}
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

// Fetched clips, keyed by source path. Downloading a clip in full before
// playing it means playback can never outrun the network and stall mid-word.
const audioBlobCache = new Map();
const AUDIO_CACHE_LIMIT = 12;

function cacheAudioBlobUrl(src, url) {
  audioBlobCache.set(src, url);
  // Release the oldest entries so a long session cannot grow without bound.
  while (audioBlobCache.size > AUDIO_CACHE_LIMIT) {
    const oldest = audioBlobCache.keys().next().value;
    const oldUrl = audioBlobCache.get(oldest);
    audioBlobCache.delete(oldest);
    try { URL.revokeObjectURL(oldUrl); } catch (e) { /* already released */ }
  }
}

// Resolves to a local object URL, or to the original src if the download
// fails so a network hiccup still leaves the question playable.
async function resolveAudioSrc(src) {
  if (audioBlobCache.has(src)) return audioBlobCache.get(src);
  try {
    const res = await fetch(src);
    if (!res.ok) return src;
    const url = URL.createObjectURL(await res.blob());
    cacheAudioBlobUrl(src, url);
    return url;
  } catch (e) {
    return src;
  }
}

// Fetch every clip in a set up front. Four short clips download while the
// student is still reading the intro, so no question waits on the network.
function prefetchSetAudio(task, questions) {
  if (task && task.intro_audio) resolveAudioSrc(task.intro_audio);
  (questions || []).forEach(q => { if (q && q.audio) resolveAudioSrc(q.audio); });
}

function playAudioReliable(src) {
  return new Promise(resolve => {
    if (!src) { resolve(); return; }
    const audio = $("question-audio-player");
    audio.pause();
    audio.currentTime = 0;
    audio.volume = 1.0;

    STATE._audioResolve = resolve;

    function cleanup() {
      STATE._audioResolve = null;
      if (STATE._audioPlayTimer) { clearTimeout(STATE._audioPlayTimer); STATE._audioPlayTimer = null; }
      audio.onended = null;
      audio.onerror = null;
      audio.oncanplaythrough = null;
      resolve();
    }

    // Download the whole clip first so playback cannot outrun the network.
    resolveAudioSrc(src).then(playableSrc => {
      // Session ended or the student moved on while the clip downloaded.
      if (STATE._audioResolve !== resolve) return;

      audio.src = playableSrc;
      audio.onended = cleanup;
      audio.onerror = cleanup;
      audio.oncanplaythrough = () => {
        audio.oncanplaythrough = null;
        // If playback was aborted (End Session), don't start playing.
        if (STATE._audioResolve !== resolve) return;
        audio.play().catch(() => cleanup());
      };
      audio.load();
    });
  });
}

function stopAudio() {
  const audio = $("question-audio-player");
  // Cancel any pending delayed play() so audio can't restart after stop.
  if (STATE._audioPlayTimer) { clearTimeout(STATE._audioPlayTimer); STATE._audioPlayTimer = null; }
  audio.oncanplaythrough = null;
  audio.onended = null;
  audio.onerror = null;
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
  // Silence everything first: a question prompt or a playback still running
  // would be picked up by the microphone.
  stopAllAudio();
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


// Stop every audio element on the page. Several can be playing at once — the
// question prompt, a Stage 0 sample, a playback of the student's own take, or a
// card on the results list — and leaving one running means it plays over the
// next screen.
function stopAllAudio() {
  try {
    document.querySelectorAll("audio").forEach(a => {
      try { a.pause(); a.currentTime = 0; } catch (e) {}
    });
  } catch (e) {}
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
  // Grade the take right away so Record Again is an informed retry. Stage 4 gets
  // a band plus a sample comparison; stages 1-3 get a grammar check (a single
  // block cannot be banded). Stage 5 is exam mode and stays unmarked.
  const st = STATE.selectedStage;
  if (STATE._lastBlob && st !== 5 && st !== 0) {
    // Keep the promise: Save & Next must wait for it, or the recording is stored
    // before the band arrives and the results card has no score (and so no redo).
    STATE._gradePromise = practiceGradeTake(STATE._lastBlob);
  }
}

function hidePostRecordButtons() {
  $("post-record-buttons").classList.add("hidden");
  const area = $("practice-result-area");
  if (area) area.classList.add("hidden");
}

// The Band 5 reference for the current set. It answers a DIFFERENT question
// from the one being practised, so it is a quality benchmark rather than a
// model answer — the results page and the comparison prompt both say so.
// Stage 4's Band 5 reference, chosen by question shape: a pick-1-of-2 question
// and a WH-question need different openings, and a required ending changes the
// close. Each sample carries the question it answers — the student is compared
// against a DIFFERENT question, so naming it keeps that honest.
// Source: SET json -> stage4_samples, built from the Settings sheet.
function practiceSampleCombo(q) {
  const o = (q && q.opening_type) || "";
  const opening = (o === "wh_q" || o === "open") ? "open" : "pick1";
  const ending  = (q && q.question_type === "required_wording") ? "required" : "free";
  return opening + "_" + ending;
}

function practiceBand5Entry(qOverride) {
  try {
    const task = STATE.currentTask;
    const q    = qOverride || STATE.currentQuestion;
    if (!task || !task.stage4_samples) return null;
    return task.stage4_samples[practiceSampleCombo(q)] || null;
  } catch (e) { return null; }
}

function practiceBand5Sample(qOverride) {
  const e = practiceBand5Entry(qOverride);
  return e ? String(e.answer || "").replace(/\\n/g, "\n").trim() : "";
}

function practiceBand5Question(qOverride) {
  const e = practiceBand5Entry(qOverride);
  return e ? String(e.question || "").trim() : "";
}

// ═══════════════════════════════════════════════════
// STAGE 4 — IMMEDIATE GRADING AFTER EACH TAKE
// Mirrors Stage 0: transcribe -> band -> comparison with a Band 5 sample.
// The result shows while the post-record buttons are up, so the student can
// read it before choosing Record Again or Save & Next.
// ═══════════════════════════════════════════════════


// ═══════════════════════════════════════════════════
// STAGES 1-3 — INLINE GRAMMAR CHECK
// Same moment as Stage 0 / Stage 4 grading: as soon as the take stops, so the
// student sees their errors before deciding to re-record. Reuses grammar.js and
// the existing word-diff highlighter, so corrections look the same everywhere.
// PATTERNS is left to End Session, where there are several answers for an error
// to actually recur across.
// ═══════════════════════════════════════════════════


// ═══════════════════════════════════════════════════
// OPTIONAL GRAMMAR CHECK (Stage 0 and Stage 4)
// Grammar is not part of the band, so it is offered rather than shown: a teacher
// can tell a particular student to press it. Stages 1-3 already run it
// automatically, since a single block cannot be banded.
// Shared by both screens — only the element ids differ.
// ═══════════════════════════════════════════════════

async function runOptionalGrammar(cfg) {
  const btn   = $(cfg.button);
  const block = $(cfg.block);
  if (!btn || !block) return;

  const question   = cfg.getQuestion();
  const transcript = cfg.getTranscript();
  if (!transcript || !transcript.trim()) return;

  btn.disabled = true;
  block.classList.remove("hidden");
  block.innerHTML = '<div class="analysis-feedback">Checking grammar…</div>';

  try {
    const res = await fetch("/.netlify/functions/grammar", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ questions: [{ question, transcript }], language: analysisLang() })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "Grammar check failed");

    // Take Q1 and drop PATTERNS — one answer cannot show a recurring pattern.
    const raw   = data.grammar || "";
    const parts = raw.split(/={2,}\s*(Q\d+|PATTERNS)\s*={2,}/);
    let q1 = "";
    for (let i = 1; i < parts.length; i += 2) {
      if ((parts[i] || "").trim() === "Q1") { q1 = (parts[i + 1] || "").trim(); break; }
    }
    if (!q1) q1 = raw.trim();

    cfg.store(q1);   // carried to the results page and the export

    const clean = q1.replace(/\(No grammar errors found\)/i, "").trim();
    block.innerHTML =
      '<div class="result-transcript-label" data-tr="Grammar Check">Grammar Check</div>' +
      '<div class="analysis-feedback" style="margin-top:6px;">' +
        (clean
          ? escWithLabels(highlightGrammarChanges(q1)).replace(/\n/g, "<br>")
          : '<div class="analysis-feedback-line" data-tr="No grammar errors found — well done.">' +
            'No grammar errors found — well done.</div>') +
      '</div>';
    btn.classList.add("hidden");   // done; the result replaces it
    try { translateStaticEls("#" + cfg.block); } catch (e) {}
  } catch (e) {
    console.error("Optional grammar check failed:", e.message);
    block.innerHTML = '<div class="analysis-error">Grammar check failed. Please try again.</div>';
    btn.disabled = false;
  }
}

async function practiceGrammarCheck(question, transcript, token) {
  const block = $("practice-analysis-block");
  block.innerHTML = '<div class="analysis-feedback">Checking grammar…</div>';
  block.classList.remove("hidden");

  try {
    const res = await fetch("/.netlify/functions/grammar", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        questions: [{ question, transcript }],
        language: analysisLang()
      })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "Grammar check failed");
    if (token !== STATE._gradeToken) return;   // superseded by a newer take

    // grammar.js returns "=== Q1 === ... === PATTERNS === ...". Take Q1 and
    // drop PATTERNS — one answer cannot show a recurring pattern.
    const raw   = data.grammar || "";
    const parts = raw.split(/={2,}\s*(Q\d+|PATTERNS)\s*={2,}/);
    let q1 = "";
    for (let i = 1; i < parts.length; i += 2) {
      if ((parts[i] || "").trim() === "Q1") { q1 = (parts[i + 1] || "").trim(); break; }
    }
    if (!q1) q1 = raw.trim();   // no markers — show whatever came back

    STATE._lastGrammar = q1;

    const clean = q1.replace(/\(No grammar errors found\)/i, "").trim();
    block.innerHTML =
      '<div class="result-transcript-label" data-tr="Grammar Check">Grammar Check</div>' +
      '<div class="analysis-feedback" style="margin-top:6px;">' +
        (clean
          ? escWithLabels(highlightGrammarChanges(q1)).replace(/\n/g, "<br>")
          : '<div class="analysis-feedback-line" data-tr="No grammar errors found — well done.">' +
            'No grammar errors found — well done.</div>') +
      '</div>';
    try { translateStaticEls("#practice-result-area"); } catch (e) {}
  } catch (e) {
    console.error("Stage " + STATE.selectedStage + " grammar check failed:", e.message);
    if (token === STATE._gradeToken) {
      block.innerHTML = '<div class="analysis-error">Grammar check failed. Please try again.</div>';
    }
  }
}

async function practiceGradeTake(blob) {
  const area   = $("practice-result-area");
  const textEl = $("practice-transcript-text");
  const block  = $("practice-analysis-block");
  const gapEl  = $("practice-gap-block");
  if (!area || !textEl) return;

  const question = STATE.currentQuestion ? (STATE.currentQuestion.q || "") : "";
  const token    = ++STATE._gradeToken;   // stale-result guard for fast re-records

  area.classList.remove("hidden");
  block.classList.add("hidden");
  gapEl.classList.add("hidden");
  $("practice-transcript-label").classList.remove("hidden");
  textEl.classList.remove("hidden");
  textEl.textContent = "Transcribing…";
  // New take — clear the previous grammar result and re-offer the button.
  const gB = $("btn-practice-grammar"), gBlk = $("practice-grammar-block");
  if (gB)   { gB.classList.add("hidden"); gB.disabled = false; }
  if (gBlk) { gBlk.classList.add("hidden"); gBlk.innerHTML = ""; }
  STATE._lastGrammar = "";

  // ── Transcribe ──
  let transcript = "";
  try {
    const audio_base64 = await blobToBase64(blob);
    const res = await fetch("/.netlify/functions/transcribe", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ audio_base64, filename: "practice.webm" })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "Transcription failed");
    transcript = normalizeTranscript(data.transcript || "");
  } catch (e) {
    console.error("Stage 4 transcription failed:", e.message);
    if (token === STATE._gradeToken) textEl.textContent = "(transcription failed)";
    return;
  }
  if (token !== STATE._gradeToken) return;   // a newer take superseded this one

  const words = countWords(transcript);
  textEl.textContent = transcript || "(no speech detected)";
  $("practice-transcript-label").textContent = "Transcript — " + words + " words";
  STATE._lastTranscript = transcript;

  // Let the student hear the take before deciding to re-record. Revoke the
  // previous URL so each recording does not leak one.
  const player = $("practice-playback");
  if (player) {
    if (player.dataset.blobUrl) { try { URL.revokeObjectURL(player.dataset.blobUrl); } catch (e) {} }
    const url = URL.createObjectURL(blob);
    player.dataset.blobUrl = url;
    player.src = url;
    player.classList.remove("hidden");
  }

  if (!transcript.trim()) return;

  // Stages 1-3 practise a single block (a statement, a before-example, an
  // after-example). Banding a fragment against full-answer samples would
  // mislead, and there is no organisation to assess — so those stages get a
  // grammar check instead.
  if (STATE.selectedStage !== 4) {
    return practiceGrammarCheck(question, transcript, token);
  }

  // ── Band ──
  block.innerHTML = '<div class="analysis-feedback">Scoring…</div>';
  block.classList.remove("hidden");

  let band = null;
  try {
    const res = await fetch("/.netlify/functions/analyze", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        questions: [{ question, transcript }],
        language: analysisLang(),
        mode: "band_only"
      })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "Analysis failed");
    const result = (data.parsed || {}).Q1;
    if (!result) {
      console.error("Stage 4: could not parse a band. Raw:", data.raw);
      throw new Error("No result");
    }
    band = result.band;
  } catch (e) {
    console.error("Stage 4 analysis failed:", e.message);
    if (token === STATE._gradeToken) {
      block.innerHTML = '<div class="analysis-error">Scoring failed. Please try again.</div>';
    }
    return;
  }
  if (token !== STATE._gradeToken) return;

  block.innerHTML = (band !== null)
    ? '<div class="analysis-band">Band ' + band + ' · ' + words + ' words</div>'
    : '<div class="analysis-error">Could not score this response.</div>';

  STATE._lastBand = band;

  // Offer the grammar check now the score is in — stage 4 only, since 1-3
  // already ran it automatically.
  const gBtn = $("btn-practice-grammar");
  if (gBtn) {
    gBtn.classList.remove("hidden");
    gBtn.disabled = false;
    gBtn.onclick = () => runOptionalGrammar({
      button: "btn-practice-grammar",
      block:  "practice-grammar-block",
      getQuestion:   () => (STATE.currentQuestion ? (STATE.currentQuestion.q || "") : ""),
      getTranscript: () => STATE._lastTranscript || "",
      store: (g) => { STATE._lastGrammar = g; }
    });
  }

  // ── Comparison (below Band 5 only) ──
  const sample = practiceBand5Sample();
  if (typeof band !== "number" || band >= 5) return;
  if (!sample) {
    // Sets built before stage4_samples existed have no reference to compare
    // against. Say so rather than silently showing a bare band.
    console.warn("Stage 4: no Band 5 sample for this question shape (" +
                 practiceSampleCombo(STATE.currentQuestion) +
                 "). Rebuild the sets with the new template to enable comparison.");
    return;
  }

  gapEl.innerHTML = '<div class="analysis-feedback">Comparing with a Band 5 answer…</div>';
  gapEl.classList.remove("hidden");
  // The comparison grid repeats the transcript in its left cell, so drop the
  // standalone copy above it rather than showing the answer twice.
  $("practice-transcript-label").classList.add("hidden");
  textEl.classList.add("hidden");

  try {
    const res = await fetch("/.netlify/functions/why-not-5-speaking", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        question, answer: transcript, sample, band,
        language: analysisLang(),
        // The sample answers a different question here, so the prompt must not
        // claim otherwise or the model faults the student for content mismatch.
        same_topic: false,
        sample_question: practiceBand5Question()
      })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "Comparison failed");
    if (token !== STATE._gradeToken) return;

    STATE._lastGap = data.explanation || "";
    // Show the answer beside the sample, then the comparison underneath — the
    // same shape as the results page. Without the sample on screen, feedback
    // like "the sample develops its example" refers to something unseen.
    const sq = practiceBand5Question();
    gapEl.innerHTML =
      '<table class="stage0-compare"><tbody><tr>' +
        '<td class="cmp-left">' +
          '<div class="result-transcript-label">' +
            '<span data-tr="Your answer">Your answer</span> — ' + words + ' words</div>' +
          '<div class="result-transcript-text">' + escapeHTML(transcript) + '</div>' +
        '</td>' +
        '<td class="cmp-right">' +
          '<div class="result-transcript-label">' +
            '<span data-tr="Band 5 sample answer (a different question)">Band 5 sample answer (a different question)</span> — ' +
            countWords(sample) + ' words</div>' +
          (sq ? '<div class="practice-sample-q">' +
                  '<span data-tr="It answers:">It answers:</span> ' + escapeHTML(sq) + '</div>' : "") +
          '<div class="result-transcript-text" style="color:#444;">' + escapeHTML(sample) + '</div>' +
        '</td>' +
      '</tr></tbody></table>' +
      '<div class="result-analysis-block">' +
        '<div class="result-transcript-label" data-tr="Compared with a Band 5 answer">Compared with a Band 5 answer</div>' +
        '<div class="analysis-feedback" style="margin-top:6px;">' +
          (STATE._lastGap).split("\n").filter(l => l.trim())
            .map(l => '<div class="analysis-feedback-line">' + escapeHTML(l) + '</div>').join("") +
        '</div>' +
      '</div>';
    try { translateStaticEls("#practice-result-area"); } catch (e) {}
  } catch (e) {
    console.error("Stage 4 comparison failed:", e.message);
    if (token === STATE._gradeToken) {
      gapEl.innerHTML = '<div class="analysis-error">Could not compare with a Band 5 answer.</div>';
    }
  }
}

// Wait for Save & Next or Record Again
async function waitForSaveOrRerecord(responseTime) {
  while (true) {
    // Wait for either button
    const action = await new Promise(resolve => {
      STATE._saveResolve = resolve;
      $("btn-save-next").onclick   = async () => {
        // Let the grade land first, so band/gap/grammar are stored with the take.
        const btn = $("btn-save-next");
        if (STATE._gradePromise) {
          btn.disabled = true;
          const prev = btn.textContent;
          btn.textContent = "Scoring…";
          try { await STATE._gradePromise; } catch (e) {}
          btn.textContent = prev;
          btn.disabled = false;
        }
        STATE._saveResolve = null;
        resolve("save");
      };
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
  STATE.testIndex.forEach((t, idx) => {
    const opt = document.createElement("option");
    opt.value = t.file;
    opt.dataset.dir = t.dir || "sets";
    // Prefer a friendly set name if the index provides one; else use the label.
    const name = t.set_name || t.name || t.label || t.file;
    opt.textContent = name;
    sel.appendChild(opt);
  });
}

// Load EVERY set upfront (index + each full set) for the browse sidebar & search.
// Reuses the existing list_sets + get_set endpoints. Cached in STATE.allSets.
// Returns the array; safe to call more than once (fetches only once).
let _allSetsPromise = null;
async function loadAllSets() {
  if (STATE.allSets && STATE.allSets.length) return STATE.allSets;
  if (_allSetsPromise) return _allSetsPromise;

  _allSetsPromise = (async () => {
    const key = sessionStorage.getItem("access_key") || "";
    // Ensure we have the index first.
    if (!STATE.testIndex || !STATE.testIndex.length) {
      try {
        const res = await fetch(`/.netlify/functions/api?op=list_sets&key=${encodeURIComponent(key)}`);
        if (res.ok) STATE.testIndex = await res.json();
      } catch (e) { /* handled below */ }
    }
    const index = STATE.testIndex || [];

    // Fetch each set's full JSON in parallel.
    const results = await Promise.all(index.map(async (t) => {
      try {
        const dir = t.dir || "sets";
        const res = await fetch(
          `/.netlify/functions/api?op=get_set&file=${encodeURIComponent(t.file)}&dir=${encodeURIComponent(dir)}&key=${encodeURIComponent(key)}`
        );
        if (!res.ok) return null;
        const set = await res.json();
        set._file = t.file;
        set._dir  = dir;
        return set;
      } catch (e) { return null; }
    }));

    STATE.allSets = results.filter(Boolean);
    // Sort by numeric order if present, else by set_id.
    STATE.allSets.sort((a, b) => {
      const oa = (a.order != null) ? a.order : 9999;
      const ob = (b.order != null) ? b.order : 9999;
      if (oa !== ob) return oa - ob;
      return String(a.set_id || "").localeCompare(String(b.set_id || ""));
    });
    return STATE.allSets;
  })();

  return _allSetsPromise;
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
  } else if (stage === "5") {
    // Exam mode still uses the start-screen test dropdown
    $("test-selector-group").style.display = "";
    $("btn-start-session").disabled = $("test-selector").value === "";
  } else {
    // Practice stages 1-4: test is chosen inside the browse screen now
    $("test-selector-group").style.display = "none";
    $("btn-start-session").disabled = false;
  }
}

$("test-selector").onchange  = checkStartReady;
$("stage-selector").onchange = () => { checkStartReady(); showStageBlurb(); };

// "Which stage should I choose?" — lists every stage at once, so the choice can
// be made without selecting one first.
if ($("btn-stage-help")) {
  $("btn-stage-help").onclick = () => {
    const panel = $("stage-help-panel");
    if (!panel) return;
    const open = panel.style.display !== "none";
    panel.style.display = open ? "none" : "block";
    if (!open) { try { translateStaticEls("#stage-help-panel"); } catch (e) {} }
  };
}

// Describe the selected stage on the start screen, so the choice is informed
// rather than a guess at what "Statement & Reason" means.
function showStageBlurb() {
  const el = $("stage-blurb");
  if (!el) return;
  const v = $("stage-selector").value;
  if (v === "") { el.classList.add("hidden"); el.textContent = ""; return; }
  const text = (v === "0")
    ? STAGE0_BLURB
    : ((STAGE_META[parseInt(v)] || {}).blurb || "");
  if (!text) { el.classList.add("hidden"); el.textContent = ""; return; }
  el.classList.remove("hidden");
  el.setAttribute("data-tr", text);
  translateUI(text, el, false);
}

$("btn-start-session").onclick = async () => {
  const testFile = $("test-selector").value;
  const stageVal = $("stage-selector").value;
  const stage    = stageVal === "" ? null : parseInt(stageVal);

  // Fusion entry: for practice stages (1-4) with NO test pre-selected,
  // show the interview screen with an empty dropdown and a prompt to pick a
  // test first. Practice starts only when the user chooses one.
  if (stage !== null && stage !== 0 && stage !== 5 && !testFile) {
    STATE.selectedStage = stage;
    try {
      $("start-status").textContent = "Loading tests…";
      await loadAllSets();
      STATE.currentTask = null;
      STATE._endCalled  = false;
      if (!STATE.micWarmedUp && !STATE._browseWarmupStarted) {
        STATE._browseWarmupStarted = true;
        try {
          const perm = await micPermissionState();
          if (perm === "granted") backgroundMicWarmup();
        } catch (e) { /* mic warm is best-effort */ }
      }
      $("start-status").textContent = "";
      showInterviewPicker();
    } catch (err) {
      $("start-status").textContent = "⚠ Could not start: " + (err && err.message ? err.message : err);
      console.error("Start (picker) failed:", err);
    }
    return;
  }

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
  if (STATE._endCalled || STATE._restartRequested) return;
  STATE._endCalled = true;

  if (STATE._setCompleteTimer) { clearTimeout(STATE._setCompleteTimer); STATE._setCompleteTimer = null; }
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
    set_label: setLabel, test_id: task?.set_id || "test", question_index: qIndex,
    set_id: task?.set_id || "", set_name: task?.set_name || "",
    opening_type: q.opening_type || "", question_type: q.question_type || "",
    serial: q.serial != null ? q.serial : "",
    // Stage 4 grades each take as it finishes, so the results page can replay
    // the score instead of re-running the whole analysis at End Session.
    transcript: (stage >= 1 && stage <= 4) ? (STATE._lastTranscript || "") : undefined,
    band:       (stage === 4) ? STATE._lastBand : undefined,
    gap:        (stage === 4) ? (STATE._lastGap || "") : undefined,
    sample:     (stage === 4) ? practiceBand5Sample() : undefined,
    sample_q:   (stage === 4) ? practiceBand5Question() : undefined,
    // Stages 1-3 store the grammar result so End Session can replay it.
    // Stages 1-3 run grammar automatically; stage 4 only if the student pressed
    // the optional button. Either way it is carried to the results page.
    grammar:    (stage >= 1 && stage <= 4) ? (STATE._lastGrammar || "") : undefined
  });
  // Clear so the next question cannot inherit this take's result.
  STATE._lastTranscript = ""; STATE._lastBand = null; STATE._lastGap = "";
  STATE._lastGrammar = ""; STATE._gradePromise = null;
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

  // Download every clip in the set now, while the student is still reading.
  prefetchSetAudio(task, questions);

  // Optional starting question index (from the browse list). Default 0.
  let _startAt = STATE._startQIndex || 0;
  if (_startAt < 0 || _startAt >= questions.length) _startAt = 0;
  STATE._startQIndex = 0;  // consume it

  for (let i = _startAt; i < questions.length; i++) {
    if (STATE._endCalled || STATE._restartRequested) return;

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
    const setLabel = task.set_name || task.set_label || task.set_id || "Set";
    $("interview-question-label").textContent =
      `${setLabel} — Q${i + 1} of ${questions.length} — ${STAGE_META[stage] ? STAGE_META[stage].title : "Stage " + stage}`;

    // Test dropdown + question tabs (highlight current)
    var _pm = $("interview-pick-msg"); if (_pm) _pm.style.display = "none";
    initInterviewControls();
    populateInterviewDropdown();
    renderQTabs(task, i + 1);

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
    if (STATE._endCalled || STATE._restartRequested) return;
    if (STATE._skipQuestion) continue;

    // If record not yet pressed during audio, wait for it now
    if (!STATE._recordPressed) {
      await waitForRecordPress();
    }
    if (STATE._endCalled || STATE._restartRequested) return;
    if (STATE._skipQuestion) continue;

    // Stop audio in case it is still playing
    stopAudio();

    // Ensure mic is available (may have been released on previous End Session)
    const micOk = await ensureMic();
    if (!micOk) {
      console.error("Microphone unavailable");
      return;
    }
    if (STATE._endCalled || STATE._restartRequested) return;
    if (STATE._skipQuestion) continue;

    // Start recording
    setRecordBtn("recording");
    startRecording();

    // Timer — may be aborted early by stop button
    STATE._lastBlob = null;
    await startResponseTimer(responseTime);
    if (STATE._endCalled || STATE._restartRequested) return;
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
    if (STATE._endCalled || STATE._restartRequested) return;
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

  // Download every clip in the set now, while the student is still reading.
  prefetchSetAudio(task, questions);

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
    if (STATE._endCalled || STATE._restartRequested) return;
  }

  for (let i = 0; i < questions.length; i++) {
    if (STATE._endCalled || STATE._restartRequested) return;
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
    if (STATE._endCalled || STATE._restartRequested) return;

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

    if (STATE._endCalled || STATE._restartRequested) return;

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
  // A set was completed: return to the picker screen (same screen shown on entry)
  // with a message inviting another test or ending to see analysis.
  STATE.currentTask = null;
  STATE._justCompletedSet = true;
  showInterviewPicker();
}

// (The "Practice Another Test" button was removed — set-complete now
// auto-returns to the test picker. Guard kept in case the element is absent.)
var _contBtn = $("btn-continue-practice");
if (_contBtn) _contBtn.onclick = () => {
  STATE._endCalled = false;
  STATE.currentTask = null;
  showInterviewPicker();
};

// ═══════════════════════════════════════════════════
// PRACTICE SUPPORT RENDERER
// ═══════════════════════════════════════════════════

function renderPracticeSupport(task, question, stage) {
  const questionCard = $("practice-question-card");
  const supportCard  = $("practice-support-card");
  const reasonList   = $("practice-reason-list");

  // New question — clear the idea panel. One typed reason per question, matching
  // how recordings are single-slot during practice.
  const ideaSel = $("idea-reason-select");
  if (ideaSel) ideaSel.value = "";
  const ideaOwn = $("idea-own-input");
  if (ideaOwn) { ideaOwn.value = ""; ideaOwn.classList.add("hidden"); }
  const ideaStatus = $("idea-status");
  if (ideaStatus) ideaStatus.textContent = "";

  // Question card — default hidden
  questionCard.classList.remove("hidden");
  questionCard.style.display = "";
  const escaped     = escapeHTML(question.q);
  const highlighted = applyHighlights(escaped, question.highlight_phrases || []);
  $("practice-question-text").innerHTML = highlighted;
  $("toggle-question").checked = false;
  $("practice-question-text").style.display = "none";
  const toggleQSpan = $("toggle-question-label").querySelector(".toggle-text");
  if (toggleQSpan) toggleQSpan.textContent = "Show text";

  // Support card
  supportCard.classList.remove("hidden");
  supportCard.style.display = "";
  var ideaWrapEl = $("idea-frame-wrap");
  if (ideaWrapEl) ideaWrapEl.style.display = "";
  const stageNum = parseInt(stage) || 1;
  const meta = STAGE_META[stageNum] || STAGE_META[1];
  $("practice-stage-title").textContent       = (stageNum === 4) ? "Reference Structure" : meta.title;
  const instrEl = $("practice-stage-instruction");
  instrEl.style.color = "#555";
  if (stageNum === 4) {
    // Instruction + the 80-words note, translated together (asHTML keeps the line break)
    translateUI(meta.instruction + "\nResponses of 80 words and above are recommended.", instrEl, true);
  } else {
    translateUI(meta.instruction, instrEl, false);
  }

  // The idea panel is a sibling of the reason list inside #practice-support-split,
  // so clearing the list no longer touches it — no need to park it anywhere.

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

  // Render areas — skip empty. area2 (the reasons list) is intentionally omitted;
  // the same reasons are available in the idea-generation dropdown.
  // area3 is a full worked answer to a DIFFERENT question. Showing it beside the
  // current question makes students think it is the model answer for THIS one,
  // so it is kept out of the practice view. It still appears on the results page
  // as a clearly-labelled Band 5 reference.
  const areasToShow = [
    { text: normalize(area1), cls: "support-area area1" },
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

  // The idea panel sits in the right-hand column of #practice-support-split and
  // stays there; it is no longer re-inserted into the reason list.
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
  stopAllAudio();
  $("saving-modal").classList.add("hidden");
  clearInterval(STATE.timerInterval);

  // Stage 4 grades each take during practice, so its summary is deterministic
  // and shares Stage 0's layout (side-by-side comparison + redo).
  if (STATE.selectedStage === 4 && STATE.recordings.some(r => r.stage === 4)) {
    endStage4Session();
    return;
  }

  // Exam mode uses the same results layout. It has no inline grading — a timed
  // test gives no feedback until the end — so the scoring happens there.
  if (STATE.selectedStage === 5 && STATE.recordings.some(r => r.stage === 5)) {
    endExamSession();
    return;
  }

  showScreen("screen-end");
  $("results-list").innerHTML = "";
  $("end-summary").textContent =
    `${STATE.recordings.length} question${STATE.recordings.length !== 1 ? "s" : ""} recorded.`;
  runTranscriptionFlow();
}

// ═══════════════════════════════════════════════════
// STAGE 4 — DETERMINISTIC SESSION SUMMARY (no AI calls)
// Same layout as Stage 0. The Band 5 sample answers a different question, so it
// is labelled as a quality reference rather than a model answer.
// ═══════════════════════════════════════════════════


// ═══════════════════════════════════════════════════
// EXAM MODE — RESULTS
// Same layout as Stage 4: band-only plus a comparison with the Band 5 sample.
// Unlike practice, nothing is graded until now — a timed test gives no feedback
// while it runs — so transcription and scoring happen here, then one optional
// grammar pass across the whole session.
// ═══════════════════════════════════════════════════


// One grammar call across every exam answer. Renders the corrections under each
// card, that card's own error tags, and a pooled tally at the top — which is the
// part a student can act on, since it shows what recurs rather than one slip.
async function runSessionGrammar(recs) {
  const btn = $("btn-session-grammar");
  const box = $("session-grammar-summary");
  if (!btn || !box) return;

  const withText = recs.filter(r => r.transcript && r.transcript.trim());
  if (!withText.length) return;

  btn.disabled = true;
  box.classList.remove("hidden");
  box.innerHTML = '<div class="analysis-feedback">Checking grammar…</div>';

  try {
    const res = await fetch("/.netlify/functions/grammar", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        questions: withText.map(r => ({ question: r.q, transcript: r.transcript })),
        language: analysisLang()
      })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "Grammar check failed");

    // Split into per-question blocks. PATTERNS is dropped: the pooled tags below
    // are computed from the actual labels, so they cannot drift from the text.
    const raw   = data.grammar || "";
    const parts = raw.split(/={2,}\s*(Q\d+|PATTERNS)\s*={2,}/);
    const byQ   = {};
    for (let i = 1; i < parts.length; i += 2) {
      const key = (parts[i] || "").trim();
      if (/^Q\d+$/.test(key)) byQ[key] = (parts[i + 1] || "").trim();
    }

    const texts = [];
    withText.forEach((r, i) => {
      const g = byQ["Q" + (i + 1)] || "";
      r.grammar = g;                       // carried to the export
      texts.push(g);
      const idx  = recs.indexOf(r);
      const slot = $("exam-grammar-" + idx);
      if (!slot) return;
      const clean = g.replace(/\(No grammar errors found\)/i, "").trim();
      slot.classList.remove("hidden");
      slot.innerHTML =
        '<div class="result-transcript-label" data-tr="Grammar Check">Grammar Check</div>' +
        grammarPillsHTML(grammarErrorCounts(g), "") +
        '<div class="analysis-feedback" style="margin-top:6px;">' +
          (clean
            ? escWithLabels(highlightGrammarChanges(g)).replace(/\n/g, "<br>")
            : '<div class="analysis-feedback-line" data-tr="No grammar errors found — well done.">' +
              'No grammar errors found — well done.</div>') +
        '</div>';
    });

    const pooled = grammarPoolCounts(texts);
    STATE._sessionGrammarPills = pooled;    // carried to the export
    box.innerHTML = Object.keys(pooled).length
      ? grammarPillsHTML(pooled, "Most common grammar mistakes")
      : '<div class="analysis-feedback-line" data-tr="No grammar errors found across this session — well done.">' +
        'No grammar errors found across this session — well done.</div>';

    btn.classList.add("hidden");
    try { translateStaticEls("#results-list"); } catch (e) {}
  } catch (e) {
    console.error("Session grammar check failed:", e.message);
    box.innerHTML = '<div class="analysis-error">Grammar check failed. Please try again.</div>';
    btn.disabled = false;
  }
}

async function endExamSession() {
  stopAllAudio();
  releaseMic();
  clearInterval(STATE.timerInterval);
  $("saving-modal").classList.add("hidden");
  showScreen("screen-end");

  const recs = STATE.recordings.filter(r => r.stage === 5);

  const heading = document.querySelector("#screen-end .results-top-bar h2");
  if (heading) heading.textContent = "Exam Mode — Results";

  const statusEl = $("transcription-status");
  statusEl.classList.remove("hidden");
  statusEl.textContent = "Transcribing your responses…";
  $("end-summary").textContent = "";
  $("results-list").innerHTML = "";

  // ── Transcribe anything not already done ──
  for (const r of recs) {
    if (r.transcript && r.transcript.trim()) continue;
    try {
      const audio_base64 = await blobToBase64(r.blob);
      const res = await fetch("/.netlify/functions/transcribe", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ audio_base64, filename: r.filename || "exam.webm" })
      });
      const data = await res.json();
      if (res.ok) r.transcript = normalizeTranscript(data.transcript || "");
    } catch (e) {
      console.error("Exam transcription failed:", e.message);
    }
  }

  // ── Band for every question, in one call ──
  statusEl.textContent = "Scoring…";
  const scored = recs.filter(r => r.transcript && r.transcript.trim());
  if (scored.length) {
    try {
      const res = await fetch("/.netlify/functions/analyze", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          questions: scored.map(r => ({ question: r.q, transcript: r.transcript })),
          language: analysisLang(),
          mode: "band_only"
        })
      });
      const data = await res.json();
      if (res.ok && data.parsed) {
        scored.forEach((r, i) => {
          const got = data.parsed["Q" + (i + 1)];
          if (got) r.band = got.band;
        });
      } else {
        console.error("Exam analysis returned no bands. Raw:", data.raw);
      }
    } catch (e) {
      console.error("Exam analysis failed:", e.message);
    }
  }

  // ── Comparison for anything below Band 5 ──
  statusEl.textContent = "Comparing with Band 5 answers…";
  for (const r of scored) {
    r.sample   = practiceBand5Sample({ opening_type: r.opening_type, question_type: r.question_type });
    r.sample_q = practiceBand5Question({ opening_type: r.opening_type, question_type: r.question_type });
    if (typeof r.band !== "number" || r.band >= 5 || !r.sample) continue;
    try {
      const res = await fetch("/.netlify/functions/why-not-5-speaking", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          question: r.q, answer: r.transcript, sample: r.sample, band: r.band,
          language: analysisLang(), same_topic: false, sample_question: r.sample_q
        })
      });
      const data = await res.json();
      if (res.ok) r.gap = data.explanation || "";
    } catch (e) {
      console.error("Exam comparison failed:", e.message);
    }
  }

  renderExamResults(recs);

  // ── Save ──
  statusEl.textContent = "Saving to your records…";
  const transcripts = {};
  recs.forEach((r, i) => { transcripts[i] = r.transcript || ""; });
  await autoDownload(transcripts);
  await exportStage0Doc(recs);
  statusEl.textContent = "✓ Saved to your records.";
}

// Draw the cards plus the session-wide grammar control above them.
function renderExamResults(recs) {
  const banded = recs.filter(r => typeof r.band === "number");
  const avg = banded.length
    ? (banded.reduce((sum, r) => sum + r.band, 0) / banded.length).toFixed(1)
    : "—";
  $("end-summary").textContent =
    recs.length + " question" + (recs.length !== 1 ? "s" : "") + " attempted" +
    " · Average band: " + avg +
    (banded.length && banded.length < recs.length
      ? " (" + banded.length + " of " + recs.length + " scored)"
      : "");

  const list = $("results-list");
  list.innerHTML = "";

  // One grammar pass for the whole session, rather than a button per card:
  // in exam mode the student has just answered every question, so the useful
  // view is what recurs across all of them.
  const bar = document.createElement("div");
  bar.id = "session-grammar-bar";
  bar.innerHTML =
    '<button id="btn-session-grammar" type="button" class="btn-secondary" ' +
    'style="width:auto;padding:7px 16px;font-size:13px;" ' +
    'data-tr="Check grammar">Check grammar</button>' +
    '<div id="session-grammar-summary" class="hidden"></div>';
  list.appendChild(bar);

  recs.forEach((r, i) => {
    const card = stage0ResultCard(r, 0);
    card.id = "exam-card-" + i;
    const slot = document.createElement("div");
    slot.className = "card-grammar-slot hidden";
    slot.id = "exam-grammar-" + i;
    // Insert before the redo box so the order reads: analysis -> grammar ->
    // re-record. The redo is the action taken after reading the feedback.
    const redoBox = card.querySelector(".stage0-redo");
    if (redoBox) card.insertBefore(slot, redoBox);
    else         card.appendChild(slot);
    list.appendChild(card);
  });

  $("btn-session-grammar").onclick = () => runSessionGrammar(recs);
  try { translateStaticEls("#results-list"); } catch (e) {}
}

async function endStage4Session() {
  stopAllAudio();
  releaseMic();
  clearInterval(STATE.timerInterval);
  showScreen("screen-end");

  const recs   = STATE.recordings.filter(r => r.stage === 4);
  const banded = recs.filter(r => typeof r.band === "number");
  const avg    = banded.length
    ? (banded.reduce((sum, r) => sum + r.band, 0) / banded.length).toFixed(1)
    : "—";

  const heading = document.querySelector("#screen-end .results-top-bar h2");
  if (heading) heading.textContent = "Full Answer — Practice Summary";

  const statusEl = $("transcription-status");
  statusEl.classList.remove("hidden");
  statusEl.textContent = "Saving to your records…";
  $("end-summary").textContent =
    recs.length + " question" + (recs.length !== 1 ? "s" : "") + " attempted" +
    " · Average band: " + avg +
    (banded.length && banded.length < recs.length
      ? " (" + banded.length + " of " + recs.length + " scored)"
      : "");

  const list = $("results-list");
  list.innerHTML = "";
  recs.forEach((r) => { list.appendChild(stage0ResultCard(r, 0)); });
  try { translateStaticEls("#results-list"); } catch (e) {}

  const transcripts = {};
  recs.forEach((r, i) => { transcripts[i] = r.transcript || ""; });
  await autoDownload(transcripts);
  await exportStage0Doc(recs);
  statusEl.textContent = "✓ Saved to your records.";
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
  if (!res.ok) {
    let detail = "";
    try { const e = await res.json(); detail = e.error || JSON.stringify(e); }
    catch (_) { try { detail = await res.text(); } catch (__) {} }
    console.error("Transcription failed (" + res.status + "):", detail);
    throw new Error("Transcription failed: " + detail);
  }
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
    var _propLabel = questionHintLabel({ opening_type: r.opening_type, question_type: r.question_type });
    var _testId = r.set_id || r.test_id || "";
    var _testName = r.set_name || "";
    var _headBits = [];
    if (_testId) _headBits.push(escapeHTML(_testId));
    if (_testName) _headBits.push(escapeHTML(_testName));
    _headBits.push('Q' + r.question_index);
    if (_propLabel) _headBits.push(escapeHTML(_propLabel));
    _headBits.push(STAGE_META[r.stage] ? STAGE_META[r.stage].title : 'Stage ' + r.stage);
    card.innerHTML =
      '<div class="result-num">' + _headBits.join(' — ') + '</div>' +
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
    if (!res.ok) {
      let detail = "";
      try { const e = await res.json(); detail = e.error || JSON.stringify(e); }
      catch (_) { try { detail = await res.text(); } catch (__) {} }
      console.error("Analysis failed (" + res.status + "):", detail);
      throw new Error("Analysis failed: " + detail);
    }
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
        grammarPillsHTML(grammarErrorCounts(grammarText), "") +
        "<div class=\"analysis-feedback\">" +
        escWithLabels(highlightGrammarChanges(grammarText)).replace(/\n/g, "<br>") +
        "</div>";
      card.appendChild(grammarBlock);
    });

    // Common errors, tallied from the "Error:" labels rather than taken from the
    // model's PATTERNS prose — the counts then reflect what was actually flagged.
    const _pooled = grammarPoolCounts(
      Object.keys(grammarParsed).filter(k => /^Q\d+$/.test(k)).map(k => grammarParsed[k].feedback || "")
    );
    STATE._sessionGrammarPills = _pooled;
    if (Object.keys(_pooled).length) {
      const patternsDiv = document.createElement("div");
      patternsDiv.className = "result-item overall-block";
      patternsDiv.innerHTML =
        '<div class="result-num" data-tr="Most common grammar mistakes">Most common grammar mistakes</div>' +
        grammarPillsHTML(_pooled, "");
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

// fileId updates an existing Drive file instead of creating another — used so a
// redo rewrites the session report rather than adding a near-identical copy.
async function uploadToDrive(filename, content, mimeType, studentKey, isBase64 = false, convertTo, subfolder, fileId) {
  try {
    const res  = await fetch("/.netlify/functions/upload-to-drive", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ filename, content, mimeType, studentKey, isBase64, convertTo, subfolder, fileId })
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
    const propLabel = questionHintLabel({ opening_type: r.opening_type, question_type: r.question_type });
    const headBits = [];
    if (r.set_id || r.test_id) headBits.push(escapeHTML(r.set_id || r.test_id));
    if (r.set_name) headBits.push(escapeHTML(r.set_name));
    headBits.push("Q" + (r.question_index || (i + 1)));
    if (propLabel) headBits.push(escapeHTML(propLabel));
    headBits.push(escapeHTML(stageTitle));
    const header = `<h2 style="color:#00736b;font-size:16px">${headBits.join(" — ")}</h2>`;
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

  const _r0 = STATE.recordings[0];
  const setLabel = _r0
    ? [(_r0.set_id || _r0.test_id || ""), (_r0.set_name || "")].filter(Boolean).join(" — ")
    : "";
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
  // Each redo already saved itself, so there is nothing to flush here. Clearing
  // the file id means the next session creates its own report.
  STATE._sessionFileId  = null;
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

// Warm up the microphone once, right after login (per the "authorize once,
// warm up per session" model). The mic stream is held for the whole session,
// so warming here is safe and removes any wait when practice starts. The audio
// OUTPUT pipeline is still re-primed before the first question as a safety net.
async function warmUpMicAfterLogin() {
  if (STATE.micWarmedUp || STATE._loginWarmupStarted) return;
  STATE._loginWarmupStarted = true;
  try {
    // Request mic permission now (prompts on first login), then warm up.
    const ok = await ensureMic();
    if (ok) {
      await backgroundMicWarmup();     // silent, no screen switch
    }
    // If denied, the first practice entry will guide the user to enable it.
  } catch (e) { /* best-effort */ }
}

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
    warmUpMicAfterLogin();
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
      warmUpMicAfterLogin();
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
// Module-level so re-binding the record button can clear a stale interval and
// so the stop path can't run twice (timer tick + manual click).
let STAGE0_TIMER      = null;
let STAGE0_STOPPING   = false;

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

// The sample's own logic, shown above its text so the shape is visible before
// the sentences. Translatable like the sample itself.
function renderStage0Structure(el) {
  if (!el) return;
  const en = el.dataset.en || "";
  if (!en) { el.textContent = ""; el.style.display = "none"; return; }
  el.style.display = "";
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

  document.querySelectorAll(".stage0-full-text").forEach(el => el.style.visibility = "");
  $("stage0-full-header").style.visibility = "";
  $("stage0-table-area").classList.remove("hidden");


  // New sample always starts with the sample answer visible. The checkbox is
  // inverted (checked = hidden), so it resets to UNchecked.
  $("toggle-stage0-full").checked = false;
  setStage0FullVisible(true);

  // Reset record button to pulse state
  const recBtn = $("btn-stage0-record");
  recBtn.classList.remove("recording", "hidden");
  recBtn.classList.add("pulse");
  $("stage0-post-record").classList.add("hidden");
  $("stage0-timer-box").classList.add("hidden");
  $("stage0-results-area").classList.add("hidden");
  $("stage0-analysis-block").classList.add("hidden");
  $("stage0-gap-block").classList.add("hidden");
  STAGE0_BLOB = null;
  STAGE0_TRANSCRIPT = "";

  // Clear any idea spine generated for the previous sample.
  for (let i = 1; i <= 3; i++) {
    const cell = $("stage0-spine-" + i);
    if (cell) cell.textContent = "";
  }
  const ideaStatus = $("s0-idea-status");
  if (ideaStatus) ideaStatus.textContent = "";
  const ideaSel = $("s0-idea-reason-select");
  if (ideaSel) ideaSel.value = "";
  // One typed reason per question, matching how recordings are single-slot.
  const ideaOwn = $("s0-idea-own-input");
  if (ideaOwn) { ideaOwn.value = ""; ideaOwn.classList.add("hidden"); }

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
  document.querySelectorAll(".stage0-full-text").forEach(el => el.style.visibility = show ? "" : "hidden");
  // Hide only the column's label — NOT the whole <th>, because the toggle now
  // lives inside that header cell and must stay clickable so the student can
  // turn the sample back on mid-practice.
  const hdrLabel = $("stage0-full-header-label");
  if (hdrLabel) hdrLabel.style.visibility = show ? "" : "hidden";
  const label = $("stage0-full-toggle-label");
  if (label) label.style.color = show ? "#00736b" : "#c0392b";

  // The label flips between two phrases, so update data-tr and re-translate
  // rather than writing textContent directly (which would clobber the
  // translated string and revert the label to English).
  const text = $("stage0-toggle-text");
  if (text) {
    const en = show ? "Hide sample" : "Show sample";
    text.setAttribute("data-tr", en);
    if (stage0IsEnglish()) text.textContent = en;
    else translateUI(en, text, false);
  }

  // NOTE: the checkbox is inverted — CHECKED means the sample is HIDDEN.
  $("toggle-stage0-full").checked = !show;
}

// Checkbox: tick to hide the sample answer. Default is unticked (sample shown).
// Works before and during recording.
$("toggle-stage0-full").onchange = () => {
  setStage0FullVisible(!$("toggle-stage0-full").checked);
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
  const STAGE0_TIME = 45;

  // Any interval left over from a previous binding (switching samples, or
  // pressing Record Again) must die, or its tick keeps running against the
  // new state and fires autoStop a second time.
  if (STAGE0_TIMER) { clearInterval(STAGE0_TIMER); STAGE0_TIMER = null; }
  STAGE0_STOPPING = false;

  const autoStop = async () => {
    // Reentrancy guard: the countdown tick and a manual click can both land
    // here. A second run would find the recorder already stopped, briefly
    // render "(transcription failed)", then be overwritten by the first run.
    if (STAGE0_STOPPING) return;
    STAGE0_STOPPING = true;

    if (STAGE0_TIMER) { clearInterval(STAGE0_TIMER); STAGE0_TIMER = null; }
    $("stage0-timer-box").classList.add("hidden");
    btn.classList.remove("recording");
    btn.classList.add("hidden");
    const blob = await stopRecording();
    STAGE0_BLOB = blob;
    $("stage0-post-record").classList.remove("hidden");
    // Immediate auto-grading: transcribe -> band -> gap analysis, no button press.
    await stage0ProcessRecording();
  };

  btn.onclick = async () => {
    if (btn.classList.contains("pulse")) {
      // ── Start recording ──────────────────────────
      const ok = await ensureMic();
      if (!ok) return;

      btn.classList.remove("pulse");
      btn.classList.add("recording");
      STAGE0_STOPPING = false;
      startRecording();

      // Pause question audio
      $("stage0-audio-player").pause();

      // Sample text stays in whatever state the student chose. If they want to
      // practise without it, they hide it BEFORE recording.

      // 45 s countdown
      let remaining = STAGE0_TIME;
      $("stage0-timer-digits").textContent = "00:45";
      $("stage0-timer-value").classList.remove("danger");
      $("stage0-timer-box").classList.remove("hidden");
      STAGE0_TIMER = setInterval(async () => {
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
  STAGE0_TRANSCRIPT = "";
  $("stage0-post-record").classList.add("hidden");
  $("stage0-results-area").classList.add("hidden");
  $("stage0-analysis-block").classList.add("hidden");
  $("stage0-gap-block").classList.add("hidden");

  // NOTE: the full-sentence toggle is deliberately NOT reset here. Whatever the
  // student chose persists across attempts until they change it themselves.

  // Reset record button and re-bind
  const btn = $("btn-stage0-record");
  btn.classList.remove("recording", "hidden");
  btn.classList.add("pulse");
  stage0BindRecordButton();
};

// ═══════════════════════════════════════════════════
// STAGE 0 — IMMEDIATE AUTO-GRADING
// Runs automatically when a recording stops. No button press.
//   1. transcribe   -> /.netlify/functions/transcribe
//   2. band + feedback -> /.netlify/functions/analyze
//   3. gap analysis (only when band < 5) -> /.netlify/functions/why-not-5-speaking
// Band, feedback and gap text are stored on the STATE.recordings entry so the
// End Session summary can replay them with no further API calls.
// ═══════════════════════════════════════════════════

function stage0GoldenSample() {
  const b = (STAGE0_CURRENT && STAGE0_CURRENT.blocks) || {};
  return [
    b.statement_reason && b.statement_reason.full,
    b.before_example   && b.before_example.full,
    b.after_example    && b.after_example.full
  ].filter(Boolean).join(" ");
}

async function stage0ProcessRecording() {
  if (!STAGE0_BLOB) return;

  // Revoke the previous URL so each take does not leak one.
  const s0Player = $("stage0-playback");
  if (s0Player.dataset.blobUrl) { try { URL.revokeObjectURL(s0Player.dataset.blobUrl); } catch (e) {} }
  const s0Url = URL.createObjectURL(STAGE0_BLOB);
  s0Player.dataset.blobUrl = s0Url;
  s0Player.src = s0Url;
  $("stage0-results-area").classList.remove("hidden");
  $("stage0-transcript-text").textContent = "Transcribing...";
  $("stage0-transcript-label").textContent = "Transcript";
  $("stage0-analysis-block").classList.add("hidden");
  $("stage0-gap-block").classList.add("hidden");

  // ── 1. Transcribe ────────────────────────────────
  try {
    const audio_base64 = await blobToBase64(STAGE0_BLOB);
    const res = await fetch("/.netlify/functions/transcribe", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ audio_base64, filename: "stage0.webm" })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "Transcription failed");
    STAGE0_TRANSCRIPT = normalizeTranscript(data.transcript || "");
  } catch (e) {
    console.error("Stage 0 transcription failed:", e.message);
    $("stage0-transcript-text").textContent = "(transcription failed)";
    return;
  }

  const words = countWords(STAGE0_TRANSCRIPT);
  $("stage0-transcript-text").textContent  = STAGE0_TRANSCRIPT || "(no speech detected)";
  $("stage0-transcript-label").textContent = "Transcript — " + words + " words";

  // Upsert into STATE.recordings (keyed on sample id — re-recording a sample
  // replaces the previous attempt).
  const sampleId = STAGE0_CURRENT ? (STAGE0_CURRENT.id || "s0") : "s0";
  const entry = {
    stage: 0,
    question_id: sampleId,
    q: STAGE0_CURRENT ? (STAGE0_CURRENT.question || "") : "",
    audio: "",
    blob: STAGE0_BLOB,
    filename: getRunLabel(sampleId, 0, "q1") + ".webm",
    set_label: "Stage 0",
    test_id: "stage0",
    question_index: 1,
    transcript: STAGE0_TRANSCRIPT,
    band: null,
    feedback: "",
    gap: "",
    grammar: "",
    sample: stage0GoldenSample()
  };
  const existing = STATE.recordings.findIndex(r => r.stage === 0 && r.question_id === sampleId);
  if (existing >= 0) STATE.recordings[existing] = entry;
  else               STATE.recordings.push(entry);

  if (!STAGE0_TRANSCRIPT.trim()) return;   // nothing to score

  // ── 2. Band + feedback ───────────────────────────
  const block = $("stage0-analysis-block");
  block.innerHTML = '<div class="analysis-feedback">Scoring…</div>';
  block.classList.remove("hidden");

  let band = null;
  try {
    const res = await fetch("/.netlify/functions/analyze", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        questions: [{ question: entry.q, transcript: STAGE0_TRANSCRIPT }],
        language: analysisLang(),
        // Stage 0 shows only the band here — the comparison below carries all the
        // written feedback, so full criterion output would just repeat it longer.
        mode: "band_only"
      })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "Analysis failed");

    const result = (data.parsed || {}).Q1;
    if (!result) {
      // Log what the model actually returned so a format drift is diagnosable.
      console.error("Stage 0: could not parse a band. Raw response:", data.raw);
      throw new Error("No result returned for this response");
    }

    band           = result.band;
    entry.band     = result.band;
    entry.feedback = result.feedback || "";

    block.innerHTML =
      (result.band !== null
        ? '<div class="analysis-band">Band ' + result.band + ' · ' + words + ' words</div>'
        : '<div class="analysis-error">Could not score this response.</div>');

    // Offer the grammar check now the score is in. Optional by design: grammar
    // is not part of the band, so a teacher decides who needs it.
    const s0Btn = $("btn-stage0-grammar");
    if (s0Btn) {
      s0Btn.classList.remove("hidden");
      s0Btn.disabled = false;
      s0Btn.onclick = () => runOptionalGrammar({
        button: "btn-stage0-grammar",
        block:  "stage0-grammar-block",
        getQuestion:   () => entry.q,
        getTranscript: () => STAGE0_TRANSCRIPT,
        store: (g) => { entry.grammar = g; }   // carried to results + export
      });
    }
  } catch (e) {
    console.error("Stage 0 analysis failed:", e.message);
    block.innerHTML = '<div class="analysis-error">Scoring failed. Please try again.</div>';
    return;
  }

  // ── 3. Gap analysis — only when the band is below 5 ──
  const sample = stage0GoldenSample();
  if (typeof band !== "number" || band >= 5 || !sample) return;

  const gapBlock = $("stage0-gap-block");
  gapBlock.innerHTML = '<div class="analysis-feedback" data-tr="Comparing with the sample above…">Comparing with the sample above…</div>';
  try { translateStaticEls("#stage0-gap-block"); } catch (e) {}
  gapBlock.classList.remove("hidden");

  try {
    const res = await fetch("/.netlify/functions/why-not-5-speaking", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        question: entry.q,
        answer:   STAGE0_TRANSCRIPT,
        sample:   sample,
        band:     band,
        language: analysisLang()
      })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "Gap analysis failed");

    entry.gap = data.explanation || "";
    gapBlock.innerHTML =
      '<div class="result-transcript-label" data-tr="Compared with the sample above">Compared with the sample above</div>' +
      '<div class="analysis-feedback" style="margin-top:6px;">' +
        (entry.gap)
          .split("\n")
          .filter(l => l.trim())
          .map(l => '<div class="analysis-feedback-line">' + escapeHTML(l) + '</div>')
          .join("") +
      '</div>';
    try { translateStaticEls("#stage0-gap-block"); } catch (e) {}
  } catch (e) {
    console.error("Stage 0 gap analysis failed:", e.message);
    gapBlock.innerHTML = '<div class="analysis-error" data-tr="Could not compare with the sample above.">Could not compare with the sample above.</div>';
    try { translateStaticEls("#stage0-gap-block"); } catch (e) {}
  }
}

$("btn-end-stage0").onclick = () => {
  if (STATE.recordings.some(r => r.stage === 0)) {
    // Stage 0 is already graded per-recording, so the summary is deterministic:
    // no transcription pass, no analysis call. Just replay what we stored.
    endStage0Session();
  } else {
    // Nothing saved — just return to start
    stopAllAudio();
    releaseMic();
    showScreen("screen-start");
  }
};

// ═══════════════════════════════════════════════════
// STAGE 0 — DETERMINISTIC SESSION SUMMARY (no AI calls)
// ═══════════════════════════════════════════════════

// ═══════════════════════════════════════════════════
// STAGE 0 — GOOGLE DOC REPORT
// Mirrors the on-screen summary exactly: band, feedback, gap analysis and the
// 5-point benchmark. Reads only what auto-grading already stored on each
// recording, so there are no API calls beyond the upload itself.
// ═══════════════════════════════════════════════════

async function exportStage0Doc(recs, suffix) {
  // Nothing recorded means nothing to report. Uploading an empty document — and
  // saying it saved — is worse than saying nothing happened.
  if (!recs || !recs.length) return;
  if (!recs.some(r => (r.transcript && r.transcript.trim()) || r.blob)) return;
  const studentKey = (sessionStorage.getItem("access_key") || "").slice(0, 3).toLowerCase();

  const banded = recs.filter(r => typeof r.band === "number");
  const avg = banded.length
    ? (banded.reduce((sum, r) => sum + r.band, 0) / banded.length).toFixed(1)
    : "N/A";

  const nl2br = (t) => (t || "").split("\n").filter(l => l.trim()).map(escapeHTML).join("<br>");

  const rowsHtml = recs.map((r) => {
    const words    = countWords(r.transcript || "");
    const yourUrl  = r.driveLink || "";
    const yourLink = yourUrl
      ? `<a href="${escapeHTML(yourUrl)}">▶ Play your recording</a>`
      : `<span style="color:#999">Your recording unavailable</span>`;

    const header = `<h2 style="color:#00736b;font-size:16px">Stage 0 — ${escapeHTML(r.question_id || "")}</h2>`;
    const question = r.q ? `<p><strong>Question:</strong> ${escapeHTML(r.q)}</p>` : "";
    const links = `<p>${yourLink}</p>`;

    const bandLine = (typeof r.band === "number")
      ? `<p><strong>Band ${r.band} &middot; ${words} words</strong></p>`
      : `<p><strong>(not scored)</strong></p>`;

    const gap = nl2br(r.gap);
    // Google Docs discards most CSS on import but keeps table borders and cell
    // shading, so a one-cell table is the only reliable way to box content.
    const boxed = (title, inner, bg) =>
      `<table style="width:100%;border-collapse:collapse;margin:8px 0;">` +
        `<tr><td style="border:1px solid #dddddd;background-color:${bg};padding:8px 10px;">` +
          `<strong>${title}</strong><br>${inner}` +
        `</td></tr>` +
      `</table>`;

    // Band 5: no gap, no benchmark — matches the on-screen summary.
    const showSample = !!(r.sample && r.band !== 5);

    const answerInner =
      `<strong>Your answer — ${words} words</strong><br>` +
      escapeHTML(r.transcript || "(no speech detected)");

    const sampleInner = showSample
      ? `<strong>5-point sample answer benchmark — ${countWords(r.sample)} words</strong><br>` +
        `<span style="color:#444444">${escapeHTML(r.sample)}</span>`
      : "";

    // Side by side when there is something to compare against, mirroring the
    // results page; otherwise one full-width cell.
    const cell = (inner, bg, width) =>
      `<td style="width:${width};border:1px solid #dddddd;background-color:${bg};` +
      `padding:8px 10px;vertical-align:top;">${inner}</td>`;

    const transcript =
      `<table style="width:100%;border-collapse:collapse;margin:8px 0;table-layout:fixed;"><tr>` +
        cell(answerInner, "#ffffff", showSample ? "50%" : "100%") +
        (showSample ? cell(sampleInner, "#fafafa", "50%") : "") +
      `</tr></table>`;

    const gapBlock = gap
      ? boxed("Compared with the 5-point sample", gap, "#f7f3fa")
      : "";

    // Optional grammar check, if the student ran one during practice.
    const grammarBox = (r.grammar && r.grammar.trim())
      ? boxed("Grammar Check", nl2br(r.grammar), "#fffdf5")
      : "";


    // Order mirrors the results page: question -> audio -> comparison table
    // -> band -> gap analysis.
    return header + question + links + transcript + bandLine + gapBlock + grammarBox + "<hr>";
  }).join("");

  const isRedo = !!suffix;
  const summary = isRedo
    ? ""
    : `<p style="font-size:20px;font-weight:700;color:#00736b">` +
      `Average Score: ${avg} / 5 (${banded.length} of ${recs.length} scored)</p>`;

  // Session-wide error tally, if a grammar check was run. Plain text rather than
  // pills — Google Docs drops most inline styling on import.
  let pillsHtml = "";
  try {
    const pooled = STATE._sessionGrammarPills || {};
    const labels = Object.keys(pooled).sort((a, b) => pooled[b] - pooled[a]);
    if (!isRedo && labels.length) {
      pillsHtml =
        `<p><strong>Most common grammar mistakes:</strong><br>` +
        labels.slice(0, 8).map(l =>
          `${escapeHTML(l)}${pooled[l] > 1 ? " &times;" + pooled[l] : ""}`).join(" &nbsp;&middot;&nbsp; ") +
        `</p>`;
    }
  } catch (e) {}

  const html = `<!DOCTYPE html><html><head><meta charset="utf-8"></head>
    <body style="font-family:Arial,sans-serif">
      <h1>${isRedo ? "Stage 0 — Redo" : "Stage 0 — Practice Summary"}</h1>
      <p>Generated ${escapeHTML(new Date().toLocaleString())}</p>
      ${summary}${pillsHtml}${rowsHtml}
    </body></html>`;

  const docName = `${sessionBaseName()}_stage0_report`;
  try {
    // One document per session. The first call creates it and keeps the id; a
    // redo re-renders the whole report and PATCHes the same file, so closing the
    // tab is safe at any point and Drive does not fill with near-identical copies.
    const up = await uploadToDrive(
      docName, html, "text/html", studentKey,
      false,
      "application/vnd.google-apps.document",
      "04_speaking_interview",
      STATE._sessionFileId || null
    );
    if (up && up.fileId) STATE._sessionFileId = up.fileId;
  } catch (e) {
    console.warn("Stage 0 report upload failed:", e.message);
  }
}


// Build one Stage 0 result card. Used for the original attempt and for every
// redo, so a redo looks identical to a first attempt. `attempt` is 0 for the
// original, 1+ for redos.
function stage0ResultCard(r, attempt) {
  const card = document.createElement("div");
  card.className = "result-item";

  const headBits = ["Stage 0"];
  if (r.question_id) headBits.push(escapeHTML(r.question_id));
  // How many takes this question has had. The earlier ones are replaced, not
  // kept — a false start is not worth preserving — but the count still tells the
  // student they have been round more than once.
  if (r._attempts > 1) headBits.push("Attempt " + r._attempts);
  else if (attempt)    headBits.push("Redo " + attempt);

  const lines = (t) => (t || "")
    .split("\n").filter(l => l.trim())
    .map(l => '<div class="analysis-feedback-line">' + escapeHTML(l) + '</div>')
    .join("");

  const gapHtml = lines(r.gap);

  // Band 5 needs no comparison: there is no gap analysis, and showing the
  // benchmark beside a top-band answer adds nothing. Those rows collapse to a
  // single full-width column. Gate on the band itself rather than on whether
  // a sample happens to be stored, so entries graded before this rule still
  // render correctly.
  const isTopBand     = (r.band === 5);
  const hasComparison = !isTopBand && !!(gapHtml || r.sample);

  const bandHtml = (typeof r.band === "number")
    ? '<div class="analysis-band">Band ' + r.band + ' · ' +
      countWords(r.transcript || "") + ' words</div>'
    : '<div class="analysis-feedback-line" data-tr="Not scored — try recording this one again.">' +
      'Not scored — try recording this one again.</div>';

  const answerCell =
    '<div class="result-transcript-label">' +
      '<span data-tr="Your answer">Your answer</span> — ' +
      countWords(r.transcript || "") + ' words</div>' +
    '<div class="result-transcript-text">' +
      escapeHTML(r.transcript || "(no speech detected)") + '</div>';

  const sampleCell = r.sample
    ? '<div class="result-transcript-label">' +
        (r.stage === 4
          ? '<span data-tr="Band 5 sample answer (a different question)">Band 5 sample answer (a different question)</span> — '
          : '<span data-tr="5-point sample answer benchmark">5-point sample answer benchmark</span> — ') +
        countWords(r.sample) + ' words</div>' +
      (r.sample_q
        ? '<div class="practice-sample-q">' +
            '<span data-tr="It answers:">It answers:</span> ' + escapeHTML(r.sample_q) + '</div>'
        : "") +
      '<div class="result-transcript-text" style="color:#444;">' +
        escapeHTML(r.sample) + '</div>'
    : "";

  const compareCell = gapHtml
    ? (r.stage === 4
        ? '<div class="result-transcript-label" style="margin-top:10px;" data-tr="Compared with a Band 5 answer">Compared with a Band 5 answer</div>'
        : '<div class="result-transcript-label" style="margin-top:10px;" data-tr="Compared with the 5-point sample">Compared with the 5-point sample</div>') +
      '<div class="analysis-feedback" style="margin-top:6px;">' + gapHtml + '</div>'
    : "";

  // Optional grammar check, if the student ran one.
  const grammarBlock = (r.grammar && r.grammar.trim())
    ? '<div class="result-analysis-block" style="margin-top:10px;border-top:1px solid #eee;padding-top:10px;">' +
        '<div class="result-transcript-label" data-tr="Grammar Check">Grammar Check</div>' +
        '<div class="analysis-feedback" style="margin-top:6px;">' +
          escWithLabels(highlightGrammarChanges(r.grammar)).replace(/\n/g, "<br>") +
        '</div>' +
      '</div>'
    : "";

  const grid = hasComparison
    ? '<table class="stage0-compare"><tbody><tr>' +
        '<td class="cmp-left">'  + answerCell + '</td>' +
        '<td class="cmp-right">' + sampleCell + '</td>' +
      '</tr></tbody></table>' +
      '<div class="result-analysis-block">' + bandHtml + compareCell + '</div>'
    : '<div class="result-transcript-block">' + answerCell + '</div>' +
      '<div class="result-analysis-block">'   + bandHtml + '</div>';

  card.innerHTML =
    '<div class="result-num">' + headBits.join(" — ") + '</div>' +
    '<p class="result-q">' + escapeHTML(r.q || "") + '</p>' +
    '<div class="result-audio-block">' +
      '<div class="result-audio-label" data-tr="Your Recording">Your Recording</div>' +
      '<audio controls src="' + URL.createObjectURL(r.blob) + '"></audio>' +
    '</div>' +
    grid + grammarBlock;


  // Below Band 5 the student can record this question again, as often as they
  // like. A redo replaces this card rather than adding another.
  // An unscored answer gets one too: without it the card would offer nothing at
  // all, which reads as a broken page rather than a failed grade.
  if (r.band !== 5) {
    const redo = document.createElement("div");
    redo.className = "stage0-redo";
    redo.innerHTML =
      '<div class="stage0-redo-title" data-tr="Try this question again">Try this question again</div>' +
      '<div class="stage0-redo-desc" data-tr="Re-record your answer and compare it with the 5-point sample again. You have 45 seconds.">' +
        'Re-record your answer and compare it with the 5-point sample again. You have 45 seconds.</div>' +
      '<button type="button" class="btn-record pulse stage0-redo-btn"><div class="record-dot"></div></button>' +
      '<div class="stage0-redo-timer hidden"><span class="stage0-redo-digits">00:45</span></div>' +
      '<div class="stage0-redo-status"></div>';
    card.appendChild(redo);
    redo.querySelector(".stage0-redo-btn").onclick = () => stage0RunRedo(r, attempt, card);
  }

  return card;
}

// ═══════════════════════════════════════════════════
// STAGE 0 — REDO FROM THE RESULTS PAGE
// Below Band 5 a student can re-record the same question as many times as they
// like. Each redo runs the same chain as a first attempt (transcribe -> band ->
// gap analysis), appends its own card, and uploads its own report.
// ═══════════════════════════════════════════════════

async function stage0RunRedo(orig, attempt, card) {
  const redoBox = card.querySelector(".stage0-redo");
  const btn     = redoBox.querySelector(".stage0-redo-btn");
  const timer   = redoBox.querySelector(".stage0-redo-timer");
  const digits  = redoBox.querySelector(".stage0-redo-digits");
  const status  = redoBox.querySelector(".stage0-redo-status");

  // Already recording -> stop early.
  if (btn.classList.contains("recording")) { redoBox._stop && redoBox._stop(); return; }

  // A save from the previous attempt may still be running.
  if (btn.disabled) return;

  // Silence any card that is playing, so it does not bleed into the recording.
  stopAllAudio();

  // The mic is released when the session ends, so re-acquire it here. This can
  // re-prompt for permission if the browser has since forgotten it.
  status.textContent = "";
  const ok = await ensureMic();
  if (!ok) { status.textContent = "Microphone unavailable. Please allow access and try again."; return; }

  btn.classList.remove("pulse");
  btn.classList.add("recording");
  timer.classList.remove("hidden");
  startRecording();

  let remaining = 45;
  digits.textContent = "00:45";
  let stopped = false;

  const finish = async () => {
    if (stopped) return;              // guard: timer and click can both fire
    stopped = true;
    clearInterval(iv);
    timer.classList.add("hidden");
    btn.classList.remove("recording");
    btn.classList.add("hidden");

    const blob = await stopRecording();
    status.textContent = "Transcribing…";

    // ── Transcribe ──
    let transcript = "";
    try {
      const audio_base64 = await blobToBase64(blob);
      const res = await fetch("/.netlify/functions/transcribe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ audio_base64, filename: "stage0_redo.webm" })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Transcription failed");
      transcript = normalizeTranscript(data.transcript || "");
    } catch (e) {
      console.error("Stage 0 redo transcription failed:", e.message);
      status.textContent = "Transcription failed. Please try again.";
      btn.classList.remove("hidden");
      btn.classList.add("pulse");
      return;
    }

    const redo = {
      stage: orig.stage,
      question_id: orig.question_id,
      q: orig.q,
      blob: blob,
      filename: getRunLabel(orig.question_id || "s0", 0, "redo" + (attempt + 1)) + ".webm",
      set_label: "Stage 0", test_id: "stage0", question_index: 1,
      transcript: transcript,
      band: null, feedback: "", gap: "",
      sample: orig.sample,
      sample_q: orig.sample_q,
      _redoOf: orig.question_id,
      _attempt: attempt + 1
    };

    // ── Band ──
    if (transcript.trim()) {
      status.textContent = "Scoring…";
      try {
        const res = await fetch("/.netlify/functions/analyze", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            questions: [{ question: redo.q, transcript: transcript }],
            language: analysisLang(),
            mode: "band_only"
          })
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || "Analysis failed");
        const result = (data.parsed || {}).Q1;
        if (!result) {
          console.error("Stage 0 redo: could not parse a band. Raw:", data.raw);
        } else {
          redo.band = result.band;
        }
      } catch (e) {
        console.error("Stage 0 redo analysis failed:", e.message);
      }

      // ── Gap analysis (below Band 5 only) ──
      if (typeof redo.band === "number" && redo.band < 5 && redo.sample) {
        status.textContent = "Comparing with the 5-point sample…";
        try {
          const res = await fetch("/.netlify/functions/why-not-5-speaking", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              question: redo.q, answer: transcript, sample: redo.sample,
              band: redo.band, language: analysisLang(),
              // Stage 4's sample answers a different question; Stage 0's does not.
              same_topic: (orig.stage !== 4),
              sample_question: orig.sample_q || ""
            })
          });
          const data = await res.json();
          if (res.ok) redo.gap = data.explanation || "";
        } catch (e) {
          console.error("Stage 0 redo gap analysis failed:", e.message);
        }
      }
    }

    // Replace the attempt rather than stacking a new card. A redo is usually a
    // second try at the same answer — often after a false start or a fragment —
    // so keeping every take would fill the page with attempts nobody wants.
    // Match on stage + question rather than object identity: a second redo is
    // handed the ORIGINAL entry, which the first redo already replaced, so
    // indexOf would miss and the list would grow.
    redo._attempts = (orig._attempts || 1) + 1;
    const slotIdx = STATE.recordings.findIndex(
      x => x.stage === redo.stage && x.question_id === redo.question_id);
    if (slotIdx >= 0) STATE.recordings[slotIdx] = redo;
    else              STATE.recordings.push(redo);

    // Save straight away, updating the same session report. Waiting until the
    // student leaves loses the work when they close the tab instead — and they
    // usually do, since there is no logout.

    const next = stage0ResultCard(redo, 0);
    next.id = card.id;
    card.replaceWith(next);
    try { translateStaticEls("#results-list"); } catch (e) {}

    // The session grammar tally no longer covers every answer: this redo was not
    // in it. Re-offer the check rather than leaving a stale summary on screen.
    const sgBtn = $("btn-session-grammar"), sgBox = $("session-grammar-summary");
    if (sgBtn && sgBox && !sgBox.classList.contains("hidden")) {
      sgBtn.classList.remove("hidden");
      sgBtn.disabled = false;
      sgBox.classList.add("hidden");
      sgBox.innerHTML = "";
      STATE._sessionGrammarPills = null;
    }

    // Upload the take, then rewrite the session report to include it.
    // The old card has been replaced, so its status element is detached — write
    // to the NEW card, and lock its redo button until the save finishes or the
    // student can start another recording mid-upload.
    const liveStatus = next.querySelector(".stage0-redo-status");
    const liveBtn    = next.querySelector(".stage0-redo-btn");
    if (liveBtn) { liveBtn.disabled = true; liveBtn.classList.remove("pulse"); }
    if (liveStatus) liveStatus.textContent = "Saving…";

    try {
      const keyPrefix = (sessionStorage.getItem("access_key") || "").slice(0, 3).toLowerCase();
      const b64 = await blobToBase64(blob);
      const up  = await uploadToDrive(redo.filename, b64, "audio/webm", keyPrefix, true,
                                      undefined, "04_speaking_interview/audio_interview");
      if (up && up.link) redo.driveLink = up.link;

      const stageRecs = STATE.recordings.filter(x => x.stage === redo.stage);
      await exportStage0Doc(stageRecs);
      if (liveStatus) liveStatus.textContent = "✓ Saved.";
    } catch (e) {
      console.warn("Redo save failed:", e.message);
      if (liveStatus) liveStatus.textContent = "Could not save — please try again.";
    } finally {
      if (liveBtn) { liveBtn.disabled = false; liveBtn.classList.add("pulse"); }
    }
  };

  redoBox._stop = finish;
  btn.onclick = finish;

  const iv = setInterval(() => {
    remaining--;
    const m = Math.floor(remaining / 60).toString().padStart(2, "0");
    const sec = (remaining % 60).toString().padStart(2, "0");
    digits.textContent = m + ":" + sec;
    if (remaining <= 0) finish();
  }, 1000);
}

async function endStage0Session() {
  stopAllAudio();
  releaseMic();
  clearInterval(STATE.timerInterval);
  $("saving-modal").classList.add("hidden");
  showScreen("screen-end");

  // A redo replaces the entry for its question, so every recording here is a
  // current answer — one per question.
  const recs   = STATE.recordings.filter(r => r.stage === 0);
  const banded = recs.filter(r => typeof r.band === "number");
  const avg    = banded.length
    ? (banded.reduce((sum, r) => sum + r.band, 0) / banded.length).toFixed(1)
    : "—";

  // Different header from the AI analysis flow.
  const heading = document.querySelector("#screen-end .results-top-bar h2");
  if (heading) heading.textContent = "Stage 0 — Practice Summary";

  // autoDownload + the report writes progress into this element, so keep it
  // visible for the save phase rather than hiding it outright.
  const statusEl = $("transcription-status");
  statusEl.classList.remove("hidden");
  statusEl.textContent = "Saving to your records…";
  $("end-summary").textContent =
    recs.length + " question" + (recs.length !== 1 ? "s" : "") + " attempted" +
    " · Average band: " + avg +
    (banded.length && banded.length < recs.length
      ? " (" + banded.length + " of " + recs.length + " scored)"
      : "");

  const list = $("results-list");
  list.innerHTML = "";

  recs.forEach((r) => {
    list.appendChild(stage0ResultCard(r, 0));
  });

  // The cards carry [data-tr] strings (the redo box), so translate them once
  // they are in the DOM. Redo cards do the same when they are appended.
  try { translateStaticEls("#results-list"); } catch (e) {}

  // Same download + Drive upload the other stages get, using the transcripts
  // we already have. One upload pass at End Session, not per recording.
  // autoDownload populates r.driveLink, so the report must wait for it.
  const transcripts = {};
  recs.forEach((r, i) => { transcripts[i] = r.transcript || ""; });
  await autoDownload(transcripts);
  await exportStage0Doc(recs);
  statusEl.textContent = "✓ Saved to your records.";
}

// ═══════════════════════════════════════════════════
// INIT
// ═══════════════════════════════════════════════════
initGate();

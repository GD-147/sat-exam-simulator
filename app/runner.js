// app/runner.js

function decodeHtmlEntitiesDeep(text = "") {
  let s = String(text);

  for (let i = 0; i < 3; i++) {
    const ta = document.createElement("textarea");
    ta.innerHTML = s;
    const decoded = ta.value;
    if (decoded === s) break;
    s = decoded;
  }

  return s;
}

function renderInlineMarkup(text = "") {
  let s = decodeHtmlEntitiesDeep(text);

  // lascia passare solo tag semplici e sicuri
  s = s.replace(/<(?!\/?(u|i|br)\b)[^>]*>/gi, "");

  return s;
}

function normalizeQuestion(q) {
  const choices = {};
  for (const [k, v] of Object.entries(q.choices || {})) {
    choices[k] = decodeHtmlEntitiesDeep(v);
  }

  return {
    ...q,
    prompt: decodeHtmlEntitiesDeep(q.prompt || ""),
    explanation: decodeHtmlEntitiesDeep(q.explanation || ""),
    choices
  };
}

async function loadQuestionsForSection(examId, section) {
  const files = (section.examFiles && section.examFiles.length)
    ? section.examFiles
    : [`${section.id}.json`];

  const all = [];
  for (const f of files) {
    const path = `../packs/${examId}/data/${f}`;
    const res = await fetch(path, { cache: "no-store" });
    if (!res.ok) throw new Error(`Missing question file: ${path}`);

    const raw = await res.json();
    const arr = Array.isArray(raw) ? raw.map(normalizeQuestion) : [];

    all.push({ file: f, questions: arr });
  }
  return all; // [{file, questions}, ...]
}

function fmtTime(seconds) {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}
function decodeHtmlEntitiesDeep(text = "") {
  let s = String(text);

  for (let i = 0; i < 3; i++) {
    const ta = document.createElement("textarea");
    ta.innerHTML = s;
    const decoded = ta.value;

    if (decoded === s) break;
    s = decoded;
  }

  return s;
}

function renderInlineMarkup(text = "") {
  let s = decodeHtmlEntitiesDeep(text);

  // lascia passare solo tag semplici e sicuri
  s = s.replace(/<(?!\/?(u|i|br)\b)[^>]*>/gi, "");

  return s;
}
function practiceCursorKey(examId, sectionId) {
  return `practiceCursor_${examId}_${sectionId}`;
}

function getPracticeSlice(allQs, chunkSize, examId, sectionId) {
  const key = practiceCursorKey(examId, sectionId);
  let cursor = parseInt(localStorage.getItem(key) || "0", 10);

  if (cursor >= allQs.length) cursor = 0;

  const start = cursor;
  const end = Math.min(cursor + chunkSize, allQs.length);

  const slice = allQs.slice(start, end);

  cursor = end;
  if (cursor >= allQs.length) cursor = 0;
  localStorage.setItem(key, String(cursor));

  return { slice, start, end, total: allQs.length };
}



function qs(id) { return document.getElementById(id); }

(async function () {
  const examId = getExamFromUrl();
  if (!isAccessGranted(examId)) { goToWelcome(examId); return; }

  const cfg = await loadConfig(examId);
  applyTheme(cfg.theme || "dark");
  qs("brand").textContent = cfg.brandName;
  qs("logo").src = cfg.logoPath;

  const params = new URLSearchParams(window.location.search);
  const sectionId = params.get("section");
  const mode = params.get("mode"); // "exam" | "practice"

  const section = cfg.sections.find(s => s.id === sectionId);
  if (!section) {
    qs("title").textContent = "Error";
    qs("desc").textContent = "Unknown section.";
    return;
  }

  // Essay placeholder (gestiamo Writing nello step successivo)
  // ===== ESSAY MODE =====
if (section.type === "essay") {
  const examSets = await loadQuestionsForSection(examId, section);
  const pooledPrompts = examSets.flatMap(s => s.questions); // here "questions" are prompts

  // pick prompt (rotate like exams; practice also cycles)
  let promptObj = null;
  let metaText = "";

  if (mode === "practice") {
    const key = `essayCursor_${examId}_${sectionId}`;
    let cur = parseInt(localStorage.getItem(key) || "0", 10);
    if (cur >= pooledPrompts.length) cur = 0;
    promptObj = pooledPrompts[cur];
    localStorage.setItem(key, String((cur + 1) % pooledPrompts.length));
    metaText = `Prompt: ${promptObj.id} (practice)`;
  } else {
    const rotKey = `essayRotation_${examId}_${sectionId}`;
    let rot = parseInt(localStorage.getItem(rotKey) || "0", 10);
    if (rot >= pooledPrompts.length) rot = 0;
    promptObj = pooledPrompts[rot];
    localStorage.setItem(rotKey, String((rot + 1) % pooledPrompts.length));
    metaText = `Prompt: ${promptObj.id} (timed)`;
  }

  // show essay panel
  qs("runnerPanel").classList.add("hidden");
  qs("resultsPanel").classList.add("hidden");
  qs("essayPanel").classList.remove("hidden");
  qs("essayResultsPanel").classList.add("hidden");

  qs("essayTitle").textContent = `${section.label} — ${mode === "practice" ? "Practice Mode" : "Exam Mode"}`;
  qs("essayDesc").textContent = mode === "practice"
    ? "Untimed writing practice. Use this to rehearse structure and evidence."
    : `Timed writing: ${section.timeMin} minutes.`;
  qs("essayMeta").textContent = metaText;

  qs("essayPrompt").innerHTML = renderInlineMarkup(promptObj.prompt);

  // timer for exam mode
  let timerInterval = null;
  let remaining = section.timeMin * 60;
  const startTime = Date.now();

  if (mode !== "practice") {
    qs("timer").classList.remove("hidden");
    qs("timer").textContent = fmtTime(remaining);
    timerInterval = setInterval(() => {
      remaining--;
      qs("timer").textContent = fmtTime(Math.max(0, remaining));
      if (remaining <= 0) finishEssay();
    }, 1000);
  } else {
    qs("timer").classList.add("hidden");
  }

  // autosave key per prompt
  const draftKey = `draft_${examId}_${sectionId}_${promptObj.id}`;
  const box = qs("essayText");

  // load draft if exists
  box.value = localStorage.getItem(draftKey) || "";

  function updateWordCount() {
    const words = box.value.trim() ? box.value.trim().split(/\s+/).length : 0;
    qs("wordCount").textContent = String(words);
  }
  updateWordCount();

  box.addEventListener("input", () => {
    updateWordCount();
    localStorage.setItem(draftKey, box.value);
  });

  qs("essaySaveBtn").addEventListener("click", () => {
    localStorage.setItem(draftKey, box.value);
  });

  function finishEssay() {
    if (timerInterval) clearInterval(timerInterval);

    const elapsedSec = Math.floor((Date.now() - startTime) / 1000);
    const words = box.value.trim() ? box.value.trim().split(/\s+/).length : 0;

    qs("essayPanel").classList.add("hidden");
    qs("essayResultsPanel").classList.remove("hidden");

    qs("essayTimeLine").textContent = `Time used: ${fmtTime(elapsedSec)}`;
    qs("essayWordLine").textContent = `Word count: ${words}`;

    qs("essayHomeBtn").onclick = () => {
      window.location.href = `app.html?exam=${encodeURIComponent(examId)}`;
    };
  }

  qs("essayFinishBtn").addEventListener("click", finishEssay);
  qs("backLink").addEventListener("click", (e) => {
    e.preventDefault();
    window.location.href = `app.html?exam=${encodeURIComponent(examId)}`;
  });

  return;
  }

  // Carica domande MCQ (supporta più examFiles)
  const examSets = await loadQuestionsForSection(examId, section);

  // Pool globale per Practice Mode (tutte le domande di tutti gli exam)
  const pooledQs = examSets.flatMap(s => s.questions);

  // Scegli set domande per la sessione
let sessionQs;
let metaText = "";

if (mode === "practice") {
  const info = getPracticeSlice(pooledQs, cfg.practiceChunkSize || 10, examId, sectionId);
  sessionQs = info.slice;
  metaText = `Practice block: ${info.start + 1}–${info.end} of ${info.total}`;
} else {
  const rotKey = `examRotation_${examId}_${sectionId}`;
  let rot = parseInt(localStorage.getItem(rotKey) || "0", 10);
  if (rot >= examSets.length) rot = 0;

  const chosen = examSets[rot];
  localStorage.setItem(rotKey, String((rot + 1) % examSets.length));

  const n = Math.min(section.examQuestions, chosen.questions.length);
  sessionQs = chosen.questions.slice(0, n);

  metaText = `Loaded set: ${chosen.file}`;
}

// stampa subito la riga meta
const metaEl = qs("metaLine");
if (metaEl) metaEl.textContent = metaText;


  // UI state
  let idx = 0;
  const answers = {}; // q.id -> "A"/"B"/"C"/"D"
  const startTime = Date.now();

  // Timer (solo Exam Mode)
  let timerInterval = null;
  let remaining = section.timeMin * 60;

  function render() {
    const q = sessionQs[idx];
    qs("title").textContent = `${section.label} — ${mode === "practice" ? "Practice Mode" : "Exam Mode"}`;
    qs("desc").textContent = mode === "practice"
      ? `10-question set (progress cycles automatically).`
      : `Timed full section: ${sessionQs.length} questions in ${section.timeMin} minutes.`;

      qs("metaLine").textContent = metaText;

    qs("progress").textContent = `Question ${idx + 1} of ${sessionQs.length}`;
    qs("prompt").innerHTML = renderInlineMarkup(q.prompt);

    const box = qs("choices");
    box.innerHTML = "";
    ["A","B","C","D"].forEach(letter => {
      const row = document.createElement("label");
      row.className = "choice";

      const input = document.createElement("input");
      input.type = "radio";
      input.name = "choice";
      input.value = letter;
      input.checked = answers[q.id] === letter;

      input.addEventListener("change", () => {
        answers[q.id] = letter;
      });

      const span = document.createElement("span");
      span.className = "choiceText";
      span.innerHTML = `${letter}. ${renderInlineMarkup(q.choices[letter])}`;
      row.appendChild(input);
      row.appendChild(span);
      box.appendChild(row);
    });

    qs("prevBtn").disabled = idx === 0;
    qs("nextBtn").disabled = idx === sessionQs.length - 1;
  }

  function finish() {
    if (timerInterval) clearInterval(timerInterval);

    const elapsedSec = Math.floor((Date.now() - startTime) / 1000);

    let correct = 0;
    sessionQs.forEach(q => {
      if ((answers[q.id] || "") === q.correct) correct++;
    });

    const pct = Math.round((correct / sessionQs.length) * 100);

    qs("runnerPanel").classList.add("hidden");
    qs("resultsPanel").classList.remove("hidden");

    qs("scoreLine").textContent = `Score: ${pct}% (${correct}/${sessionQs.length} correct)`;
    qs("timeLine").textContent = `Time used: ${fmtTime(elapsedSec)}`;

    const review = qs("review");
    review.innerHTML = "";

    sessionQs.forEach((q, i) => {
      const user = answers[q.id] || "(no answer)";
      const ok = user === q.correct;

      const block = document.createElement("div");
      block.className = "reviewBlock";

      const num = document.createElement("div");
      num.className = ok ? "qnum qnum-ok" : "qnum qnum-bad";
      num.textContent = `Q${i + 1}`;

      const text = document.createElement("div");
      text.className = "reviewText";

      const p = document.createElement("div");
      p.className = "reviewPrompt";
      p.innerHTML = renderInlineMarkup(q.prompt);

      const a = document.createElement("div");
      a.className = "reviewAns";
      a.textContent = `Your answer: ${user}    |    Correct: ${q.correct}`;

      const ex = document.createElement("div");
      ex.className = "reviewExp";
      ex.textContent = q.explanation;

      text.appendChild(p);
      text.appendChild(a);
      text.appendChild(ex);

      block.appendChild(num);
      block.appendChild(text);
      review.appendChild(block);
    });
  }

  if (mode !== "practice") {
    qs("timer").classList.remove("hidden");
    qs("timer").textContent = fmtTime(remaining);

    timerInterval = setInterval(() => {
      remaining--;
      qs("timer").textContent = fmtTime(Math.max(0, remaining));
      if (remaining <= 0) finish();
    }, 1000);
  }

  qs("prevBtn").addEventListener("click", () => { if (idx > 0) { idx--; render(); } });
  qs("nextBtn").addEventListener("click", () => { if (idx < sessionQs.length - 1) { idx++; render(); } });
  qs("finishBtn").addEventListener("click", finish);

  qs("backLink").addEventListener("click", (e) => {
    e.preventDefault();
    window.location.href = `app.html?exam=${encodeURIComponent(examId)}`;
  });

  qs("homeBtn").addEventListener("click", () => {
    window.location.href = `app.html?exam=${encodeURIComponent(examId)}`;
  });

  render();
})();

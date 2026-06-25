import { useState, useEffect, useRef, useCallback } from "react";

// ─── SUPABASE CONFIG ──────────────────────────────────────────────────────────
const SUPA_URL = "https://zrggkyddmufsauqelwpc.supabase.co";
const SUPA_KEY = "sb_publishable_fgV7DGUsPdrqYZtOzzblKg_J8pmr6oe";

async function supa(path, options = {}) {
  const res = await fetch(`${SUPA_URL}/rest/v1/${path}`, {
    headers: {
      "apikey": SUPA_KEY,
      "Authorization": `Bearer ${SUPA_KEY}`,
      "Content-Type": "application/json",
      "Prefer": options.prefer || "return=representation",
      ...options.headers,
    },
    ...options,
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(err);
  }
  const text = await res.text();
  return text ? JSON.parse(text) : null;
}

const db = {
  async getStudents() {
    return await supa("students?select=*&order=id");
  },
  async getExams(studentId) {
    return await supa(`exams?student_id=eq.${studentId}&select=*&order=date`);
  },
  async getWords(examId) {
    return await supa(`exam_words?exam_id=eq.${examId}&select=*`);
  },
  async getAllData() {
    const students = await supa("students?select=*&order=id");
    const exams = await supa("exams?select=*&order=date");
    const words = await supa("exam_words?select=*");
    return { students, exams, words };
  },
  async addStudent(student) {
    return await supa("students", { method: "POST", body: JSON.stringify(student) });
  },
  async addExam(exam) {
    return await supa("exams", { method: "POST", body: JSON.stringify(exam) });
  },
  async addWords(wordRows) {
    return await supa("exam_words", { method: "POST", body: JSON.stringify(wordRows) });
  },
};

// ─── COLORS ───────────────────────────────────────────────────────────────────
const C = {
  bg: "#0d0f18",
  surface: "#13161f",
  card: "#1c2030",
  cardHover: "#222640",
  border: "#2a2f4a",
  accent: "#7c9dff",
  accentDim: "#2d3d7a",
  accentGlow: "#7c9dff22",
  green: "#4ade80",
  greenDim: "#14532d55",
  red: "#f87171",
  redDim: "#7f1d1d44",
  amber: "#fbbf24",
  purple: "#c084fc",
  purpleDim: "#581c8755",
  text: "#e8eaf6",
  muted: "#7a85a8",
  dim: "#3d4468",
};

const TREND_CONFIG = {
  mastered:    { color: C.green,  label: "Maîtrisé",   icon: "✦", bg: C.greenDim },
  progression: { color: C.accent, label: "Progression", icon: "↑", bg: C.accentGlow },
  regression:  { color: C.red,    label: "Régression",  icon: "↓", bg: C.redDim },
  struggling:  { color: C.amber,  label: "Difficile",   icon: "!", bg: "#78350f44" },
  neutral:     { color: C.muted,  label: "Variable",    icon: "~", bg: "#1e2240" },
};

// ─── HELPERS ──────────────────────────────────────────────────────────────────
function buildStudentMap(raw) {
  const { students, exams, words } = raw;
  const wordsByExam = {};
  words.forEach(w => {
    if (!wordsByExam[w.exam_id]) wordsByExam[w.exam_id] = {};
    wordsByExam[w.exam_id][w.word] = w.correct;
  });
  const examsByStudent = {};
  exams.forEach(e => {
    if (!examsByStudent[e.student_id]) examsByStudent[e.student_id] = [];
    examsByStudent[e.student_id].push({ ...e, words: wordsByExam[e.id] || {} });
  });
  const map = {};
  students.forEach(s => {
    map[s.id] = { ...s, exams: examsByStudent[s.id] || [] };
  });
  return map;
}

function computeWordStats(student) {
  const wordMap = {};
  student.exams.forEach((exam, examIdx) => {
    Object.entries(exam.words || {}).forEach(([word, correct]) => {
      if (!wordMap[word]) wordMap[word] = [];
      wordMap[word].push({ examIdx, examId: exam.id, date: exam.date, correct, type: exam.type });
    });
  });
  return wordMap;
}

function getTrend(appearances) {
  if (!appearances || appearances.length === 0) return "neutral";
  const shortOnly = appearances.filter(a => a.type === "short");
  const arr = shortOnly.length >= 2 ? shortOnly : appearances;
  if (arr.length < 2) return arr[0]?.correct ? "mastered" : "struggling";
  const recent = arr.slice(-2);
  if (arr.every(a => a.correct)) return "mastered";
  if (arr.every(a => !a.correct)) return "struggling";
  if (!recent[0].correct && recent[1].correct) return "progression";
  if (recent[0].correct && !recent[1].correct) return "regression";
  return "neutral";
}

function getExamScore(exam) {
  const vals = Object.values(exam.words || {});
  if (!vals.length) return 0;
  return Math.round((vals.filter(Boolean).length / vals.length) * 100);
}

function getOverallScore(student) {
  const short = student.exams.filter(e => e.type === "short");
  if (!short.length) return null;
  let t = 0, c = 0;
  short.forEach(e => Object.values(e.words || {}).forEach(v => { t += v ? 1 : 0; c++; }));
  return c ? Math.round((t / c) * 100) : 0;
}

function formatDate(d) {
  if (!d) return "";
  const [y, m, day] = d.split("-");
  return `${day}/${m}/${y.slice(2)}`;
}

function genId() { return `id_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`; }

// ─── GENERATE EXAM WORDS ──────────────────────────────────────────────────────
function generateExamWords(student, mode, count = 12) {
  const wordStats = computeWordStats(student);
  const shortExams = student.exams.filter(e => e.type === "short");
  const lastExam = shortExams[shortExams.length - 1];

  const scored = Object.entries(wordStats).map(([word, apps]) => {
    const shortApps = apps.filter(a => a.type === "short");
    const total = shortApps.length || apps.length;
    const wrong = (shortApps.length ? shortApps : apps).filter(a => !a.correct).length;
    const errorRate = total > 0 ? wrong / total : 0;
    const inLastExam = lastExam ? (word in (lastExam.words || {})) : false;
    const wrongInLast = lastExam ? (lastExam.words?.[word] === false) : false;
    return { word, errorRate, total, wrong, inLastExam, wrongInLast, appearances: apps.length };
  });

  let sorted;
  if (mode === "overall") {
    sorted = scored.sort((a, b) => b.errorRate - a.errorRate || b.total - a.total);
  } else if (mode === "recent") {
    const inLast = scored.filter(w => w.inLastExam && w.wrongInLast);
    const others = scored.filter(w => !w.inLastExam || !w.wrongInLast).sort((a, b) => b.errorRate - a.errorRate);
    sorted = [...inLast, ...others];
  } else {
    sorted = scored.sort((a, b) => b.appearances - a.appearances || b.errorRate - a.errorRate);
  }
  return sorted.slice(0, count).map(w => w.word);
}

// ─── SCORE RING ───────────────────────────────────────────────────────────────
function ScoreRing({ score, size = 64, stroke = 5 }) {
  const r = (size - stroke * 2) / 2;
  const circ = 2 * Math.PI * r;
  const dash = (score / 100) * circ;
  const color = score >= 75 ? C.green : score >= 50 ? C.accent : C.red;
  return (
    <svg width={size} height={size} style={{ transform: "rotate(-90deg)", flexShrink: 0 }}>
      <circle cx={size/2} cy={size/2} r={r} fill="none" stroke={C.border} strokeWidth={stroke} />
      <circle cx={size/2} cy={size/2} r={r} fill="none" stroke={color} strokeWidth={stroke}
        strokeDasharray={`${dash} ${circ}`} strokeLinecap="round" />
      <text x={size/2} y={size/2} textAnchor="middle" dominantBaseline="middle"
        fill={color} fontSize={size * 0.2} fontWeight="700"
        style={{ transform: "rotate(90deg)", transformOrigin: `${size/2}px ${size/2}px` }}>
        {score}%
      </text>
    </svg>
  );
}

// ─── MINI BAR ─────────────────────────────────────────────────────────────────
function MiniBar({ score }) {
  const color = score >= 75 ? C.green : score >= 50 ? C.accent : C.red;
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
      <div style={{ flex: 1, height: 5, background: C.border, borderRadius: 3, overflow: "hidden" }}>
        <div style={{ width: `${score}%`, height: "100%", background: color, borderRadius: 3 }} />
      </div>
      <span style={{ fontSize: 12, color, fontWeight: 700, minWidth: 34 }}>{score}%</span>
    </div>
  );
}

// ─── PROGRESS CHART ───────────────────────────────────────────────────────────
function ProgressChart({ exams }) {
  const shortExams = exams.filter(e => e.type === "short" && Object.keys(e.words || {}).length > 0);
  if (shortExams.length < 2) return (
    <div style={{ color: C.muted, fontSize: 13, textAlign: "center", padding: "20px 0" }}>
      Minimum 2 examens courts pour afficher le graphe.
    </div>
  );

  const scores = shortExams.map(e => getExamScore(e));
  const maxS = 100, minS = 0;
  const W = 480, H = 140, PL = 36, PR = 16, PT = 16, PB = 32;
  const gW = W - PL - PR, gH = H - PT - PB;
  const xStep = gW / (scores.length - 1);
  const yPos = s => PT + gH - ((s - minS) / (maxS - minS)) * gH;

  const points = scores.map((s, i) => ({ x: PL + i * xStep, y: yPos(s), s }));
  const pathD = points.map((p, i) => `${i === 0 ? "M" : "L"} ${p.x} ${p.y}`).join(" ");
  const areaD = `${pathD} L ${points[points.length-1].x} ${H - PB} L ${points[0].x} ${H - PB} Z`;

  const yTicks = [0, 25, 50, 75, 100];

  return (
    <svg viewBox={`0 0 ${W} ${H}`} style={{ width: "100%", maxWidth: W }}>
      {yTicks.map(t => (
        <g key={t}>
          <line x1={PL} y1={yPos(t)} x2={W - PR} y2={yPos(t)} stroke={C.border} strokeWidth="1" strokeDasharray={t === 0 ? "none" : "3,4"} />
          <text x={PL - 6} y={yPos(t)} textAnchor="end" dominantBaseline="middle" fill={C.dim} fontSize="10">{t}</text>
        </g>
      ))}
      <defs>
        <linearGradient id="areaGrad" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={C.accent} stopOpacity="0.25" />
          <stop offset="100%" stopColor={C.accent} stopOpacity="0.02" />
        </linearGradient>
      </defs>
      <path d={areaD} fill="url(#areaGrad)" />
      <path d={pathD} fill="none" stroke={C.accent} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
      {points.map((p, i) => {
        const color = p.s >= 75 ? C.green : p.s >= 50 ? C.accent : C.red;
        return (
          <g key={i}>
            <circle cx={p.x} cy={p.y} r="5" fill={C.bg} stroke={color} strokeWidth="2" />
            <text x={p.x} y={p.y - 10} textAnchor="middle" fill={color} fontSize="10" fontWeight="700">{p.s}%</text>
            <text x={p.x} y={H - PB + 14} textAnchor="middle" fill={C.dim} fontSize="9">{formatDate(shortExams[i].date)}</text>
          </g>
        );
      })}
    </svg>
  );
}

// ─── WORD PILL ────────────────────────────────────────────────────────────────
function WordPill({ word, appearances }) {
  const trend = getTrend(appearances);
  const cfg = TREND_CONFIG[trend];
  const successRate = Math.round((appearances.filter(a => a.correct).length / appearances.length) * 100);
  return (
    <div style={{
      display: "flex", alignItems: "center", gap: 10,
      padding: "9px 14px", background: C.card, borderRadius: 9,
      border: `1px solid ${C.border}`, marginBottom: 5,
    }}>
      <span style={{ flex: 1, fontSize: 13, color: C.text, fontWeight: 500 }}>{word}</span>
      <div style={{ display: "flex", gap: 3 }}>
        {appearances.map((a, i) => (
          <div key={i} title={`${formatDate(a.date)} — ${a.correct ? "Juste" : "Faux"}`} style={{
            width: 18, height: 18, borderRadius: 4,
            background: a.correct ? C.green : C.red,
            opacity: a.type === "baseline" ? 0.45 : 1,
            border: a.type !== "short" ? `1px dashed ${C.muted}` : "none",
            display: "flex", alignItems: "center", justifyContent: "center",
            fontSize: 9, color: "#000", fontWeight: 700,
          }}>
            {a.type !== "short" ? "B" : ""}
          </div>
        ))}
      </div>
      <div style={{
        display: "flex", alignItems: "center", gap: 5, padding: "3px 8px",
        background: cfg.bg, borderRadius: 6,
      }}>
        <span style={{ fontSize: 12, color: cfg.color, fontWeight: 700 }}>{cfg.icon}</span>
        <span style={{ fontSize: 11, color: cfg.color }}>{successRate}%</span>
        <span style={{ fontSize: 10, color: cfg.color, opacity: 0.8 }}>{cfg.label}</span>
      </div>
    </div>
  );
}

// ─── EXAM GENERATOR MODAL ─────────────────────────────────────────────────────
function GeneratorModal({ student, onClose }) {
  const [mode, setMode] = useState("overall");
  const [count, setCount] = useState(12);
  const [generated, setGenerated] = useState(null);
  const [copied, setCopied] = useState(false);

  const modes = [
    { id: "overall",  label: "Plus souvent faux", desc: "Mots avec le taux d'erreur le plus élevé sur tous les examens", icon: "📊" },
    { id: "recent",   label: "Dernier examen", desc: "Mots ratés lors du test le plus récent en priorité", icon: "🕐" },
    { id: "frequent", label: "Plus fréquents", desc: "Mots qui apparaissent le plus souvent dans les examens", icon: "🔁" },
  ];

  function generate() {
    setGenerated(generateExamWords(student, mode, count));
  }

  function copyList() {
    navigator.clipboard.writeText(generated.join("\n"));
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.85)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 100 }}
      onClick={e => e.target === e.currentTarget && onClose()}>
      <div style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 16, padding: 28, width: "min(520px, 95vw)", maxHeight: "85vh", overflowY: "auto" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 22 }}>
          <h2 style={{ color: C.text, fontSize: 18, fontWeight: 700, margin: 0 }}>Générer un examen — {student.id}</h2>
          <button onClick={onClose} style={{ background: "none", border: "none", color: C.muted, fontSize: 20, cursor: "pointer" }}>✕</button>
        </div>

        <div style={{ marginBottom: 20 }}>
          <div style={{ fontSize: 11, color: C.muted, fontWeight: 700, letterSpacing: "0.08em", marginBottom: 10 }}>MODE DE SÉLECTION</div>
          {modes.map(m => (
            <div key={m.id} onClick={() => setMode(m.id)} style={{
              padding: "12px 14px", borderRadius: 10, marginBottom: 8, cursor: "pointer",
              border: `1px solid ${mode === m.id ? C.accent : C.border}`,
              background: mode === m.id ? C.accentGlow : C.card,
            }}>
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <span style={{ fontSize: 18 }}>{m.icon}</span>
                <div>
                  <div style={{ fontSize: 13, fontWeight: 700, color: mode === m.id ? C.accent : C.text }}>{m.label}</div>
                  <div style={{ fontSize: 11, color: C.muted, marginTop: 2 }}>{m.desc}</div>
                </div>
              </div>
            </div>
          ))}
        </div>

        <div style={{ marginBottom: 20 }}>
          <div style={{ fontSize: 11, color: C.muted, fontWeight: 700, letterSpacing: "0.08em", marginBottom: 10 }}>
            NOMBRE DE MOTS : {count}
          </div>
          <input type="range" min={5} max={50} value={count} onChange={e => setCount(+e.target.value)}
            style={{ width: "100%", accentColor: C.accent }} />
          <div style={{ display: "flex", justifyContent: "space-between", fontSize: 10, color: C.dim, marginTop: 4 }}>
            <span>5</span><span>Court (10-15)</span><span>Bilan (50)</span>
          </div>
        </div>

        <button onClick={generate} style={{
          width: "100%", padding: "12px", background: C.accent, color: "#fff",
          border: "none", borderRadius: 10, fontSize: 14, fontWeight: 700, cursor: "pointer", marginBottom: 16,
        }}>
          Générer la liste
        </button>

        {generated && (
          <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 10, padding: 16 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
              <span style={{ fontSize: 12, color: C.muted }}>{generated.length} mots sélectionnés</span>
              <button onClick={copyList} style={{
                padding: "5px 12px", background: copied ? C.greenDim : C.accentDim,
                color: copied ? C.green : C.accent, border: `1px solid ${copied ? C.green : C.accent}`,
                borderRadius: 6, fontSize: 12, cursor: "pointer", fontWeight: 700,
              }}>
                {copied ? "✓ Copié !" : "Copier la liste"}
              </button>
            </div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
              {generated.map((w, i) => (
                <div key={w} style={{
                  padding: "5px 12px", background: C.surface, borderRadius: 20,
                  border: `1px solid ${C.border}`, fontSize: 13, color: C.text,
                  display: "flex", alignItems: "center", gap: 6,
                }}>
                  <span style={{ color: C.dim, fontSize: 11 }}>{i + 1}.</span>
                  {w}
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── SCAN MODAL ───────────────────────────────────────────────────────────────
function ScanModal({ students, onClose, onSave }) {
  const [step, setStep] = useState(1);
  const [studentId, setStudentId] = useState("");
  const [examType, setExamType] = useState("short");
  const [examDate, setExamDate] = useState(new Date().toISOString().split("T")[0]);
  const [wordList, setWordList] = useState("");
  const [image, setImage] = useState(null);
  const [results, setResults] = useState({});
  const [analyzing, setAnalyzing] = useState(false);
  const [saving, setSaving] = useState(false);
  const fileRef = useRef();
  const words = wordList.split("\n").map(w => w.trim()).filter(Boolean);

  async function analyzeImage() {
    if (!image || !words.length) return;
    setAnalyzing(true);
    try {
      const res = await fetch("/api/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          imageData: image.data,
          mediaType: image.mediaType,
          words,
        })
      });
      const data = await res.json();
      if (data.result) {
        setResults(data.result);
      } else {
        throw new Error("No result");
      }
    } catch {
      const init = {};
      words.forEach(w => init[w] = true);
      setResults(init);
    }
    setAnalyzing(false);
    setStep(3);
  }

  function handleFile(e) {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = ev => {
      setImage({ data: ev.target.result.split(",")[1], mediaType: file.type, url: ev.target.result });
    };
    reader.readAsDataURL(file);
  }

  async function handleSave() {
    setSaving(true);
    try {
      const examId = genId();
      await db.addExam({ id: examId, student_id: studentId, date: examDate, type: examType });
      const wordRows = Object.entries(results).map(([word, correct]) => ({
        exam_id: examId,
        word,
        correct,
      }));
      await db.addWords(wordRows);
      onSave();
      onClose();
    } catch (e) {
      alert("Erreur lors de l'enregistrement : " + e.message);
    }
    setSaving(false);
  }

  const box = { background: C.surface, border: `1px solid ${C.border}`, borderRadius: 16, padding: 28, width: "min(540px, 95vw)", maxHeight: "88vh", overflowY: "auto" };

  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.85)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 100 }}
      onClick={e => e.target === e.currentTarget && onClose()}>
      <div style={box}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20 }}>
          <h2 style={{ color: C.text, fontSize: 18, fontWeight: 700, margin: 0 }}>
            {["", "Configurer", "Scanner", "Valider"][step]} l'examen
          </h2>
          <button onClick={onClose} style={{ background: "none", border: "none", color: C.muted, fontSize: 20, cursor: "pointer" }}>✕</button>
        </div>

        <div style={{ display: "flex", gap: 6, marginBottom: 24 }}>
          {["Config", "Scan", "Valider"].map((s, i) => (
            <div key={i} style={{
              flex: 1, textAlign: "center", padding: "6px 0", borderRadius: 8, fontSize: 12,
              background: step === i+1 ? C.accentDim : step > i+1 ? C.greenDim : C.card,
              border: `1px solid ${step === i+1 ? C.accent : step > i+1 ? C.green : C.border}`,
              color: step === i+1 ? C.accent : step > i+1 ? C.green : C.muted,
              fontWeight: step === i+1 ? 700 : 400,
            }}>{i+1}. {s}</div>
          ))}
        </div>

        {step === 1 && (
          <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            <div>
              <label style={{ color: C.muted, fontSize: 11, display: "block", marginBottom: 6, fontWeight: 700, letterSpacing: "0.07em" }}>ÉLÈVE</label>
              <select value={studentId} onChange={e => setStudentId(e.target.value)}
                style={{ width: "100%", padding: "10px 12px", background: C.card, border: `1px solid ${C.border}`, borderRadius: 8, color: C.text, fontSize: 14 }}>
                <option value="">Sélectionner...</option>
                {Object.values(students).map(s => <option key={s.id} value={s.id}>{s.label} — {s.id}</option>)}
              </select>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
              <div>
                <label style={{ color: C.muted, fontSize: 11, display: "block", marginBottom: 6, fontWeight: 700, letterSpacing: "0.07em" }}>TYPE</label>
                <select value={examType} onChange={e => setExamType(e.target.value)}
                  style={{ width: "100%", padding: "10px 12px", background: C.card, border: `1px solid ${C.border}`, borderRadius: 8, color: C.text, fontSize: 13 }}>
                  <option value="short">Court (10-15 mots)</option>
                  <option value="baseline">Bilan initial</option>
                  <option value="final">Bilan final</option>
                </select>
              </div>
              <div>
                <label style={{ color: C.muted, fontSize: 11, display: "block", marginBottom: 6, fontWeight: 700, letterSpacing: "0.07em" }}>DATE</label>
                <input type="date" value={examDate} onChange={e => setExamDate(e.target.value)}
                  style={{ width: "100%", padding: "10px 12px", background: C.card, border: `1px solid ${C.border}`, borderRadius: 8, color: C.text, fontSize: 13 }} />
              </div>
            </div>
            <div>
              <label style={{ color: C.muted, fontSize: 11, display: "block", marginBottom: 6, fontWeight: 700, letterSpacing: "0.07em" }}>MOTS (un par ligne, dans l'ordre)</label>
              <textarea value={wordList} onChange={e => setWordList(e.target.value)}
                placeholder={"yesterday\nunderline\nbeautiful\n..."} rows={8}
                style={{ width: "100%", padding: "10px 12px", background: C.card, border: `1px solid ${C.border}`, borderRadius: 8, color: C.text, fontSize: 13, resize: "vertical", fontFamily: "monospace", boxSizing: "border-box" }} />
              <div style={{ fontSize: 11, color: C.muted, marginTop: 4 }}>{words.length} mot{words.length !== 1 ? "s" : ""}</div>
            </div>
            <button onClick={() => setStep(2)} disabled={!studentId || !words.length}
              style={{ padding: "12px", background: studentId && words.length ? C.accent : C.dim, color: "#fff", border: "none", borderRadius: 9, fontSize: 14, fontWeight: 700, cursor: "pointer" }}>
              Suivant →
            </button>
          </div>
        )}

        {step === 2 && (
          <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            <div style={{
              border: `2px dashed ${C.border}`, borderRadius: 12, padding: 28,
              textAlign: "center", cursor: "pointer", background: C.card,
            }} onClick={() => fileRef.current.click()}>
              {image
                ? <img src={image.url} alt="exam" style={{ maxWidth: "100%", maxHeight: 280, borderRadius: 8 }} />
                : <>
                    <div style={{ fontSize: 36, marginBottom: 10 }}>📷</div>
                    <div style={{ color: C.muted, fontSize: 14 }}>Photo de la feuille d'examen</div>
                    <div style={{ color: C.dim, fontSize: 12, marginTop: 4 }}>Case vide ☐ = juste · Case remplie ■ = faux</div>
                  </>
              }
              <input ref={fileRef} type="file" accept="image/*" onChange={handleFile} style={{ display: "none" }} />
            </div>
            <div style={{ display: "flex", gap: 10 }}>
              <button onClick={() => setStep(1)} style={{ flex: 1, padding: "10px", background: C.card, color: C.muted, border: `1px solid ${C.border}`, borderRadius: 8, cursor: "pointer" }}>← Retour</button>
              {image && <button onClick={analyzeImage} disabled={analyzing}
                style={{ flex: 2, padding: "10px", background: C.accent, color: "#fff", border: "none", borderRadius: 8, fontSize: 14, fontWeight: 700, cursor: "pointer" }}>
                {analyzing ? "Analyse..." : "🔍 Analyser"}
              </button>}
              <button onClick={() => { const i = {}; words.forEach(w => i[w] = true); setResults(i); setStep(3); }}
                style={{ flex: 1, padding: "10px", background: C.card, color: C.muted, border: `1px solid ${C.border}`, borderRadius: 8, cursor: "pointer", fontSize: 12 }}>
                Manuel
              </button>
            </div>
          </div>
        )}

        {step === 3 && (
          <div>
            <p style={{ color: C.muted, fontSize: 13, marginBottom: 14 }}>Vérifiez et corrigez si besoin.</p>
            <div style={{ display: "flex", flexDirection: "column", gap: 7, marginBottom: 18 }}>
              {words.map(word => (
                <div key={word} style={{ display: "flex", alignItems: "center", gap: 12 }}>
                  <span style={{ flex: 1, fontSize: 14, color: C.text }}>{word}</span>
                  <button onClick={() => setResults(r => ({ ...r, [word]: !r[word] }))}
                    style={{
                      padding: "6px 18px", borderRadius: 7, border: "none", cursor: "pointer",
                      background: results[word] ? C.greenDim : C.redDim,
                      color: results[word] ? C.green : C.red, fontWeight: 700, fontSize: 13,
                    }}>
                    {results[word] ? "✓ Juste" : "✗ Faux"}
                  </button>
                </div>
              ))}
            </div>
            <div style={{ display: "flex", gap: 10 }}>
              <button onClick={() => setStep(2)} style={{ flex: 1, padding: "10px", background: C.card, color: C.muted, border: `1px solid ${C.border}`, borderRadius: 8, cursor: "pointer" }}>← Retour</button>
              <button onClick={handleSave} disabled={saving}
                style={{ flex: 2, padding: "12px", background: C.green, color: "#000", border: "none", borderRadius: 9, fontSize: 14, fontWeight: 700, cursor: "pointer" }}>
                {saving ? "Enregistrement..." : "✓ Enregistrer"}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── STUDENT VIEW ─────────────────────────────────────────────────────────────
function StudentView({ student, onBack, onRefresh }) {
  const [filter, setFilter] = useState("all");
  const [showGenerator, setShowGenerator] = useState(false);
  const wordStats = computeWordStats(student);

  const trendCounts = {};
  Object.values(wordStats).forEach(apps => {
    const t = getTrend(apps);
    trendCounts[t] = (trendCounts[t] || 0) + 1;
  });

  const baseline = student.exams.find(e => e.type === "baseline");
  const finalExam = student.exams.find(e => e.type === "final");

  const filteredWords = Object.entries(wordStats)
    .filter(([, apps]) => filter === "all" || getTrend(apps) === filter)
    .sort(([, a], [, b]) => {
      const order = { regression: 0, struggling: 1, neutral: 2, progression: 3, mastered: 4 };
      return order[getTrend(a)] - order[getTrend(b)];
    });

  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", gap: 14, marginBottom: 26 }}>
        <button onClick={onBack} style={{ background: C.card, border: `1px solid ${C.border}`, color: C.muted, padding: "8px 16px", borderRadius: 8, cursor: "pointer", fontSize: 13 }}>← Retour</button>
        <div style={{ width: 46, height: 46, background: C.accentDim, borderRadius: 12, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 20, flexShrink: 0 }}>
          {student.label}
        </div>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 18, fontWeight: 700, color: C.text }}>{student.id}</div>
          <div style={{ fontSize: 12, color: C.muted }}>{student.exams.length} examen{student.exams.length > 1 ? "s" : ""} · {Object.keys(wordStats).length} mots distincts</div>
        </div>
        <button onClick={() => setShowGenerator(true)}
          style={{ padding: "9px 16px", background: C.purpleDim, color: C.purple, border: `1px solid ${C.purple}55`, borderRadius: 9, cursor: "pointer", fontSize: 13, fontWeight: 700 }}>
          ✦ Générer examen
        </button>
      </div>

      {/* Progress chart */}
      <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, padding: 20, marginBottom: 16 }}>
        <div style={{ fontSize: 11, color: C.muted, fontWeight: 700, letterSpacing: "0.08em", marginBottom: 14 }}>PROGRESSION</div>
        <ProgressChart exams={student.exams} />
      </div>

      {/* Exam cards */}
      <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, padding: 18, marginBottom: 16 }}>
        <div style={{ fontSize: 11, color: C.muted, fontWeight: 700, letterSpacing: "0.08em", marginBottom: 14 }}>TOUS LES EXAMENS</div>
        <div style={{ display: "flex", gap: 10, overflowX: "auto", paddingBottom: 4 }}>
          {student.exams.map(exam => {
            const score = getExamScore(exam);
            const isSpecial = exam.type !== "short";
            return (
              <div key={exam.id} style={{
                minWidth: 86, background: C.surface, borderRadius: 10, padding: "12px 8px",
                border: `1px solid ${isSpecial ? C.purple + "66" : C.border}`, textAlign: "center", flexShrink: 0,
              }}>
                <div style={{ fontSize: 9, color: isSpecial ? C.purple : C.muted, fontWeight: 700, marginBottom: 6, letterSpacing: "0.05em" }}>
                  {exam.type === "baseline" ? "BILAN INI." : exam.type === "final" ? "BILAN FIN." : "EXAM"}
                </div>
                <ScoreRing score={score} size={54} stroke={4} />
                <div style={{ fontSize: 9, color: C.dim, marginTop: 6 }}>{formatDate(exam.date)}</div>
                <div style={{ fontSize: 9, color: C.muted, marginTop: 2 }}>{Object.keys(exam.words || {}).length} mots</div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Baseline vs final */}
      {(baseline || finalExam) && (
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 16 }}>
          {baseline && (
            <div style={{ background: C.card, border: `1px solid ${C.purple}44`, borderRadius: 10, padding: 14 }}>
              <div style={{ fontSize: 10, color: C.purple, fontWeight: 700, marginBottom: 6, letterSpacing: "0.07em" }}>BILAN INITIAL</div>
              <div style={{ fontSize: 26, fontWeight: 800, color: C.text }}>{getExamScore(baseline)}%</div>
              <div style={{ fontSize: 11, color: C.muted }}>{formatDate(baseline.date)}</div>
            </div>
          )}
          {finalExam && (
            <div style={{ background: C.card, border: `1px solid ${C.green}44`, borderRadius: 10, padding: 14 }}>
              <div style={{ fontSize: 10, color: C.green, fontWeight: 700, marginBottom: 6, letterSpacing: "0.07em" }}>BILAN FINAL</div>
              <div style={{ fontSize: 26, fontWeight: 800, color: C.green }}>{getExamScore(finalExam)}%</div>
              <div style={{ fontSize: 11, color: baseline ? (getExamScore(finalExam) >= getExamScore(baseline) ? C.green : C.red) : C.muted }}>
                {baseline ? `${getExamScore(finalExam) >= getExamScore(baseline) ? "+" : ""}${getExamScore(finalExam) - getExamScore(baseline)} pts` : formatDate(finalExam.date)}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Filters */}
      <div style={{ display: "flex", gap: 6, marginBottom: 12, flexWrap: "wrap" }}>
        {[["all", "Tous", C.muted], ...Object.entries(TREND_CONFIG).map(([k, v]) => [k, v.label, v.color])].map(([key, label, color]) => (
          <button key={key} onClick={() => setFilter(key)}
            style={{
              padding: "5px 12px", borderRadius: 20, border: `1px solid ${filter === key ? color : C.border}`,
              background: filter === key ? color + "22" : "transparent",
              color: filter === key ? color : C.muted, fontSize: 11, cursor: "pointer", fontWeight: filter === key ? 700 : 400,
            }}>
            {label} ({key === "all" ? Object.keys(wordStats).length : trendCounts[key] || 0})
          </button>
        ))}
      </div>

      {/* Legend */}
      <div style={{ display: "flex", gap: 14, marginBottom: 10, flexWrap: "wrap" }}>
        {[[C.green, "Juste"], [C.red, "Faux"]].map(([col, lbl]) => (
          <div key={lbl} style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 11, color: C.muted }}>
            <div style={{ width: 14, height: 14, borderRadius: 3, background: col }} />{lbl}
          </div>
        ))}
        <div style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 11, color: C.muted }}>
          <div style={{ width: 14, height: 14, borderRadius: 3, background: C.green, opacity: 0.4, border: `1px dashed ${C.muted}` }} />Bilan
        </div>
      </div>

      {/* Words */}
      {filteredWords.length === 0
        ? <div style={{ color: C.muted, textAlign: "center", padding: 28, fontSize: 14 }}>Aucun mot dans cette catégorie.</div>
        : filteredWords.map(([word, apps]) => <WordPill key={word} word={word} appearances={apps} />)
      }

      {showGenerator && <GeneratorModal student={student} onClose={() => setShowGenerator(false)} />}
    </div>
  );
}

// ─── DASHBOARD ────────────────────────────────────────────────────────────────
function Dashboard({ students, onSelectStudent, onAddExam, onRefresh }) {
  const [showAddStudent, setShowAddStudent] = useState(false);
  const [newId, setNewId] = useState("");
  const [newLabel, setNewLabel] = useState("");
  const [adding, setAdding] = useState(false);

  async function handleAddStudent() {
    if (!newId.trim() || !newLabel.trim()) return;
    setAdding(true);
    try {
      await db.addStudent({ id: newId.trim().toUpperCase(), label: newLabel.trim() });
      await onRefresh();
      setNewId(""); setNewLabel(""); setShowAddStudent(false);
    } catch (e) { alert("Erreur : " + e.message); }
    setAdding(false);
  }

  const totalExams = Object.values(students).reduce((s, st) => s + st.exams.length, 0);
  const allWords = [...new Set(Object.values(students).flatMap(st => st.exams.flatMap(e => Object.keys(e.words || {}))))];

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 28 }}>
        <div>
          <h1 style={{ fontSize: 24, fontWeight: 800, color: C.text, margin: 0, letterSpacing: "-0.02em" }}>Vocab Tracker</h1>
          <p style={{ color: C.muted, fontSize: 13, margin: "4px 0 0" }}>Suivi de progression vocabulaire</p>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <button onClick={() => setShowAddStudent(!showAddStudent)}
            style={{ padding: "9px 16px", background: C.card, color: C.muted, border: `1px solid ${C.border}`, borderRadius: 9, cursor: "pointer", fontSize: 13 }}>
            + Élève
          </button>
          <button onClick={onAddExam}
            style={{ padding: "9px 16px", background: C.accent, color: "#fff", border: "none", borderRadius: 9, cursor: "pointer", fontSize: 13, fontWeight: 700 }}>
            + Examen
          </button>
        </div>
      </div>

      {showAddStudent && (
        <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, padding: 16, marginBottom: 18 }}>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr auto", gap: 10, alignItems: "flex-end" }}>
            <div>
              <label style={{ color: C.muted, fontSize: 11, display: "block", marginBottom: 5, fontWeight: 700 }}>CODE ÉLÈVE (ex: S04)</label>
              <input value={newId} onChange={e => setNewId(e.target.value)} placeholder="S04"
                style={{ width: "100%", padding: "9px 12px", background: C.surface, border: `1px solid ${C.border}`, borderRadius: 8, color: C.text, fontSize: 14, boxSizing: "border-box" }} />
            </div>
            <div>
              <label style={{ color: C.muted, fontSize: 11, display: "block", marginBottom: 5, fontWeight: 700 }}>SYMBOLE (ex: ★, ◆, #4)</label>
              <input value={newLabel} onChange={e => setNewLabel(e.target.value)} placeholder="★"
                style={{ width: "100%", padding: "9px 12px", background: C.surface, border: `1px solid ${C.border}`, borderRadius: 8, color: C.text, fontSize: 16, textAlign: "center", boxSizing: "border-box" }} />
            </div>
            <button onClick={handleAddStudent} disabled={adding || !newId || !newLabel}
              style={{ padding: "9px 18px", background: C.green, color: "#000", border: "none", borderRadius: 8, cursor: "pointer", fontWeight: 700 }}>
              {adding ? "..." : "Ajouter"}
            </button>
          </div>
        </div>
      )}

      <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 10, marginBottom: 24 }}>
        {[
          { label: "Élèves", value: Object.keys(students).length, color: C.accent },
          { label: "Examens", value: totalExams, color: C.purple },
          { label: "Mots distincts", value: allWords.length, color: C.amber },
        ].map(({ label, value, color }) => (
          <div key={label} style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 11, padding: "14px 18px" }}>
            <div style={{ fontSize: 26, fontWeight: 800, color }}>{value}</div>
            <div style={{ fontSize: 11, color: C.muted, marginTop: 2 }}>{label}</div>
          </div>
        ))}
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        {Object.values(students).length === 0 && (
          <div style={{ color: C.muted, textAlign: "center", padding: 40, fontSize: 14, background: C.card, borderRadius: 12, border: `1px solid ${C.border}` }}>
            Aucun élève pour l'instant. Ajoutez-en un pour commencer.
          </div>
        )}
        {Object.values(students).map(student => {
          const score = getOverallScore(student);
          const wordStats = computeWordStats(student);
          const trendCounts = {};
          Object.values(wordStats).forEach(apps => { const t = getTrend(apps); trendCounts[t] = (trendCounts[t] || 0) + 1; });

          return (
            <div key={student.id} onClick={() => onSelectStudent(student.id)}
              style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 13, padding: "18px 20px", cursor: "pointer", display: "flex", alignItems: "center", gap: 16, transition: "border-color 0.15s, background 0.15s" }}
              onMouseEnter={e => { e.currentTarget.style.borderColor = C.accent; e.currentTarget.style.background = C.cardHover; }}
              onMouseLeave={e => { e.currentTarget.style.borderColor = C.border; e.currentTarget.style.background = C.card; }}>
              <div style={{ width: 44, height: 44, background: C.accentDim, borderRadius: 11, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 20, flexShrink: 0 }}>
                {student.label}
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 15, fontWeight: 700, color: C.text, marginBottom: 5 }}>{student.id}</div>
                {score !== null ? <MiniBar score={score} /> : <div style={{ fontSize: 12, color: C.dim }}>Aucun examen court</div>}
                <div style={{ display: "flex", gap: 10, marginTop: 6 }}>
                  <span style={{ fontSize: 11, color: C.muted }}>{student.exams.filter(e => e.type === "short").length} examens</span>
                  <span style={{ fontSize: 11, color: C.muted }}>{Object.keys(wordStats).length} mots</span>
                </div>
              </div>
              <div style={{ display: "flex", gap: 6, flexShrink: 0 }}>
                {trendCounts.regression > 0 && <div style={{ fontSize: 11, color: C.red, background: C.redDim, padding: "3px 8px", borderRadius: 5 }}>↓ {trendCounts.regression}</div>}
                {trendCounts.mastered > 0 && <div style={{ fontSize: 11, color: C.green, background: C.greenDim, padding: "3px 8px", borderRadius: 5 }}>✦ {trendCounts.mastered}</div>}
              </div>
              <div style={{ color: C.dim, fontSize: 16 }}>›</div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ─── APP ROOT ─────────────────────────────────────────────────────────────────
export default function App() {
  const [students, setStudents] = useState({});
  const [view, setView] = useState("dashboard");
  const [showScan, setShowScan] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  async function loadData() {
    try {
      const raw = await db.getAllData();
      setStudents(buildStudentMap(raw));
      setError(null);
    } catch (e) {
      setError("Impossible de charger les données Supabase. Vérifiez votre connexion.");
    }
    setLoading(false);
  }

  useEffect(() => { loadData(); }, []);

  if (loading) return (
    <div style={{ minHeight: "100vh", background: C.bg, display: "flex", alignItems: "center", justifyContent: "center", fontFamily: "system-ui" }}>
      <div style={{ color: C.muted, fontSize: 14 }}>Chargement...</div>
    </div>
  );

  if (error) return (
    <div style={{ minHeight: "100vh", background: C.bg, display: "flex", alignItems: "center", justifyContent: "center", fontFamily: "system-ui", padding: 24 }}>
      <div style={{ background: C.card, border: `1px solid ${C.red}44`, borderRadius: 12, padding: 28, maxWidth: 400, textAlign: "center" }}>
        <div style={{ fontSize: 32, marginBottom: 12 }}>⚠️</div>
        <div style={{ color: C.red, fontSize: 14, marginBottom: 8 }}>Erreur de connexion</div>
        <div style={{ color: C.muted, fontSize: 12, marginBottom: 18 }}>{error}</div>
        <button onClick={() => { setLoading(true); loadData(); }}
          style={{ padding: "9px 20px", background: C.accent, color: "#fff", border: "none", borderRadius: 8, cursor: "pointer" }}>
          Réessayer
        </button>
      </div>
    </div>
  );

  const currentStudent = students[view];

  return (
    <div style={{ minHeight: "100vh", background: C.bg, padding: "28px 20px", fontFamily: "'Inter', system-ui, sans-serif", boxSizing: "border-box" }}>
      <div style={{ maxWidth: 700, margin: "0 auto" }}>
        {view === "dashboard"
          ? <Dashboard students={students} onSelectStudent={id => setView(id)} onAddExam={() => setShowScan(true)} onRefresh={loadData} />
          : currentStudent
            ? <StudentView student={currentStudent} onBack={() => setView("dashboard")} onRefresh={loadData} />
            : null
        }
      </div>
      {showScan && <ScanModal students={students} onClose={() => setShowScan(false)} onSave={loadData} />}
    </div>
  );
}

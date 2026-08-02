import { useState, useEffect, useRef, useMemo } from "react";
import {
  Camera, Search, Plus, X, Share2, Radio, Download, Trash2,
  Star, Pencil, Check, Loader2, ChevronLeft, RotateCcw, Building2
} from "lucide-react";
import { store } from "./lib/storage";

/* ============================================================
   ROLODEAL — business card capture, recall, and handoff
   ============================================================ */

const P = {
  ink: "#0F141F",
  surface: "#161E2C",
  raised: "#1D2739",
  hair: "#2A3446",
  paper: "#EFEAE0",
  paperInk: "#20242C",
  brass: "#C9A24B",
  brassDim: "#8A6F33",
  text: "#E7E9EE",
  dim: "#8B95A7",
  red: "#C4574B",
  green: "#5FA87A",
};

const MONO = "ui-monospace, SFMono-Regular, Menlo, monospace";
const SERIF = "'Iowan Old Style', 'Palatino Linotype', Palatino, Georgia, serif";
const SANS = "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif";

const KEY_INDEX = "rolodeal:index";
const imgKey = (id) => `rolodeal:img:${id}`;

/* ---------- helpers ---------- */

const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);

const initials = (name = "") =>
  name.trim().split(/\s+/).slice(0, 2).map((w) => w[0] || "").join("").toUpperCase() || "?";

const esc = (s = "") =>
  String(s).replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\n/g, "\\n");

function buildVCard(c) {
  const L = ["BEGIN:VCARD", "VERSION:3.0"];
  L.push(`N:${esc(c.lastName)};${esc(c.firstName)};;;`);
  L.push(`FN:${esc(c.fullName || `${c.firstName} ${c.lastName}`.trim())}`);
  if (c.company) L.push(`ORG:${esc(c.company)}`);
  if (c.title) L.push(`TITLE:${esc(c.title)}`);
  (c.phones || []).forEach((p) => {
    const t = (p.label || "work").toUpperCase().includes("CELL") ? "CELL" : (p.label || "WORK").toUpperCase();
    L.push(`TEL;TYPE=${esc(t)},VOICE:${esc(p.number)}`);
  });
  (c.emails || []).forEach((e) => L.push(`EMAIL;TYPE=INTERNET,WORK:${esc(e)}`));
  if (c.website) L.push(`URL:${esc(c.website)}`);
  const a = c.address || {};
  if (a.street || a.city || a.state || a.zip) {
    L.push(`ADR;TYPE=WORK:;;${esc(a.street)};${esc(a.city)};${esc(a.state)};${esc(a.zip)};${esc(a.country)}`);
  }
  const note = [c.metAt && `Met: ${c.metAt}`, c.notes].filter(Boolean).join(" | ");
  if (note) L.push(`NOTE:${esc(note)}`);
  L.push(`REV:${new Date(c.createdAt || Date.now()).toISOString()}`);
  L.push("END:VCARD");
  return L.join("\r\n");
}

function plainText(c) {
  return [
    c.fullName,
    [c.title, c.company].filter(Boolean).join(", "),
    ...(c.phones || []).map((p) => `${p.label || "phone"}: ${p.number}`),
    ...(c.emails || []),
    c.website,
  ].filter(Boolean).join("\n");
}

/* downscale an image file to a base64 jpeg */
function shrink(file, maxEdge, quality) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("Could not read that image."));
    reader.onload = () => {
      const img = new Image();
      img.onerror = () => reject(new Error("Could not open that image."));
      img.onload = () => {
        const scale = Math.min(1, maxEdge / Math.max(img.width, img.height));
        const w = Math.round(img.width * scale);
        const h = Math.round(img.height * scale);
        const canvas = document.createElement("canvas");
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext("2d");
        ctx.drawImage(img, 0, 0, w, h);
        resolve(canvas.toDataURL("image/jpeg", quality));
      };
      img.src = reader.result;
    };
    reader.readAsDataURL(file);
  });
}

const stripPrefix = (dataUrl) => dataUrl.split(",")[1];

/* ---------- storage ---------- */

async function loadIndex() {
  try {
    const r = await store.get(KEY_INDEX);
    return r ? JSON.parse(r.value) : [];
  } catch {
    return [];
  }
}

async function saveIndex(cards) {
  await store.set(KEY_INDEX, JSON.stringify(cards));
}

async function loadImages(id) {
  try {
    const r = await store.get(imgKey(id));
    return r ? JSON.parse(r.value) : null;
  } catch {
    return null;
  }
}

/* ---------- extraction ---------- */

async function extractCard(frontB64, backB64) {
  const res = await fetch("/api/extract", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ front: frontB64, back: backB64 || null }),
  });

  if (res.status === 429) throw new Error("Too many scans too fast. Wait a moment and retry.");
  if (!res.ok) {
    let detail = "The reader could not reach the service. Try again.";
    try {
      const e = await res.json();
      if (e.error) detail = e.error;
    } catch { /* keep the default */ }
    throw new Error(detail);
  }

  const data = await res.json();
  if (!data.card) throw new Error("Nothing readable came back. Reshoot the card.");
  return data.card;
}

/* ============================================================
   UI pieces
   ============================================================ */

function Eyebrow({ children, color = P.dim }) {
  return (
    <div style={{ fontFamily: MONO, fontSize: 10, letterSpacing: "0.18em", color, textTransform: "uppercase" }}>
      {children}
    </div>
  );
}

function CardFace({ card, onClick, index }) {
  const [hover, setHover] = useState(false);
  return (
    <button
      onClick={onClick}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      className="w-full text-left"
      style={{
        background: P.paper,
        color: P.paperInk,
        borderRadius: 6,
        padding: "16px 18px",
        border: `1px solid ${hover ? P.brass : "rgba(0,0,0,0.12)"}`,
        boxShadow: hover
          ? "0 10px 24px rgba(0,0,0,0.45)"
          : "0 2px 0 rgba(0,0,0,0.35), 0 6px 14px rgba(0,0,0,0.3)",
        transform: hover ? "translateY(-2px)" : "none",
        transition: "transform 140ms ease, box-shadow 140ms ease, border-color 140ms ease",
        animation: `deal 340ms ease both`,
        animationDelay: `${Math.min(index, 8) * 35}ms`,
      }}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="truncate" style={{ fontFamily: SERIF, fontSize: 19, lineHeight: 1.2 }}>
            {card.fullName || "Untitled card"}
          </div>
          <div className="truncate" style={{ fontSize: 12.5, color: "#5A6070", marginTop: 3 }}>
            {[card.title, card.company].filter(Boolean).join(" · ") || "No title on file"}
          </div>
        </div>
        <div
          className="shrink-0 flex items-center justify-center"
          style={{
            width: 38, height: 38, borderRadius: 3,
            border: `1px solid ${P.brassDim}`, color: P.brassDim,
            fontFamily: MONO, fontSize: 12, letterSpacing: "0.06em",
          }}
        >
          {initials(card.fullName)}
        </div>
      </div>
      <div className="flex items-center gap-3 mt-3" style={{ fontFamily: MONO, fontSize: 10, color: "#7C8494" }}>
        <span style={{ color: "#7C8494" }}>{(card.phones || []).length} tel</span>
        <span style={{ color: "#7C8494" }}>{(card.emails || []).length} email</span>
        {card.metAt ? <span className="truncate" style={{ color: P.brassDim }}>{card.metAt}</span> : null}
        {card.starred ? <Star size={11} style={{ color: P.brass, fill: P.brass, marginLeft: "auto" }} /> : null}
      </div>
    </button>
  );
}

function Field({ label, value, onChange, placeholder }) {
  return (
    <label className="block mb-3">
      <Eyebrow>{label}</Eyebrow>
      <input
        value={value || ""}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="w-full mt-1 px-3 py-2 outline-none"
        style={{
          background: P.ink, color: P.text, border: `1px solid ${P.hair}`,
          borderRadius: 4, fontSize: 14, fontFamily: SANS,
        }}
      />
    </label>
  );
}

function Btn({ children, onClick, tone = "quiet", disabled, full }) {
  const tones = {
    brass: { bg: P.brass, fg: "#1A1405", bd: P.brass },
    quiet: { bg: "transparent", fg: P.text, bd: P.hair },
    danger: { bg: "transparent", fg: P.red, bd: "#4A2A28" },
  };
  const t = tones[tone];
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={`flex items-center justify-center gap-2 px-3 py-2 ${full ? "w-full" : ""}`}
      style={{
        background: t.bg, color: t.fg, border: `1px solid ${t.bd}`, borderRadius: 4,
        fontFamily: MONO, fontSize: 11, letterSpacing: "0.12em", textTransform: "uppercase",
        opacity: disabled ? 0.45 : 1, cursor: disabled ? "default" : "pointer",
      }}
    >
      {children}
    </button>
  );
}

/* ============================================================
   Capture
   ============================================================ */

function Capture({ onSave, onCancel, toast }) {
  const [front, setFront] = useState(null);
  const [back, setBack] = useState(null);
  const [stage, setStage] = useState("shoot"); // shoot | reading | review
  const [draft, setDraft] = useState(null);
  const [err, setErr] = useState("");
  const frontRef = useRef();
  const backRef = useRef();

  const pick = async (file, side) => {
    if (!file) return;
    setErr("");
    try {
      const full = await shrink(file, 1500, 0.78);
      const thumb = await shrink(file, 640, 0.6);
      const payload = { full, thumb };
      side === "front" ? setFront(payload) : setBack(payload);
    } catch (e) {
      setErr(e.message);
    }
  };

  const read = async () => {
    if (!front) return;
    setStage("reading");
    setErr("");
    try {
      const r = await extractCard(stripPrefix(front.full), back ? stripPrefix(back.full) : null);
      setDraft({
        id: uid(),
        createdAt: Date.now(),
        firstName: r.firstName || "",
        lastName: r.lastName || "",
        fullName: r.fullName || [r.firstName, r.lastName].filter(Boolean).join(" "),
        title: r.title || "",
        company: r.company || "",
        emails: r.emails || [],
        phones: r.phones || [],
        website: r.website || "",
        address: r.address || {},
        socials: r.socials || [],
        notes: [r.tagline, r.otherText].filter(Boolean).join(" — "),
        metAt: "",
        starred: false,
      });
      setStage("review");
    } catch (e) {
      setErr(e.message);
      setStage("shoot");
    }
  };

  const commit = async () => {
    await onSave(draft, { front: front?.thumb || null, back: back?.thumb || null });
  };

  const Slot = ({ side, shot, inputRef }) => (
    <div className="flex-1">
      <Eyebrow>{side}</Eyebrow>
      <button
        onClick={() => inputRef.current.click()}
        className="w-full mt-1 flex items-center justify-center relative overflow-hidden"
        style={{
          aspectRatio: "1.75 / 1", borderRadius: 6,
          background: shot ? "#000" : P.surface,
          border: `1px dashed ${shot ? P.brassDim : P.hair}`,
        }}
      >
        {shot ? (
          <img src={shot.thumb} alt="" className="w-full h-full object-cover" />
        ) : (
          <div className="flex flex-col items-center gap-1" style={{ color: P.dim }}>
            <Camera size={20} />
            <span style={{ fontFamily: MONO, fontSize: 10, letterSpacing: "0.1em" }}>
              {side === "FRONT" ? "REQUIRED" : "OPTIONAL"}
            </span>
          </div>
        )}
        <span style={{ position: "absolute", inset: 8, border: `1px solid ${shot ? "transparent" : "rgba(201,162,75,0.25)"}`, borderRadius: 3, pointerEvents: "none" }} />
      </button>
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        capture="environment"
        className="hidden"
        onChange={(e) => pick(e.target.files[0], side.toLowerCase())}
      />
    </div>
  );

  if (stage === "review" && draft) {
    const set = (k) => (v) => setDraft({ ...draft, [k]: v });
    return (
      <div className="pb-28">
        <div className="flex items-center gap-2 mb-4">
          <button onClick={() => setStage("shoot")} style={{ color: P.dim }}><ChevronLeft size={18} /></button>
          <Eyebrow color={P.brass}>Check the read</Eyebrow>
        </div>
        <Field label="Full name" value={draft.fullName} onChange={set("fullName")} />
        <div className="flex gap-3">
          <div className="flex-1"><Field label="First" value={draft.firstName} onChange={set("firstName")} /></div>
          <div className="flex-1"><Field label="Last" value={draft.lastName} onChange={set("lastName")} /></div>
        </div>
        <Field label="Title" value={draft.title} onChange={set("title")} />
        <Field label="Company" value={draft.company} onChange={set("company")} />
        <Field
          label="Phones"
          value={(draft.phones || []).map((p) => `${p.label || "office"}:${p.number}`).join(", ")}
          placeholder="mobile:248-555-0134, office:..."
          onChange={(v) =>
            setDraft({
              ...draft,
              phones: v.split(",").map((s) => {
                const [a, b] = s.split(":");
                return b ? { label: a.trim(), number: b.trim() } : { label: "office", number: a.trim() };
              }).filter((p) => p.number),
            })
          }
        />
        <Field
          label="Emails"
          value={(draft.emails || []).join(", ")}
          onChange={(v) => setDraft({ ...draft, emails: v.split(",").map((s) => s.trim()).filter(Boolean) })}
        />
        <Field label="Website" value={draft.website} onChange={set("website")} />
        <Field label="Where you met" value={draft.metAt} placeholder="ACG Detroit, Sept 2026" onChange={set("metAt")} />
        <Field label="Notes" value={draft.notes} onChange={set("notes")} />

        <div className="fixed left-0 right-0 bottom-0 p-4 flex gap-3" style={{ background: `linear-gradient(to top, ${P.ink} 70%, transparent)` }}>
          <Btn onClick={onCancel}>Discard</Btn>
          <div className="flex-1"><Btn tone="brass" full onClick={commit}><Check size={13} /> File it</Btn></div>
        </div>
      </div>
    );
  }

  return (
    <div>
      <div className="flex items-center gap-2 mb-4">
        <button onClick={onCancel} style={{ color: P.dim }}><ChevronLeft size={18} /></button>
        <Eyebrow color={P.brass}>New card</Eyebrow>
      </div>
      <div className="flex gap-3">
        <Slot side="FRONT" shot={front} inputRef={frontRef} />
        <Slot side="BACK" shot={back} inputRef={backRef} />
      </div>
      {err ? (
        <div className="mt-4" style={{ color: P.red, fontSize: 12.5 }}>{err}</div>
      ) : null}
      <div className="mt-6">
        <Btn tone="brass" full disabled={!front || stage === "reading"} onClick={read}>
          {stage === "reading" ? <><Loader2 size={13} className="animate-spin" /> Reading card</> : <>Read the card</>}
        </Btn>
      </div>
      <p className="mt-3" style={{ color: P.dim, fontSize: 12, lineHeight: 1.5 }}>
        Shoot straight on in decent light. Back is optional, but worth it when the card has a second language or handwriting on it.
      </p>
    </div>
  );
}

/* ============================================================
   Detail
   ============================================================ */

function Detail({ card, onBack, onDelete, onUpdate, toast }) {
  const [imgs, setImgs] = useState(null);
  const [flipped, setFlipped] = useState(false);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(card);
  const nfcOk = typeof window !== "undefined" && "NDEFReader" in window;

  useEffect(() => {
    let alive = true;
    loadImages(card.id).then((r) => alive && setImgs(r));
    return () => { alive = false; };
  }, [card.id]);

  const vcf = useMemo(() => buildVCard(card), [card]);

  const downloadVcf = () => {
    const blob = new Blob([vcf], { type: "text/vcard;charset=utf-8" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `${(card.fullName || "contact").replace(/\s+/g, "_")}.vcf`;
    a.click();
    URL.revokeObjectURL(a.href);
    toast("Contact file saved");
  };

  const shareCard = async () => {
    const file = new File([vcf], `${(card.fullName || "contact").replace(/\s+/g, "_")}.vcf`, { type: "text/vcard" });
    try {
      if (navigator.canShare && navigator.canShare({ files: [file] })) {
        await navigator.share({ files: [file], title: card.fullName });
      } else if (navigator.share) {
        await navigator.share({ title: card.fullName, text: plainText(card) });
      } else {
        await navigator.clipboard.writeText(plainText(card));
        toast("Details copied to clipboard");
      }
    } catch (e) {
      if (e.name !== "AbortError") toast("Sharing was blocked here. Use Save contact file instead.");
    }
  };

  const sendNfc = async () => {
    try {
      const ndef = new window.NDEFReader();
      toast("Hold the phones together");
      await ndef.write({
        records: [{ recordType: "mime", mediaType: "text/vcard", data: new TextEncoder().encode(vcf) }],
      });
      toast("Card sent");
    } catch (e) {
      toast("NFC write failed. Phone may need NFC turned on.");
    }
  };

  const save = () => {
    onUpdate(draft);
    setEditing(false);
    toast("Card updated");
  };

  const shot = flipped ? imgs?.back : imgs?.front;

  if (editing) {
    const set = (k) => (v) => setDraft({ ...draft, [k]: v });
    return (
      <div className="pb-28">
        <div className="flex items-center gap-2 mb-4">
          <button onClick={() => { setEditing(false); setDraft(card); }} style={{ color: P.dim }}><ChevronLeft size={18} /></button>
          <Eyebrow color={P.brass}>Editing</Eyebrow>
        </div>
        <Field label="Full name" value={draft.fullName} onChange={set("fullName")} />
        <Field label="Title" value={draft.title} onChange={set("title")} />
        <Field label="Company" value={draft.company} onChange={set("company")} />
        <Field
          label="Phones"
          value={(draft.phones || []).map((p) => `${p.label || "office"}:${p.number}`).join(", ")}
          onChange={(v) =>
            setDraft({
              ...draft,
              phones: v.split(",").map((s) => {
                const [a, b] = s.split(":");
                return b ? { label: a.trim(), number: b.trim() } : { label: "office", number: a.trim() };
              }).filter((p) => p.number),
            })
          }
        />
        <Field label="Emails" value={(draft.emails || []).join(", ")} onChange={(v) => setDraft({ ...draft, emails: v.split(",").map((s) => s.trim()).filter(Boolean) })} />
        <Field label="Website" value={draft.website} onChange={set("website")} />
        <Field label="Where you met" value={draft.metAt} onChange={set("metAt")} />
        <Field label="Notes" value={draft.notes} onChange={set("notes")} />
        <div className="fixed left-0 right-0 bottom-0 p-4" style={{ background: `linear-gradient(to top, ${P.ink} 70%, transparent)` }}>
          <Btn tone="brass" full onClick={save}><Check size={13} /> Save changes</Btn>
        </div>
      </div>
    );
  }

  return (
    <div className="pb-8">
      <div className="flex items-center justify-between mb-4">
        <button onClick={onBack} className="flex items-center gap-1" style={{ color: P.dim }}>
          <ChevronLeft size={18} /><span style={{ fontFamily: MONO, fontSize: 11, letterSpacing: "0.1em" }}>DECK</span>
        </button>
        <div className="flex items-center gap-3">
          <button onClick={() => onUpdate({ ...card, starred: !card.starred })}>
            <Star size={17} style={{ color: card.starred ? P.brass : P.dim, fill: card.starred ? P.brass : "none" }} />
          </button>
          <button onClick={() => setEditing(true)}><Pencil size={16} style={{ color: P.dim }} /></button>
        </div>
      </div>

      {/* the card itself */}
      <div
        onClick={() => imgs?.back && setFlipped(!flipped)}
        style={{
          background: shot ? "#000" : P.paper,
          borderRadius: 8, overflow: "hidden", position: "relative",
          aspectRatio: "1.75 / 1",
          boxShadow: "0 12px 30px rgba(0,0,0,0.5)",
          border: `1px solid ${P.hair}`,
        }}
      >
        {shot ? (
          <img src={shot} alt="" className="w-full h-full object-cover" />
        ) : (
          <div className="w-full h-full flex flex-col justify-center px-5" style={{ color: P.paperInk }}>
            <div style={{ fontFamily: SERIF, fontSize: 24 }}>{card.fullName}</div>
            <div style={{ fontSize: 13, color: "#5A6070" }}>{[card.title, card.company].filter(Boolean).join(" · ")}</div>
          </div>
        )}
        {imgs?.back ? (
          <div className="absolute bottom-2 right-2 flex items-center gap-1 px-2 py-1"
            style={{ background: "rgba(0,0,0,0.6)", borderRadius: 3, color: P.brass, fontFamily: MONO, fontSize: 9, letterSpacing: "0.1em" }}>
            <RotateCcw size={10} /> {flipped ? "BACK" : "FRONT"}
          </div>
        ) : null}
      </div>

      <h2 className="mt-5" style={{ fontFamily: SERIF, fontSize: 26, lineHeight: 1.15 }}>{card.fullName}</h2>
      <div style={{ color: P.dim, fontSize: 14, marginTop: 2 }}>{card.title}</div>
      {card.company ? (
        <div className="flex items-center gap-2 mt-1" style={{ color: P.brass, fontSize: 14 }}>
          <Building2 size={13} /> {card.company}
        </div>
      ) : null}

      <div className="mt-5" style={{ borderTop: `1px solid ${P.hair}` }}>
        {(card.phones || []).map((p, i) => (
          <a key={i} href={`tel:${p.number}`} className="flex items-center justify-between py-3"
            style={{ borderBottom: `1px solid ${P.hair}`, color: P.text, fontSize: 15 }}>
            <span>{p.number}</span>
            <span style={{ fontFamily: MONO, fontSize: 10, color: P.dim, letterSpacing: "0.1em" }}>{(p.label || "office").toUpperCase()}</span>
          </a>
        ))}
        {(card.emails || []).map((e, i) => (
          <a key={i} href={`mailto:${e}`} className="flex items-center justify-between py-3 gap-3"
            style={{ borderBottom: `1px solid ${P.hair}`, color: P.text, fontSize: 15 }}>
            <span className="truncate">{e}</span>
            <span style={{ fontFamily: MONO, fontSize: 10, color: P.dim, letterSpacing: "0.1em" }}>EMAIL</span>
          </a>
        ))}
        {card.website ? (
          <a href={`https://${card.website.replace(/^https?:\/\//, "")}`} target="_blank" rel="noreferrer"
            className="flex items-center justify-between py-3" style={{ borderBottom: `1px solid ${P.hair}`, color: P.text, fontSize: 15 }}>
            <span className="truncate">{card.website}</span>
            <span style={{ fontFamily: MONO, fontSize: 10, color: P.dim, letterSpacing: "0.1em" }}>WEB</span>
          </a>
        ) : null}
      </div>

      {(card.metAt || card.notes) ? (
        <div className="mt-5 p-3" style={{ background: P.surface, borderRadius: 5, border: `1px solid ${P.hair}` }}>
          {card.metAt ? <><Eyebrow>Met at</Eyebrow><div style={{ fontSize: 14, marginBottom: 8 }}>{card.metAt}</div></> : null}
          {card.notes ? <><Eyebrow>Notes</Eyebrow><div style={{ fontSize: 14, lineHeight: 1.5 }}>{card.notes}</div></> : null}
        </div>
      ) : null}

      <div className="mt-6">
        <Eyebrow color={P.brass}>Hand it off</Eyebrow>
        <div className="grid grid-cols-2 gap-2 mt-2">
          <Btn tone="brass" onClick={shareCard}><Share2 size={13} /> Send card</Btn>
          <Btn onClick={downloadVcf}><Download size={13} /> vCard file</Btn>
          {nfcOk ? <Btn onClick={sendNfc}><Radio size={13} /> Tap to send</Btn> : null}
          <Btn onClick={async () => { await navigator.clipboard.writeText(plainText(card)); toast("Details copied"); }}>
            Copy details
          </Btn>
        </div>
      </div>

      <div className="mt-8">
        <Btn tone="danger" full onClick={() => onDelete(card.id)}><Trash2 size={13} /> Remove from deck</Btn>
      </div>
    </div>
  );
}

/* ============================================================
   App
   ============================================================ */

export default function Rolodeal() {
  const [cards, setCards] = useState([]);
  const [view, setView] = useState("deck");
  const [selected, setSelected] = useState(null);
  const [q, setQ] = useState("");
  const [loading, setLoading] = useState(true);
  const [msg, setMsg] = useState("");

  const toast = (t) => { setMsg(t); setTimeout(() => setMsg(""), 2600); };

  useEffect(() => {
    loadIndex().then((c) => { setCards(c); setLoading(false); });
  }, []);

  const persist = async (next) => {
    setCards(next);
    try { await saveIndex(next); } catch { toast("Could not save. Storage may be full."); }
  };

  const addCard = async (card, images) => {
    try {
      await store.set(imgKey(card.id), JSON.stringify(images));
    } catch { /* images are optional */ }
    await persist([card, ...cards]);
    setView("deck");
    toast("Card filed");
  };

  const updateCard = async (card) => {
    const next = cards.map((c) => (c.id === card.id ? card : c));
    await persist(next);
    setSelected(card);
  };

  const deleteCard = async (id) => {
    try { await store.delete(imgKey(id)); } catch { /* fine */ }
    await persist(cards.filter((c) => c.id !== id));
    setView("deck");
    toast("Card removed");
  };

  const filtered = useMemo(() => {
    const t = q.trim().toLowerCase();
    const base = [...cards].sort((a, b) => (b.starred ? 1 : 0) - (a.starred ? 1 : 0) || b.createdAt - a.createdAt);
    if (!t) return base;
    return base.filter((c) =>
      [c.fullName, c.company, c.title, c.metAt, c.notes, ...(c.emails || []), ...(c.phones || []).map((p) => p.number)]
        .filter(Boolean).join(" ").toLowerCase().includes(t)
    );
  }, [cards, q]);

  const thisMonth = cards.filter((c) => new Date(c.createdAt).getMonth() === new Date().getMonth()).length;

  return (
    <div style={{ background: P.ink, color: P.text, minHeight: "100vh", fontFamily: SANS }}>
      <style>{`
        @keyframes deal { from { opacity: 0; transform: translateY(10px) } to { opacity: 1; transform: none } }
        @media (prefers-reduced-motion: reduce) { *, *::before, *::after { animation: none !important; transition: none !important } }
        input::placeholder { color: #5A6274 }
      `}</style>

      <div className="mx-auto px-4 pt-6" style={{ maxWidth: 560 }}>
        {view === "deck" ? (
          <>
            <div className="flex items-end justify-between">
              <div>
                <div style={{ fontFamily: SERIF, fontSize: 30, letterSpacing: "-0.01em" }}>Rolodeal</div>
                <Eyebrow>{cards.length} cards · {thisMonth} this month</Eyebrow>
              </div>
              <button
                onClick={() => setView("capture")}
                className="flex items-center gap-2 px-3 py-2"
                style={{ background: P.brass, color: "#1A1405", borderRadius: 4, fontFamily: MONO, fontSize: 11, letterSpacing: "0.1em" }}
              >
                <Plus size={14} /> SCAN
              </button>
            </div>

            <div className="relative mt-5">
              <Search size={15} style={{ position: "absolute", left: 11, top: 11, color: P.dim }} />
              <input
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="Name, firm, where you met"
                className="w-full outline-none"
                style={{
                  background: P.surface, border: `1px solid ${P.hair}`, borderRadius: 4,
                  padding: "9px 12px 9px 34px", color: P.text, fontSize: 14,
                }}
              />
              {q ? <button onClick={() => setQ("")} style={{ position: "absolute", right: 10, top: 10, color: P.dim }}><X size={15} /></button> : null}
            </div>

            <div className="mt-4 space-y-3 pb-10">
              {loading ? (
                <div className="flex justify-center py-16"><Loader2 className="animate-spin" style={{ color: P.dim }} /></div>
              ) : filtered.length === 0 ? (
                <div className="text-center py-16" style={{ color: P.dim }}>
                  <div style={{ fontFamily: SERIF, fontSize: 19, color: P.text }}>
                    {cards.length ? "No match in the deck" : "The deck is empty"}
                  </div>
                  <div style={{ fontSize: 13.5, marginTop: 6 }}>
                    {cards.length ? "Try the firm name instead." : "Scan the first card and it lands here."}
                  </div>
                </div>
              ) : (
                filtered.map((c, i) => (
                  <CardFace key={c.id} card={c} index={i} onClick={() => { setSelected(c); setView("detail"); }} />
                ))
              )}
            </div>
          </>
        ) : view === "capture" ? (
          <Capture onSave={addCard} onCancel={() => setView("deck")} toast={toast} />
        ) : (
          <Detail
            card={selected}
            onBack={() => setView("deck")}
            onDelete={deleteCard}
            onUpdate={updateCard}
            toast={toast}
          />
        )}
      </div>

      {msg ? (
        <div className="fixed left-0 right-0 bottom-6 flex justify-center px-4" style={{ pointerEvents: "none" }}>
          <div className="px-4 py-2" style={{
            background: P.raised, border: `1px solid ${P.brassDim}`, borderRadius: 4,
            fontFamily: MONO, fontSize: 11, letterSpacing: "0.08em", color: P.text,
          }}>
            {msg}
          </div>
        </div>
      ) : null}
    </div>
  );
}

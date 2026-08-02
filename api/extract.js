/**
 * POST /api/extract
 * Body: { front: <base64 jpeg, no data: prefix>, back: <base64 jpeg|null> }
 * Returns: { card: {...structured fields...} }
 *
 * The Anthropic key lives here and never reaches the browser.
 */

const MODEL = "claude-sonnet-5";
const MAX_IMAGE_BYTES = 3_500_000; // base64 length guard, roughly 2.6MB of jpeg

const EXTRACT_PROMPT = `You are reading photographs of a business card. The first image is the front. If a second image is provided it is the back of the same card.

Return ONLY a JSON object, no preamble, no markdown fences, with exactly these keys:
{
  "firstName": string|null,
  "lastName": string|null,
  "fullName": string|null,
  "credentials": string|null,
  "title": string|null,
  "company": string|null,
  "emails": string[],
  "phones": [{"label": "mobile"|"office"|"direct"|"fax"|"other", "number": string}],
  "website": string|null,
  "address": {"street": string|null, "city": string|null, "state": string|null, "zip": string|null, "country": string|null},
  "socials": string[],
  "tagline": string|null,
  "otherText": string|null
}

Rules: transcribe exactly what is printed, do not invent or complete missing values, use null or [] when absent. Normalize phone numbers to the format printed. Strip "http://" and "https://" from website. Put anything meaningful you could not classify into otherText.`;

/* crude per-instance throttle, enough to stop a runaway loop burning your key */
const hits = new Map();
function throttled(ip) {
  const now = Date.now();
  const window = 60_000;
  const limit = 20;
  const rec = hits.get(ip) || { count: 0, start: now };
  if (now - rec.start > window) {
    rec.count = 0;
    rec.start = now;
  }
  rec.count += 1;
  hits.set(ip, rec);
  return rec.count > limit;
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Use POST." });
  }

  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) return res.status(500).json({ error: "Server is missing ANTHROPIC_API_KEY." });

  const ip = (req.headers["x-forwarded-for"] || "unknown").split(",")[0].trim();
  if (throttled(ip)) return res.status(429).json({ error: "Too many scans too fast." });

  const { front, back } = req.body || {};
  if (!front || typeof front !== "string") {
    return res.status(400).json({ error: "No front image received." });
  }
  if (front.length > MAX_IMAGE_BYTES || (back && back.length > MAX_IMAGE_BYTES)) {
    return res.status(413).json({ error: "Image too large. Reshoot at lower resolution." });
  }

  const content = [
    { type: "image", source: { type: "base64", media_type: "image/jpeg", data: front } },
  ];
  if (back) {
    content.push({ type: "image", source: { type: "base64", media_type: "image/jpeg", data: back } });
  }
  content.push({ type: "text", text: EXTRACT_PROMPT });

  try {
    const upstream = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": key,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 1000,
        messages: [{ role: "user", content }],
      }),
    });

    if (!upstream.ok) {
      const body = await upstream.text();
      console.error("anthropic error", upstream.status, body.slice(0, 500));
      return res.status(502).json({ error: "The card reader is unavailable right now." });
    }

    const data = await upstream.json();
    const text = (data.content || [])
      .filter((b) => b.type === "text")
      .map((b) => b.text)
      .join("");

    const clean = text.replace(/```json/g, "").replace(/```/g, "").trim();
    const start = clean.indexOf("{");
    const end = clean.lastIndexOf("}");
    if (start === -1 || end === -1) {
      return res.status(422).json({ error: "Nothing readable came back. Reshoot the card." });
    }

    const card = JSON.parse(clean.slice(start, end + 1));
    return res.status(200).json({ card, usage: data.usage || null });
  } catch (err) {
    console.error("extract failed", err);
    return res.status(500).json({ error: "Extraction failed. Try the scan again." });
  }
}

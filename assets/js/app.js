// ════════════════════════════════════════════════════════════════
// Edge Function: ocr-rezultat  (v2 — citește TOATE rezultatele)
// Din buletinul de laborator (PDF/imagine) extrage:
//   - lista completă de analize cu valori
//   - medicul validator + parafa
//
// Primește: { fileBase64, mediaType }
// Întoarce: {
//   doctor_nume, parafa,
//   rezultate: [ { denumire, rezultat, um, interval, flag } ]
// }
// flag: "ridicat" | "scazut" | "normal" | null
//
// Retry + backoff + fallback pe alt model. Secret: GEMINI_API_KEY
// ════════════════════════════════════════════════════════════════

import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const MODELS = ["gemini-2.5-flash", "gemini-2.5-flash-lite", "gemini-2.0-flash"];
const MAX_RETRIES_PER_MODEL = 3;

const PROMPT = `Acesta este un buletin de rezultate de analize medicale de laborator din România.
Extrage TOATE analizele cu rezultatele lor, plus medicul validator.

Pentru fiecare analiză din buletin extrage:
- "denumire": numele analizei exact ca pe buletin (ex: „Glicemie", „Colesterol seric total", „(WBC) Leucocite").
- "rezultat": valoarea rezultatului ca text (ex: „126.13", „Negativ", „Normal", „Prezent E.coli >100.000 UFC/ml").
- "um": unitatea de măsură dacă apare (ex: „mg/dl", „%", „mmol/L"); altfel null.
- "interval": intervalul biologic de referință dacă apare (ex: „60 - 105", „< 220", „Negativ"); altfel null.
- "flag": „ridicat" dacă valoarea depășește limita maximă (adesea marcat cu săgeată în sus), „scazut" dacă e sub limita minimă, „normal" dacă e în interval, null dacă nu se poate stabili.

Include toate analizele, inclusiv componentele hemoleucogramei, biochimie, sumar de urină etc.
NU inventa valori. Dacă un câmp lipsește, pune null.

Extrage și medicul care a VALIDAT/VERIFICAT (nu medicul trimițător):
- "doctor_nume": numele medicului validator / șef de laborator (ex: „Dr. Ene Carmen"), sau null.
- "parafa": codul parafei de lângă nume/ștampilă (ex: „A16026", „457104", „C 44384"), sau null.

Răspunde DOAR cu JSON valid, fără alt text, fără code blocks. Format:
{
  "doctor_nume": "string sau null",
  "parafa": "string sau null",
  "rezultate": [
    { "denumire": "...", "rezultat": "...", "um": "... sau null", "interval": "... sau null", "flag": "ridicat|scazut|normal sau null" }
  ]
}`;

function sleep(ms: number) { return new Promise((r) => setTimeout(r, ms)); }
function backoff(attempt: number): number { return 400 * Math.pow(2, attempt) + Math.floor(Math.random() * 600); }
function jsonResponse(obj: unknown, status: number): Response {
  return new Response(JSON.stringify(obj), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
}

async function callModel(model: string, fileBase64: string, mediaType: string, apiKey: string): Promise<any> {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;

  const genConfig: Record<string, unknown> = {
    temperature: 0,
    maxOutputTokens: 12000,
    responseMimeType: "application/json",
  };
  // IMPORTANT: dezactivează "thinking" pe modelele 2.5, altfel gândirea
  // consumă bugetul de tokeni și JSON-ul iese gol/trunchiat.
  if (model.indexOf("gemini-2.5") === 0) {
    genConfig.thinkingConfig = { thinkingBudget: 0 };
  }

  const reqBody = JSON.stringify({
    contents: [{ parts: [
      { inline_data: { mime_type: mediaType, data: fileBase64 } },
      { text: PROMPT },
    ] }],
    generationConfig: genConfig,
  });

  let lastErr = "";
  for (let attempt = 1; attempt <= MAX_RETRIES_PER_MODEL; attempt++) {
    let resp: Response;
    try {
      resp = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: reqBody });
    } catch (e) { lastErr = `network: ${e}`; await sleep(backoff(attempt)); continue; }

    if (resp.ok) {
      const data = await resp.json();
      const parts = data?.candidates?.[0]?.content?.parts;
      if (!parts || !parts.length) {
        console.warn(`[ocr-rezultat] ${model} finishReason=${data?.candidates?.[0]?.finishReason}`);
        throw new Error("Gemini: continut gol (finishReason=" + (data?.candidates?.[0]?.finishReason || "?") + ")");
      }
      let text = parts.map((p: any) => p.text || "").join("\n").trim();
      text = text.replace(/^```(?:json)?\s*/i, "").replace(/\s*```\s*$/, "").trim();
      const parsed = JSON.parse(text);
      console.log(`[ocr-rezultat] ${model} → ${Array.isArray(parsed.rezultate) ? parsed.rezultate.length : 0} rezultate, medic=${parsed.doctor_nume || "-"}`);
      return parsed;
    }

    const status = resp.status;
    const errText = (await resp.text()).substring(0, 250);
    lastErr = `${status}: ${errText}`;
    if (status === 503 || status === 429 || status === 500) { await sleep(backoff(attempt)); continue; }
    throw new Error(`Gemini ${status}: ${errText}`);
  }
  throw new Error(`OVERLOADED:${model}:${lastErr}`);
}

function normRezultate(arr: any): any[] {
  if (!Array.isArray(arr)) return [];
  return arr
    .filter((r) => r && (r.denumire || r.rezultat))
    .map((r) => ({
      denumire: r.denumire || "",
      rezultat: r.rezultat != null ? String(r.rezultat) : "",
      um: r.um || null,
      interval: r.interval || null,
      flag: r.flag || null,
    }));
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return jsonResponse({ error: "Method not allowed" }, 405);

  try {
    const { fileBase64, mediaType } = await req.json();
    if (!fileBase64) return jsonResponse({ error: "fileBase64 lipseste" }, 400);
    const apiKey = Deno.env.get("GEMINI_API_KEY");
    if (!apiKey) return jsonResponse({ error: "GEMINI_API_KEY nu e setat" }, 500);
    const mime = mediaType || "application/pdf";

    let lastError = "";
    for (const model of MODELS) {
      let parsed: any;
      try {
        parsed = await callModel(model, fileBase64, mime, apiKey);
      } catch (e) {
        const msg = String((e as any)?.message || e);
        lastError = msg;
        if (msg.startsWith("OVERLOADED:")) continue;
        return jsonResponse({ doctor_nume: null, parafa: null, rezultate: [], warn: msg }, 200);
      }
      return jsonResponse({
        doctor_nume: parsed.doctor_nume || null,
        parafa: parsed.parafa || null,
        rezultate: normRezultate(parsed.rezultate),
      }, 200);
    }
    return jsonResponse({ doctor_nume: null, parafa: null, rezultate: [], overloaded: true, detail: lastError }, 200);

  } catch (e) {
    return jsonResponse({ doctor_nume: null, parafa: null, rezultate: [], error: String((e as any)?.message || e) }, 200);
  }
});

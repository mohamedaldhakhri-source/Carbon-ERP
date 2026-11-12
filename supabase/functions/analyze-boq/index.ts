// Reads a BOQ (PDF, image, or spreadsheet text) with Claude, assigns each item to a department,
// and drafts a project timeline. Only the system admin, owner and general manager may call it.
// Needs the ANTHROPIC_API_KEY secret on the Supabase project.
import Anthropic from "npm:@anthropic-ai/sdk@1.3.0";
import { createClient } from "npm:@supabase/supabase-js@2.45.4";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });

// The browser splits big files into small parts so each call stays well inside the Edge Function time limit.
const MODEL = "claude-opus-5-5";
const DEPTS = ["arch", "interior", "fitout", "joinery", "contracting", "supervision"];
const DEPT_GUIDE = `Company departments (use these exact keys):
- arch: architectural design, drawings, permits, authority approvals, design studies.
- interior: interior design concepts, finishes selection, FF&E design, 3D visuals.
- fitout: interior fit-out works on site: gypsum, partitions, ceilings, flooring, painting, cladding, glazing, MEP fit-out, furniture installation.
- joinery: carpentry workshop items: doors, wardrobes, cabinets, counters, wooden panelling, custom furniture made in the workshop.
- contracting: civil and structural construction: excavation, concrete, blockwork, steel structure, plaster, waterproofing, external works, infrastructure, main MEP installation.
- supervision: site supervision, consultancy, project management, inspections, testing and commissioning, handover documentation.`;

const ITEM_PROPS = {
  code: { type: "string", description: "Item number exactly as written in the BOQ, e.g. 3.12" },
  section_code: { type: "string", description: "Code of the section this item belongs to" },
  description: { type: "string", description: "Item description in the BOQ's own language, shortened only if very long" },
  qty: { type: "number" },
  unit: { type: "string" },
  rate: { type: "number", description: "Unit rate; 0 if not given" },
  total: { type: "number", description: "Line total; qty*rate if not given" },
  dept: { type: "string", enum: DEPTS },
};
const EXTRACT_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["sections", "items", "stated_total", "currency", "notes"],
  properties: {
    sections: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["code", "name"],
        properties: { code: { type: "string" }, name: { type: "string" } },
      },
    },
    items: {
      type: "array",
      items: { type: "object", additionalProperties: false, required: Object.keys(ITEM_PROPS), properties: ITEM_PROPS },
    },
    stated_total: { type: "number", description: "Grand total before VAT as printed in the document; 0 if absent" },
    currency: { type: "string" },
    notes: { type: "string", description: "Short Arabic notes for the reviewer: unreadable parts, totals that do not add up, assumptions. Empty if none." },
  },
};
const CLASSIFY_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["items"],
  properties: {
    items: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["code", "dept"],
        properties: { code: { type: "string" }, dept: { type: "string", enum: DEPTS } },
      },
    },
  },
};
const SCHEDULE_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["tasks", "notes"],
  properties: {
    tasks: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["name", "start_date", "end_date", "dept", "is_phase"],
        properties: {
          name: { type: "string", description: "Arabic task or phase name" },
          start_date: { type: "string", description: "YYYY-MM-DD" },
          end_date: { type: "string", description: "YYYY-MM-DD" },
          dept: { type: "string", enum: [...DEPTS, "general"] },
          is_phase: { type: "boolean", description: "true for a phase header row that groups the tasks after it" },
        },
      },
    },
    notes: { type: "string", description: "Short Arabic notes for the general manager: key assumptions, risks, tight durations." },
  },
};

type Body = {
  mode: "extract" | "classify" | "schedule";
  file?: { name?: string; mime: string; data: string }; // base64
  text?: string;
  items?: { code: string; description: string; section?: string }[];
  project?: { name?: string; type?: string; start_date: string; end_date: string; depts?: string[]; location?: string };
  part?: { n: number; of: number };
  sections?: { code: string; name: string; total: number; items: number; depts: string[] }[];
};

async function ask(client: Anthropic, system: string, content: Anthropic.ContentBlockParam[], schema: Record<string, unknown>, effort: "low" | "medium") {
  const stream = client.messages.stream({
    model: MODEL,
    max_tokens: 32000,
    thinking: { type: "adaptive" },
    output_config: { effort, format: { type: "json_schema", schema } },
    system,
    messages: [{ role: "user", content }],
  });
  const msg = await stream.finalMessage();
  if (msg.stop_reason === "refusal") throw new Error("رفض النموذج قراءة هذا الملف");
  if (msg.stop_reason === "max_tokens") throw new Error("الملف كبير جداً، قسّمه لأجزاء وحاول مرة ثانية");
  const text = msg.content.map((b) => (b.type === "text" ? b.text : "")).join("");
  return { data: JSON.parse(text), usage: msg.usage };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  try {
    const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
      auth: { persistSession: false },
    });
    const token = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
    const { data: who, error: whoErr } = await admin.auth.getUser(token);
    if (whoErr || !who?.user) return json({ error: "سجّل دخول أولاً" }, 401);
    const { data: me } = await admin.from("profiles").select("role").eq("id", who.user.id).single();
    if (!me || !["admin", "owner", "gm"].includes(me.role)) return json({ error: "التحليل الذكي لمدير النظام وصاحب الشركة والمدير العام" }, 403);

    const apiKey = Deno.env.get("ANTHROPIC_API_KEY");
    if (!apiKey) return json({ error: "التحليل الذكي غير مفعّل بعد: مفتاح Claude API غير مضاف في Supabase" }, 503);
    const client = new Anthropic({ apiKey });

    const body = (await req.json()) as Body;

    if (body.mode === "extract") {
      const content: Anthropic.ContentBlockParam[] = [];
      if (body.file?.data) {
        const mime = body.file.mime;
        if (body.file.data.length > 14_000_000) return json({ error: "حجم الملف أكبر من 10 ميجا" }, 400);
        if (mime === "application/pdf") {
          content.push({ type: "document", source: { type: "base64", media_type: "application/pdf", data: body.file.data } });
        } else if (["image/png", "image/jpeg", "image/webp", "image/gif"].includes(mime)) {
          content.push({ type: "image", source: { type: "base64", media_type: mime as "image/png", data: body.file.data } });
        } else return json({ error: "نوع الملف غير مدعوم. ارفع PDF أو Excel أو صورة" }, 400);
      }
      if (body.text?.trim()) content.push({ type: "text", text: "<boq_sheet>\n" + body.text.slice(0, 400_000) + "\n</boq_sheet>" });
      if (!content.length) return json({ error: "ارفع ملف BOQ أولاً" }, 400);
      content.push({
        type: "text",
        text: (body.part && body.part.of > 1 ? `This is part ${body.part.n} of ${body.part.of} of a longer BOQ. Extract only what is on this part. If an item's section header is not in this part, use the item number's prefix before the first dot as section_code. ` : "") +
          "Extract every priced line item of this Bill of Quantities, in document order, with its section, and assign each item to the one department that will deliver it. Section header rows go in sections, not items. Keep numbers exactly as printed (no rounding, no thousands separators). If a line has a total but no quantity, use qty 1. Skip subtotal, VAT and grand-total rows. Write notes in Arabic, and leave notes empty if there is nothing worth flagging.",
      });
      const { data, usage } = await ask(client,
        "You read construction and fit-out BOQs for Carbon Engineering, a company in Oman.\n" + DEPT_GUIDE,
        content, EXTRACT_SCHEMA, "low");
      return json({ ...data, usage });
    }

    if (body.mode === "classify") {
      const items = (body.items || []).slice(0, 2000);
      if (!items.length) return json({ error: "لا توجد بنود" }, 400);
      const list = items.map((i) => `${i.code}\t${i.section || ""}\t${i.description}`).join("\n");
      const { data, usage } = await ask(client,
        "You assign BOQ items to departments for Carbon Engineering, a company in Oman.\n" + DEPT_GUIDE,
        [{ type: "text", text: "Assign every item below (code, section, description) to one department. Return every code exactly once.\n<items>\n" + list + "\n</items>" }],
        CLASSIFY_SCHEMA, "low");
      return json({ ...data, usage });
    }

    if (body.mode === "schedule") {
      const p = body.project;
      if (!p?.start_date || !p?.end_date) return json({ error: "حدد تاريخ البداية والتسليم" }, 400);
      const secs = (body.sections || []).map((s) => `${s.code}\t${s.name}\t${s.items} items\t${Math.round(s.total)} OMR\tdepts: ${s.depts.join(",")}`).join("\n");
      const { data, usage } = await ask(client,
        "You are a senior planning engineer at Carbon Engineering in Oman. You draft realistic project timelines that the general manager will review and adjust.\n" + DEPT_GUIDE,
        [{
          type: "text",
          text: `Draft the timeline for this project.
Project: ${p.name || ""} (${p.type === "gov" ? "government" : "private"} client)${p.location ? `, location: ${p.location}` : ""}
Start: ${p.start_date}. Contract handover: ${p.end_date}.
Departments on the project: ${(p.depts || []).join(", ") || "not set"}
BOQ sections (code, name, item count, value, departments):
${secs || "(no BOQ)"}

Rules:
- Group the work into phases (is_phase true, dept "general") in a sensible order, e.g. mobilization and approvals, design, procurement and long-lead items, workshop fabrication, site works by trade, testing, snagging and handover. Each phase is followed by its tasks.
- Each task has one responsible department from the list above; use only departments on the project, or "general" for phases.
- Give bigger sections proportionally more time, overlap tasks where trades can run in parallel, allow procurement lead time before installation, and leave about 5% of the duration before handover for snagging.
- Every date must fall between the start and handover dates, with start_date <= end_date.
- 10 to 30 rows in total. Names in Arabic, short.`,
        }],
        SCHEDULE_SCHEMA, "medium");
      const s = p.start_date, e = p.end_date;
      data.tasks = (data.tasks || []).map((t: { start_date: string; end_date: string; dept: string }) => {
        const a = t.start_date < s ? s : t.start_date > e ? e : t.start_date;
        let b = t.end_date > e ? e : t.end_date < a ? a : t.end_date;
        if (b < a) b = a;
        return { ...t, start_date: a, end_date: b, dept: DEPTS.includes(t.dept) ? t.dept : null };
      });
      return json({ ...data, usage });
    }

    return json({ error: "طلب غير معروف" }, 400);
  } catch (e) {
    const err = e as { status?: number; message?: string };
    if (err.status === 401) return json({ error: "مفتاح Claude API غير صحيح" }, 502);
    if (err.status === 429) return json({ error: "ضغط على خدمة الذكاء الاصطناعي، حاول بعد دقيقة" }, 502);
    if (err.status === 400 && /credit|balance/i.test(err.message || "")) return json({ error: "رصيد Claude API خلص، اشحن الرصيد من console.anthropic.com" }, 502);
    console.error(e);
    return json({ error: "تعذّر التحليل: " + (err.message || String(e)).slice(0, 300) }, 500);
  }
});

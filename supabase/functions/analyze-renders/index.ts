// Reads the interior-design renders of one area of a building (the pictures in a design presentation)
// and returns its finishes: floor, walls, ceiling, glass frames, furniture colours, plants and light.
// The 3D viewer paints the walkable model with them. Each area is read once and kept on the document
// (project_docs.look), so the cost is paid only the first time.
// Only the system admin, owner and general manager may start a reading; everyone sees the saved result.
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

const MODEL = "claude-opus-5-5";
const COLOR = { type: "string", description: "Colour as #rrggbb, as it looks in the render" };
const OPT_COLOR = { type: "string", description: "#rrggbb, or empty string if there is none" };
const WALL_MATS = ["paint", "wood_slats", "wood_panel", "tile", "concrete", "wallpaper", "stone", "glass"];
const LOOK_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["room_ar", "floor", "walls", "ceiling", "glass_frame", "furniture", "plants", "light", "notes_ar"],
  properties: {
    room_ar: { type: "string", description: "Short Arabic name of the space" },
    floor: {
      type: "object", additionalProperties: false,
      required: ["material", "color", "accent_color", "accent_share"],
      properties: {
        material: { type: "string", enum: ["carpet", "tile", "polished_concrete", "terrazzo", "wood", "vinyl", "marble", "epoxy"] },
        color: COLOR,
        accent_color: { ...OPT_COLOR, description: "A second floor colour used in bands or zones (e.g. a coloured walkway), #rrggbb or empty" },
        accent_share: { type: "number", description: "Share of the floor in the accent colour, 0 to 1" },
      },
    },
    walls: {
      type: "object", additionalProperties: false,
      required: ["color", "material", "accent_color", "accent_material", "accent_share"],
      properties: {
        color: { ...COLOR, description: "Main wall colour, #rrggbb" },
        material: { type: "string", enum: WALL_MATS },
        accent_color: { ...OPT_COLOR, description: "Feature wall colour (painted wall, wood cladding...), #rrggbb or empty" },
        accent_material: { type: "string", enum: WALL_MATS },
        accent_share: { type: "number", description: "Share of the solid walls in the feature finish, 0 to 1" },
      },
    },
    ceiling: {
      type: "object", additionalProperties: false,
      required: ["type", "color"],
      properties: { type: { type: "string", enum: ["exposed", "gypsum", "grid", "slats"] }, color: COLOR },
    },
    glass_frame: { ...COLOR, description: "Colour of the glass partition frames, #rrggbb" },
    furniture: {
      type: "object", additionalProperties: false,
      required: ["chair", "table", "desk", "sofa", "armchair", "cabinet", "screen"],
      properties: {
        chair: { ...OPT_COLOR, description: "Seat/back colour of task or meeting chairs" },
        table: { ...OPT_COLOR, description: "Table top colour" },
        desk: { ...OPT_COLOR, description: "Desk top colour" },
        sofa: { ...OPT_COLOR, description: "Sofa upholstery colour" },
        armchair: { ...OPT_COLOR, description: "Lounge chair upholstery colour" },
        cabinet: { ...OPT_COLOR, description: "Cabinet / shelving colour" },
        screen: { ...OPT_COLOR, description: "Desk divider screen colour" },
      },
    },
    plants: { type: "integer", description: "How much greenery: 0 none, 1 a few pots, 2 planters, 3 a lot" },
    light: { type: "string", enum: ["warm", "neutral", "cool"] },
    notes_ar: { type: "string", description: "One or two short Arabic sentences describing the finishes, for the client" },
  },
};

type Body = {
  mode?: "ping" | "area";
  doc_id?: string;
  key?: string;
  title?: string;
  images?: string[]; // base64 JPEG, at most 4, about 1000 px wide
  force?: boolean;
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  try {
    const env = Deno.env.toObject();
    const keyName = Object.keys(env).find((k) => k.trim().toUpperCase() === "ANTHROPIC_API_KEY" && env[k].trim()) ||
      Object.keys(env).find((k) => env[k].trim().startsWith("sk-ant-"));
    const apiKey = keyName ? env[keyName].trim() : "";
    const body = (await req.json().catch(() => ({}))) as Body;

    // A free check that the key is there and valid (lists models, no tokens used).
    if (body.mode === "ping") {
      if (!apiKey) return json({ ok: false, error: "no_key" });
      try {
        const r = await fetch("https://api.anthropic.com/v1/models?limit=1", { headers: { "x-api-key": apiKey, "anthropic-version": "2023-06-01" } });
        return json({ ok: r.ok, status: r.status });
      } catch (e) {
        return json({ ok: false, error: String(e).slice(0, 100) });
      }
    }

    const admin = createClient(env.SUPABASE_URL!, env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });
    const token = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
    const { data: who, error: whoErr } = await admin.auth.getUser(token);
    if (whoErr || !who?.user) return json({ error: "سجّل دخول أولاً" }, 401);
    const { data: me } = await admin.from("profiles").select("role").eq("id", who.user.id).single();
    if (!me || !["admin", "owner", "gm"].includes(me.role)) return json({ error: "تحليل التصميم الداخلي لمدير النظام وصاحب الشركة والمدير العام" }, 403);

    const key = String(body.key || "").slice(0, 120), docId = String(body.doc_id || "");
    if (!docId || !key) return json({ error: "طلب ناقص" }, 400);
    const { data: doc } = await admin.from("project_docs").select("id, look").eq("id", docId).single();
    if (!doc) return json({ error: "المستند غير موجود" }, 404);
    const saved = doc.look && doc.look[key];
    if (saved && !body.force) return json({ look: saved, cached: true });

    if (!apiKey) return json({ error: "مفتاح Claude API غير موجود في Supabase (السر ANTHROPIC_API_KEY)" }, 503);
    const imgs = (body.images || []).filter((s) => typeof s === "string" && s.length > 1000 && s.length < 3_000_000).slice(0, 4);
    if (!imgs.length) return json({ error: "ما في صور" }, 400);

    const client = new Anthropic({ apiKey });
    const content: Anthropic.ContentBlockParam[] = imgs.map((data) => ({ type: "image", source: { type: "base64", media_type: "image/jpeg", data } }));
    content.push({
      type: "text",
      text: `These ${imgs.length > 1 ? imgs.length + " renders show" : "render shows"} one area of an interior design${body.title ? `, titled "${String(body.title).slice(0, 120)}" in the presentation` : ""}.
Read the finishes so a simple 3D model of the same space can be painted to look like it:
- floor: the main floor finish and colour; if a second colour forms bands or zones (a coloured walkway, a rug zone), give it as the accent with its share of the floor.
- walls: the main solid wall colour and finish, and any feature finish (a strongly coloured painted wall, wood slats...) with its share of the solid walls. Glass partitions are not walls.
- ceiling: exposed services, plain gypsum, a tile grid or slats, and its colour.
- glass_frame: the colour of the frames of glass partitions (if there are none, the colour of door frames).
- furniture: the main colour of each kind of piece that appears; empty string for pieces that do not appear.
- plants, light colour, and one or two short Arabic sentences describing the look.
Give colours as they appear under the render's lighting, but not darkened by shadow.`,
    });
    const stream = client.messages.stream({
      model: MODEL,
      max_tokens: 8000,
      thinking: { type: "adaptive" },
      output_config: { effort: "low", format: { type: "json_schema", schema: LOOK_SCHEMA } },
      system: "You are an interior designer at Carbon Engineering in Oman. You read design renders and describe their finishes precisely.",
      messages: [{ role: "user", content }],
    });
    const msg = await stream.finalMessage();
    if (msg.stop_reason === "refusal") return json({ error: "رفض النموذج قراءة الصور" }, 502);
    const text = msg.content.map((b) => (b.type === "text" ? b.text : "")).join("");
    const look = { ...JSON.parse(text), title: body.title || "", at: new Date().toISOString() };
    await admin.rpc("doc_look_put", { p_doc: docId, p_key: key, p_val: look });
    return json({ look, usage: msg.usage });
  } catch (e) {
    const err = e as { status?: number; message?: string };
    if (err.status === 401) return json({ error: "مفتاح Claude API غير صحيح" }, 502);
    if (err.status === 429) return json({ error: "ضغط على خدمة الذكاء الاصطناعي، حاول بعد دقيقة" }, 502);
    if (err.status === 400 && /credit|balance/i.test(err.message || "")) return json({ error: "رصيد Claude API خلص، اشحن الرصيد من console.anthropic.com" }, 502);
    console.error(e);
    return json({ error: "تعذّر التحليل: " + (err.message || String(e)).slice(0, 300) }, 500);
  }
});

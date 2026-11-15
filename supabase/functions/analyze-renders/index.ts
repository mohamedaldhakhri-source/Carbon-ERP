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

// A building as data: what the 3D viewer builds (layout.js). Metres, x to the right, y down the drawing.
const N = { type: "number" };
const FLOOR_MATS = ["carpet", "tile", "polished_concrete", "terrazzo", "wood", "vinyl", "marble", "epoxy"];
const FURN = ["sofa", "majlis_seating", "armchair", "chair", "office_chair", "dining_table", "coffee_table", "side_table", "round_table", "desk", "bed", "wardrobe", "kitchen_counter", "island", "bar_stool", "tv_unit", "toilet", "basin", "shower", "bathtub", "sunbed", "plant", "cabinet"];
const obj = (props: Record<string, unknown>) => ({ type: "object", additionalProperties: false, required: Object.keys(props), properties: props });
const STOREY = {
  name_ar: { type: "string" },
  height: { type: "number", description: "Floor to ceiling, metres (3.2 to 3.6 if not shown)" },
  walls: { type: "array", description: "Every wall as a straight centre line along x or along y, from end to end through door and window openings", items: obj({ x0: N, y0: N, x1: N, y1: N, t: { type: "number", description: "thickness, metres" } }) },
  openings: { type: "array", description: "Doors, windows and glass on the walls: the segment of the wall centre line they occupy", items: obj({ type: { type: "string", enum: ["door", "double_door", "sliding", "window", "glass"] }, x0: N, y0: N, x1: N, y1: N }) },
  rooms: { type: "array", items: obj({ name_ar: { type: "string" }, x0: N, y0: N, x1: N, y1: N, floor: obj({ material: { type: "string", enum: FLOOR_MATS }, color: { type: "string", description: "#rrggbb" } }), wall_color: { type: "string", description: "#rrggbb" } }) },
};
const STRUCTURE_SCHEMA = obj({
  title: { type: "string", description: "Short Arabic name of the building" },
  scale_note: { type: "string", description: "One short English sentence: how the metres were worked out (which dimensions were used, any contradictions)" },
  storeys: { type: "array", items: obj(STOREY) },
  outdoor: { type: "array", items: obj({ type: { type: "string", enum: ["pool", "deck", "lawn", "paving", "pergola"] }, x0: N, y0: N, x1: N, y1: N }) },
});
const FURNITURE_SCHEMA = obj({
  pieces: { type: "array", items: obj({ storey: { type: "integer" }, type: { type: "string", enum: FURN }, x: N, y: N, w: N, d: N, facing: { type: "string", enum: ["n", "s", "e", "w"], description: "where the front faces: n = up the drawing (smaller y)" }, color: { type: "string", description: "#rrggbb, or empty" } }) },
});

type Body = {
  mode?: "ping" | "area" | "plan" | "design";
  brief?: string;
  part?: "structure" | "furniture";
  text?: string;
  structure?: unknown;
  doc_id?: string;
  key?: string;
  title?: string;
  images?: string[]; // base64 JPEG, at most 4, about 1000 px wide
  force?: boolean;
};

// Reads a floor plan picture (any drawing style) into the building data the viewer builds, and keeps it on the document.
// Two calls from the browser, so each stays inside the function time limit: first the building (walls, openings, rooms,
// outdoor), then the furniture placed in that same frame.
// deno-lint-ignore no-explicit-any
async function readPlan(admin: any, apiKey: string, body: Body) {
  const docId = String(body.doc_id || ""), part = body.part === "furniture" ? "furniture" : "structure", design = body.mode === "design";
  if (!docId) return json({ error: "طلب ناقص" }, 400);
  const { data: doc } = await admin.from("project_docs").select("id, look").eq("id", docId).single();
  if (!doc) return json({ error: "المستند غير موجود" }, 404);
  if (part === "structure" && doc.look?.layout && !body.force) return json({ layout: doc.look.layout, cached: true });
  if (!apiKey) return json({ error: "مفتاح الـ AI غير موجود في Supabase (السر ANTHROPIC_API_KEY)" }, 503);
  const imgs = (body.images || []).filter((s) => typeof s === "string" && s.length > 1000 && s.length < 4_000_000).slice(0, 4);
  if (!imgs.length && !design) return json({ error: "ما في صور" }, 400);
  const brief = String(body.brief || doc.look?.brief || "").slice(0, 3000);
  if (design && !brief) return json({ error: "اكتب وصف المشروع" }, 400);
  const client = new Anthropic({ apiKey });
  const content: Anthropic.ContentBlockParam[] = imgs.map((data) => ({ type: "image", source: { type: "base64", media_type: "image/jpeg", data } }));
  const pageText = body.text ? `Text found on the pages:\n<page_text>\n${String(body.text).slice(0, 12000)}\n</page_text>\n\n` : "";
  // deno-lint-ignore no-explicit-any
  const base: any = part === "furniture" ? body.structure : null;
  if (part === "furniture" && !base?.storeys) return json({ error: "طلب ناقص" }, 400);
  content.push({
    type: "text",
    text: design && part === "structure"
      ? `Design a building for this brief from a client of Carbon Engineering in Oman:
<brief>
${brief}
</brief>
Give the design as data so a 3D model can be built from it:
- Coordinates in metres, x to the right, y down the plan (y = 0 is the north side), origin at the top-left corner of the building.
- Respect the plot size, areas and rooms asked for; where the brief is silent, choose what suits an Omani family: a guest majlis with its own entrance and guest toilet near it, family living away from guests, bedrooms with their own bathrooms where the area allows, a kitchen with a door to the outside service area. Realistic sizes: bedrooms 4 x 4.5 m or more, majlis 5 x 7 m or more, corridors 1.2 m or more, bathrooms 2 x 2.5 m or more.
- walls: every wall (outer 0.25 m, inner 0.15 m) as a centre line along x or y, running through openings, meeting at corners. Rooms must be closed by walls, with doors to reach every room.
- openings: doors (0.9 m, main entrances 1.2-1.6 m as double_door), sliding glass doors to terraces, and windows on outer walls of rooms (1.2-2.0 m), as the segment of the wall centre line they occupy.
- rooms: each room with its Arabic name, its rectangle inside the walls, a floor finish and colour for its use, and a wall colour (warm, calm palette).
- outdoor: what the brief asks for outside (pool, deck, lawn, paving, pergola), within the plot.
- title: a short Arabic name; scale_note: one sentence on the main design idea.
Only one storey unless the brief asks for more; if it does, give each storey with the stair on both.`
      : part === "structure"
      ? `${pageText}These pages hold an architectural floor plan (other pages may show 3D views or schedules of the same building; use them to understand it).
Describe the building as data so a 3D model can be built from it:
- Coordinates in metres, x to the right, y down the plan, origin at the top-left corner of the building. Use the written dimensions for the scale. If written dimensions contradict each other or the drawing, keep the drawing's proportions and scale it so the overall dimensions match; say so in scale_note.
- walls: every wall (outer and inner) as a centre line along x or y with its thickness, running through openings. Outer walls usually 0.2-0.3 m, inner 0.1-0.2 m. Walls must meet at corners.
- openings: each door, double door, sliding glass door, window or fixed glass wall, as the segment of the wall centre line it occupies.
- rooms: each room or space with its Arabic name and its rectangle (inside the walls), a realistic floor finish and colour for its use (bathrooms tile, living areas porcelain or wood, majlis carpet...), and a wall colour.
- outdoor: pool, deck, lawn, paving or pergola rectangles outside the walls, same coordinates.
Only one storey unless the drawing shows more.`
      : design ? `This building was designed for the brief below; its walls, openings and rooms are in this data (metres, x to the right, y down the plan, origin at the top-left corner of the building):
<brief>
${brief}
</brief>
<building>
${JSON.stringify({ storeys: base.storeys.map((s: { name_ar: string; rooms: unknown; walls: unknown; openings: unknown }) => ({ name_ar: s.name_ar, rooms: s.rooms, walls: s.walls, openings: s.openings })), outdoor: base.outdoor }).slice(0, 60000)}
</building>
Furnish it fully and realistically for the brief, storey by storey (storey index from 0): majlis seating along the majlis walls, sofas, armchairs, coffee and dining tables with chairs, beds with wardrobes, kitchen counters along kitchen walls (and an island if the kitchen is big), TV units, toilets, basins, showers or bathtubs in every bathroom, sunbeds and plants outside. Give each piece its centre, its size along x (w) and y (d), and the side its front faces: kitchen counters face into the kitchen, beds face away from the headboard (headboard against a wall), chairs face their table, sofas face the room. Pieces must sit inside their room, not cross walls, and leave doorways and paths clear (at least 0.9 m). Give each piece a colour (#rrggbb) that suits a warm, modern Omani interior.`
      : `${pageText}These pages hold an architectural floor plan. Its walls, openings and rooms have already been read into this data (metres, x to the right, y down the plan, origin at the top-left corner of the building):
<building>
${JSON.stringify({ storeys: base.storeys.map((s: { name_ar: string; rooms: unknown; walls: unknown; openings: unknown }) => ({ name_ar: s.name_ar, rooms: s.rooms, walls: s.walls, openings: s.openings })), outdoor: base.outdoor }).slice(0, 60000)}
</building>
List every piece of furniture and every fixture drawn on the plan, in that same coordinate frame, storey by storey (storey index from 0): sofas, majlis seating, armchairs, beds, wardrobes, dining and coffee tables, chairs, desks, kitchen counters and island, bar stools, TV units, toilets, basins, showers, bathtubs, sunbeds, plants. Give each its centre, its size along x (w) and y (d), and the side its front faces: kitchen counters face into the kitchen, beds face away from the headboard, chairs face their table, sofas face the room. Pieces must sit inside their room and not cross walls. Add a colour (#rrggbb) only where the drawing or 3D views show one; otherwise an empty string.`,
  });
  const stream = client.messages.stream({
    model: MODEL,
    max_tokens: 32000,
    thinking: { type: "adaptive" },
    output_config: { effort: "low", format: { type: "json_schema", schema: part === "structure" ? STRUCTURE_SCHEMA : FURNITURE_SCHEMA } },
    system: design ? "You are a senior architect and interior designer at Carbon Engineering in Oman. You design practical, beautiful homes and describe them precisely as data." : "You are an architect at Carbon Engineering in Oman. You read floor plans precisely and describe them as data.",
    messages: [{ role: "user", content }],
  });
  const msg = await stream.finalMessage();
  if (msg.stop_reason === "refusal") return json({ error: "رفض الـ AI قراءة المخطط" }, 502);
  if (msg.stop_reason === "max_tokens") return json({ error: "المخطط كبير جداً على قراءة وحدة" }, 502);
  const data = JSON.parse(msg.content.map((b) => (b.type === "text" ? b.text : "")).join(""));
  console.log("analyze-renders plan", part, "tokens in", msg.usage.input_tokens, "out", msg.usage.output_tokens);
  let layout;
  if (part === "structure") layout = { ...data, ...(design ? { designed: true, brief } : {}), storeys: data.storeys.map((s: object) => ({ ...s, furniture: [] })), at: new Date().toISOString() };
  else {
    layout = { ...base, storeys: base.storeys.map((s: object, i: number) => ({ ...s, furniture: (data.pieces || []).filter((p: { storey: number }) => (p.storey || 0) === i).map(({ storey: _s, ...p }: { storey: number }) => p) })), at: new Date().toISOString() };
  }
  await admin.rpc("doc_look_put", { p_doc: docId, p_key: "layout", p_val: layout });
  return json({ layout, usage: msg.usage });
}

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
    if (!me || !["admin", "owner", "gm"].includes(me.role)) return json({ error: "ميزات الـ AI لمدير النظام وصاحب الشركة والمدير العام" }, 403);

    if (body.mode === "plan" || body.mode === "design") return await readPlan(admin, apiKey, body);

    const key = String(body.key || "").slice(0, 120), docId = String(body.doc_id || "");
    if (!docId || !key) return json({ error: "طلب ناقص" }, 400);
    const { data: doc } = await admin.from("project_docs").select("id, look").eq("id", docId).single();
    if (!doc) return json({ error: "المستند غير موجود" }, 404);
    const saved = doc.look && doc.look[key];
    if (saved && !body.force) return json({ look: saved, cached: true });

    if (!apiKey) return json({ error: "مفتاح الـ AI غير موجود في Supabase (السر ANTHROPIC_API_KEY)" }, 503);
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
    if (msg.stop_reason === "refusal") return json({ error: "رفض الـ AI قراءة الصور" }, 502);
    const text = msg.content.map((b) => (b.type === "text" ? b.text : "")).join("");
    const look = { ...JSON.parse(text), title: body.title || "", at: new Date().toISOString() };
    await admin.rpc("doc_look_put", { p_doc: docId, p_key: key, p_val: look });
    return json({ look, usage: msg.usage });
  } catch (e) {
    const err = e as { status?: number; message?: string };
    if (err.status === 401) return json({ error: "مفتاح الـ AI غير صحيح" }, 502);
    if (err.status === 429) return json({ error: "ضغط على خدمة الذكاء الاصطناعي، حاول بعد دقيقة" }, 502);
    if (err.status === 400 && /credit|balance/i.test(err.message || "")) return json({ error: "رصيد الـ AI خلص، اشحن الرصيد من console.anthropic.com" }, 502);
    console.error(e);
    return json({ error: "تعذّر التحليل: " + (err.message || String(e)).slice(0, 300) }, 500);
  }
});

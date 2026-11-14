// Lets the system admin create employees, reset their passwords, and delete them.
// Runs with the service role so it can use the auth admin API; the caller must be an admin.
import { createClient } from "npm:@supabase/supabase-js@2.45.4";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });

const ROLES = ["admin", "owner", "gm", "head", "site", "procurement", "qs", "finance"];
const DEPTS = ["arch", "interior", "fitout", "joinery", "contracting", "supervision"];

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
    if (!me || me.role !== "admin") return json({ error: "هذه العملية لمدير النظام فقط" }, 403);

    const body = await req.json();
    if (body.action === "create") {
      const email = String(body.email || "").trim().toLowerCase();
      const password = String(body.password || "");
      const full_name = String(body.full_name || "").trim();
      const role = String(body.role || "");
      const dept = body.dept ? String(body.dept) : null;
      if (!email || !full_name) return json({ error: "الاسم والبريد مطلوبين" }, 400);
      if (password.length < 6) return json({ error: "كلمة المرور لازم تكون 6 أحرف أو أكثر" }, 400);
      if (!ROLES.includes(role)) return json({ error: "اختر دور الموظف" }, 400);
      if (dept && !DEPTS.includes(dept)) return json({ error: "قسم غير معروف" }, 400);
      const { data, error } = await admin.auth.admin.createUser({
        email, password, email_confirm: true, user_metadata: { full_name },
      });
      if (error) return json({ error: /already/i.test(error.message) ? "هذا البريد مسجل من قبل" : error.message }, 400);
      const { error: pErr } = await admin.from("profiles").update({ role, dept, full_name }).eq("id", data.user.id);
      if (pErr) return json({ error: pErr.message }, 400);
      return json({ id: data.user.id });
    }
    if (body.action === "password") {
      const password = String(body.password || "");
      if (password.length < 6) return json({ error: "كلمة المرور لازم تكون 6 أحرف أو أكثر" }, 400);
      const { error } = await admin.auth.admin.updateUserById(String(body.id), { password });
      if (error) return json({ error: error.message }, 400);
      return json({ ok: true });
    }
    if (body.action === "delete") {
      if (body.id === who.user.id) return json({ error: "ما تقدر تحذف حسابك" }, 400);
      const { error } = await admin.auth.admin.deleteUser(String(body.id));
      if (error) return json({ error: /foreign key|violates/i.test(error.message) ? "الموظف عنده طلبات مسجلة. غيّر دوره إلى (بانتظار التفعيل) بدل الحذف لإيقاف دخوله." : error.message }, 400);
      return json({ ok: true });
    }
    return json({ error: "عملية غير معروفة" }, 400);
  } catch (e) {
    return json({ error: String((e as Error).message || e) }, 500);
  }
});

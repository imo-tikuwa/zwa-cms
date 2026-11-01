// The site's Worker. Static assets are served before it runs; it handles
// what is left: contact form submissions (POST /_zwa/forms/<id>, when the
// site has forms enabled) and everything else via the ASSETS binding.
//
// Bindings when forms are enabled: DB (the site's D1), TURNSTILE_SECRET.
// The Worker only reads `forms` and inserts into `form_submissions`.
//
// With Basic authentication on, BASIC_AUTH ("<user>:<salt>:<sha256>") is
// bound and the Worker runs before every request, assets included.

const MAX_BODY = 64 * 1024;
const LIMITS = { text: 200, email: 254, tel: 30, textarea: 5000, checkbox: 10 };
const CHOICES = ["select", "radio", "checkboxes"];
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const NONCE = /^[0-9a-f-]{36}$/;

export default {
  async fetch(request, env) {
    if (env.BASIC_AUTH && !(await authorized(request, env.BASIC_AUTH))) {
      return new Response("認証が必要です", {
        status: 401,
        headers: {
          "www-authenticate": 'Basic realm="site", charset="UTF-8"',
          "content-type": "text/plain; charset=utf-8",
          "cache-control": "no-store",
        },
      });
    }
    const url = new URL(request.url);
    if (url.pathname.startsWith("/_zwa/")) {
      const m = url.pathname.match(/^\/_zwa\/forms\/(\d+)$/);
      if (m && env.DB && env.TURNSTILE_SECRET) return submit(request, env, url, Number(m[1]));
      return new Response("Not Found", { status: 404 });
    }
    return env.ASSETS.fetch(request);
  },
};

async function authorized(request, secret) {
  const [user, salt, hash] = secret.split(":");
  const header = request.headers.get("authorization") || "";
  const m = header.match(/^Basic\s+(\S+)$/i);
  if (!m) return false;
  let given;
  try {
    // UTF-8, as announced by charset="UTF-8" above.
    given = new TextDecoder().decode(Uint8Array.from(atob(m[1]), (c) => c.charCodeAt(0)));
  } catch {
    return false;
  }
  const i = given.indexOf(":");
  if (i < 0 || given.slice(0, i) !== user) return false;
  const digest = new Uint8Array(
    await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`${salt}:${given.slice(i + 1)}`)),
  );
  const expected = Uint8Array.from(hash.match(/../g) ?? [], (h) => parseInt(h, 16));
  return expected.length === digest.length && crypto.subtle.timingSafeEqual(digest, expected);
}

const reply = (status, body) =>
  Response.json(body, { status, headers: { "cache-control": "no-store" } });
const fail = (status, error) => reply(status, { ok: false, error });

async function submit(request, env, url, formId) {
  if (request.method !== "POST") return fail(405, "POST で送信してください");
  // Only the site's own pages may post here.
  const origin = request.headers.get("origin");
  if (origin && origin !== url.origin) return fail(403, "このページからは送信できません");
  if (Number(request.headers.get("content-length") || 0) > MAX_BODY) {
    return fail(413, "入力が長すぎます");
  }

  let data;
  try {
    data = await request.formData();
  } catch {
    return fail(400, "送信内容を読み取れません");
  }
  // Honeypot: hidden from people, filled in by naive bots. Pretend success.
  if (data.get("_zwa_hp")) return reply(200, { ok: true });

  const nonce = String(data.get("_zwa_nonce") || "");
  if (!NONCE.test(nonce)) return fail(400, "ページを再読み込みしてから送信してください");

  const form = await env.DB.prepare("SELECT fields FROM forms WHERE id = ?1").bind(formId).first();
  if (!form) return fail(404, "このフォームは現在使われていません");

  let fields;
  try {
    fields = JSON.parse(form.fields);
  } catch {
    return fail(500, "フォームの設定が壊れています");
  }
  const values = [];
  for (const f of fields) {
    if (CHOICES.includes(f.type)) {
      // Only the form's own choices; checkboxes may send several.
      const picked = data.getAll(`f_${f.id}`).filter((v) => typeof v === "string" && v !== "");
      if (picked.some((v) => !(f.options ?? []).includes(v)) || (f.type !== "checkboxes" && picked.length > 1)) {
        return fail(400, `「${f.label}」の選択が正しくありません。ページを再読み込みしてください`);
      }
      if (f.required && picked.length === 0) return fail(400, `「${f.label}」を選んでください`);
      values.push({ label: f.label, value: picked.join("、") });
      continue;
    }
    const raw = data.get(`f_${f.id}`);
    const value = typeof raw === "string" ? raw.trim() : "";
    if (f.required && !value) {
      return fail(400, f.type === "checkbox" ? `「${f.label}」にチェックしてください` : `「${f.label}」を入力してください`);
    }
    if (value.length > (LIMITS[f.type] ?? LIMITS.text)) return fail(400, `「${f.label}」が長すぎます`);
    if (value && f.type === "email" && !EMAIL.test(value)) {
      return fail(400, `「${f.label}」のメールアドレスの形式が正しくありません`);
    }
    values.push({ label: f.label, value: f.type === "checkbox" ? (value ? "on" : "") : value });
  }

  // Tokens are single-use and expire after 5 minutes.
  const token = String(data.get("cf-turnstile-response") || "");
  if (!token || token.length > 2048) return fail(400, "確認が完了していません。もう一度お試しください");
  let verify = null;
  try {
    const res = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
      method: "POST",
      body: new URLSearchParams({
        secret: env.TURNSTILE_SECRET,
        response: token,
        remoteip: request.headers.get("cf-connecting-ip") || "",
      }),
    });
    verify = await res.json();
  } catch {
    // Treated as a failed check below.
  }
  if (!verify?.success || (verify.hostname && verify.hostname !== url.hostname)) {
    return fail(403, "確認に失敗しました。もう一度お試しください");
  }

  let page = null;
  try {
    const referer = new URL(request.headers.get("referer") || "");
    if (referer.origin === url.origin) page = referer.pathname.slice(0, 500);
  } catch {
    // No usable Referer.
  }
  // A resend of the same submission (e.g. after a lost response) is ignored.
  await env.DB.prepare(
    "INSERT INTO form_submissions (form_id, nonce, data, page_path) VALUES (?1, ?2, ?3, ?4) ON CONFLICT (nonce) DO NOTHING",
  )
    .bind(formId, nonce, JSON.stringify(values), page)
    .run();
  return reply(200, { ok: true });
}

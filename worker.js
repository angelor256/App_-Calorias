// Worker: sirve la app (assets) y expone POST /api/ai (Gemini), protegido con la sesión de Supabase.
const MODEL = 'gemini-2.5-flash';
const PROMPT = 'Eres nutricionista. Estima los valores nutricionales de lo que se describe o aparece en la imagen (una porción típica si no se indica cantidad). Responde SOLO JSON: {"name":string,"kcal":number,"protein":number,"carbs":number,"fat":number}. name en español.';

export default {
  async fetch(req, env) {
    const url = new URL(req.url);
    if (url.pathname !== '/api/ai') return env.ASSETS.fetch(req);
    const origin = req.headers.get('Origin') || '';
    const okOrigin = origin === url.origin || origin === 'https://angelor256.github.io';
    const cors = okOrigin ? { 'Access-Control-Allow-Origin': origin, 'Access-Control-Allow-Headers': 'Authorization, Content-Type', 'Access-Control-Allow-Methods': 'POST, OPTIONS', Vary: 'Origin' } : {};
    const json = (o, s = 200) => new Response(JSON.stringify(o), { status: s, headers: { 'Content-Type': 'application/json', ...cors } });
    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
    if (req.method !== 'POST') return json({ error: 'method' }, 405);
    if (origin && !okOrigin) return json({ error: 'origin' }, 403);

    // 1) validar sesión de Supabase
    const token = (req.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '');
    if (!token) return json({ error: 'no auth' }, 401);
    const u = await fetch(env.SUPABASE_URL + '/auth/v1/user', {
      headers: { Authorization: 'Bearer ' + token, apikey: env.SUPABASE_ANON_KEY },
    });
    if (!u.ok) return json({ error: 'invalid session' }, 401);

    // 2) llamar a Gemini
    let body; try { body = await req.json(); } catch { return json({ error: 'bad json' }, 400); }
    const parts = [{ text: PROMPT + (body.text ? '\nDescripción: ' + String(body.text).slice(0, 500) : '') }];
    if (body.image) {
      if (String(body.image).length > 4_000_000) return json({ error: 'image too large' }, 413);
      parts.push({ inline_data: { mime_type: body.mime || 'image/jpeg', data: body.image } });
    }
    const g = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-goog-api-key': env.GEMINI_API_KEY },
        body: JSON.stringify({ contents: [{ parts }], generationConfig: { responseMimeType: 'application/json' } }),
      });
    if (!g.ok) return json({ error: 'ai error', status: g.status }, 502);
    try {
      const t = (await g.json()).candidates[0].content.parts[0].text;
      const o = JSON.parse(t);
      return json({ name: String(o.name), kcal: +o.kcal, protein: +o.protein, carbs: +o.carbs, fat: +o.fat });
    } catch { return json({ error: 'bad ai response' }, 502); }
  },
};

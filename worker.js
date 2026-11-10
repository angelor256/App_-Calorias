// Worker: sirve la app (assets) y expone POST /api/ai (Gemini), protegido con la sesión de Supabase.
const MODEL = 'gemini-flash-latest';
const PROMPT = 'Eres nutricionista. Estima los valores nutricionales de lo que se describe o aparece en la imagen (una porción típica si no se indica cantidad). Responde SOLO JSON: {"name":string,"kcal":number,"protein":number,"carbs":number,"fat":number}. name en español.';








const PROMPT_L = 'Esta imagen es la tabla de información nutricional de un producto. Lee los valores POR PORCIÓN indicada (si solo aparece por 100 g o 100 ml, usa esa cantidad). Responde SOLO JSON: {"name":string (nombre del producto si se ve, si no "Producto"),"amount":number (tamaño de la porción, ej. 30),"unit":"g"|"ml"|"unidad"|"taza"|"cucharada"|"rebanada"|"porción","kcal":number,"protein":number,"carbs":number,"fat":number}. Solo números, sin unidades. name en español.';

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
    const u = await fetch((env.SUPABASE_URL || 'https://pcyatoxtwngpzbotrxxu.supabase.co') + '/auth/v1/user', {
      headers: { Authorization: 'Bearer ' + token, apikey: env.SUPABASE_ANON_KEY || 'sb_publishable_DpZuBk4uzmjcUvFJEvoEjw_oYBU1_lW' },
    });
    if (!u.ok) return json({ error: 'invalid session' }, 401);








    // 2) llamar a Gemini
    let body; try { body = await req.json(); } catch { return json({ error: 'bad json' }, 400); }
    const lab = body.mode === 'label';
    const parts = [{ text: lab ? PROMPT_L : PROMPT + (body.text ? '\nDescripción: ' + String(body.text).slice(0, 500) : '') }];
    if (body.image) {
      if (String(body.image).length > 4_000_000) return json({ error: 'image too large' }, 413);
      parts.push({ inline_data: { mime_type: body.mime || 'image/jpeg', data: body.image } });
    }
    const reqBody = JSON.stringify({ contents: [{ parts }], generationConfig: { responseMimeType: 'application/json' } });
    const models = [MODEL, 'gemini-flash-lite-latest', 'gemini-2.5-flash-lite', 'gemini-3-flash-preview', 'gemini-2.0-flash', MODEL];
    let g;
    for (let n = 0; n < models.length; n++) {
      g = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${models[n]}:generateContent`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-goog-api-key': env.GEMINI_API_KEY },
        body: reqBody,
      });
      if (g.ok || ![404, 429, 500, 503, 504].includes(g.status)) break;
      await new Promise(r => setTimeout(r, 600 * (n + 1)));
    }
    if (!g.ok) return json({ error: 'ai error', status: g.status, detail: (await g.text()).slice(0, 300) }, 502);
    try {
      const t = (await g.json()).candidates[0].content.parts[0].text;
      const o = JSON.parse(t);
      return json({ name: String(o.name), amount: +o.amount || 100, unit: String(o.unit || 'g'), kcal: +o.kcal, protein: +o.protein, carbs: +o.carbs, fat: +o.fat });
    } catch { return json({ error: 'bad ai response' }, 502); }
  },
};








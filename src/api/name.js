import { createClient } from '@supabase/supabase-js';

// ===== 从环境变量读取密钥（在 Vercel 项目 Settings -> Environment Variables 中配置）=====
const SILICONFLOW_API_KEY = process.env.SILICONFLOW_API_KEY;
const SILICONFLOW_MODEL = process.env.SILICONFLOW_MODEL || 'Qwen/Qwen2.5-7B-Instruct';
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

const supabase =
  SUPABASE_URL && SUPABASE_SERVICE_ROLE_KEY
    ? createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)
    : null;

function buildPrompt({ surname, gender, mode, requirement, birthDate, birthTime }) {
  const base =
    `你是一位精通中国传统文化与现代命名学的起名大师。请为姓氏「${surname}」的${gender || '孩子'}起 3 个名字。` +
    (requirement ? `用户的起名需求：${requirement}。` : '');

  const baziPart =
    mode === 'bazi'
      ? `孩子出生于 ${birthDate || '未知日期'} ${birthTime || '未知时辰'}。` +
        `请先简要推算其生辰八字与五行喜用（如：五行缺木、喜用神为木），再据此选取能补益五行的字起名，并在寓意中说明八字依据。`
      : '请结合音律、字形、字义与美好寓意起名。';

  return (
    base +
    baziPart +
    `\n\n严格要求：只返回一个 JSON 对象，不要输出任何其他文字、不要 markdown 代码块。格式如下：\n` +
    `{"bazi":"八字五行简析（普通起名模式可留空字符串）","names":[{"name":"完整姓名","pinyin":"拼音","meaning":"寓意解释，80字以内"}]}\n` +
    `names 数组必须恰好包含 3 个名字。`
  );
}

async function callSiliconFlow(prompt) {
  const resp = await fetch('https://api.siliconflow.cn/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${SILICONFLOW_API_KEY}`,
    },
    body: JSON.stringify({
      model: SILICONFLOW_MODEL,
      messages: [{ role: 'user', content: prompt }],
      temperature: 0.9,
      max_tokens: 1500,
    }),
  });

  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`硅基流动 API 错误 ${resp.status}: ${text}`);
  }

  const data = await resp.json();
  return data.choices?.[0]?.message?.content || '';
}

function parseNamesJson(content) {
  // 尽量容错地从模型输出中提取 JSON 对象
  const match = content.match(/\{[\s\S]*\}/);
  if (!match) throw new Error('模型未返回 JSON');
  const parsed = JSON.parse(match[0]);
  if (!Array.isArray(parsed.names) || parsed.names.length === 0) {
    throw new Error('模型返回格式不正确');
  }
  return {
    bazi: parsed.bazi || '',
    names: parsed.names.slice(0, 3).map((n) => ({
      name: String(n.name || ''),
      pinyin: String(n.pinyin || ''),
      meaning: String(n.meaning || ''),
    })),
  };
}

export default async function handler(req, res) {
  // GET /api/name -> 返回最近 20 条起名历史
  if (req.method === 'GET') {
    if (!supabase) {
      return res.status(200).json({ history: [], warning: 'Supabase 未配置' });
    }
    const { data, error } = await supabase
      .from('name_history')
      .select('id, created_at, surname, gender, mode, requirement, birth_date, birth_time, names, model')
      .order('created_at', { ascending: false })
      .limit(20);
    if (error) return res.status(500).json({ error: error.message });
    return res.status(200).json({ history: data });
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  if (!SILICONFLOW_API_KEY) {
    return res.status(500).json({ error: '服务器未配置 SILICONFLOW_API_KEY 环境变量' });
  }

  try {
    const { surname, gender, mode, requirement, birthDate, birthTime } = req.body || {};

    if (!surname || !String(surname).trim()) {
      return res.status(400).json({ error: '请填写姓氏' });
    }

    const prompt = buildPrompt({ surname: String(surname).trim(), gender, mode, requirement, birthDate, birthTime });

    // 生成失败时最多重试一次（模型偶尔返回非 JSON）
    let result;
    try {
      result = parseNamesJson(await callSiliconFlow(prompt));
    } catch {
      result = parseNamesJson(await callSiliconFlow(prompt));
    }

    // 保存到 Supabase（失败不影响返回结果）
    let saved = false;
    if (supabase) {
      const { error } = await supabase.from('name_history').insert({
        surname: String(surname).trim(),
        gender: gender || null,
        mode: mode === 'bazi' ? 'bazi' : 'normal',
        requirement: requirement || null,
        birth_date: birthDate || null,
        birth_time: birthTime || null,
        names: result.names,
        model: SILICONFLOW_MODEL,
      });
      saved = !error;
      if (error) console.error('Supabase 保存失败:', error.message);
    }

    return res.status(200).json({
      names: result.names,
      bazi: result.bazi,
      model: SILICONFLOW_MODEL,
      saved,
    });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: err.message || '起名失败，请稍后重试' });
  }
}

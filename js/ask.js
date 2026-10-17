// Gemini API で質問する (キーは各自のものをこの端末にだけ保存)
const KEY = 'howtogit-gemini';
export const DEFAULT_MODEL = 'gemini-3.6-flash';
const FALLBACK_MODEL = 'gemini-flash-latest';
const ENDPOINT = 'https://generativelanguage.googleapis.com/v1beta/models/';

export const SYSTEM = [
  'あなたは Git 学習ゲーム「HOW to Git」の先生です。',
  '初心者に、日本語で短く (3〜6行) やさしく答えてください。専門用語には一言説明を添えます。',
  'コマンドは `git ...` のようにバッククォートで囲みます。',
  'いま出ている依頼やステージの解き方を聞かれたら、まず「どう考えるか」のヒントを出し、答えのコマンドそのものは相手が求めたときだけ示します。',
  'このゲームでは「コード」ボタンでファイルを書いたことにできます (実際には書かない)。',
  'Git と関係ない質問には一言で答えて、Git の話に戻します。',
  '最後に付ける「いまの画面の状況」を参考にしてください。',
].join('\n');

export function loadSettings() {
  try { return { key: '', model: DEFAULT_MODEL, ...JSON.parse(localStorage.getItem(KEY) || '{}') }; } catch (e) { return { key: '', model: DEFAULT_MODEL }; }
}
export function saveSettings(s) {
  try { localStorage.setItem(KEY, JSON.stringify(s)); } catch (e) { /* 保存できない環境 */ }
}

// history: [{role: 'user'|'model', text}]  context: 状況の文字列
export function buildRequest(history, context) {
  const contents = history.map((m) => ({ role: m.role, parts: [{ text: m.text }] }));
  const last = contents[contents.length - 1];
  if (last && last.role === 'user' && context) last.parts = [{ text: `${last.parts[0].text}\n\n---\nいまの画面の状況:\n${context}` }];
  return { systemInstruction: { parts: [{ text: SYSTEM }] }, contents };
}

export function parseAnswer(json) {
  const c = json && json.candidates && json.candidates[0];
  const parts = (c && c.content && c.content.parts) || [];
  const text = parts.filter((p) => !p.thought && p.text).map((p) => p.text).join('').trim();
  if (text) return text;
  if (json && json.promptFeedback && json.promptFeedback.blockReason) throw new Error('この質問には答えられませんでした');
  throw new Error('答えが空でした');
}

async function call(model, key, body) {
  const res = await fetch(`${ENDPOINT}${encodeURIComponent(model)}:generateContent`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key },
    body: JSON.stringify(body),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error((json.error && json.error.message) || `HTTP ${res.status}`);
    err.status = res.status;
    throw err;
  }
  return parseAnswer(json);
}

export async function ask(history, context) {
  const s = loadSettings();
  if (!s.key) throw new Error('API キーが未設定です');
  const body = buildRequest(history, context);
  try {
    return await call(s.model || DEFAULT_MODEL, s.key, body);
  } catch (e) {
    // モデル名が古くなっていたら、最新の別名で試す
    if (e.status === 404 && s.model !== FALLBACK_MODEL) return call(FALLBACK_MODEL, s.key, body);
    if (e.status === 400 && /API key/i.test(e.message)) throw new Error('API キーが正しくないようです');
    if (e.status === 429) throw new Error('使いすぎ制限です。少し待ってからもう一度');
    throw e;
  }
}

// 答えの簡単な整形 (コード・太字・改行)
export function formatAnswer(text, esc) {
  const blocks = text.split(/```[a-z]*\n?/);
  return blocks.map((b, i) => (i % 2
    ? `<pre>${esc(b.replace(/\n$/, ''))}</pre>`
    : esc(b)
      .replace(/`([^`\n]+)`/g, '<code>$1</code>')
      .replace(/\*\*([^*\n]+)\*\*/g, '<b>$1</b>')
      .replace(/^\s*[-*] /gm, '・')
      .replace(/\n/g, '<br>'))).join('');
}

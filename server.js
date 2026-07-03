import 'dotenv/config';
import express from 'express';
import Parser from 'rss-parser';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const parser = new Parser();

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ---- 地域タグの判定（キーワード方式） ----
const REGION_KEYWORDS = {
  asia: ['中国', '韓国', '北朝鮮', '台湾', 'インド', '日本', 'ASEAN', 'フィリピン', 'ベトナム', 'タイ', 'インドネシア', 'マレーシア', '香港'],
  europe: ['EU', '欧州', '英国', 'イギリス', 'フランス', 'ドイツ', 'イタリア', 'スペイン', 'ロシア', 'ウクライナ', 'NATO', 'ポーランド'],
  mideast: ['イスラエル', 'パレスチナ', 'ガザ', 'イラン', 'イラク', 'サウジ', 'シリア', 'レバノン', '中東', 'トルコ'],
  americas: ['米国', 'アメリカ', 'トランプ', 'バイデン', 'カナダ', 'メキシコ', 'ブラジル', '南米', '中南米'],
};

function guessRegion(text) {
  for (const key of Object.keys(REGION_KEYWORDS)) {
    if (REGION_KEYWORDS[key].some((kw) => text.includes(kw))) return key;
  }
  return 'intl';
}

function relativeTime(dateStr) {
  const diffMs = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diffMs / 60000);
  if (mins < 1) return 'たった今';
  if (mins < 60) return `${mins}分前`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}時間前`;
  return `${Math.floor(hrs / 24)}日前`;
}

// ---- ニュース取得（無料・課金なし） ----
app.get('/api/news', async (req, res) => {
  try {
    const feed = await parser.parseURL(
      'https://news.google.com/rss/headlines/section/topic/WORLD?hl=ja&gl=JP&ceid=JP:ja'
    );
    const items = (feed.items || []).slice(0, 8).map((item) => {
      const desc = (item.contentSnippet || '').slice(0, 100);
      return {
        title: item.title,
        desc: desc || '詳細はリンク先をご覧ください。',
        link: item.link,
        time: relativeTime(item.pubDate),
        region: guessRegion(`${item.title} ${desc}`),
      };
    });
    res.json({ items, live: true });
  } catch (err) {
    console.error('ニュース取得エラー:', err.message);
    res.status(500).json({ error: 'ニュースの取得に失敗しました。時間をおいて再度お試しください。' });
  }
});

// ---- 背景解説の生成（Gemini APIの無料枠を使用。APIキー未設定なら課金なしで案内のみ） ----
app.post('/api/explain', async (req, res) => {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return res.status(400).json({
      error: 'この機能を使うにはAPIキーが必要です。.envファイルにGEMINI_API_KEYを設定してください（Gemini APIの無料枠なので基本的に課金は発生しません）。',
      needsApiKey: true,
    });
  }

  const { title, desc } = req.body || {};
  if (!title) return res.status(400).json({ error: 'title is required' });

  try {
    const prompt = `次のニュース見出しについて、国際情勢に詳しくない人でも文脈が分かるように、日本語で簡潔に解説してください。全体で4〜5文程度に収め、以下の要素を自然な文章に織り込んでください。

- なぜ今この話題が動いているか（背景・経緯）
- 経済や市場への影響（為替・株価・特定の産業などへの波及があれば）
- 過去の似たような出来事や前例（もしあれば）

事実に基づき、断定しすぎず、客観的なトーンで書いてください。見出しの繰り返しや前置きは不要で、解説本文のみを返してください。過去の前例が特に無い場合は無理に触れなくて構いません。

見出し: ${title}
概要: ${desc || ''}`;

    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
        }),
      }
    );

    if (!response.ok) {
      const errText = await response.text();
      throw new Error(`API error: ${response.status} ${errText}`);
    }

    const data = await response.json();
    const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!text) throw new Error('empty response');

    res.json({ explain: text.trim() });
  } catch (err) {
    console.error('解説生成エラー:', err.message);
    res.status(500).json({ error: '解説の生成に失敗しました。しばらくして再度お試しください。' });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`✅ World Pulse が起動しました: http://localhost:${PORT}`);
  if (!process.env.GEMINI_API_KEY) {
    console.log('ℹ️  解説機能は現在オフです（.envにGEMINI_API_KEYを設定すると使えます）');
  }
});

import { NextResponse } from 'next/server';

// WMO天気コードを日本語表記に変換するマッピング
const weatherCodeMap: Record<number, string> = {
  0: '快晴',
  1: '晴れ',
  2: '時々曇り',
  3: '曇り',
  45: '霧',
  48: '霧氷',
  51: '小雨',
  53: '雨',
  55: '強い雨',
  61: '弱い雨',
  63: '雨',
  65: '激しい雨',
  71: '弱い雪',
  73: '雪',
  75: '激しい雪',
  80: 'にわか雨',
  81: '強いにわか雨',
  82: '激しいにわか雨',
  95: '雷雨',
};

// Open-Meteo API から天気予報を取得
async function fetchWeatherData() {
  try {
    const url =
      'https://api.open-meteo.com/v1/forecast?latitude=35.6895&longitude=139.6917&daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max&timezone=Asia%2FTokyo';

    const res = await fetch(url, { next: { revalidate: 3600 } });
    if (!res.ok) return null;

    const data = await res.json();
    const daily = data.daily;
    if (!daily || !daily.time) return null;

    return daily.time
      .map((dateStr: string, idx: number) => {
        const code = daily.weather_code[idx];
        const weatherText = weatherCodeMap[code] || '不明';
        const maxTemp = daily.temperature_2m_max[idx];
        const minTemp = daily.temperature_2m_min[idx];
        const rainProb = daily.precipitation_probability_max[idx];

        return `- ${dateStr}: 天気[${weatherText}], 気温[${minTemp}℃〜${maxTemp}℃], 降水確率[${rainProb}%]`;
      })
      .join('\n');
  } catch (error) {
    console.error('天気API取得エラー:', error);
    return null;
  }
}

export async function POST(req: Request) {
  try {
    const { message, events } = await req.json();

    const apiKey = process.env.GROQ_API_KEY;
    if (!apiKey) {
      return NextResponse.json(
        { error: 'GROQ_API_KEY が .env.local に設定されていません。' },
        { status: 500 }
      );
    }

    // 1. 予定データのコンテキスト化
    const eventsContext =
      events && events.length > 0
        ? `【グループの現在の予定一覧】\n` +
          events
            .map((e: any) => {
              const start = new Date(e.start_time).toLocaleString('ja-JP');
              const end = new Date(e.end_time).toLocaleString('ja-JP');
              return `- タイトル: ${e.title}\n  日時: ${start} 〜 ${end}${
                e.description ? `\n  メモ: ${e.description}` : ''
              }`;
            })
            .join('\n')
        : '【グループの現在の予定一覧】\n現在、登録されている予定はありません。';

    // 2. 天気データの取得
    const weatherData = await fetchWeatherData();
    const weatherContext = weatherData
      ? `【直近7日間の天気予報（関東・東京周辺）】\n${weatherData}`
      : '【直近7日間の天気予報】\n現在、天気情報の取得に失敗しています。';

    // 3. プロンプト作成
    const systemInstruction = `あなたは「BOOK KING」という共有カレンダーアプリのAIアシスタントです。
ユーザーのカレンダー上の予定と、提供された最新の天気予報を把握し、日程調整の提案、雨の日の注意喚起、服装のアドバイス、おすすめのお出かけプランなどを行ってください。
回答は丁寧でわかりやすい日本語で行ってください。

${eventsContext}

${weatherContext}`;

    // 4. Groq API の呼び出し（OpenAI互換API）
    const groqResponse = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'llama-3.3-70b-versatile', // 高性能・高速モデル
        messages: [
          { role: 'system', content: systemInstruction },
          { role: 'user', content: message },
        ],
        temperature: 0.7,
      }),
    });

    if (!groqResponse.ok) {
      const errData = await groqResponse.json();
      throw new Error(errData.error?.message || 'Groq APIとの通信に失敗しました。');
    }

    const groqData = await groqResponse.json();
    const reply = groqData.choices[0]?.message?.content || '応答を取得できませんでした。';

    return NextResponse.json({ reply });
  } catch (error: any) {
    console.error('Groq API エラー:', error);
    return NextResponse.json(
      { error: error.message || 'AIの応答生成に失敗しました。' },
      { status: 500 }
    );
  }
}
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

    const res = await fetch(url, { cache: 'no-store' });
    if (!res.ok) return null;

    const data = await res.json();
    const daily = data.daily;
    if (!daily || !daily.time) return null;

    const weatherCodes = daily.weather_code || daily.weathercode || [];

    return daily.time
      .map((dateStr: string, idx: number) => {
        const code = weatherCodes[idx];
        const weatherText = weatherCodeMap[code] || '不明';
        const maxTemp = Math.round(daily.temperature_2m_max[idx]);
        const minTemp = Math.round(daily.temperature_2m_min[idx]);
        const rainProb = daily.precipitation_probability_max[idx] ?? 0;

        return `- 日付: ${dateStr} / 天気: ${weatherText} / 最高気温: ${maxTemp}℃ / 最低気温: ${minTemp}℃ / 降水確率: ${rainProb}%`;
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

    // 1. 現在日時（日本時間）の算出
    const now = new Date();
    const todayFormatted = now.toLocaleDateString('ja-JP', {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
      weekday: 'short',
      timeZone: 'Asia/Tokyo',
    });
    const todayISO = now.toLocaleDateString('sv-SE', { timeZone: 'Asia/Tokyo' });

    // 2. 予定データのコンテキスト化
    const eventsContext =
      events && events.length > 0
        ? `【グループの現在の予定一覧】\n` +
          events
            .map((e: any) => {
              const start = new Date(e.start_time).toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo' });
              const end = new Date(e.end_time).toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo' });
              return `- タイトル: ${e.title}\n  日時: ${start} 〜 ${end}${
                e.description ? `\n  メモ: ${e.description}` : ''
              }`;
            })
            .join('\n')
        : '【グループの現在の予定一覧】\n現在、登録されている予定はありません。';

    // 3. 天気データの取得
    const weatherData = await fetchWeatherData();

    const weatherContext = weatherData
      ? `【提供された最新の天気予報データ】\n${weatherData}`
      : '【最新の天気予報データ】\n現在、天気情報の取得に失敗しています。';

    // 4. システムプロンプト（openai/gpt-oss-20b 用に厳格なルールを設定）
    const systemInstruction = `あなたは「BOOK KING」という共有カレンダーアプリのAIアシスタントです。

【本日の日付（基準日）】
${todayFormatted} (${todayISO})

${eventsContext}

${weatherContext}

【最優先指示】
1. 上記の【提供された最新の天気予報データ】には、本日(${todayISO})から向こう7日間の実際の天気データが含まれています。
2. 「天気予報が含まれていません」「外部サイトでご確認ください」といった拒絶回答は禁止です。上記データの中に存在する日付の天気を事実として回答してください。
3. ユーザーが「明日」と尋ねた場合は、本日(${todayISO})の翌日の日付のデータを参照して回答してください。
4. 回答は丁寧でわかりやすい日本語で答えてください。`;

    // 5. Groq API の呼び出し (元の openai/gpt-oss-20b を使用)
    const groqResponse = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'openai/gpt-oss-20b', // 元のモデル名を維持
        messages: [
          { role: 'system', content: systemInstruction },
          { role: 'user', content: message },
        ],
        temperature: 0.2, // 拒絶・知ったかぶりを防止
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
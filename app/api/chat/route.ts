import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const supabase = createClient(supabaseUrl, supabaseAnonKey);

const weatherCodeMap: Record<number, string> = {
  0: '快晴', 1: '晴れ', 2: '時々曇り', 3: '曇り',
  45: '霧', 48: '霧氷', 51: '小雨', 53: '雨', 55: '強い雨',
  61: '弱い雨', 63: '雨', 65: '激しい雨', 71: '弱い雪', 73: '雪', 75: '激しい雪',
  80: 'にわか雨', 81: '強いにわか雨', 82: '激しいにわか雨', 95: '雷雨',
};

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
    const { message, events, groupId, userId } = await req.json();

    const apiKey = process.env.GROQ_API_KEY;
    if (!apiKey) {
      console.error('エラー: GROQ_API_KEY が設定されていません。');
      return NextResponse.json(
        { error: 'GROQ_API_KEY が設定されていません。Vercelの環境変数を確認してください。' },
        { status: 500 }
      );
    }

    const now = new Date();
    const todayFormatted = now.toLocaleDateString('ja-JP', {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
      weekday: 'short',
      timeZone: 'Asia/Tokyo',
    });
    const todayISO = now.toLocaleDateString('sv-SE', { timeZone: 'Asia/Tokyo' });

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

    const weatherData = await fetchWeatherData();
    const weatherContext = weatherData
      ? `【提供された最新の天気予報データ】\n${weatherData}`
      : '【最新の天気予報データ】\n現在、天気情報の取得に失敗しています。';

    const systemInstruction = `あなたは「BOOK KING」という共有カレンダーアプリのアシスタントです。

【本日の日付】
${todayFormatted} (${todayISO})

${eventsContext}

${weatherContext}

【最優先指示】
ユーザーの指示に従い、以下のように処理してください。

1. **予定作成の指示の場合**:
   時間を聞き返さず、必ず以下のJSON形式のみを出力してください。
   時間指定がない場合は start_time を "00:00"、end_time を "23:59"（終日）に設定してください。
   「全員」「メンバー全員」などの指定があれば all_members を true にしてください。

   {"is_event_creation": true, "title": "予定タイトル", "date": "YYYY-MM-DD", "start_time": "HH:MM", "end_time": "HH:MM", "all_members": true, "reply_message": "登録メッセージ"}

2. **その他の会話・天気・質問の場合**:
   丁寧な日本語でテキストで返答してください。`;

    // Groq API 呼び出し (利用可能な高速モデル llama-3.1-8b-instant を使用)
    const groqResponse = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'llama-3.1-8b-instant',
        messages: [
          { role: 'system', content: systemInstruction },
          { role: 'user', content: message },
        ],
        temperature: 0.1,
      }),
    });

    if (!groqResponse.ok) {
      const errText = await groqResponse.text();
      console.error('Groq API エラーレスポンス:', errText);
      throw new Error(`Groq APIエラー (${groqResponse.status}): ${errText}`);
    }

    const groqData = await groqResponse.json();
    const rawReply = groqData.choices[0]?.message?.content || '';

    // JSONパース判定
    let parsedData = null;
    try {
      const jsonMatch = rawReply.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        parsedData = JSON.parse(jsonMatch[0]);
      }
    } catch (e) {
      // 通常テキスト応答
    }

    // 予定作成リクエスト時の処理
    if (parsedData && parsedData.is_event_creation && userId) {
      const targetDate = parsedData.date || todayISO;
      const startTime = parsedData.start_time || '00:00';
      const endTime = parsedData.end_time || '23:59';

      const startDateTime = new Date(`${targetDate}T${startTime}:00`).toISOString();
      const endDateTime = new Date(`${targetDate}T${endTime}:00`).toISOString();

      const { data: newEvent, error: insertError } = await supabase
        .from('events')
        .insert({
          title: parsedData.title || '新しい予定',
          start_time: startDateTime,
          end_time: endDateTime,
          group_id: groupId || null,
          created_by: userId,
          color: '#3b82f6',
        })
        .select()
        .single();

      if (insertError) {
        console.error('Supabase 予定挿入エラー:', insertError);
        throw new Error(`DB保存エラー: ${insertError.message}`);
      }

      let participantUserIds: string[] = [userId];

      if (parsedData.all_members && groupId) {
        const { data: groupMembers } = await supabase
          .from('group_members')
          .select('user_id')
          .eq('group_id', groupId);

        if (groupMembers && groupMembers.length > 0) {
          participantUserIds = groupMembers.map((m) => m.user_id);
        }
      }

      if (newEvent && participantUserIds.length > 0) {
        const participantRows = participantUserIds.map((pid) => ({
          event_id: newEvent.id,
          user_id: pid,
        }));
        await supabase.from('event_participants').insert(participantRows);
      }

      const isAllDay = startTime === '00:00' && endTime === '23:59';
      const timeDisplay = isAllDay ? '（終日）' : `（${startTime}〜${endTime}）`;

      return NextResponse.json({
        reply: parsedData.reply_message || `${targetDate} に「${parsedData.title}」の予定を${timeDisplay}追加しました！`,
        eventAdded: true,
      });
    }

    return NextResponse.json({
      reply: rawReply,
      eventAdded: false,
    });
  } catch (error: any) {
    console.error('サーバー処理エラー:', error);
    return NextResponse.json(
      { error: error.message || '内部サーバーエラーが発生しました。' },
      { status: 500 }
    );
  }
}

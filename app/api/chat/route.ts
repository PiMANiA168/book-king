import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

// Supabase クライアントの初期化
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const supabase = createClient(supabaseUrl, supabaseAnonKey);

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
    const { message, events, groupId, userId } = await req.json();

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

    // 4. システムプロンプト（予定作成判定 & 終日自動補正ルール）
    const systemInstruction = `あなたは「BOOK KING」という共有カレンダーアプリの優秀なAIアシスタントです。

【本日の日付（基準日）】
${todayFormatted} (${todayISO})

${eventsContext}

${weatherContext}

【指示】
ユーザーのメッセージを解析し、以下のいずれかで処理してください。

1. **予定追加の指示の場合**:
   絶対に時間を聞き返さず、必ず以下のJSONフォーマットのみを出力してください（余計な文字列や解説は不要）。
   時間帯の指定がない場合は、自動的に start_time を "00:00"、end_time を "23:59"（終日）に設定してください。
   「全員」「メンバー全員」「みんな」等の単語があれば all_members を true にしてください。

   【出力JSONフォーマット】
   {
     "is_event_creation": true,
     "title": "予定のタイトル",
     "date": "YYYY-MM-DD",
     "start_time": "HH:MM",
     "end_time": "HH:MM",
     "all_members": true または false,
     "reply_message": "ユーザーへの完了報告メッセージ"
   }

2. **質問や通常会話・天気問い合わせの場合**:
   提供された天気データや既存の予定を参照しながら、丁寧でわかりやすい日本語で直接テキストを返答してください。`;

    // 5. Groq API の呼び出し
    const groqResponse = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'llama-3.3-70b-versatile', // 高精度なオープンモデル (または 'openai/gpt-oss-20b')
        messages: [
          { role: 'system', content: systemInstruction },
          { role: 'user', content: message },
        ],
        temperature: 0.1,
      }),
    });

    if (!groqResponse.ok) {
      const errData = await groqResponse.json();
      throw new Error(errData.error?.message || 'Groq APIとの通信に失敗しました。');
    }

    const groqData = await groqResponse.json();
    const rawReply = groqData.choices[0]?.message?.content || '';

    // 6. JSONパース判定（予定作成処理）
    let parsedData = null;
    try {
      // JSON文字列が含まれているか検出してパース
      const jsonMatch = rawReply.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        parsedData = JSON.parse(jsonMatch[0]);
      }
    } catch (e) {
      // パース失敗時は通常のテキスト会話として処理
    }

    // 7. 予定登録実行 (is_event_creation が true の場合)
    if (parsedData && parsedData.is_event_creation && userId) {
      const targetDate = parsedData.date || todayISO;
      const startTime = parsedData.start_time || '00:00';
      const endTime = parsedData.end_time || '23:59';

      const startDateTime = new Date(`${targetDate}T${startTime}:00`).toISOString();
      const endDateTime = new Date(`${targetDate}T${endTime}:00`).toISOString();

      // (1) events テーブルに新規予定を挿入
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
        console.error('Supabase 予定追加エラー:', insertError);
        throw new Error('データベースへの予定追加に失敗しました。');
      }

      // (2) 同行者（参加者）の追加処理
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

    // 通常会話・回答の返却
    return NextResponse.json({
      reply: rawReply,
      eventAdded: false,
    });
  } catch (error: any) {
    console.error('Groq API エラー:', error);
    return NextResponse.json(
      { error: error.message || 'AIの応答生成に失敗しました。' },
      { status: 500 }
    );
  }
}

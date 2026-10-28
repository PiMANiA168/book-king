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

    const systemInstruction = `あなたは「BOOK KING」という共有カレンダーアプリのAIコンシェルジュです。

【本日の日付（基準日）】
${todayFormatted} (ISO表記: ${todayISO})

${eventsContext}

${weatherContext}

【動作判定ルール】
1. **action: "suggest_date" (日程サジェスト・確認問い合わせ)**:
   - 「〜行きたいな」「〜にみんなで行きたい」「空いてる日ある？」など、日程が確定していない提案・打診の場合は、**絶対にデータベースへ追加せず "suggest_date" にしてください**。
   - 既存の予定と天気データを参照し、空いていて天気が良いお勧めの日付（YYYY-MM-DD）を算出し、「〜月〜日に『〇〇へGO』の予定をメンバー全員・終日で作成しますか？」とユーザーに確認・質問する文章を reply_message にセットしてください。

2. **action: "create_event" (確定登録)**:
   - ユーザーが「〇月〇日に〜の予定を入れて」と日付指定で直接命令した場合、またはAIからの日程提案に対して同意（「はい」「おねがい」「登録して」「みんなで行こう」「その日で決定」など）した場合のみ **"create_event"** にしてください。

3. **予定タイトル**:
   - どこかへ移動・外出する予定（富士Q、ディズニー、バーベキュー等）の場合、タイトルは必ず「[目的地・目的]へGO」形式にしてください（例: 「富士QへGO」）。

4. **メンバー範囲 (all_members)**:
   - 「みんな」「全員」「みんなで」「グループ全員」という言葉がある場合、または「みんなで行こう」などの同意文言の場合は、**必ず "all_members": true** にしてください。

【出力JSONフォーマット】
{
  "action": "suggest_date" または "create_event" または "chat",
  "title": "富士QへGO",
  "date": "YYYY-MM-DD",
  "start_time": "00:00",
  "end_time": "23:59",
  "all_members": true,
  "destination": "富士Q",
  "reply_message": "10月31日（晴れ）は予定が空いています！『富士QへGO』の予定をメンバー全員・終日で登録しますか？",
  "route_info": {
    "car": "🚗 自動車: 約100km / 約1時間30分",
    "bike": "🚲 自転車: 約100km / 約5時間",
    "public": "🚃 公共交通機関: 約2時間 / 交通費: 約2,000円 (電車・高速バス等)"
  }
}`;

    // Groq API 呼び出し (openai/gpt-oss-20b)
    const groqResponse = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'openai/gpt-oss-20b',
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

    // JSON パース処理
    let parsedData = null;
    try {
      const jsonMatch = rawReply.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        parsedData = JSON.parse(jsonMatch[0]);
      }
    } catch (e) {
      // 通常のテキスト応答へフォールバック
    }

    // 1. 予定確定追加アクション (create_event)
    if (parsedData && parsedData.action === 'create_event' && userId) {
      const targetDate = parsedData.date || todayISO;
      const startTime = parsedData.start_time || '00:00';
      const endTime = parsedData.end_time || '23:59';

      const startDateTime = new Date(`${targetDate}T${startTime}:00`).toISOString();
      const endDateTime = new Date(`${targetDate}T${endTime}:00`).toISOString();

      let activeGroupId = groupId;
      if (!activeGroupId || activeGroupId === 'ALL') {
        const { data: userGroupRow } = await supabase
          .from('group_members')
          .select('group_id')
          .eq('user_id', userId)
          .limit(1)
          .maybeSingle();
        if (userGroupRow) activeGroupId = userGroupRow.group_id;
      }

      // タイトルの補正（富士Q等のお出かけの場合は "〇〇へGO" に統一）
      let eventTitle = parsedData.title || '新しい予定';
      if (parsedData.destination && !eventTitle.includes('へGO')) {
        eventTitle = `${parsedData.destination}へGO`;
      }

      const { data: newEvent, error: insertError } = await supabase
        .from('events')
        .insert({
          title: eventTitle,
          start_time: startDateTime,
          end_time: endDateTime,
          group_id: activeGroupId || null,
          created_by: userId,
          color: '#3b82f6',
        })
        .select()
        .single();

      if (insertError) {
        console.error('Supabase 予定挿入エラー:', insertError);
        throw new Error(`DB保存エラー: ${insertError.message}`);
      }

      // 同行者登録ロジック
      let participantUserIds: string[] = [userId];

      if (parsedData.all_members && activeGroupId) {
        const { data: groupMembers, error: memberErr } = await supabase
          .from('group_members')
          .select('user_id')
          .eq('group_id', activeGroupId);

        if (!memberErr && groupMembers && groupMembers.length > 0) {
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

      let finalReply = parsedData.reply_message || `${targetDate} に「${eventTitle}」の予定を${timeDisplay}追加しました！`;

      if (parsedData.route_info) {
        finalReply += `\n\n【📍 ${parsedData.destination || eventTitle} への交通ルート案内】\n`;
        if (parsedData.route_info.car) finalReply += `${parsedData.route_info.car}\n`;
        if (parsedData.route_info.public) finalReply += `${parsedData.route_info.public}\n`;
        if (parsedData.route_info.bike) finalReply += `${parsedData.route_info.bike}\n`;
      }

      return NextResponse.json({
        reply: finalReply,
        eventAdded: true,
      });
    }

    // 2. 日程サジェスト提案 (suggest_date) または 通常チャット (chat) -> DB登録なし
    let replyText = parsedData?.reply_message || rawReply;

    if (parsedData?.route_info) {
      replyText += `\n\n【📍 交通ルート参考】\n`;
      if (parsedData.route_info.car) replyText += `${parsedData.route_info.car}\n`;
      if (parsedData.route_info.public) replyText += `${parsedData.route_info.public}\n`;
      if (parsedData.route_info.bike) replyText += `${parsedData.route_info.bike}\n`;
    }

    return NextResponse.json({
      reply: replyText,
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

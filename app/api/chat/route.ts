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
    const { message, history, events, groupId, userId } = await req.json();

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

    const systemInstruction = `あなたは「BOOK KING」という共有カレンダーアプリの超優秀なAIコンシェルジュです。

【本日の日付（基準日）】
${todayFormatted} (ISO表記: ${todayISO})

${eventsContext}

${weatherContext}

【文脈継承・最優先動作ルール】
1. **直前のやり取りからの文脈引き継ぎ（最重要）**:
   - 会話履歴であなたが特定の日程や目的地を提案（例：「沖縄への旅行を11月3日に〜」）した直後に、ユーザーが「いいよ」「おねがい」「その日で」「11月3日」「みんなで行こう」「〇〇に置き換えて」などの肯定・短文返答をした場合：
     -> **直前で話題にしていた「目的地」「提案日付（YYYY-MM-DD）」「メンバー範囲」を完璧に引き継ぎ、必ず action: "create_event" を発行してください。**
     -> 絶対に「いつにしますか？」「何の予定ですか？」と質問を返すボケ行為をしないでください。

2. **目的地タイトルの固定規則**:
   - ユーザーが発言した実際の目的地（沖縄、北海道、ディズニー等）をそのまま使用し、「[目的地]へGO」という形式にしてください（例: 「沖縄へGO」）。
   - プロンプトの例などに書かれていない無関係な場所（富士Q等）を勝手に生成・補完することは固く禁止します。

3. **メンバー範囲 (all_members)**:
   - 会話文脈または発言に「みんな」「全員」「みんなで」「みんなで行こう」が含まれている場合は **"all_members": true** に設定してください。

4. **動作区分 (action)**:
   - **"suggest_date"**: 日程未定で候補日を提案・確認する場合（DB保存なし）。
   - **"create_event"**: ユーザーの同意が得られた場合、または明確に登録が命じられた場合（DB保存実行）。

【出力JSONフォーマット】
{
  "action": "suggest_date" または "create_event" または "chat",
  "title": "[目的地]へGO",
  "date": "YYYY-MM-DD",
  "start_time": "00:00",
  "end_time": "23:59",
  "all_members": true または false,
  "destination": "[目的地名称]",
  "reply_message": "ユーザーへの返答文言",
  "route_info": {
    "car": "🚗 自動車: 約〇km / 約〇時間",
    "bike": "🚲 自転車: 約〇km / 約〇時間",
    "public": "🚃 公共交通機関/飛行機: 約〇時間 / 交通費: 約〇円"
  }
}`;

    // 過去の会話履歴を整形
    const formattedHistory = (history || [])
      .filter((m: any) => m.role === 'user' || m.role === 'assistant')
      .map((m: any) => ({
        role: m.role,
        content: m.content,
      }));

    const apiMessages = [
      { role: 'system', content: systemInstruction },
      ...formattedHistory,
      { role: 'user', content: message },
    ];

    // Groq API 呼び出し
    const groqResponse = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'openai/gpt-oss-20b',
        messages: apiMessages,
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

    let parsedData = null;
    try {
      const jsonMatch = rawReply.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        parsedData = JSON.parse(jsonMatch[0]);
      }
    } catch (e) {
      // 通常テキスト応答
    }

    // 1. 予定確定追加処理 (create_event)
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

      // 同行者登録
      let participantUserIds: string[] = [userId];

      if (parsedData.all_members && activeGroupId) {
        const { data: groupMembers } = await supabase
          .from('group_members')
          .select('user_id')
          .eq('group_id', activeGroupId);

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

    // 2. 日程サジェスト提案 (suggest_date) または 通常チャット (chat)
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

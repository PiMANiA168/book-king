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

    const systemInstruction = `あなたは「BOOK KING」という共有カレンダーアプリの超優秀なAIコンシェルジュです。

【本日の日付（基準日）】
${todayFormatted} (ISO表記: ${todayISO})

${eventsContext}

${weatherContext}

【思考・動作ルール】
1. **日付の解釈（相対表記対応）**:
   「明日」「あさって」「今週末」「来週の月曜」「1週間後」「今月中」などの指示は、基準日 (${todayISO}) をベースにして正確な YYYY-MM-DD に計算してください。

2. **メンバー範囲の判定**:
   - ユーザーが「全員」「メンバー全員」「みんなで」「グループ全員」等の表現を使用している場合のみ、"all_members": true にしてください。
   - 特にメンバーの指定がない場合や「自分だけ」の場合は、必ず "all_members": false にしてください。

3. **機能分類 (action)**:
   - **"create_event"**: 確定した予定の追加要求、または前回のAIサジェストに対してユーザーが肯定（「はい」「おねがい」「入れて」など）した場合。時間指定がなければ start_time:"00:00", end_time:"23:59"（終日）とします。
   - **"suggest_date"**: 「〜に行きたい」「空いてる日教えて」「いつがいい？」といった日程未定の相談・提案依頼。既存の予定と天気予報データを比較し、空いていて天気が良い日（晴れ/快晴）を提案する文章を作成してください。
   - **"chat"**: 通常の質問、天気問い合わせ、雑談など。

4. **交通案内の付与 (route_info)**:
   目的地（富士Q、ディズニー、特定の観光地や場所など）がある予定を作成または提案する場合、都心方面からの移動手段別の情報（距離、時間、概算交通費）を推測して route_info オブジェクトに設定してください。

【出力フォーマット（厳密に以下のJSONのみを出力してください）】
{
  "action": "create_event" | "suggest_date" | "chat",
  "title": "予定のタイトル",
  "date": "YYYY-MM-DD",
  "start_time": "HH:MM",
  "end_time": "HH:MM",
  "all_members": true または false,
  "destination": "目的地名称（あれば）",
  "reply_message": "ユーザーへの返答メッセージ",
  "route_info": {
    "car": "🚗 自動車: 約〇km / 約〇時間〇分",
    "bike": "🚲 自転車: 約〇km / 約〇時間",
    "public": "🚃 公共交通機関: 約〇時間〇分 / 交通費: 約〇,〇〇円 (電車・高速バス等)"
  }
}`;

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

    // 1. 予定作成アクション (create_event)
    if (parsedData && (parsedData.action === 'create_event' || parsedData.is_event_creation) && userId) {
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
          .single();
        if (userGroupRow) activeGroupId = userGroupRow.group_id;
      }

      const { data: newEvent, error: insertError } = await supabase
        .from('events')
        .insert({
          title: parsedData.title || '新しい予定',
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

      // 同行者登録（all_members が true の場合のみ全員、なければ自分のみ）
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

      let finalReply = parsedData.reply_message || `${targetDate} に「${parsedData.title}」の予定を${timeDisplay}追加しました！`;

      // 交通情報がある場合は追記
      if (parsedData.route_info) {
        finalReply += `\n\n【📍 ${parsedData.destination || parsedData.title} への交通ルート案内】\n`;
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

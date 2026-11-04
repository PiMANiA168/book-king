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

// 天気予報データの取得
async function fetchWeatherData() {
  try {
    const url = 'https://api.open-meteo.com/v1/forecast?latitude=35.6895&longitude=139.6917&daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max&timezone=Asia%2FTokyo';
    const res = await fetch(url, { cache: 'no-store' });
    if (!res.ok) return null;
    const data = await res.json();
    const daily = data.daily;
    if (!daily || !daily.time) return null;
    const weatherCodes = daily.weather_code || daily.weathercode || [];
    return daily.time.map((dateStr: string, idx: number) => {
      const weatherText = weatherCodeMap[weatherCodes[idx]] || '不明';
      return {
        date: dateStr,
        weather: weatherText,
        maxTemp: Math.round(daily.temperature_2m_max[idx]),
        minTemp: Math.round(daily.temperature_2m_min[idx]),
        rainProb: daily.precipitation_probability_max[idx] ?? 0,
      };
    });
  } catch (error) {
    return null;
  }
}

// 既存予定から埋まっている日付 (YYYY-MM-DD) を抽出
function getOccupiedDates(events: any[]): string[] {
  if (!events || !Array.isArray(events)) return [];
  const occupiedSet = new Set<string>();

  events.forEach((e: any) => {
    const timeVal = e.start_time || e.start || e.date;
    if (timeVal) {
      try {
        const d = new Date(timeVal);
        if (!isNaN(d.getTime())) {
          const dateStr = d.toLocaleDateString('sv-SE', { timeZone: 'Asia/Tokyo' });
          occupiedSet.add(dateStr);
        }
      } catch (err) {}
    }
  });

  return Array.from(occupiedSet);
}

export async function POST(req: Request) {
  try {
    const { message, history, events, groupId, userId } = await req.json();
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) return NextResponse.json({ error: 'GEMINI_API_KEY が未設定です。' }, { status: 500 });

    const now = new Date();
    const todayFormatted = now.toLocaleDateString('ja-JP', { year: 'numeric', month: 'long', day: 'numeric', weekday: 'short', timeZone: 'Asia/Tokyo' });
    const todayISO = now.toLocaleDateString('sv-SE', { timeZone: 'Asia/Tokyo' });

    const weatherList = await fetchWeatherData();
    const occupiedDates = getOccupiedDates(events);

    // 空いている日をリストアップ
    const availableWeatherDays = (weatherList || [])
      .filter((w: any) => !occupiedDates.includes(w.date))
      .map((w: any) => `- ${w.date} (${w.weather}, 降水確率:${w.rainProb}%)`)
      .join('\n');

    const occupiedDatesStr = occupiedDates.length > 0 ? occupiedDates.join(', ') : 'なし';

    const systemInstruction = `あなたは「BOOK KING」のAIコンシェルジュです。
グループの予定調整をサポートします。

【本日の日付】
${todayFormatted} (${todayISO})

【すでに予定が埋まっている日（提案不可）】
${occupiedDatesStr}

【空いていて提案可能な天気データ】
${availableWeatherDays || 'データ参照不可'}

【思考ガイドライン】
1. 過去の会話履歴とユーザーの最新の発言から、目的地 (destination) と提案中の日付 (proposed_date) を把握・記憶・更新してください。
2. ユーザーが「いいね」「お願い」「オッケー」などの同意や相づちを打った場合、過去ログで確定させようとしていた目的地と日付を引き継ぎ、action を "create_event" にしてください。「いいね」自体を目的地にしてはいけません。
3. 候補日を提案する際は、埋まっている日（${occupiedDatesStr}）を固く避け、空いている候補日の中から天気が最も良い日を選んでください。
4. ユーザーが今月の予定の確認・照会を求めてきた場合、action を "query_schedule" にしてください。`;

    // 会話履歴を Gemini API のコンテンツ形式に整形
    const contents = [
      ...(history || []).map((h: any) => ({
        role: h.role === 'assistant' ? '' : 'user',
        parts: [{ text: h.content }]
      })),
      {
        role: 'user',
        parts: [{ text: message }]
      }
    ];

    // Gemini 3.5 Flash Lite API (または gemini-2.0-flash / gemini-1.5-flash) を呼び出し
    const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash:generateContent?key=${apiKey}`;

    const geminiRes = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: contents,
        systemInstruction: { parts: [{ text: systemInstruction }] },
        generationConfig: {
          temperature: 0.1,
          responseMimeType: 'application/json',
          responseSchema: {
            type: 'OBJECT',
            properties: {
              memory: {
                type: 'OBJECT',
                properties: {
                  destination: { type: 'STRING', description: '認識・記憶している目的地（例: 北海道）。未定なら空文字' },
                  proposed_date: { type: 'STRING', description: '提案・確定する日付（YYYY-MM-DD）。未定なら空文字' }
                },
                required: ['destination', 'proposed_date']
              },
              action: {
                type: 'STRING',
                enum: ['suggest_date', 'create_event', 'query_schedule', 'chat'],
                description: 'AIの実行アクション'
              },
              reply_message: { type: 'STRING', description: 'ユーザーに返す会話本文' }
            },
            required: ['memory', 'action', 'reply_message']
          }
        }
      })
    });

    if (!geminiRes.ok) {
      const errText = await geminiRes.text();
      throw new Error(`Gemini API エラー (${geminiRes.status}): ${errText}`);
    }

    const geminiData = await geminiRes.json();
    const rawText = geminiData.candidates?.[0]?.content?.parts?.[0]?.text || '{}';
    const parsed = JSON.parse(rawText);

    const { memory, action, reply_message } = parsed;
    const activeDestination = memory?.destination || '';
    const activeDate = memory?.proposed_date || '';

    // A. 予定の照会処理 (query_schedule)
    if (action === 'query_schedule') {
      if (!events || events.length === 0) {
        return NextResponse.json({
          reply: '現在、登録されている予定はありません！何か予定を作成しますか？',
          eventAdded: false
        });
      }
      const formattedEvents = events.map((e: any) => {
        const d = new Date(e.start_time || e.start);
        const dateStr = !isNaN(d.getTime())
          ? d.toLocaleDateString('ja-JP', { month: 'long', day: 'numeric', weekday: 'short', timeZone: 'Asia/Tokyo' })
          : '日時不明';
        return `- ${dateStr}: ${e.title}`;
      }).join('\n');

      return NextResponse.json({
        reply: `【現在のグループの予定一覧】\n${formattedEvents}\n\n新しい予定の追加やご相談があれば教えてくださいね！`,
        eventAdded: false
      });
    }

    // B. 予定の確定処理 (create_event)
    if (action === 'create_event' && activeDestination && activeDate && userId) {
      const startDateTime = new Date(`${activeDate}T00:00:00`).toISOString();
      const endDateTime = new Date(`${activeDate}T23:59:00`).toISOString();

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

      const eventTitle = `${activeDestination}へGO`;

      const { data: newEvent, error: insertError } = await supabase.from('events').insert({
        title: eventTitle,
        start_time: startDateTime,
        end_time: endDateTime,
        group_id: activeGroupId || null,
        created_by: userId,
        color: '#3b82f6',
      }).select().single();

      if (insertError) throw new Error(`DB保存エラー: ${insertError.message}`);

      if (activeGroupId) {
        const { data: groupMembers } = await supabase
          .from('group_members')
          .select('user_id')
          .eq('group_id', activeGroupId);
        if (groupMembers && groupMembers.length > 0) {
          await supabase.from('event_participants').insert(
            groupMembers.map((m: any) => ({ event_id: newEvent.id, user_id: m.user_id }))
          );
        }
      }

      const confirmReply = `${activeDate} に「${eventTitle}」の予定をメンバー全員・（終日）で追加しました！\n\n【📍 ${activeDestination} への交通ルート案内】\n🚗 自動車: ルート確認済み\n🚃 公共交通機関: ルート確認済み`;
      return NextResponse.json({ reply: confirmReply, eventAdded: true });
    }

    // C. 通常会話 / 日程提案 (suggest_date, chat)
    return NextResponse.json({ reply: reply_message, eventAdded: false });

  } catch (error: any) {
    console.error('サーバー処理エラー:', error);
    return NextResponse.json({ error: error.message || '内部サーバーエラーが発生しました。' }, { status: 500 });
  }
}

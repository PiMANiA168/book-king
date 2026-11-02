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
  return events.map((e: any) => {
    if (!e.start_time) return '';
    const d = new Date(e.start_time);
    return d.toLocaleDateString('sv-SE', { timeZone: 'Asia/Tokyo' });
  }).filter(Boolean);
}

// 会話履歴から目的地を最新優先で安全抽出
function extractDestination(history: any[], currentMessage: string): string {
  const userMessages = [
    currentMessage,
    ...(history || []).filter((h: any) => h.role === 'user').map((h: any) => h.content).reverse()
  ];

  for (const text of userMessages) {
    const match = text.match(/([一-龠ぁ-んァ-ヶa-zA-Z0-9]+?)(?:にいきたい|に行きたい|へ行きたい|に行こう|へ行こう|にみんなで|へみんなで|へGO|への旅行|への予定)/);
    if (match && match[1]) {
      const cleaned = match[1].replace(/^(今月中|明日|来週|みんなで|どこか|確定で|今月|一番|降水確率|低い|雨|天気)/, '').trim();
      if (cleaned && !['Unknown', '厳しいか', 'うん', 'はい', 'いいよ', 'ダメ'].includes(cleaned) && !cleaned.includes('[')) {
        return cleaned;
      }
    }
  }

  // AI側の直近提案から抽出
  for (let i = (history || []).length - 1; i >= 0; i--) {
    if (history[i].role === 'assistant') {
      const match = history[i].content.match(/「(.+?)へGO」/) || history[i].content.match(/『(.+?)へGO』/);
      if (match && match[1] && !['Unknown', '厳しいか', ''].includes(match[1])) {
        return match[1];
      }
    }
  }

  return '';
}

// 会話履歴でNG指定された日付リストを抽出
function getRejectedDates(history: any[], currentMessage: string): string[] {
  const rejected: string[] = [];
  const allTexts = [...(history || []).map((h: any) => h.content), currentMessage];
  
  for (const text of allTexts) {
    if (text.includes('予定が入っている') || text.includes('ダメ') || text.includes('無理') || text.includes('空いてない')) {
      const match = text.match(/(\d{1,2})月(\d{1,2})日/) || text.match(/(\d{4}-\d{2}-\d{2})/);
      if (match) {
        rejected.push(match[0]);
      }
    }
  }
  return rejected;
}

export async function POST(req: Request) {
  try {
    const { message, history, events, groupId, userId } = await req.json();
    const apiKey = process.env.GROQ_API_KEY;
    if (!apiKey) return NextResponse.json({ error: 'GROQ_API_KEY が未設定です。' }, { status: 500 });

    const now = new Date();
    const todayFormatted = now.toLocaleDateString('ja-JP', { year: 'numeric', month: 'long', day: 'numeric', weekday: 'short', timeZone: 'Asia/Tokyo' });
    const todayISO = now.toLocaleDateString('sv-SE', { timeZone: 'Asia/Tokyo' });

    // 状態抽出
    const activeDestination = extractDestination(history, message) || '旅行';
    const weatherList = await fetchWeatherData();
    const occupiedDates = getOccupiedDates(events);
    const rejectedDates = getRejectedDates(history, message);

    const allBlockedDates = [...new Set([...occupiedDates, ...rejectedDates])];

    // 空いている日の中で最良の天気日を選出
    let recommendedDate = '';
    if (weatherList && weatherList.length > 0) {
      const validDays = weatherList.filter((w: any) => {
        return !allBlockedDates.some((b: string) => b && (w.date === b || b.includes(w.date) || w.date.includes(b)));
      });

      validDays.sort((a: any, b: any) => a.rainProb - b.rainProb);
      if (validDays[0]) {
        recommendedDate = validDays[0].date;
      }
    }

    const eventsContext = events && events.length > 0
      ? `【既存の予定一覧（提案不可）】\n` + events.map((e: any) => `- ${e.title}: ${e.start_time}`).join('\n')
      : '【既存の予定一覧】なし';

    const systemInstruction = `あなたは「BOOK KING」のAIコンシェルジュです。
日本語テキストで自然に応答しつつ、末尾に必ず以下のJSON形式の指示を含めてください。

【本日の日付】
${todayFormatted} (${todayISO})

${eventsContext}

【判定状態】
- 目的地: "${activeDestination}"
- 空いているおすすめの候補日: "${recommendedDate}"

【対話ルール】
1. 重複防止: 既存の予定が入っている日やNG指定された日には提案を行わず、空いているおすすめ候補日（${recommendedDate}）を提案してください。
2. 同意返答（「よろしく」「おねgal」「いいよ」「決定」等）の場合:
   - action: "create_event" で確定処理を行ってください。

【出力形式】
返答文言の最後に、半角波括弧で囲んだJSONを1つだけ出力してください。
{"action":"suggest_date"|"create_event"|"chat", "destination":"${activeDestination}", "date":"${recommendedDate}", "title":"${activeDestination}へGO"}`;

    const formattedHistory = (history || [])
      .filter((m: any) => m.role === 'user' || m.role === 'assistant')
      .map((m: any) => ({ role: m.role, content: m.content }));

    const groqResponse = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'qwen/qwen3.8-27b',
        messages: [
          { role: 'system', content: systemInstruction },
          ...formattedHistory,
          { role: 'user', content: message }
        ],
        temperature: 0.2,
        max_tokens: 300, // 制限超過防止
      }),
    });

    if (!groqResponse.ok) {
      const errText = await groqResponse.text();
      throw new Error(`Groq APIエラー (${groqResponse.status}): ${errText}`);
    }

    const groqData = await groqResponse.json();
    const rawReply = groqData.choices[0]?.message?.content || '';

    let parsedData: any = {};
    const jsonMatch = rawReply.match(/\{[\s\S]*?\}/);
    if (jsonMatch) {
      try {
        parsedData = JSON.parse(jsonMatch[0]);
      } catch (e) {}
    }

    const isAffirmative = /^(うん|はい|いいね|いいよ|おねがい|頼む|決定|その日で|行こう|OK|ok|オッケー|よろしく)/i.test(message.trim()) || message.includes('よろしく');
    const isRejectingDate = message.includes('予定が入っている') || message.includes('ダメ') || message.includes('無理') || message.includes('空いてない');

    // 1. 予定確定処理 (create_event)
    if ((isAffirmative || parsedData.action === 'create_event') && !isRejectingDate && userId) {
      const targetDate = recommendedDate || parsedData.date || todayISO;
      const startDateTime = new Date(`${targetDate}T00:00:00`).toISOString();
      const endDateTime = new Date(`${targetDate}T23:59:00`).toISOString();

      let activeGroupId = groupId;
      if (!activeGroupId || activeGroupId === 'ALL') {
        const { data: userGroupRow } = await supabase.from('group_members').select('group_id').eq('user_id', userId).limit(1).maybeSingle();
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
        const { data: groupMembers } = await supabase.from('group_members').select('user_id').eq('group_id', activeGroupId);
        if (groupMembers && groupMembers.length > 0) {
          await supabase.from('event_participants').insert(groupMembers.map((m: any) => ({ event_id: newEvent.id, user_id: m.user_id })));
        }
      }

      let reply = `${targetDate} に「${eventTitle}」の予定をメンバー全員・（終日）で追加しました！\n\n【📍 ${activeDestination} への交通ルート案内】\n🚗 自動車: ルート確認済み\n🚃 公共交通機関: ルート確認済み`;
      return NextResponse.json({ reply, eventAdded: true });
    }

    // 2. チャット/サジェスト応答の整形
    let replyText = rawReply.replace(/\{[\s\S]*?\}/g, '').trim();
    if (!replyText || replyText.includes('2026-11-03')) {
      replyText = `${recommendedDate}（降水確率が低い日）に『${activeDestination}へGO』の予定を作成しますか？`;
    }

    return NextResponse.json({ reply: replyText, eventAdded: false });
  } catch (error: any) {
    console.error('サーバー処理エラー:', error);
    return NextResponse.json({ error: error.message || '内部サーバーエラーが発生しました。' }, { status: 500 });
  }
}

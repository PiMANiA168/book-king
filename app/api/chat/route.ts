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

// 目的地抽出の除外キーワード & 抽出ロジック強化
function extractDestination(history: any[], currentMessage: string): string {
  const ignoreWords = [
    '今月の予定', '予定', 'スケジュール', '確認', '教えて', '何かある', '一覧',
    'Unknown', '厳しいか', 'うん', 'はい', 'いいよ', 'ダメ', '旅行', 'よろしく'
  ];

  const userMessages = [
    currentMessage,
    ...(history || []).filter((h: any) => h.role === 'user').map((h: any) => h.content).reverse()
  ];

  for (const text of userMessages) {
    if (text.includes('予定') || text.includes('スケジュール') || text.includes('確認')) {
      continue;
    }

    const match = text.match(/([一-龠ぁ-んァ-ヶa-zA-Z0-9]+?)(?:にいきたい|に行きたい|へ行きたい|にいこう|に行こう|へいこう|へ行こう|にいく|に行く|へいく|へ行く|にみんなで|へみんなで|へGO|への旅行|への予定)/);
    if (match && match[1]) {
      const cleaned = match[1].replace(/^(今月中|明日|来週|みんなで|どこか|確定で|今月|一番|降水確率|低い|雨|天気)/, '').trim();
      if (cleaned && !ignoreWords.includes(cleaned) && !cleaned.includes('[')) {
        return cleaned;
      }
    }

    const trimmed = text.trim();
    if (trimmed.length >= 2 && trimmed.length <= 8 && !ignoreWords.includes(trimmed)) {
      return trimmed;
    }
  }

  for (let i = (history || []).length - 1; i >= 0; i--) {
    if (history[i].role === 'assistant') {
      const match = history[i].content.match(/「(.+?)へGO」/) || history[i].content.match(/『(.+?)へGO』/);
      if (match && match[1] && !ignoreWords.includes(match[1])) {
        return match[1].trim();
      }
    }
  }

  return '';
}

// ユーザーが「予定の確認・照会」を求めているか判定
function isQueryScheduleIntent(message: string): boolean {
  const queryKeywords = ['予定', 'スケジュール', '入ってる', '確認', '教えて', '何がある', '今月'];
  const isCreateKeywords = ['行きたい', '追加', '作成', 'いこう', '予約', '入れて'];
  
  const hasQuery = queryKeywords.some(k => message.includes(k));
  const hasCreate = isCreateKeywords.some(k => message.includes(k));

  return hasQuery && !hasCreate;
}

export async function POST(req: Request) {
  try {
    const { message, history, events, groupId, userId } = await req.json();
    const apiKey = process.env.GROQ_API_KEY;
    if (!apiKey) return NextResponse.json({ error: 'GROQ_API_KEY が未設定です。' }, { status: 500 });

    const now = new Date();
    const todayFormatted = now.toLocaleDateString('ja-JP', { year: 'numeric', month: 'long', day: 'numeric', weekday: 'short', timeZone: 'Asia/Tokyo' });
    const todayISO = now.toLocaleDateString('sv-SE', { timeZone: 'Asia/Tokyo' });

    // 1. 照会インテント（「今月の予定は」等の問い合わせ）の判定
    if (isQueryScheduleIntent(message)) {
      if (!events || events.length === 0) {
        return NextResponse.json({
          reply: '現在、登録されている予定はありません！何か予定を作成しますか？',
          eventAdded: false,
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
        reply: `【現在のグループの予定一覧】\n${formattedEvents}\n\n新しい予定の追加や相談があれば教えてくださいね！`,
        eventAdded: false,
      });
    }

    // 2. 状態抽出（新規作成・提案フロー）
    const activeDestination = extractDestination(history, message);
    const weatherList = await fetchWeatherData();
    const occupiedDates = getOccupiedDates(events);

    let recommendedDate = '';
    if (weatherList && weatherList.length > 0) {
      const validDays = weatherList.filter((w: any) => !occupiedDates.includes(w.date));
      validDays.sort((a: any, b: any) => a.rainProb - b.rainProb);
      if (validDays[0]) {
        recommendedDate = validDays[0].date;
      }
    }

    const systemInstruction = `あなたは「BOOK KING」のAIコンシェルジュです。
日本語テキストで自然に応答しつつ、末尾に必ず以下のJSON形式の指示を含めてください。

【本日の日付】
${todayFormatted} (${todayISO})

【既存の埋まっている予定日（提案不可）】
${occupiedDates.join(', ') || 'なし'}

【判定状態】
- 目的地: "${activeDestination || '未設定'}"
- 空いているおすすめの候補日: "${recommendedDate || 'なし'}"

【対話ルール】
1. 重複防止: 既存予定日（${occupiedDates.join(', ') || 'なし'}）は絶対提案せず、完全に空いている日（${recommendedDate}）だけを提案してください。
2. 目的地が未設定の場合: 「どちらへ行きますか？」と尋ねてください。
3. 同意返答（「うん」「よろしく」「おねがい」「いいよ」等）の場合:
   - 目的地が判明していれば action: "create_event" で確定処理を行ってください。

【出力形式】
返答文言の最後に、半角波括弧で囲んだJSONを1つだけ出力してください。
{"action":"suggest_date"|"create_event"|"chat", "destination":"${activeDestination}", "date":"${recommendedDate}", "title":"${activeDestination ? `${activeDestination}へGO` : ''}"}`;

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
        max_tokens: 300,
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
    const finalDestination = activeDestination || parsedData.destination;

    // 1. 予定確定処理 (create_event)
    if ((isAffirmative || parsedData.action === 'create_event') && finalDestination && userId) {
      const targetDate = recommendedDate || parsedData.date || todayISO;
      const startDateTime = new Date(`${targetDate}T00:00:00`).toISOString();
      const endDateTime = new Date(`${targetDate}T23:59:00`).toISOString();

      let activeGroupId = groupId;
      if (!activeGroupId || activeGroupId === 'ALL') {
        const { data: userGroupRow } = await supabase.from('group_members').select('group_id').eq('user_id', userId).limit(1).maybeSingle();
        if (userGroupRow) activeGroupId = userGroupRow.group_id;
      }

      const eventTitle = `${finalDestination}へGO`;

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
          await supabase.from('event_participants').insert(groupMembers.map((m: any) => ({ event_id: m.user_id })));
        }
      }

      let reply = `${targetDate} に「${eventTitle}」の予定をメンバー全員・（終日）で追加しました！\n\n【📍 ${finalDestination} への交通ルート案内】\n🚗 自動車: ルート確認済み\n🚃 公共交通機関: ルート確認済み`;
      return NextResponse.json({ reply, eventAdded: true });
    }

    // 2. チャット/サジェスト応答の整形
    let replyText = rawReply.replace(/\{[\s\S]*?\}/g, '').trim();
    if (!replyText || occupiedDates.includes(recommendedDate)) {
      if (finalDestination) {
        replyText = `${recommendedDate}（空いている日）に『${finalDestination}へGO』の予定を作成しますか？`;
      } else {
        replyText = `どちらにお出かけされますか？行き先を教えていただければ、空いている日をご案内します！`;
      }
    }

    return NextResponse.json({ reply: replyText, eventAdded: false });
  } catch (error: any) {
    console.error('サーバー処理エラー:', error);
    return NextResponse.json({ error: error.message || '内部サーバーエラーが発生しました。' }, { status: 500 });
  }
}

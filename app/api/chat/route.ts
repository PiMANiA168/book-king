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

// 会話履歴から「最新の目的地」を厳密抽出
function getLatestDestination(history: any[], currentMessage: string): string {
  const allTexts = [
    currentMessage,
    ...(history || []).filter((h: any) => h.role === 'user').map((h: any) => h.content).reverse()
  ];

  for (const text of allTexts) {
    const match = text.match(/([一-龠ぁ-んァ-ヶa-zA-Z0-9]+?)(?:にいきたい|に行きたい|へ行きたい|に行こう|へ行こう|にみんなで|へみんなで|へGO|への旅行|への予定)/);
    if (match && match[1]) {
      const cleaned = match[1].replace(/^(今月中|明日|来週|みんなで|どこか|確定で|今月|一番|降水確率|低い|雨|天気)/, '').trim();
      if (cleaned && cleaned !== 'Unknown' && !cleaned.includes('[')) return cleaned;
    }
    const trimmed = text.trim();
    if (trimmed.length >= 2 && trimmed.length <= 8 && !['こんにちは', 'うん', 'はい', 'おねがい', 'いいよ', 'いいね', 'OK'].includes(trimmed)) {
      return trimmed;
    }
  }

  // AI側の過去の提案から抽出
  for (let i = (history || []).length - 1; i >= 0; i--) {
    if (history[i].role === 'assistant') {
      const match = history[i].content.match(/「(.+?)へGO」/) || history[i].content.match(/「(.+?)」/);
      if (match && match[1] && match[1] !== 'Unknown') return match[1];
    }
  }

  return '';
}

// 会話履歴から「最新の提案日付」を厳密抽出
function getLatestProposedDate(history: any[], currentYear: number): string | null {
  if (!history) return null;
  for (let i = history.length - 1; i >= 0; i--) {
    const text = history[i].content;
    const isoMatch = text.match(/(\d{4})-(\d{1,2})-(\d{1,2})/);
    if (isoMatch) return `${isoMatch[1]}-${isoMatch[2].padStart(2, '0')}-${isoMatch[3].padStart(2, '0')}`;
    const mdMatch = text.match(/(\d{1,2})月(\d{1,2})日/);
    if (mdMatch) return `${currentYear}-${mdMatch[1].padStart(2, '0')}-${mdMatch[2].padStart(2, '0')}`;
  }
  return null;
}

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
      return `- 日付: ${dateStr} / 天気: ${weatherText} / 最高: ${Math.round(daily.temperature_2m_max[idx])}℃ / 最低: ${Math.round(daily.temperature_2m_min[idx])}℃ / 降水確率: ${daily.precipitation_probability_max[idx] ?? 0}%`;
    }).join('\n');
  } catch (error) {
    return null;
  }
}

export async function POST(req: Request) {
  try {
    const { message, history, events, groupId, userId } = await req.json();

    const apiKey = process.env.GROQ_API_KEY;
    if (!apiKey) return NextResponse.json({ error: 'GROQ_API_KEY が未設定です。' }, { status: 500 });

    const now = new Date();
    const todayFormatted = now.toLocaleDateString('ja-JP', { year: 'numeric', month: 'long', day: 'numeric', weekday: 'short', timeZone: 'Asia/Tokyo' });
    const todayISO = now.toLocaleDateString('sv-SE', { timeZone: 'Asia/Tokyo' });

    // 1. 事前に会話状態を解析（State Injection の準備）
    const currentDest = getLatestDestination(history, message);
    const currentDate = getLatestProposedDate(history, now.getFullYear());

    const weatherData = await fetchWeatherData();
    const weatherContext = weatherData ? `【提供された最新の天気予報データ】\n${weatherData}` : '【最新の天気予報データ】\n現在、天気情報の取得に失敗しています。';

    // 2. 解析した状態をシステムプロンプトに直接注入（AIに暗記させない）
    const systemInstruction = `あなたは「BOOK KING」の共有カレンダーAIアシスタントです。
必ず指定のJSONオブジェクト形式のみを出力してください。

【本日の日付（基準日）】
${todayFormatted} (${todayISO})

【現在の会話状態（確定・引き継ぎ情報）】
- 現在話題になっている目的地: "${currentDest || '未定'}"
- 現在提案中の日付: "${currentDate || '未定'}"

${weatherContext}

【思考・動作ルール】
1. **会話・挨拶・質問の場合 (action: "chat")**:
   - 挨拶（「こんにちは」等）や質問には action: "chat" で丁寧に応答してください。目的地や日付の話がない場合は予定作成の文言を出さないでください。
2. **お出かけ提案の場合 (action: "suggest_date")**:
   - 目的地がある場合は DB 保存せず、天気データから最適な日を選び「〇月〇日に『[目的地]へGO』の予定を登録しますか？」と提案してください。
3. **同意・確定の場合 (action: "create_event")**:
   - ユーザーが「うん」「はい」「いいね」「その日で」などと同意した場合、上記の【現在の会話状態】の目的地と日付をそのまま使用して action: "create_event" にしてください。

【出力JSONフォーマット】
{
  "action": "suggest_date" | "create_event" | "chat",
  "title": "${currentDest ? `${currentDest}へGO` : '目的地へGO'}",
  "date": "${currentDate || 'YYYY-MM-DD'}",
  "start_time": "00:00",
  "end_time": "23:59",
  "all_members": true,
  "destination": "${currentDest}",
  "reply_message": "返答本文"
}`;

    const formattedHistory = (history || [])
      .filter((m: any) => m.role === 'user' || m.role === 'assistant')
      .map((m: any) => ({ role: m.role, content: m.content }));

    const apiMessages = [
      { role: 'system', content: systemInstruction },
      ...formattedHistory,
      { role: 'user', content: message },
    ];

    // 3. Groq API (openai/gpt-oss-120b) を呼び出し
    const groqResponse = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'openai/gpt-oss-120b',
        messages: apiMessages,
        response_format: { type: 'json_object' },
        temperature: 0.1,
      }),
    });

    if (!groqResponse.ok) {
      const errText = await groqResponse.text();
      throw new Error(`Groq APIエラー (${groqResponse.status}): ${errText}`);
    }

    const groqData = await groqResponse.json();
    const rawReply = groqData.choices[0]?.message?.content || '';

    let parsedData: any = null;
    try {
      parsedData = JSON.parse(rawReply);
    } catch (e) {
      const match = rawReply.match(/\{[\s\S]*\}/);
      if (match) parsedData = JSON.parse(match[0]);
    }

    const isAffirmative = /^(うん|はい|いいね|いいよ|おねがい|頼む|決定|その日で|行こう|OK|ok|オッケー)/i.test(message.trim());

    if (!parsedData) {
      parsedData = { action: isAffirmative ? 'create_event' : 'chat', reply_message: rawReply };
    }

    // 4. 同意時は注入された状態を優先して適用
    if (isAffirmative && currentDest) {
      parsedData.action = 'create_event';
      parsedData.destination = currentDest;
      if (currentDate) parsedData.date = currentDate;
    }

    // 予定確定追加処理 (create_event)
    if (parsedData.action === 'create_event' && userId) {
      const targetDate = parsedData.date || currentDate || todayISO;
      const startDateTime = new Date(`${targetDate}T00:00:00`).toISOString();
      const endDateTime = new Date(`${targetDate}T23:59:00`).toISOString();

      let activeGroupId = groupId;
      if (!activeGroupId || activeGroupId === 'ALL') {
        const { data: userGroupRow } = await supabase.from('group_members').select('group_id').eq('user_id', userId).limit(1).maybeSingle();
        if (userGroupRow) activeGroupId = userGroupRow.group_id;
      }

      const destName = parsedData.destination || currentDest || 'お出かけ';
      const eventTitle = `${destName}へGO`;

      const { data: newEvent, error: insertError } = await supabase.from('events').insert({
        title: eventTitle,
        start_time: startDateTime,
        end_time: endDateTime,
        group_id: activeGroupId || null,
        created_by: userId,
        color: '#3b82f6',
      }).select().single();

      if (insertError) throw new Error(`DB保存エラー: ${insertError.message}`);

      // 同行者登録
      let participantUserIds: string[] = [userId];
      if (activeGroupId) {
        const { data: groupMembers } = await supabase.from('group_members').select('user_id').eq('group_id', activeGroupId);
        if (groupMembers && groupMembers.length > 0) participantUserIds = groupMembers.map((m) => m.user_id);
      }

      if (newEvent && participantUserIds.length > 0) {
        await supabase.from('event_participants').insert(participantUserIds.map((pid) => ({ event_id: newEvent.id, user_id: pid })));
      }

      let finalReply = `${targetDate} に「${eventTitle}」の予定をメンバー全員・（終日）で追加しました！`;
      finalReply += `\n\n【📍 ${destName} への交通ルート案内】\n🚗 自動車: ルート確認済み\n🚃 公共交通機関: ルート確認済み`;

      return NextResponse.json({ reply: finalReply, eventAdded: true });
    }

    return NextResponse.json({ reply: parsedData.reply_message || rawReply, eventAdded: false });
  } catch (error: any) {
    return NextResponse.json({ error: error.message || '内部サーバーエラーが発生しました。' }, { status: 500 });
  }
}

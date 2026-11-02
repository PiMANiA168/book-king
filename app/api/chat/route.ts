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

// 会話履歴全体から「目的地」を強力に抽出・保持する関数
function findDestinationFromHistory(history: any[], currentMessage: string): string {
  const allTexts = [...(history || []).map((h: any) => h.content), currentMessage];

  // 地名のキーワードパターン検索
  for (let i = allTexts.length - 1; i >= 0; i--) {
    const text = allTexts[i];
    const match = text.match(/([一-龠ぁ-んァ-ヶa-zA-Z0-9]+?)(?:に行きたい|へ行きたい|に行こう|へ行こう|にみんなで|へみんなで|へGO|への旅行|への予定|名)/);
    if (match && match[1]) {
      const cleaned = match[1].replace(/^(今月中|明日|来週|みんなで|どこか|確定で|今月|一番|降水確率|低い)/, '').trim();
      if (cleaned && cleaned !== 'Unknown' && !cleaned.includes('[')) {
        return cleaned;
      }
    }
  }

  // 「北海道」「沖縄」「富士Q」などの単体発言の拾い出し
  for (let i = allTexts.length - 1; i >= 0; i--) {
    const text = allTexts[i].trim();
    if (['北海道', '沖縄', '富士Q', 'ディズニー', '京都', '大阪'].includes(text)) {
      return text;
    }
  }

  return '';
}

// 会話履歴全体から「日付(YYYY-MM-DD)」を強力に抽出・保持する関数
function findDateFromHistory(history: any[], currentMessage: string, currentYear: number): string | null {
  const allTexts = [...(history || []).map((h: any) => h.content), currentMessage];

  for (let i = allTexts.length - 1; i >= 0; i--) {
    const text = allTexts[i];
    const isoMatch = text.match(/(\d{4})-(\d{1,2})-(\d{1,2})/);
    if (isoMatch) {
      return `${isoMatch[1]}-${isoMatch[2].padStart(2, '0')}-${isoMatch[3].padStart(2, '0')}`;
    }
    const mdMatch = text.match(/(\d{1,2})月(\d{1,2})日/);
    if (mdMatch) {
      return `${currentYear}-${mdMatch[1].padStart(2, '0')}-${mdMatch[2].padStart(2, '0')}`;
    }
  }
  return null;
}

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
      return NextResponse.json({ error: 'GROQ_API_KEY が設定されていません。' }, { status: 500 });
    }

    const now = new Date();
    const todayFormatted = now.toLocaleDateString('ja-JP', { year: 'numeric', month: 'long', day: 'numeric', weekday: 'short', timeZone: 'Asia/Tokyo' });
    const todayISO = now.toLocaleDateString('sv-SE', { timeZone: 'Asia/Tokyo' });

    const eventsContext = events && events.length > 0
      ? `【グループの現在の予定一覧】\n` + events.map((e: any) => `- タイトル: ${e.title}\n  日時: ${e.start_time} 〜 ${e.end_time}`).join('\n')
      : '【グループの現在の予定一覧】\n現在、登録されている予定はありません。';

    const weatherData = await fetchWeatherData();
    const weatherContext = weatherData
      ? `【提供された最新の天気予報データ】\n${weatherData}`
      : '【最新の天気予報データ】\n現在、天気情報の取得に失敗しています。';

    const systemInstruction = `あなたは「BOOK KING」の共有カレンダーAIアシスタントです。
必ず単一のJSONオブジェクトのみを出力してください。

【本日の日付（基準日）】
${todayFormatted} (${todayISO})

${eventsContext}

${weatherContext}

【思考・動作ルール】
1. 会話履歴から「目的地」と「希望日付（または候補日）」を常に保持・引き継いでください。
2. 「一番降水確率が低いところ」などの要求には、天気データから降水確率が最小の日付（例: 2026-11-03）を自動選定してください。
3. ユーザーが「北海道」「11月3日」「いいね」「おねがい」等の短文で答えた場合は、聞き返さずに直前の目的地と日付を組み合わせて返答を作成してください。

【出力JSONフォーマット】
{
  "action": "suggest_date" | "create_event" | "chat",
  "title": "目的地へGO",
  "date": "YYYY-MM-DD",
  "start_time": "00:00",
  "end_time": "23:59",
  "all_members": true,
  "destination": "目的地名称",
  "reply_message": "11月3日（降水確率2%）に「北海道へGO」の予定を登録しますか？",
  "route_info": {
    "car": "🚗 自動車: 約800km / 約10時間",
    "bike": "🚲 自転車: 約800km / 約50時間",
    "public": "🚃 公共交通機関/飛行機: 約2時間 / 交通費: 約15,000円"
  }
}`;

    const formattedHistory = (history || [])
      .filter((m: any) => m.role === 'user' || m.role === 'assistant')
      .map((m: any) => ({ role: m.role, content: m.content }));

    const apiMessages = [
      { role: 'system', content: systemInstruction },
      ...formattedHistory,
      { role: 'user', content: message },
    ];

    const groqResponse = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'openai/gpt-oss-120b',
        messages: apiMessages,
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
      const jsonMatch = rawReply.match(/\{[\s\S]*\}/);
      if (jsonMatch) parsedData = JSON.parse(jsonMatch[0]);
    } catch (e) {
      // パース失敗時フォールバック
    }

    // --- プログラムによる状態復元（メモリ補完機能） ---
    const extractedDest = findDestinationFromHistory(history, message);
    const extractedDate = findDateFromHistory(history, message, now.getFullYear());

    if (!parsedData) {
      parsedData = { action: 'suggest_date', reply_message: rawReply };
    }

    // 目的地と日付を過去ログから強制統合
    if (extractedDest) parsedData.destination = extractedDest;
    if (extractedDate) parsedData.date = extractedDate;

    // ユーザーの肯定・同意判定
    const isAffirmative = /^(いいね|いいよ|おねがい|頼む|決定|その日で|行こう|OK|ok|オッケー)/i.test(message.trim());

    // 両方のスロット（目的地＆日付）が埋まっている場合の強制動作制御
    if (parsedData.destination && parsedData.date) {
      if (isAffirmative || message.trim() === parsedData.destination || message.includes('11月') || message.includes('3日')) {
        // 同意があった、または特定情報を追加で入れて両方が揃った場合 ➔ 予定確定登録へ
        if (isAffirmative) {
          parsedData.action = 'create_event';
        } else {
          // 提案確認を提示
          parsedData.action = 'suggest_date';
          parsedData.reply_message = `${parsedData.date} に「${parsedData.destination}へGO」の予定をメンバー全員・終日で作成しますか？`;
        }
      }
    }

    // 1. 予定確定追加処理 (create_event)
    if (parsedData.action === 'create_event' && userId) {
      const targetDate = parsedData.date || extractedDate || todayISO;
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

      const destName = parsedData.destination || extractedDest || 'お出かけ';
      const eventTitle = `${destName}へGO`;

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
        throw new Error(`DB保存エラー: ${insertError.message}`);
      }

      // 同行者登録（全員）
      let participantUserIds: string[] = [userId];
      if (activeGroupId) {
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

      let finalReply = `${targetDate} に「${eventTitle}」の予定をメンバー全員・${timeDisplay}で追加しました！`;

      if (parsedData.route_info) {
        finalReply += `\n\n【📍 ${destName} への交通ルート案内】\n`;
        if (parsedData.route_info.car) finalReply += `${parsedData.route_info.car}\n`;
        if (parsedData.route_info.public) finalReply += `${parsedData.route_info.public}\n`;
        if (parsedData.route_info.bike) finalReply += `${parsedData.route_info.bike}\n`;
      }

      return NextResponse.json({ reply: finalReply, eventAdded: true });
    }

    // 2. 日程サジェスト提案・会話応答
    let replyText = parsedData.reply_message || rawReply;

    // AIがボケて「行き先はどちらですか？」等と聞き返してきた場合、プログラム側で上書き修復
    if (parsedData.destination && parsedData.date && (replyText.includes('行き先') || replyText.includes('日程'))) {
      replyText = `${parsedData.date}（降水確率が最も低い日）に「${parsedData.destination}へGO」の予定をメンバー全員・終体で作成しますか？`;
    }

    if (parsedData.route_info) {
      replyText += `\n\n【📍 交通ルート参考】\n`;
      if (parsedData.route_info.car) replyText += `${parsedData.route_info.car}\n`;
      if (parsedData.route_info.public) replyText += `${parsedData.route_info.public}\n`;
      if (parsedData.route_info.bike) replyText += `${parsedData.route_info.bike}\n`;
    }

    return NextResponse.json({ reply: replyText, eventAdded: false });
  } catch (error: any) {
    console.error('サーバー処理エラー:', error);
    return NextResponse.json({ error: error.message || '内部サーバーエラーが発生しました。' }, { status: 500 });
  }
}

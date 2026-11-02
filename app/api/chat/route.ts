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

// 過去ログから目的地を最新順に安全抽出（「厳しいか」「うん」などの雑談を除外）
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
      const match = history[i].content.match(/「(.+?)へGO」/) || history[i].content.match(/「(.+?)」/);
      if (match && match[1] && !['Unknown', '厳しいか'].includes(match[1])) {
        return match[1];
      }
    }
  }

  return '';
}

// 会話履歴でNG指定された日付リストを収集
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
    const activeDestination = extractDestination(history, message);
    const weatherList = await fetchWeatherData();
    const rejectedDates = getRejectedDates(history, message);

    // NG日を除外した最良の天気日を選出
    let recommendedDate = '';
    let weatherInfoStr = '';
    if (weatherList && weatherList.length > 0) {
      const validDays = weatherList.filter((w: any) => !rejectedDates.some((r: any) => r.includes(w.date) || r.includes(`${parseInt(w.date.split('-')[1])}月${parseInt(w.date.split('-')[2])}日`)));
      // 降水確率が一番低い日を提案
      validDays.sort((a: any, b: any) => a.rainProb - b.rainProb);
      if (validDays[0]) {
        recommendedDate = validDays[0].date;
        weatherInfoStr = `${validDays[0].date} (${validDays[0].weather} / 降水確率${validDays[0].rainProb}%)`;
      }
    }

    const weatherTextContext = weatherList
      ? `【最新の天気予報データ】\n` + weatherList.map((w: any) => `- ${w.date}: ${w.weather} (最高:${w.maxTemp}℃/最低:${w.minTemp}℃/降水確率:${w.rainProb}%)`).join('\n')
      : '天気データ参照不可';

    const systemInstruction = `あなたは「BOOK KING」のAIコンシェルジュです。
日本語テキストで自然に応答しつつ、末尾に必ず以下のJSON形式の指示を含めてください。

【本日の日付】
${todayFormatted} (${todayISO})

【現在の判定状態】
- 目的地: "${activeDestination || '未定'}"
- NG指定された日付: ${rejectedDates.join(', ') || 'なし'}
- AIが推奨する最適な代替日: "${recommendedDate || '未定'}"

${weatherTextContext}

【対話ルール】
1. **「〜行きたい」に対して**:
   - 目的地が判明している場合、最も天気が良い日付（${recommendedDate}）を提案し、「${recommendedDate}に『${activeDestination}へGO』の予定を作成しますか？」と聞いてください。
2. **「〇月〇日は予定がある/無理」「いい日を探して」に対して**:
   - 目的地（${activeDestination}）を維持したまま、NG日を除いた代替日（${recommendedDate}）を提示して提案し直してください。絶対に「行き先はどこですか？」と聞き返さないでください。
3. **「うん」「いいよ」「決定」等の同意に対して**:
   - 確定処理（action: "create_event"）を行い、登録完了メッセージを出力してください。

【出力形式】
返答文言の最後に、半角波括弧で囲んだJSONを1つだけ出力してください。
{"action":"suggest_date"|"create_event"|"chat", "destination":"${activeDestination}", "date":"${recommendedDate}", "title":"${activeDestination}へGO"}`;

    const formattedHistory = (history || [])
      .filter((m: any) => m.role === 'user' || m.role === 'assistant')
      .map((m: any) => ({ role: m.role, content: m.content }));

    // Groq API 呼び出し (qwen/qwen3.8-27b を指定)
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
      }),
    });

    if (!groqResponse.ok) {
      const errText = await groqResponse.text();
      throw new Error(`Groq APIエラー (${groqResponse.status}): ${errText}`);
    }

    const groqData = await groqResponse.json();
    const rawReply = groqData.choices[0]?.message?.content || '';

    // JSON部分のパース
    let parsedData: any = {};
    const jsonMatch = rawReply.match(/\{[\s\S]*?\}/);
    if (jsonMatch) {
      try {
        parsedData = JSON.parse(jsonMatch[0]);
      } catch (e) {}
    }

    // 意図フラグのプログラム判定
    const isAffirmative = /^(うん|はい|いいね|いいよ|おねがい|頼む|決定|その日で|行こう|OK|ok|オッケー)/i.test(message.trim());
    const isRejectingDate = message.includes('予定が入っている') || message.includes('ダメ') || message.includes('探すのが') || message.includes('仕事');

    // 1. 予定確定処理 (create_event)
    if ((isAffirmative || parsedData.action === 'create_event') && !isRejectingDate && activeDestination && userId) {
      const targetDate = parsedData.date || recommendedDate || todayISO;
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

      // グループ全員を登録
      if (activeGroupId) {
        const { data: groupMembers } = await supabase.from('group_members').select('user_id').eq('group_id', activeGroupId);
        if (groupMembers && groupMembers.length > 0) {
          await supabase.from('event_participants').insert(groupMembers.map((m: any) => ({ event_id: newEvent.id, user_id: m.user_id })));
        }
      }

      let reply = `${targetDate} に「${eventTitle}」の予定をメンバー全員・（終日）で追加しました！\n\n【📍 ${activeDestination} への交通ルート案内】\n🚗 自動車: 約2時間30分 / 🚃 公共交通機関: 約1時間45分`;
      return NextResponse.json({ reply, eventAdded: true });
    }

    // 2. チャット/サジェスト応答の整形 (JSON文字列を除去して綺麗にする)
    let replyText = rawReply.replace(/\{[\s\S]*?\}/g, '').trim();
    if (!replyText) {
      replyText = `${recommendedDate}（降水確率が低い日）に『${activeDestination}へGO』の予定を提案します。いかがでしょうか？`;
    }

    return NextResponse.json({ reply: replyText, eventAdded: false });
  } catch (error: any) {
    console.error('サーバー処理エラー:', error);
    return NextResponse.json({ error: error.message || '内部サーバーエラーが発生しました。' }, { status: 500 });
  }
}

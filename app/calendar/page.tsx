'use client';

import { useState, useEffect, useRef } from 'react';
import { createClient } from '@supabase/supabase-js';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import Link from 'next/link';
import UserMenu from '@/components/UserMenu';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const supabase = createClient(supabaseUrl, supabaseAnonKey);

interface CalendarEvent {
  id?: string;
  title: string;
  start_time: string;
  end_time: string;
  description?: string;
  group_id?: string;
  created_by?: string;
}

interface ChatMessage {
  id?: string;
  role: 'user' | 'assistant';
  content: string;
  created_at?: string;
}

interface GroupInfo {
  id: string;
  name: string;
}

const DEFAULT_WELCOME_MESSAGE: ChatMessage = {
  role: 'assistant',
  content:
    'こんにちは！BOOK KINGのAIアシスタントです。予定の確認や「明日15時に会議を追加して」といった指示を教えてください！',
};

export default function CalendarPage() {
  const [events, setEvents] = useState<CalendarEvent[]>([]);
  const [currentDate, setCurrentDate] = useState<Date>(new Date());
  const [selectedDate, setSelectedDate] = useState<Date>(new Date());

  const [isChatOpen, setIsChatOpen] = useState<boolean>(false);
  const [messages, setMessages] = useState<ChatMessage[]>([DEFAULT_WELCOME_MESSAGE]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [clearing, setClearing] = useState(false);
  
  const [userId, setUserId] = useState<string>('');
  const [userGroups, setUserGroups] = useState<GroupInfo[]>([]);
  const [selectedGroupId, setSelectedGroupId] = useState<string>('ALL');
  const [authChecking, setAuthChecking] = useState(true);

  // --------------------------------------------------
  // 予定追加モーダル用ステート
  // --------------------------------------------------
  const [isAddModalOpen, setIsAddModalOpen] = useState(false);
  const [eventTitle, setEventTitle] = useState('');
  const [eventDate, setEventDate] = useState('');
  const [eventStartTime, setEventStartTime] = useState('10:00');
  const [eventEndTime, setEventEndTime] = useState('11:00');
  const [eventDescription, setEventDescription] = useState('');
  const [eventTargetGroupId, setEventTargetGroupId] = useState('');
  const [isSavingEvent, setIsSavingEvent] = useState(false);
  const [eventErrorMessage, setEventErrorMessage] = useState('');

  const chatEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (isChatOpen) {
      chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
  }, [messages, loading, isChatOpen]);

  // 未ログインガード & 初期データ取得
  useEffect(() => {
    const initData = async () => {
      try {
        const { data: { session } } = await supabase.auth.getSession();

        if (!session || !session.user) {
          window.location.href = '/';
          return;
        }

        const currentUserId = session.user.id;
        setUserId(currentUserId);

        // 1. 所属している全グループを取得
        const { data: memberData, error: memberError } = await supabase
          .from('group_members')
          .select('group_id, groups(id, name)')
          .eq('user_id', currentUserId);

        if (memberError) {
          console.error('グループ取得エラー:', memberError);
        }

        const groups: GroupInfo[] = [];
        if (memberData && memberData.length > 0) {
          memberData.forEach((item: any) => {
            if (item.groups) {
              groups.push({ id: item.groups.id, name: item.groups.name || '名称未設定グループ' });
            } else if (item.group_id) {
              groups.push({ id: item.group_id, name: 'グループ' });
            }
          });
        }

        setUserGroups(groups);

        // 2. 予定の取得
        if (groups.length > 0) {
          setSelectedGroupId('ALL');
          await fetchEvents('ALL', groups.map((g) => g.id));
        } else {
          setSelectedGroupId('');
          setEvents([]);
        }

        fetchChatHistory(currentUserId);
      } catch (err) {
        console.error('初期化処理例外:', err);
      } finally {
        setAuthChecking(false);
      }
    };

    initData();
  }, []);

  // 予定の取得処理
  const fetchEvents = async (targetGroupId?: string, availableGroupIds?: string[]) => {
    const gid = targetGroupId !== undefined ? targetGroupId : selectedGroupId;
    const allIds = availableGroupIds || userGroups.map((g) => g.id);

    if (allIds.length === 0) {
      setEvents([]);
      return;
    }

    let query = supabase.from('events').select('*');

    if (gid === 'ALL') {
      query = query.in('group_id', allIds);
    } else if (gid) {
      query = query.eq('group_id', gid);
    } else {
      setEvents([]);
      return;
    }

    const { data, error } = await query.order('start_time', { ascending: true });

    if (!error && data) {
      setEvents(data);
    } else if (error) {
      console.error('予定取得エラー:', error);
    }
  };

  const fetchChatHistory = async (targetUserId: string) => {
    const uid = targetUserId || userId;
    if (!uid) return;

    const { data, error } = await supabase
      .from('chat_messages')
      .select('*')
      .eq('user_id', uid)
      .order('created_at', { ascending: true });

    if (!error && data && data.length > 0) {
      setMessages(data);
    } else {
      setMessages([DEFAULT_WELCOME_MESSAGE]);
    }
  };

  // --------------------------------------------------
  // 予定追加モーダルの開閉関数
  // --------------------------------------------------
  const openAddEventModal = (targetDate?: Date) => {
    const baseDate = targetDate || selectedDate || new Date();
    const yyyy = baseDate.getFullYear();
    const mm = String(baseDate.getMonth() + 1).padStart(2, '0');
    const dd = String(baseDate.getDate()).padStart(2, '0');
    
    setEventTitle('');
    setEventDate(`${yyyy}-${mm}-${dd}`);
    setEventStartTime('10:00');
    setEventEndTime('11:00');
    setEventDescription('');
    setEventErrorMessage('');
    
    // デフォルト登録先グループの設定
    const defaultGroup = selectedGroupId === 'ALL' ? (userGroups[0]?.id || '') : selectedGroupId;
    setEventTargetGroupId(defaultGroup);

    setIsAddModalOpen(true);
  };

  // 予定の手動追加処理
  const handleSaveEvent = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!eventTitle.trim()) {
      setEventErrorMessage('タイトルを入力してください。');
      return;
    }
    if (!eventTargetGroupId) {
      setEventErrorMessage('追加先のグループを選択してください。');
      return;
    }

    setIsSavingEvent(true);
    setEventErrorMessage('');

    try {
      const startDateTime = new Date(`${eventDate}T${eventStartTime}:00`).toISOString();
      const endDateTime = new Date(`${eventDate}T${eventEndTime}:00`).toISOString();

      const { error } = await supabase.from('events').insert({
        title: eventTitle.trim(),
        start_time: startDateTime,
        end_time: endDateTime,
        description: eventDescription.trim() || null,
        group_id: eventTargetGroupId,
        created_by: userId,
      });

      if (error) {
        console.error('予定追加エラー:', error);
        setEventErrorMessage('予定の保存に失敗しました。');
      } else {
        setIsAddModalOpen(false);
        await fetchEvents();
      }
    } catch (err) {
      console.error('予定保存例外:', err);
      setEventErrorMessage('エラーが発生しました。入力内容を確認してください。');
    } finally {
      setIsSavingEvent(false);
    }
  };

  const handleClearHistory = async () => {
    if (!userId || clearing) return;
    if (!window.confirm('チャット履歴を消去しますか？')) return;

    setClearing(true);
    try {
      const { error } = await supabase
        .from('chat_messages')
        .delete()
        .eq('user_id', userId);

      if (!error) {
        setMessages([DEFAULT_WELCOME_MESSAGE]);
      }
    } catch (err) {
      console.error('履歴削除例外:', err);
    } finally {
      setClearing(false);
    }
  };

  const handleSendMessage = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!input.trim() || loading) return;

    const userText = input.trim();
    setInput('');

    const userMsg: ChatMessage = { role: 'user', content: userText };
    setMessages((prev) => [...prev, userMsg]);
    setLoading(true);

    const activeGroupId = selectedGroupId === 'ALL' ? (userGroups[0]?.id || null) : selectedGroupId;

    if (userId) {
      await supabase.from('chat_messages').insert({
        user_id: userId,
        group_id: activeGroupId,
        role: 'user',
        content: userText,
      });
    }

    try {
      const response = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: userText,
          events: events,
          groupId: activeGroupId,
          userId: userId,
        }),
      });

      const data = await response.json();

      if (response.ok && data.reply) {
        const aiMsg: ChatMessage = { role: 'assistant', content: data.reply };
        setMessages((prev) => [...prev, aiMsg]);

        if (userId) {
          await supabase.from('chat_messages').insert({
            user_id: userId,
            group_id: activeGroupId,
            role: 'assistant',
            content: data.reply,
          });
        }

        if (data.eventAdded) {
          await fetchEvents();
        }
      } else {
        const errorMsg = data.reply || data.error || '応答の取得に失敗しました。';
        setMessages((prev) => [...prev, { role: 'assistant', content: errorMsg }]);
      }
    } catch (error) {
      console.error('送信エラー:', error);
      setMessages((prev) => [
        ...prev,
        {
          role: 'assistant',
          content: '通信エラーが発生しました。ネットワーク状態を確認してください。',
        },
      ]);
    } fontally {
      setLoading(false);
    }
  };

  const getCalendarDays = () => {
    const year = currentDate.getFullYear();
    const month = currentDate.getMonth();

    const firstDay = new Date(year, month, 1);
    const lastDay = new Date(year, month + 1, 0);

    const days = [];
    const firstDayOfWeek = firstDay.getDay();

    const prevMonthLastDay = new Date(year, month, 0).getDate();
    for (let i = firstDayOfWeek - 1; i >= 0; i--) {
      days.push({
        date: new Date(year, month - 1, prevMonthLastDay - i),
        isCurrentMonth: false,
      });
    }

    for (let i = 1; i <= lastDay.getDate(); i++) {
      days.push({
        date: new Date(year, month, i),
        isCurrentMonth: true,
      });
    }

    const remainingDays = 42 - days.length;
    for (let i = 1; i <= remainingDays; i++) {
      days.push({
        date: new Date(year, month + 1, i),
        isCurrentMonth: false,
      });
    }

    return days;
  };

  const isSameDay = (d1: Date, d2: Date) => {
    return (
      d1.getFullYear() === d2.getFullYear() &&
      d1.getMonth() === d2.getMonth() &&
      d1.getDate() === d2.getDate()
    );
  };

  const getEventsForDate = (date: Date) => {
    return events.filter((event) => {
      const eventDate = new Date(event.start_time);
      return isSameDay(eventDate, date);
    });
  };

  const prevMonth = () => {
    setCurrentDate(new Date(currentDate.getFullYear(), currentDate.getMonth() - 1, 1));
  };
  const nextMonth = () => {
    setCurrentDate(new Date(currentDate.getFullYear(), currentDate.getMonth() + 1, 1));
  };
  const thisMonth = () => {
    const today = new Date();
    setCurrentDate(today);
    setSelectedDate(today);
  };

  const formatTime = (isoString: string) => {
    try {
      return new Date(isoString).toLocaleTimeString('ja-JP', {
        hour: '2-digit',
        minute: '2-digit',
      });
    } catch {
      return '';
    }
  };

  if (authChecking) {
    return (
      <div className="h-screen flex items-center justify-center bg-slate-100 text-xs font-semibold text-slate-500">
        認証確認中...
      </div>
    );
  }

  const selectedDateEvents = getEventsForDate(selectedDate);

  return (
    <div className="flex h-screen bg-slate-100 text-slate-800 overflow-hidden relative">
      
      {/* --------------------------------------------------
          1. 左サイドメニューバー
      -------------------------------------------------- */}
      <aside className="w-16 md:w-60 bg-white border-r border-slate-200 flex flex-col justify-between p-3 md:p-5 shrink-0 z-20">
        <div className="space-y-6">
          {/* BOOK KING ロゴ */}
          <div className="flex items-center justify-center md:justify-start">
            <span className="hidden md:inline font-black text-xl text-slate-900 tracking-wider">
              BOOK KING
            </span>
            <span className="md:hidden font-black text-lg text-slate-900">
              BK
            </span>
          </div>

          {/* メニューアイコンリスト */}
          <nav className="space-y-1.5">
            {/* カレンダーボタン */}
            <Link
              href="/calendar"
              className="flex items-center justify-center md:justify-start gap-3 p-2.5 rounded-xl bg-slate-900 text-white transition shadow-xs"
            >
              <svg className="w-5 h-5 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
              </svg>
              <span className="hidden md:inline text-xs font-bold">カレンダー</span>
            </Link>

            {/* グループ移動ボタン（未加入時のみ薄字表示） */}
            <Link
              href="/groups"
              className="flex items-center justify-center md:justify-start gap-3 p-2.5 rounded-xl text-slate-600 hover:bg-slate-100 transition"
            >
              <svg className="w-5 h-5 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z" />
              </svg>
              <div className="hidden md:flex items-center gap-1.5">
                <span className="text-xs font-bold">グループ</span>
                {userGroups.length === 0 && (
                  <span className="text-[10px] text-slate-400 font-normal">（未加入）</span>
                )}
              </div>
            </Link>
          </nav>
        </div>

        {/* 下部：アカウントメニュー */}
        <div className="pt-4 border-t border-slate-100 flex items-center justify-center md:justify-start relative">
          <UserMenu />
        </div>
      </aside>

      {/* --------------------------------------------------
          2. メインエリア (ヘッダー + カレンダー + 予定詳細)
      -------------------------------------------------- */}
      <div className="flex-1 flex flex-col min-w-0 overflow-y-auto">
        {/* ヘッダー */}
        <header className="bg-white border-b border-slate-200 p-3 md:p-4 flex flex-wrap items-center justify-between gap-2 shrink-0">
          <div className="flex items-center gap-3 md:gap-4">
            <span className="text-base md:text-xl font-bold text-slate-800 whitespace-nowrap">
              {currentDate.getFullYear()}年 {currentDate.getMonth() + 1}月
            </span>

            <div className="flex items-center bg-white border border-slate-300 rounded-lg overflow-hidden shadow-xs text-xs">
              <button
                onClick={prevMonth}
                className="px-2.5 py-1.5 hover:bg-slate-50 text-slate-600 transition cursor-pointer"
              >
                &lt;
              </button>
              <button
                onClick={thisMonth}
                className="px-3 py-1.5 font-semibold border-x border-slate-200 hover:bg-slate-50 transition text-slate-700 cursor-pointer"
              >
                今月
              </button>
              <button
                onClick={nextMonth}
                className="px-2.5 py-1.5 hover:bg-slate-50 text-slate-600 transition cursor-pointer"
              >
                &gt;
              </button>
            </div>

            {/* グループ切り替えドロップダウン */}
            {userGroups.length > 0 && (
              <select
                value={selectedGroupId}
                onChange={(e) => {
                  const newGid = e.target.value;
                  setSelectedGroupId(newGid);
                  fetchEvents(newGid);
                }}
                className="px-3 py-1.5 bg-slate-50 border border-slate-300 rounded-lg text-xs font-bold text-slate-700 focus:outline-none focus:ring-2 focus:ring-slate-800 cursor-pointer"
              >
                <option value="ALL">表示: すべてのグループ ({userGroups.length})</option>
                {userGroups.map((g, idx) => (
                  <option key={`${g.id}-${idx}`} value={g.id}>
                    {g.name} ({g.id.slice(0, 6)}...)
                  </option>
                ))}
              </select>
            )}
          </div>

          <div className="flex items-center gap-2 md:gap-3">
            {/* 予定追加ボタン */}
            <button
              onClick={() => openAddEventModal()}
              disabled={userGroups.length === 0}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold text-white bg-slate-900 rounded-lg shadow-xs hover:bg-slate-800 active:scale-95 disabled:opacity-40 transition duration-150 cursor-pointer"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 4v16m8-8H4" />
              </svg>
              <span>予定を追加</span>
            </button>

            {/* 更新ボタン */}
            <button
              onClick={() => fetchEvents()}
              className="flex items-center gap-2 px-3 py-1.5 text-xs font-semibold text-slate-700 bg-white border border-slate-300 rounded-lg shadow-xs hover:bg-slate-50 hover:border-slate-400 active:bg-slate-100 transition duration-150 cursor-pointer"
            >
              <svg className="w-3.5 h-3.5 text-slate-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
              </svg>
              更新
            </button>
          </div>
        </header>

        {/* カレンダーグリッド + 詳細パネル */}
        <div className="flex-1 p-3 md:p-6 flex flex-col lg:flex-row gap-4 overflow-y-auto">
          {/* カレンダーグリッド */}
          <div className="flex-1 bg-white border border-slate-200 rounded-2xl shadow-xs flex flex-col overflow-hidden min-h-[400px] lg:min-h-0">
            <div className="grid grid-cols-7 border-b border-slate-200 bg-slate-50 text-center text-xs font-semibold text-slate-500 py-2.5">
              <span className="text-red-500">日</span>
              <span>月</span>
              <span>火</span>
              <span>水</span>
              <span>木</span>
              <span>金</span>
              <span className="text-blue-500">土</span>
            </div>

            <div className="flex-1 grid grid-cols-7 grid-rows-6 divide-x divide-y divide-slate-100">
              {getCalendarDays().map((item, index) => {
                const dayEvents = getEventsForDate(item.date);
                const isSelected = isSameDay(item.date, selectedDate);
                const isToday = isSameDay(item.date, new Date());

                return (
                  <div
                    key={index}
                    onClick={() => setSelectedDate(item.date)}
                    className={`p-1 md:p-1.5 flex flex-col justify-between cursor-pointer transition hover:bg-blue-50/50 ${
                      !item.isCurrentMonth ? 'bg-slate-50/50 text-slate-300' : 'text-slate-700'
                    } ${isSelected ? 'bg-blue-50 ring-2 ring-blue-500 ring-inset' : ''}`}
                  >
                    <div className="flex justify-between items-start">
                      <span className={`text-[11px] md:text-xs font-semibold px-1.5 py-0.5 rounded-full ${isToday ? 'bg-slate-900 text-white' : ''}`}>
                        {item.date.getDate()}
                      </span>
                      {dayEvents.length > 0 && (
                        <span className="text-[9px] md:text-[10px] bg-slate-100 text-slate-700 font-bold px-1.5 py-0.2 rounded-full border border-slate-200">
                          {dayEvents.length}
                        </span>
                      )}
                    </div>

                    <div className="flex-1 mt-1 space-y-0.5 md:space-y-1 overflow-hidden">
                      {dayEvents.slice(0, 2).map((evt, idx) => (
                        <div key={idx} className="text-[9px] md:text-[10px] bg-slate-800 text-white px-1 py-0.5 rounded truncate">
                          {evt.title}
                        </div>
                      ))}
                      {dayEvents.length > 2 && (
                        <div className="text-[8px] md:text-[9px] text-slate-400 font-medium pl-0.5">
                          他 {dayEvents.length - 2} 件
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* 選択日の予定パネル */}
          <div className="w-full lg:w-80 bg-white border border-slate-200 rounded-2xl shadow-xs p-4 md:p-5 flex flex-col overflow-hidden shrink-0">
            <div className="flex items-center justify-between pb-2.5 border-b border-slate-100">
              <h2 className="font-bold text-slate-800 text-xs flex items-center gap-1.5">
                <span className="text-slate-900 font-bold">
                  {selectedDate.getMonth() + 1}月{selectedDate.getDate()}日の予定
                </span>
                <span className="text-slate-400 font-normal">
                  {['日', '月', '火', '水', '木', '金', '土'][selectedDate.getDay()]}曜日
                </span>
              </h2>

              {userGroups.length > 0 && (
                <button
                  onClick={() => openAddEventModal(selectedDate)}
                  className="text-slate-600 hover:text-slate-900 transition p-1 hover:bg-slate-100 rounded-md cursor-pointer"
                  title="選択日に予定を追加"
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 4v16m8-8H4" />
                  </svg>
                </button>
              )}
            </div>

            <div className="flex-1 overflow-y-auto mt-3 space-y-2.5 pr-1 min-h-[120px]">
              {userGroups.length === 0 ? (
                <div className="text-center text-xs text-slate-400 py-8 lg:py-12 space-y-2">
                  <p>現在グループに未加入です</p>
                  <p className="text-[11px] text-slate-400">予定を登録・共有するにはグループに参加してください</p>
                  <Link
                    href="/groups"
                    className="inline-block mt-2 px-3 py-1.5 bg-slate-900 text-white font-semibold rounded-lg hover:bg-slate-800 transition"
                  >
                    グループ一覧へ
                  </Link>
                </div>
              ) : selectedDateEvents.length === 0 ? (
                <div className="text-center text-xs text-slate-400 py-8 lg:py-12 space-y-3">
                  <p>予定はありません</p>
                  <button
                    onClick={() => openAddEventModal(selectedDate)}
                    className="px-3 py-1.5 bg-slate-100 border border-slate-200 text-slate-700 font-semibold text-xs rounded-lg hover:bg-slate-200 transition cursor-pointer"
                  >
                    + 予定を追加する
                  </button>
                </div>
              ) : (
                selectedDateEvents.map((evt, idx) => (
                  <div key={evt.id || idx} className="p-3 bg-slate-50 border border-slate-200 rounded-xl hover:border-slate-300 transition">
                    <div className="text-[11px] font-semibold text-slate-500 mb-1">
                      {formatTime(evt.start_time)} - {formatTime(evt.end_time)}
                    </div>
                    <div className="font-bold text-slate-900 text-sm mb-1">{evt.title}</div>
                    {evt.description && (
                      <div className="text-xs text-slate-500">{evt.description}</div>
                    )}
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      </div>

      {/* --------------------------------------------------
          3. 予定追加モーダル (UserMenu.tsx と統一デザイン)
      -------------------------------------------------- */}
      {isAddModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center backdrop-blur-md bg-slate-900/40 p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md overflow-hidden border border-slate-200">
            {/* モーダルヘッダー */}
            <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100 bg-slate-50">
              <h3 className="text-sm font-bold text-slate-900">予定の追加</h3>
              <button
                type="button"
                onClick={() => setIsAddModalOpen(false)}
                className="text-slate-400 hover:text-slate-600 transition font-bold text-sm cursor-pointer"
              >
                ✕
              </button>
            </div>

            {/* モーダルコンテンツ */}
            <div className="p-6 max-h-[75vh] overflow-y-auto">
              {eventErrorMessage && (
                <div className="mb-4 p-2.5 bg-red-50 border border-red-200 text-red-600 rounded-lg text-xs font-medium text-center">
                  {eventErrorMessage}
                </div>
              )}

              <form onSubmit={handleSaveEvent} className="space-y-4">
                {/* 予定タイトル */}
                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">
                    タイトル <span className="text-red-500">*</span>
                  </label>
                  <input
                    type="text"
                    required
                    value={eventTitle}
                    onChange={(e) => setEventTitle(e.target.value)}
                    placeholder="例: チームミーティング"
                    className="w-full px-3 py-2 text-xs border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-slate-800"
                  />
                </div>

                {/* 対象グループ選択 */}
                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">
                    追加先グループ <span className="text-red-500">*</span>
                  </label>
                  <select
                    value={eventTargetGroupId}
                    onChange={(e) => setEventTargetGroupId(e.target.value)}
                    className="w-full px-3 py-2 text-xs border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-slate-800 bg-white cursor-pointer font-semibold text-slate-700"
                  >
                    {userGroups.map((g, idx) => (
                      <option key={`${g.id}-${idx}`} value={g.id}>
                        {g.name}
                      </option>
                    ))}
                  </select>
                </div>

                {/* 日付 */}
                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">日付</label>
                  <input
                    type="date"
                    required
                    value={eventDate}
                    onChange={(e) => setEventDate(e.target.value)}
                    className="w-full px-3 py-2 text-xs border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-slate-800"
                  />
                </div>

                {/* 開始・終了時間 */}
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-bold text-slate-700 mb-1">開始時間</label>
                    <input
                      type="time"
                      required
                      value={eventStartTime}
                      onChange={(e) => setEventStartTime(e.target.value)}
                      className="w-full px-3 py-2 text-xs border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-slate-800"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-bold text-slate-700 mb-1">終了時間</label>
                    <input
                      type="time"
                      required
                      value={eventEndTime}
                      onChange={(e) => setEventEndTime(e.target.value)}
                      className="w-full px-3 py-2 text-xs border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-slate-800"
                    />
                  </div>
                </div>

                {/* メモ・詳細 */}
                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">メモ / 詳細</label>
                  <textarea
                    value={eventDescription}
                    onChange={(e) => setEventDescription(e.target.value)}
                    placeholder="会議のアジェンダや持ち物など"
                    rows={3}
                    className="w-full px-3 py-2 text-xs border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-slate-800 resize-none"
                  />
                </div>

                {/* 保存ボタン */}
                <div className="pt-2 flex gap-2">
                  <button
                    type="button"
                    onClick={() => setIsAddModalOpen(false)}
                    className="flex-1 py-2 text-xs font-semibold border border-slate-300 rounded-lg text-slate-600 hover:bg-slate-50 transition cursor-pointer"
                  >
                    キャンセル
                  </button>
                  <button
                    type="submit"
                    disabled={isSavingEvent}
                    className="flex-1 py-2 bg-slate-900 text-white font-semibold text-xs rounded-lg hover:bg-slate-800 disabled:opacity-50 transition cursor-pointer"
                  >
                    {isSavingEvent ? '保存中...' : '予定を保存'}
                  </button>
                </div>
              </form>
            </div>
          </div>
        </div>
      )}

      {/* --------------------------------------------------
          4. AIチャットサイドパネル
      -------------------------------------------------- */}
      <div
        className={`fixed top-0 right-0 h-full bg-white border-l border-slate-200 flex flex-col shadow-2xl z-40 transition-all duration-300 ease-in-out overflow-hidden ${
          isChatOpen ? 'w-full sm:w-96 opacity-100' : 'w-0 opacity-0 pointer-events-none'
        }`}
      >
        <div className="min-w-[320px] sm:min-w-[384px] flex-1 flex flex-col h-full">
          <div className="p-4 border-b border-slate-200 bg-slate-900 text-white flex items-center justify-between">
            <div className="flex items-center gap-2.5">
              <span className="text-xs font-bold bg-slate-800 text-slate-200 px-2 py-0.5 rounded border border-slate-700">
                AI
              </span>
              <div>
                <h2 className="font-bold text-sm leading-none">アシスタント</h2>
                <p className="text-[10px] text-slate-400 mt-1">日程調整・予定追加</p>
              </div>
            </div>

            <div className="flex items-center gap-2">
              <button
                onClick={handleClearHistory}
                disabled={clearing}
                className="p-1.5 hover:bg-slate-800 rounded-lg text-slate-400 hover:text-white transition text-xs cursor-pointer"
                title="チャット履歴を削除"
              >
                🗑️
              </button>
              <button
                onClick={() => setIsChatOpen(false)}
                className="p-1.5 hover:bg-slate-800 rounded-lg text-slate-400 hover:text-white transition font-bold text-sm cursor-pointer"
              >
                ✕
              </button>
            </div>
          </div>

          {/* メッセージリスト */}
          <div className="flex-1 p-4 overflow-y-auto space-y-3 bg-slate-50 text-xs">
            {messages.map((msg, index) => (
              <div
                key={index}
                className={`flex flex-col ${
                  msg.role === 'user' ? 'items-end' : 'items-start'
                }`}
              >
                <div
                  className={`max-w-[85%] p-3 rounded-2xl ${
                    msg.role === 'user'
                      ? 'bg-slate-900 text-white rounded-br-none'
                      : 'bg-white border border-slate-200 text-slate-800 rounded-bl-none shadow-xs'
                  }`}
                >
                  <ReactMarkdown remarkPlugins={[remarkGfm]}>
                    {msg.content}
                  </ReactMarkdown>
                </div>
              </div>
            ))}
            {loading && (
              <div className="flex justify-start">
                <div className="bg-white border border-slate-200 text-slate-500 p-3 rounded-2xl rounded-bl-none text-xs shadow-xs">
                  AIが考え中...
                </div>
              </div>
            )}
            <div ref={chatEndRef} />
          </div>

          {/* チャット入力フォーム */}
          <form
            onSubmit={handleSendMessage}
            className="p-3 border-t border-slate-200 bg-white flex gap-2"
          >
            <input
              type="text"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="例: 明日14時にミーティング追加"
              disabled={loading}
              className="flex-1 px-3 py-2 text-xs border border-slate-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-slate-800"
            />
            <button
              type="submit"
              disabled={loading || !input.trim()}
              className="px-4 py-2 bg-slate-900 text-white font-bold text-xs rounded-xl hover:bg-slate-800 disabled:opacity-50 transition shrink-0 cursor-pointer"
            >
              送信
            </button>
          </form>
        </div>
      </div>

      {/* --------------------------------------------------
          5. AIトグルフローティングボタン (isChatOpen === false 時のみレンダリング)
      -------------------------------------------------- */}
      {!isChatOpen && (
        <button
          onClick={() => setIsChatOpen(true)}
          className="fixed bottom-6 right-6 z-40 p-3.5 bg-slate-900 text-white rounded-full shadow-2xl hover:bg-slate-800 active:scale-95 transition flex items-center justify-center cursor-pointer border border-slate-700"
          title="AIアシスタントを開く"
          aria-label="AIアシスタントを開く"
        >
          <span className="text-xl">🤖</span>
        </button>
      )}
    </div>
  );
}

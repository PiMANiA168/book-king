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

interface UserProfile {
  id: string;
  full_name?: string;
  avatar_url?: string;
  email?: string;
}

interface CalendarEvent {
  id: string;
  title: string;
  start_time: string;
  end_time: string;
  description?: string;
  group_id: string;
  created_by: string;
  color?: string;
  creator?: UserProfile;
  participants?: UserProfile[];
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

const COLOR_OPTIONS = [
  { name: 'ブルー', value: '#3b82f6' },
  { name: 'グリーン', value: '#10b981' },
  { name: 'レッド', value: '#ef4444' },
  { name: 'パープル', value: '#8b5cf6' },
  { name: 'オレンジ', value: '#f97316' },
  { name: 'グレー', value: '#64748b' },
];

const DEFAULT_WELCOME_MESSAGE: ChatMessage = {
  role: 'assistant',
  content: 'こんにちは！BOOK KINGのAIアシスタントです。予定の追加指示などを入力してください！（例：「10月30日、メンバー全員でワホーの予定を入れて」）',
};

const getUserDisplayName = (user?: UserProfile) => {
  if (!user) return 'ユーザー';
  if (user.full_name && user.full_name.trim() && user.full_name !== '作成者' && user.full_name !== 'メンバー') {
    return user.full_name;
  }
  if (user.email) return user.email.split('@')[0];
  if (user.id) return `ユーザー_${user.id.slice(0, 4)}`;
  return 'ユーザー';
};

const getAvatarBgColor = (id: string) => {
  const colors = [
    'bg-red-500', 'bg-blue-500', 'bg-emerald-500', 'bg-amber-500',
    'bg-purple-500', 'bg-pink-500', 'bg-indigo-500', 'bg-teal-500', 'bg-cyan-500'
  ];
  let hash = 0;
  for (let i = 0; i < id.length; i++) {
    hash = id.charCodeAt(i) + ((hash << 5) - hash);
  }
  return colors[Math.abs(hash) % colors.length];
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
  const [currentUserProfile, setCurrentUserProfile] = useState<UserProfile | null>(null);
  const [userGroups, setUserGroups] = useState<GroupInfo[]>([]);
  const [selectedGroupId, setSelectedGroupId] = useState<string>('ALL');
  const [groupMembersMap, setGroupMembersMap] = useState<Record<string, UserProfile[]>>({});
  const [authChecking, setAuthChecking] = useState(true);

  // 予定詳細・編集モーダル用ステート
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingEvent, setEditingEvent] = useState<CalendarEvent | null>(null);
  const [eventTitle, setEventTitle] = useState('');
  const [eventDate, setEventDate] = useState('');
  const [isAllDay, setIsAllDay] = useState(false); // 終日フラグ
  const [eventStartTime, setEventStartTime] = useState('10:00');
  const [eventEndTime, setEventEndTime] = useState('11:00');
  const [eventDescription, setEventDescription] = useState('');
  const [eventTargetGroupId, setEventTargetGroupId] = useState('');
  const [eventColor, setEventColor] = useState('#3b82f6');
  const [selectedParticipantIds, setSelectedParticipantIds] = useState<string[]>([]);
  const [isSavingEvent, setIsSavingEvent] = useState(false);
  const [eventErrorMessage, setEventErrorMessage] = useState('');

  const chatEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (isChatOpen) {
      chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
  }, [messages, loading, isChatOpen]);

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

        const { data: myProfileData } = await supabase
          .from('profiles')
          .select('id, full_name, avatar_url, email')
          .eq('id', currentUserId)
          .maybeSingle();

        let myProfile: UserProfile;
        if (myProfileData && myProfileData.full_name) {
          myProfile = myProfileData;
        } else {
          const fallbackName = session.user.user_metadata?.full_name || session.user.email?.split('@')[0];
          myProfile = {
            id: currentUserId,
            full_name: fallbackName,
            email: session.user.email,
            avatar_url: session.user.user_metadata?.avatar_url,
          };
        }
        setCurrentUserProfile(myProfile);

        const { data: memberData } = await supabase
          .from('group_members')
          .select('group_id, groups(id, name)')
          .eq('user_id', currentUserId);

        const groups: GroupInfo[] = [];
        if (memberData && memberData.length > 0) {
          memberData.forEach((item: any) => {
            if (item.groups) {
              groups.push({ id: item.groups.id, name: item.groups.name || 'グループ' });
            }
          });
        }

        setUserGroups(groups);

        if (groups.length > 0) {
          setSelectedGroupId('ALL');
          const groupIds = groups.map((g) => g.id);
          await fetchEvents('ALL', groupIds, myProfile);
          await fetchAllGroupMembers(groupIds, myProfile);
        }

        fetchChatHistory(currentUserId);
      } catch (err) {
        console.error('初期化エラー:', err);
      } finally {
        setAuthChecking(false);
      }
    };

    initData();
  }, []);

  const fetchAllGroupMembers = async (groupIds: string[], myProf?: UserProfile) => {
    if (groupIds.length === 0) return;

    const { data: memberRows } = await supabase
      .from('group_members')
      .select('group_id, user_id')
      .in('group_id', groupIds);

    if (!memberRows || memberRows.length === 0) return;

    const allUserIds = Array.from(new Set(memberRows.map((m) => m.user_id)));
    
    const { data: profileRows } = await supabase
      .from('profiles')
      .select('id, full_name, avatar_url, email')
      .in('id', allUserIds);

    const profileMap: Record<string, UserProfile> = {};
    if (profileRows) {
      profileRows.forEach((p) => {
        profileMap[p.id] = p;
      });
    }

    const activeMyProf = myProf || currentUserProfile;
    if (activeMyProf) {
      profileMap[activeMyProf.id] = { ...activeMyProf, ...profileMap[activeMyProf.id] };
    }

    const map: Record<string, UserProfile[]> = {};
    memberRows.forEach((item) => {
      const gid = item.group_id;
      if (!map[gid]) map[gid] = [];
      const prof = profileMap[item.user_id] || { id: item.user_id };
      if (!map[gid].some((p) => p.id === prof.id)) {
        map[gid].push(prof);
      }
    });

    setGroupMembersMap(map);
  };

  const fetchEvents = async (targetGroupId?: string, availableGroupIds?: string[], myProf?: UserProfile) => {
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

    const { data: rawEvents, error } = await query.order('start_time', { ascending: true });

    if (!error && rawEvents) {
      const eventIds = rawEvents.map((e) => e.id);

      let partRows: { event_id: string; user_id: string }[] = [];
      if (eventIds.length > 0) {
        const { data: pData } = await supabase
          .from('event_participants')
          .select('event_id, user_id')
          .in('event_id', eventIds);
        if (pData) partRows = pData;
      }

      const neededUserIds = new Set<string>();
      rawEvents.forEach((e) => {
        if (e.created_by) neededUserIds.add(e.created_by);
      });
      partRows.forEach((p) => {
        if (p.user_id) neededUserIds.add(p.user_id);
      });

      let profilesMap: Record<string, UserProfile> = {};
      if (neededUserIds.size > 0) {
        const { data: profs } = await supabase
          .from('profiles')
          .select('id, full_name, avatar_url, email')
          .in('id', Array.from(neededUserIds));

        if (profs) {
          profs.forEach((p) => {
            profilesMap[p.id] = p;
          });
        }
      }

      const activeMyProf = myProf || currentUserProfile;
      if (activeMyProf) {
        profilesMap[activeMyProf.id] = { ...activeMyProf, ...profilesMap[activeMyProf.id] };
      }

      const eventParticipantsMap: Record<string, UserProfile[]> = {};
      partRows.forEach((p) => {
        if (!eventParticipantsMap[p.event_id]) eventParticipantsMap[p.event_id] = [];
        const prof = profilesMap[p.user_id] || { id: p.user_id };
        if (!eventParticipantsMap[p.event_id].some((x) => x.id === prof.id)) {
          eventParticipantsMap[p.event_id].push(prof);
        }
      });

      const formattedEvents: CalendarEvent[] = rawEvents.map((e) => {
        const creator = profilesMap[e.created_by] || { id: e.created_by };
        const participants = eventParticipantsMap[e.id] || [];

        return {
          ...e,
          creator,
          participants,
        };
      });

      setEvents(formattedEvents);
    }
  };

  const fetchChatHistory = async (targetUserId: string) => {
    const { data } = await supabase
      .from('chat_messages')
      .select('*')
      .eq('user_id', targetUserId)
      .order('created_at', { ascending: true });

    if (data && data.length > 0) {
      setMessages(data);
    }
  };

  const canUserEditEvent = (event: CalendarEvent | null) => {
    if (!event) return true;
    const isCreator = event.created_by === userId;
    const isParticipant = event.participants?.some((p) => p.id === userId);
    return isCreator || isParticipant;
  };

  const openModal = (targetDate?: Date, eventToEdit?: CalendarEvent) => {
    setEventErrorMessage('');
    if (eventToEdit) {
      setEditingEvent(eventToEdit);
      setEventTitle(eventToEdit.title);
      const startDate = new Date(eventToEdit.start_time);
      const endDate = new Date(eventToEdit.end_time);

      const yyyy = startDate.getFullYear();
      const mm = String(startDate.getMonth() + 1).padStart(2, '0');
      const dd = String(startDate.getDate()).padStart(2, '0');
      setEventDate(`${yyyy}-${mm}-${dd}`);

      const sTime = startDate.toTimeString().slice(0, 5);
      const eTime = endDate.toTimeString().slice(0, 5);

      if (sTime === '00:00' && eTime === '23:59') {
        setIsAllDay(true);
        setEventStartTime('10:00');
        setEventEndTime('11:00');
      } else {
        setIsAllDay(false);
        setEventStartTime(sTime);
        setEventEndTime(eTime);
      }

      setEventDescription(eventToEdit.description || '');
      setEventTargetGroupId(eventToEdit.group_id);
      setEventColor(eventToEdit.color || '#3b82f6');
      setSelectedParticipantIds(eventToEdit.participants?.map((p) => p.id) || []);
    } else {
      setEditingEvent(null);
      const baseDate = targetDate || selectedDate || new Date();
      const yyyy = baseDate.getFullYear();
      const mm = String(baseDate.getMonth() + 1).padStart(2, '0');
      const dd = String(baseDate.getDate()).padStart(2, '0');

      setEventTitle('');
      setEventDate(`${yyyy}-${mm}-${dd}`);
      setIsAllDay(true); // デフォルト終日
      setEventStartTime('10:00');
      setEventEndTime('11:00');
      setEventDescription('');
      setEventColor('#3b82f6');
      const defaultGroup = selectedGroupId === 'ALL' ? (userGroups[0]?.id || '') : selectedGroupId;
      setEventTargetGroupId(defaultGroup);
      setSelectedParticipantIds([userId]);
    }
    setIsModalOpen(true);
  };

  const handleSaveEvent = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canUserEditEvent(editingEvent)) {
      setEventErrorMessage('この予定を変更する権限がありません。');
      return;
    }
    if (!eventTitle.trim()) {
      setEventErrorMessage('タイトルを入力してください。');
      return;
    }
    if (!eventTargetGroupId) {
      setEventErrorMessage('グループを選択してください。');
      return;
    }

    setIsSavingEvent(true);
    setEventErrorMessage('');

    try {
      const finalStart = isAllDay ? '00:00:00' : `${eventStartTime}:00`;
      const finalEnd = isAllDay ? '23:59:59' : `${eventEndTime}:00`;

      const startDateTime = new Date(`${eventDate}T${finalStart}`).toISOString();
      const endDateTime = new Date(`${eventDate}T${finalEnd}`).toISOString();

      let currentEventId = editingEvent?.id;

      if (editingEvent) {
        const { error } = await supabase
          .from('events')
          .update({
            title: eventTitle.trim(),
            start_time: startDateTime,
            end_time: endDateTime,
            description: eventDescription.trim() || null,
            group_id: eventTargetGroupId,
            color: eventColor,
          })
          .eq('id', editingEvent.id);

        if (error) throw error;
      } else {
        const { data, error } = await supabase
          .from('events')
          .insert({
            title: eventTitle.trim(),
            start_time: startDateTime,
            end_time: endDateTime,
            description: eventDescription.trim() || null,
            group_id: eventTargetGroupId,
            created_by: userId,
            color: eventColor,
          })
          .select()
          .single();

        if (error) throw error;
        currentEventId = data.id;
      }

      if (currentEventId) {
        await supabase.from('event_participants').delete().eq('event_id', currentEventId);

        if (selectedParticipantIds.length > 0) {
          const participantRows = selectedParticipantIds.map((pid) => ({
            event_id: currentEventId,
            user_id: pid,
          }));
          await supabase.from('event_participants').insert(participantRows);
        }
      }

      setIsModalOpen(false);
      await fetchEvents();
    } catch (err: any) {
      console.error('予定保存エラー:', err);
      setEventErrorMessage('予定の保存に失敗しました。');
    } finally {
      setIsSavingEvent(false);
    }
  };

  const handleDeleteEvent = async () => {
    if (!editingEvent || !canUserEditEvent(editingEvent)) return;
    if (!window.confirm('この予定を削除してもよろしいですか？')) return;

    try {
      const { error } = await supabase.from('events').delete().eq('id', editingEvent.id);
      if (error) throw error;
      setIsModalOpen(false);
      await fetchEvents();
    } catch (err) {
      console.error('予定削除エラー:', err);
      alert('削除に失敗しました。');
    }
  };

  const handleClearHistory = async () => {
    if (!userId || clearing) return;
    if (!window.confirm('チャット履歴を消去しますか？')) return;

    setClearing(true);
    try {
      await supabase.from('chat_messages').delete().eq('user_id', userId);
      setMessages([DEFAULT_WELCOME_MESSAGE]);
    } catch (err) {
      console.error('履歴削除エラー:', err);
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

        if (data.eventAdded) await fetchEvents();
      }
    } catch (error) {
      console.error('AI送信エラー:', error);
    } finally {
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

  const prevMonth = () => setCurrentDate(new Date(currentDate.getFullYear(), currentDate.getMonth() - 1, 1));
  const nextMonth = () => setCurrentDate(new Date(currentDate.getFullYear(), currentDate.getMonth() + 1, 1));
  const thisMonth = () => {
    const today = new Date();
    setCurrentDate(today);
    setSelectedDate(today);
  };

  const formatEventTimeDisplay = (startTimeIso: string, endTimeIso: string) => {
    try {
      const s = new Date(startTimeIso);
      const e = new Date(endTimeIso);
      const sTime = s.toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit' });
      const eTime = e.toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit' });

      if (sTime === '00:00' && (eTime === '23:59' || eTime === '00:00')) {
        return '終日';
      }
      return `${sTime} - ${eTime}`;
    } catch {
      return '';
    }
  };

  const renderAvatar = (user?: UserProfile, size = 'w-4 h-4 text-[9px]') => {
    if (!user) return null;
    const name = getUserDisplayName(user);

    if (user.avatar_url) {
      return (
        <img
          src={user.avatar_url}
          alt={name}
          title={name}
          className={`${size} rounded-full object-cover border border-white shrink-0`}
        />
      );
    }

    const initial = name.charAt(0).toUpperCase();
    const bgColor = getAvatarBgColor(user.id || name);

    return (
      <div
        title={name}
        className={`${size} rounded-full ${bgColor} text-white font-bold flex items-center justify-center border border-white shrink-0 shadow-xs`}
      >
        {initial}
      </div>
    );
  };

  if (authChecking) {
    return (
      <div className="h-screen flex items-center justify-center bg-slate-100 text-xs font-semibold text-slate-500">
        認証確認中...
      </div>
    );
  }

  const selectedDateEvents = getEventsForDate(selectedDate);
  const currentAvailableMembers = eventTargetGroupId ? (groupMembersMap[eventTargetGroupId] || []) : [];
  const isEditable = canUserEditEvent(editingEvent);

  return (
    <div className="flex h-[100dvh] bg-slate-100 text-slate-800 overflow-hidden relative">
      <aside className="w-16 md:w-60 bg-white border-r border-slate-200 flex flex-col justify-between p-3 md:p-5 shrink-0 z-20">
        <div className="space-y-6">
          <div className="flex items-center justify-center md:justify-start">
            <span className="hidden md:inline font-black text-xl text-slate-900 tracking-wider">
              BOOK KING
            </span>
            <span className="md:hidden font-black text-lg text-slate-900">BK</span>
          </div>

          <nav className="space-y-1.5">
            <Link
              href="/calendar"
              className="flex items-center justify-center md:justify-start gap-3 p-2.5 rounded-xl bg-slate-900 text-white transition shadow-xs"
            >
              <svg className="w-5 h-5 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
              </svg>
              <span className="hidden md:inline text-xs font-bold">カレンダー</span>
            </Link>

            <Link
              href="/groups"
              className="flex items-center justify-center md:justify-start gap-3 p-2.5 rounded-xl text-slate-600 hover:bg-slate-100 transition"
            >
              <svg className="w-5 h-5 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z" />
              </svg>
              <div className="hidden md:flex items-center gap-1.5">
                <span className="text-xs font-bold">グループ</span>
              </div>
            </Link>
          </nav>
        </div>

        <div className="pt-4 border-t border-slate-100 flex items-center justify-center md:justify-start relative">
          <UserMenu />
        </div>
      </aside>

      <div className="flex-1 flex flex-col min-w-0 h-[100dvh] overflow-hidden">
        <header className="bg-white border-b border-slate-200 p-3 md:p-4 flex flex-wrap items-center justify-between gap-2 shrink-0">
          <div className="flex items-center gap-2 md:gap-4">
            <span className="text-sm md:text-xl font-bold text-slate-800 whitespace-nowrap">
              {currentDate.getFullYear()}年 {currentDate.getMonth() + 1}月
            </span>

            <div className="flex items-center bg-white border border-slate-300 rounded-lg overflow-hidden shadow-xs text-xs">
              <button onClick={prevMonth} className="px-2 py-1 hover:bg-slate-50 text-slate-600 transition">&lt;</button>
              <button onClick={thisMonth} className="px-2.5 py-1 font-semibold border-x border-slate-200 hover:bg-slate-50 transition text-slate-700">今月</button>
              <button onClick={nextMonth} className="px-2 py-1 hover:bg-slate-50 text-slate-600 transition">&gt;</button>
            </div>

            {userGroups.length > 0 && (
              <select
                value={selectedGroupId}
                onChange={(e) => {
                  const newGid = e.target.value;
                  setSelectedGroupId(newGid);
                  fetchEvents(newGid);
                }}
                className="px-2 py-1 md:px-3 md:py-1.5 bg-slate-50 border border-slate-300 rounded-lg text-xs font-bold text-slate-700 max-w-[130px] md:max-w-xs truncate"
              >
                <option value="ALL">全グループ ({userGroups.length})</option>
                {userGroups.map((g, idx) => (
                  <option key={`${g.id}-${idx}`} value={g.id}>{g.name}</option>
                ))}
              </select>
            )}
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={() => openModal()}
              disabled={userGroups.length === 0}
              className="flex items-center gap-1 px-3 py-1.5 text-xs font-bold text-white bg-slate-900 rounded-lg hover:bg-slate-800 transition cursor-pointer"
            >
              <span>+ 予定追加</span>
            </button>
          </div>
        </header>

        <div className="flex-1 p-2 md:p-5 flex flex-col lg:flex-row gap-3 md:gap-4 overflow-y-auto">
          {/* カレンダーグリッド */}
          <div className="flex-1 bg-white border border-slate-200 rounded-2xl shadow-xs flex flex-col overflow-hidden min-h-[360px] lg:min-h-0">
            <div className="grid grid-cols-7 border-b border-slate-200 bg-slate-50 text-center text-xs font-semibold text-slate-500 py-2">
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
                    className={`p-1 flex flex-col justify-between cursor-pointer transition hover:bg-blue-50/50 ${
                      !item.isCurrentMonth ? 'bg-slate-50/50 text-slate-300' : 'text-slate-700'
                    } ${isSelected ? 'bg-blue-50 ring-2 ring-blue-500 ring-inset' : ''}`}
                  >
                    <div className="flex justify-between items-start">
                      <span className={`text-[10px] md:text-xs font-semibold px-1 py-0.2 rounded-full ${isToday ? 'bg-slate-900 text-white' : ''}`}>
                        {item.date.getDate()}
                      </span>
                    </div>

                    <div className="flex-1 mt-0.5 space-y-0.5 overflow-hidden">
                      {dayEvents.slice(0, 2).map((evt) => (
                        <div
                          key={evt.id}
                          onClick={(e) => {
                            e.stopPropagation();
                            openModal(undefined, evt);
                          }}
                          style={{ backgroundColor: evt.color || '#3b82f6' }}
                          className="text-[9px] md:text-[10px] text-white px-1 py-0.5 rounded truncate flex items-center justify-between shadow-xs hover:opacity-90"
                        >
                          <span className="truncate mr-1">{evt.title}</span>
                          
                          <div className="flex -space-x-1 shrink-0">
                            {evt.creator && renderAvatar(evt.creator, 'w-3.5 h-3.5 text-[7px]')}
                            {evt.participants
                              ?.filter((p) => p.id !== evt.created_by)
                              .slice(0, 2)
                              .map((p) => (
                                <div key={p.id}>{renderAvatar(p, 'w-3.5 h-3.5 text-[7px]')}</div>
                              ))}
                          </div>
                        </div>
                      ))}
                      {dayEvents.length > 2 && (
                        <div className="text-[8px] text-slate-400 font-medium">他 {dayEvents.length - 2} 件</div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* 選択日の詳細パネル */}
          <div className="w-full lg:w-80 bg-white border border-slate-200 rounded-2xl p-4 flex flex-col overflow-hidden shrink-0">
            <div className="flex items-center justify-between pb-2 border-b border-slate-100">
              <h2 className="font-bold text-slate-800 text-xs">
                {selectedDate.getMonth() + 1}月{selectedDate.getDate()}日の予定
              </h2>
              <button
                onClick={() => openModal(selectedDate)}
                className="text-xs text-slate-600 hover:text-slate-900 font-bold"
              >
                + 追加
              </button>
            </div>

            <div className="flex-1 overflow-y-auto mt-3 space-y-2 pr-1 min-h-[120px]">
              {selectedDateEvents.length === 0 ? (
                <div className="text-center text-xs text-slate-400 py-6">予定はありません</div>
              ) : (
                selectedDateEvents.map((evt) => (
                  <div
                    key={evt.id}
                    onClick={() => openModal(undefined, evt)}
                    className="p-3 bg-slate-50 border border-slate-200 rounded-xl hover:border-slate-400 transition cursor-pointer"
                  >
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-[10px] font-semibold text-slate-500">
                        {formatEventTimeDisplay(evt.start_time, evt.end_time)}
                      </span>
                      <span
                        className="w-2.5 h-2.5 rounded-full"
                        style={{ backgroundColor: evt.color || '#3b82f6' }}
                      />
                    </div>
                    <div className="font-bold text-slate-900 text-xs mb-1.5">{evt.title}</div>

                    <div className="flex items-center gap-1.5 mt-2 pt-1.5 border-t border-slate-200/60">
                      <span className="text-[10px] text-slate-400">参加者:</span>
                      <div className="flex items-center -space-x-1">
                        {evt.creator && renderAvatar(evt.creator, 'w-4 h-4 text-[8px]')}
                        {evt.participants
                          ?.filter((p) => p.id !== evt.created_by)
                          .map((p) => (
                            <div key={p.id}>{renderAvatar(p, 'w-4 h-4 text-[8px]')}</div>
                          ))}
                      </div>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      </div>

      {/* 予定追加・詳細・編集モーダル */}
      {isModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center backdrop-blur-md bg-slate-900/40 p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md overflow-hidden border border-slate-200">
            <div className="flex items-center justify-between px-5 py-3.5 border-b border-slate-100 bg-slate-50">
              <div className="flex items-center gap-2">
                <h3 className="text-xs font-bold text-slate-900">
                  {editingEvent ? '予定の詳細' : '新しい予定の作成'}
                </h3>
                {!isEditable && (
                  <span className="px-2 py-0.5 bg-amber-100 text-amber-800 text-[10px] font-bold rounded">
                    閲覧のみ
                  </span>
                )}
              </div>
              <button
                onClick={() => setIsModalOpen(false)}
                className="text-slate-400 hover:text-slate-600 font-bold text-sm"
              >
                ✕
              </button>
            </div>

            <div className="p-5 max-h-[80vh] overflow-y-auto">
              {!isEditable && (
                <div className="mb-3 p-2.5 bg-slate-100 border border-slate-200 rounded-lg text-xs text-slate-600">
                  🔒 この予定は作成者または同行者のみ変更・削除できます。
                </div>
              )}

              {eventErrorMessage && (
                <div className="mb-3 p-2 bg-red-50 text-red-600 text-xs rounded-lg text-center font-medium">
                  {eventErrorMessage}
                </div>
              )}

              <form onSubmit={handleSaveEvent} className="space-y-3.5">
                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">タイトル *</label>
                  <input
                    type="text"
                    required
                    disabled={!isEditable}
                    value={eventTitle}
                    onChange={(e) => setEventTitle(e.target.value)}
                    placeholder="例: チームミーティング"
                    className="w-full px-3 py-1.5 text-xs border border-slate-300 rounded-lg focus:ring-2 focus:ring-slate-800 disabled:bg-slate-100"
                  />
                </div>

                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">グループ *</label>
                  <select
                    value={eventTargetGroupId}
                    disabled={!isEditable}
                    onChange={(e) => {
                      setEventTargetGroupId(e.target.value);
                      setSelectedParticipantIds([userId]);
                    }}
                    className="w-full px-3 py-1.5 text-xs border border-slate-300 rounded-lg bg-white disabled:bg-slate-100"
                  >
                    {userGroups.map((g) => (
                      <option key={g.id} value={g.id}>{g.name}</option>
                    ))}
                  </select>
                </div>

                {/* 同行メンバー複数選択 */}
                {currentAvailableMembers.length > 0 && (
                  <div>
                    <label className="block text-xs font-bold text-slate-700 mb-1">同行メンバー（複数選択可）</label>
                    <div className="flex flex-wrap gap-1.5 p-2 border border-slate-200 rounded-lg bg-slate-50 max-h-28 overflow-y-auto">
                      {currentAvailableMembers.map((member) => {
                        const isSelected = selectedParticipantIds.includes(member.id);
                        const displayName = getUserDisplayName(member);

                        return (
                          <button
                            type="button"
                            key={member.id}
                            disabled={!isEditable}
                            onClick={() => {
                              if (isSelected) {
                                setSelectedParticipantIds(selectedParticipantIds.filter((id) => id !== member.id));
                              } else {
                                setSelectedParticipantIds([...selectedParticipantIds, member.id]);
                              }
                            }}
                            className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs transition border ${
                              isSelected
                                ? 'bg-slate-900 text-white border-slate-900'
                                : 'bg-white text-slate-600 border-slate-300 hover:bg-slate-100'
                            } ${!isEditable ? 'opacity-70 cursor-not-allowed' : 'cursor-pointer'}`}
                          >
                            {renderAvatar(member, 'w-4 h-4 text-[9px]')}
                            <span className="text-[11px] font-semibold">{displayName}</span>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                )}

                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">ラベルカラー</label>
                  <div className="flex gap-2 items-center">
                    {COLOR_OPTIONS.map((c) => (
                      <button
                        type="button"
                        key={c.value}
                        disabled={!isEditable}
                        onClick={() => setEventColor(c.value)}
                        style={{ backgroundColor: c.value }}
                        className={`w-6 h-6 rounded-full transition transform ${
                          eventColor === c.value ? 'ring-2 ring-offset-2 ring-slate-800 scale-110' : 'opacity-70 hover:opacity-100'
                        } ${!isEditable ? 'cursor-not-allowed' : 'cursor-pointer'}`}
                        title={c.name}
                      />
                    ))}
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">日付</label>
                  <input
                    type="date"
                    required
                    disabled={!isEditable}
                    value={eventDate}
                    onChange={(e) => setEventDate(e.target.value)}
                    className="w-full px-3 py-1.5 text-xs border border-slate-300 rounded-lg disabled:bg-slate-100"
                  />
                </div>

                {/* 終日設定チェックボックス */}
                <div className="flex items-center gap-2 pt-1">
                  <input
                    type="checkbox"
                    id="allDayCheckbox"
                    disabled={!isEditable}
                    checked={isAllDay}
                    onChange={(e) => setIsAllDay(e.target.checked)}
                    className="w-4 h-4 rounded text-slate-900 focus:ring-slate-800 cursor-pointer"
                  />
                  <label htmlFor="allDayCheckbox" className="text-xs font-bold text-slate-700 cursor-pointer">
                    終日に設定する
                  </label>
                </div>

                {/* 時間設定（終日チェック時は非表示） */}
                {!isAllDay && (
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <label className="block text-xs font-bold text-slate-700 mb-1">開始時間</label>
                      <input
                        type="time"
                        required={!isAllDay}
                        disabled={!isEditable}
                        value={eventStartTime}
                        onChange={(e) => setEventStartTime(e.target.value)}
                        className="w-full px-3 py-1.5 text-xs border border-slate-300 rounded-lg disabled:bg-slate-100"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-bold text-slate-700 mb-1">終了時間</label>
                      <input
                        type="time"
                        required={!isAllDay}
                        disabled={!isEditable}
                        value={eventEndTime}
                        onChange={(e) => setEventEndTime(e.target.value)}
                        className="w-full px-3 py-1.5 text-xs border border-slate-300 rounded-lg disabled:bg-slate-100"
                      />
                    </div>
                  </div>
                )}

                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">詳細・メモ</label>
                  <textarea
                    disabled={!isEditable}
                    value={eventDescription}
                    onChange={(e) => setEventDescription(e.target.value)}
                    rows={2}
                    className="w-full px-3 py-1.5 text-xs border border-slate-300 rounded-lg resize-none disabled:bg-slate-100"
                  />
                </div>

                <div className="pt-2 flex gap-2">
                  {editingEvent && isEditable && (
                    <button
                      type="button"
                      onClick={handleDeleteEvent}
                      className="px-3 py-1.5 bg-red-50 text-red-600 font-semibold text-xs rounded-lg hover:bg-red-100 transition cursor-pointer"
                    >
                      削除
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => setIsModalOpen(false)}
                    className="flex-1 py-1.5 text-xs font-semibold border border-slate-300 rounded-lg text-slate-600 hover:bg-slate-50 transition cursor-pointer"
                  >
                    {isEditable ? 'キャンセル' : '閉じる'}
                  </button>
                  {isEditable && (
                    <button
                      type="submit"
                      disabled={isSavingEvent}
                      className="flex-1 py-1.5 bg-slate-900 text-white font-semibold text-xs rounded-lg hover:bg-slate-800 transition cursor-pointer"
                    >
                      {isSavingEvent ? '保存中...' : '保存'}
                    </button>
                  )}
                </div>
              </form>
            </div>
          </div>
        </div>
      )}

      {/* AI チャットパネル */}
      <div
        className={`fixed top-0 right-0 h-full bg-white border-l border-slate-200 flex flex-col shadow-2xl z-40 transition-all duration-300 ${
          isChatOpen ? 'w-full sm:w-96 opacity-100' : 'w-0 opacity-0 pointer-events-none'
        }`}
      >
        <div className="min-w-[320px] sm:min-w-[384px] flex-1 flex flex-col h-full">
          <div className="p-4 border-b border-slate-200 bg-slate-900 text-white flex items-center justify-between">
            <span className="font-bold text-sm">AI アシスタント</span>
            <div className="flex items-center gap-2">
              <button onClick={handleClearHistory} className="text-xs">🗑️</button>
              <button onClick={() => setIsChatOpen(false)} className="font-bold text-sm">✕</button>
            </div>
          </div>

          <div className="flex-1 p-4 overflow-y-auto space-y-3 bg-slate-50 text-xs">
            {messages.map((msg, index) => (
              <div key={index} className={`flex flex-col ${msg.role === 'user' ? 'items-end' : 'items-start'}`}>
                <div className={`max-w-[85%] p-3 rounded-2xl ${msg.role === 'user' ? 'bg-slate-900 text-white' : 'bg-white border border-slate-200'}`}>
                  <ReactMarkdown remarkPlugins={[remarkGfm]}>{msg.content}</ReactMarkdown>
                </div>
              </div>
            ))}
            <div ref={chatEndRef} />
          </div>

          <form onSubmit={handleSendMessage} className="p-3 border-t border-slate-200 flex gap-2">
            <input
              type="text"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="メッセージを入力..."
              className="flex-1 px-3 py-2 text-xs border border-slate-300 rounded-xl"
            />
            <button type="submit" disabled={loading} className="px-4 py-2 bg-slate-900 text-white font-bold text-xs rounded-xl">
              送信
            </button>
          </form>
        </div>
      </div>

      {!isChatOpen && (
        <button
          onClick={() => setIsChatOpen(true)}
          className="fixed bottom-6 right-6 z-40 p-3.5 bg-slate-900 text-white rounded-full shadow-2xl hover:bg-slate-800 transition border border-slate-700"
        >
          🤖
        </button>
      )}
    </div>
  );
}

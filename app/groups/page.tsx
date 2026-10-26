'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const supabase = createClient(supabaseUrl, supabaseAnonKey);

type GroupMember = {
  user_id: string;
  role?: string;
  full_name?: string;
  avatar_url?: string;
};

type Group = {
  id: string;
  name: string;
  location?: string;
  created_by?: string;
  created_at: string;
  members?: GroupMember[];
};

export default function GroupsPage() {
  const [groups, setGroups] = useState<Group[]>([]);
  const [groupName, setGroupName] = useState('');
  const [joinGroupId, setJoinGroupId] = useState('');
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState('');
  const [currentUser, setCurrentUser] = useState<any>(null);
  const router = useRouter();

  // モーダル系ステート
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [selectedGroup, setSelectedGroup] = useState<Group | null>(null);
  const [editGroupName, setEditGroupName] = useState('');
  const [editGroupLocation, setEditGroupLocation] = useState('');
  const [groupMembers, setGroupMembers] = useState<GroupMember[]>([]);
  const [copiedLink, setCopiedLink] = useState(false);
  const [modalMessage, setModalMessage] = useState('');
  const [isModalSaving, setIsModalSaving] = useState(false);

  // 招待モーダル用
  const [inviteGroup, setInviteGroup] = useState<Group | null>(null);
  const [isInviteModalOpen, setIsInviteModalOpen] = useState(false);
  const [isAlreadyMember, setIsAlreadyMember] = useState(false);
  const [isJoiningInvite, setIsJoiningInvite] = useState(false);

  const fetchGroups = async () => {
    setLoading(true);
    const { data: { user } } = await supabase.auth.getUser();

    if (!user) {
      router.push('/login');
      return;
    }
    setCurrentUser(user);

    // 1. 自分の所属グループID一覧
    const { data: memberData, error: memberError } = await supabase
      .from('group_members')
      .select('group_id')
      .eq('user_id', user.id);

    if (memberError) {
      console.error(memberError);
      setLoading(false);
      return;
    }

    if (memberData && memberData.length > 0) {
      const groupIds = memberData.map((m) => m.group_id);
      
      // グループ本体情報の取得
      const { data: groupData } = await supabase
        .from('groups')
        .select('*')
        .in('id', groupIds);

      // 全グループメンバー情報（プロフィール紐付け）を取得
      const { data: allMembersData } = await supabase
        .from('group_members')
        .select('group_id, user_id, role, profiles(full_name, avatar_url)')
        .in('group_id', groupIds);

      const membersMap: Record<string, GroupMember[]> = {};
      if (allMembersData) {
        allMembersData.forEach((m: any) => {
          if (!membersMap[m.group_id]) membersMap[m.group_id] = [];
          membersMap[m.group_id].push({
            user_id: m.user_id,
            role: m.role,
            full_name: m.profiles?.full_name || '名前未設定',
            avatar_url: m.profiles?.avatar_url || null,
          });
        });
      }

      const formattedGroups: Group[] = (groupData || []).map((g) => ({
        ...g,
        members: membersMap[g.id] || [],
      }));

      setGroups(formattedGroups);
    } else {
      setGroups([]);
    }
    setLoading(false);
  };

  useEffect(() => {
    const init = async () => {
      await fetchGroups();
      checkInviteUrl();
    };
    init();
  }, []);

  const checkInviteUrl = async () => {
    if (typeof window === 'undefined') return;
    const params = new URLSearchParams(window.location.search);
    const targetGroupId = params.get('join');

    if (!targetGroupId) return;

    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;

    const { data: groupData } = await supabase
      .from('groups')
      .select('*')
      .eq('id', targetGroupId)
      .maybeSingle();

    if (!groupData) {
      setMessage('招待リンクのグループが見つかりませんでした。');
      return;
    }

    setInviteGroup(groupData);

    const { data: member } = await supabase
      .from('group_members')
      .select('group_id')
      .eq('group_id', targetGroupId)
      .eq('user_id', user.id)
      .maybeSingle();

    setIsAlreadyMember(!!member);
    setIsInviteModalOpen(true);
  };

  const handleConfirmInviteJoin = async () => {
    if (!inviteGroup || !currentUser) return;

    setIsJoiningInvite(true);
    try {
      const { error } = await supabase
        .from('group_members')
        .insert([{ group_id: inviteGroup.id, user_id: currentUser.id, role: 'member' }]);

      if (error) {
        setMessage('グループへの参加に失敗しました。');
      } else {
        setMessage(`「${inviteGroup.name}」に参加しました！`);
        setIsInviteModalOpen(false);
        router.replace('/groups');
        await fetchGroups();
      }
    } catch (err) {
      console.error('招待参加例外:', err);
    } finally {
      setIsJoiningInvite(false);
    }
  };

  const handleCreateGroup = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!groupName.trim()) return;

    setMessage('');
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;

    const { data: newGroup, error: groupError } = await supabase
      .from('groups')
      .insert([{ name: groupName.trim(), created_by: user.id, location: '未設定' }])
      .select()
      .single();

    if (groupError) {
      setMessage(`作成エラー: ${groupError.message}`);
      return;
    }

    await supabase
      .from('group_members')
      .insert([{ group_id: newGroup.id, user_id: user.id, role: 'owner' }]);

    setGroupName('');
    setMessage(`グループ「${newGroup.name}」を作成しました！`);
    fetchGroups();
  };

  const handleJoinGroup = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!joinGroupId.trim()) return;

    setMessage('');
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;

    const { error } = await supabase
      .from('group_members')
      .insert([{ group_id: joinGroupId.trim(), user_id: user.id, role: 'member' }]);

    if (error) {
      setMessage(`参加エラー: IDが間違っているか、すでに参加しています。`);
    } else {
      setJoinGroupId('');
      setMessage('グループに参加しました！');
      fetchGroups();
    }
  };

  const openSettingsModal = async (group: Group) => {
    setSelectedGroup(group);
    setEditGroupName(group.name || '');
    setEditGroupLocation(group.location || '');
    setModalMessage('');
    setCopiedLink(false);
    setIsSettingsOpen(true);
    setGroupMembers(group.members || []);
  };

  const handleUpdateGroupInfo = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedGroup) return;

    setIsModalSaving(true);
    setModalMessage('');

    try {
      const { error } = await supabase
        .from('groups')
        .update({
          name: editGroupName.trim(),
          location: editGroupLocation.trim(),
        })
        .eq('id', selectedGroup.id);

      if (error) {
        setModalMessage(`更新エラー: ${error.message}`);
      } else {
        setModalMessage('グループ情報を更新しました！');
        await fetchGroups();
      }
    } catch (err) {
      setModalMessage('更新処理中にエラーが発生しました。');
    } finally {
      setIsModalSaving(false);
    }
  };

  const handleCopyInviteLink = () => {
    if (!selectedGroup) return;
    const inviteUrl = `${window.location.origin}/groups?join=${selectedGroup.id}`;
    navigator.clipboard.writeText(inviteUrl);
    setCopiedLink(true);
    setTimeout(() => setCopiedLink(false), 2000);
  };

  const handleBanMember = async (targetUserId: string, memberName: string) => {
    if (!selectedGroup) return;
    if (!window.confirm(`「${memberName}」をこのグループからBANしますか？`)) return;

    setIsModalSaving(true);
    try {
      const { error } = await supabase
        .from('group_members')
        .delete()
        .eq('group_id', selectedGroup.id)
        .eq('user_id', targetUserId);

      if (error) {
        setModalMessage(`BANエラー: ${error.message}`);
      } else {
        setModalMessage(`「${memberName}」をBANしました。`);
        await fetchGroups();
      }
    } catch (err) {
      setModalMessage('BAN処理中にエラーが発生しました。');
    } finally {
      setIsModalSaving(false);
    }
  };

  const handleLeaveGroup = async () => {
    if (!selectedGroup || !currentUser) return;
    if (!window.confirm(`「${selectedGroup.name}」から退会しますか？`)) return;

    setIsModalSaving(true);
    try {
      await supabase
        .from('group_members')
        .delete()
        .eq('group_id', selectedGroup.id)
        .eq('user_id', currentUser.id);

      setIsSettingsOpen(false);
      await fetchGroups();
    } catch (err) {
      setModalMessage('退会処理中にエラーが発生しました。');
    } finally {
      setIsModalSaving(false);
    }
  };

  const handleDeleteGroup = async () => {
    if (!selectedGroup || !currentUser) return;
    if (!window.confirm(`「${selectedGroup.name}」を完全に削除しますか？`)) return;

    setIsModalSaving(true);
    try {
      await supabase.from('groups').delete().eq('id', selectedGroup.id);
      setIsSettingsOpen(false);
      await fetchGroups();
    } catch (err) {
      setModalMessage('削除処理中にエラーが発生しました。');
    } finally {
      setIsModalSaving(false);
    }
  };

  const isOwner = selectedGroup?.created_by === currentUser?.id;

  const renderAvatar = (url?: string, name?: string) => {
    if (url) {
      return <img src={url} alt="" className="w-6 h-6 rounded-full object-cover border border-slate-200 shrink-0" />;
    }
    const initial = (name || 'U').charAt(0).toUpperCase();
    return (
      <div className="w-6 h-6 rounded-full bg-slate-700 text-white text-[10px] font-bold flex items-center justify-center border border-slate-200 shrink-0">
        {initial}
      </div>
    );
  };

  return (
    <div className="min-h-screen bg-slate-50 p-6">
      <header className="flex justify-between items-center mb-6 max-w-4xl mx-auto">
        <h1 className="text-2xl font-bold text-slate-800">BOOK KING グループ管理</h1>
        <Link
          href="/calendar"
          className="text-sm px-4 py-2 bg-slate-200 text-slate-700 font-semibold rounded-lg hover:bg-slate-300 transition"
        >
          カレンダーへ
        </Link>
      </header>

      <main className="max-w-4xl mx-auto space-y-6">
        {message && (
          <div className="p-4 bg-blue-50 text-blue-700 rounded-xl text-sm border border-blue-200 text-center font-medium">
            {message}
          </div>
        )}

        {/* 所属グループ一覧 */}
        <section className="bg-white p-6 rounded-xl shadow-md border border-slate-200">
          <h2 className="text-xl font-bold mb-4 text-slate-800">参加中のグループ</h2>
          {loading ? (
            <p className="text-slate-500 text-sm">読み込み中...</p>
          ) : groups.length === 0 ? (
            <p className="text-slate-500 text-sm">参加しているグループがありません。作成するかIDで参加してください。</p>
          ) : (
            <div className="grid gap-4 sm:grid-cols-2">
              {groups.map((g) => (
                <div key={g.id} className="p-4 border border-slate-200 rounded-lg bg-slate-50 flex flex-col justify-between">
                  <div>
                    <div className="flex justify-between items-start gap-2">
                      <h3 className="font-bold text-lg text-slate-800 truncate">{g.name}</h3>
                      <button
                        type="button"
                        onClick={() => openSettingsModal(g)}
                        className="p-1.5 bg-white border border-slate-200 text-slate-600 rounded-lg hover:bg-slate-100 transition cursor-pointer shrink-0"
                        title="グループ設定"
                      >
                        ⚙️
                      </button>
                    </div>
                    {g.location && (
                      <p className="text-xs text-slate-500 mt-1">📍 生息地: {g.location}</p>
                    )}

                    {/* メンバー表示領域 */}
                    <div className="mt-3">
                      <p className="text-[10px] font-bold text-slate-500 mb-1">
                        メンバー ({g.members?.length || 0}名):
                      </p>
                      <div className="flex flex-wrap gap-1.5">
                        {g.members?.map((m) => (
                          <div
                            key={m.user_id}
                            className="flex items-center gap-1 bg-white px-2 py-0.5 rounded-full border border-slate-200 text-[11px] font-medium text-slate-700"
                            title={m.full_name}
                          >
                            {renderAvatar(m.avatar_url, m.full_name)}
                            <span className="truncate max-w-[80px]">{m.full_name}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>

                  <div className="mt-3 pt-3 border-t border-slate-200">
                    <p className="text-[10px] text-slate-400">グループID:</p>
                    <code className="text-xs bg-slate-200 p-1 rounded select-all block text-slate-600 mt-0.5 break-all font-mono">
                      {g.id}
                    </code>
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>

        <div className="grid md:grid-cols-2 gap-6">
          <section className="bg-white p-6 rounded-xl shadow-md border border-slate-200">
            <h2 className="text-lg font-bold mb-4 text-slate-800">新しいグループを作る</h2>
            <form onSubmit={handleCreateGroup} className="space-y-4">
              <input
                type="text"
                value={groupName}
                onChange={(e) => setGroupName(e.target.value)}
                placeholder="例：チームBOOK KING"
                className="w-full px-4 py-2 border border-slate-300 rounded-lg text-sm"
              />
              <button
                type="submit"
                className="w-full py-2 bg-blue-600 text-white font-medium rounded-lg hover:bg-blue-700 transition cursor-pointer text-sm"
              >
                グループを作成
              </button>
            </form>
          </section>

          <section className="bg-white p-6 rounded-xl shadow-md border border-slate-200">
            <h2 className="text-lg font-bold mb-4 text-slate-800">既存のグループに参加</h2>
            <form onSubmit={handleJoinGroup} className="space-y-4">
              <input
                type="text"
                value={joinGroupId}
                onChange={(e) => setJoinGroupId(e.target.value)}
                placeholder="グループIDを貼り付け"
                className="w-full px-4 py-2 border border-slate-300 rounded-lg text-sm"
              />
              <button
                type="submit"
                className="w-full py-2 bg-slate-800 text-white font-medium rounded-lg hover:bg-slate-900 transition cursor-pointer text-sm"
              >
                IDでグループに参加
              </button>
            </form>
          </section>
        </div>
      </main>

      {/* 招待確認モーダル */}
      {isInviteModalOpen && inviteGroup && (
        <div className="fixed inset-0 z-50 flex items-center justify-center backdrop-blur-md bg-slate-900/40 p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm p-6 text-center space-y-4 border border-slate-200">
            <h3 className="text-base font-bold text-slate-900">グループへの招待</h3>
            <p className="text-sm font-bold text-blue-600">「{inviteGroup.name}」</p>
            {isAlreadyMember ? (
              <div>
                <p className="text-xs text-slate-500 bg-slate-100 p-2.5 rounded-lg">すでに入会しています。</p>
                <button onClick={() => setIsInviteModalOpen(false)} className="mt-3 w-full py-2 bg-slate-900 text-white font-semibold text-xs rounded-lg">閉じる</button>
              </div>
            ) : (
              <div className="flex gap-2">
                <button onClick={() => setIsInviteModalOpen(false)} className="flex-1 py-2 text-xs border border-slate-300 rounded-lg">キャンセル</button>
                <button onClick={handleConfirmInviteJoin} disabled={isJoiningInvite} className="flex-1 py-2 bg-blue-600 text-white text-xs rounded-lg">{isJoiningInvite ? '参加中...' : '参加する'}</button>
              </div>
            )}
          </div>
        </div>
      )}

      {/* 設定モーダル */}
      {isSettingsOpen && selectedGroup && (
        <div className="fixed inset-0 z-50 flex items-center justify-center backdrop-blur-md bg-slate-900/40 p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md overflow-hidden border border-slate-200">
            <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100 bg-slate-50">
              <h3 className="text-sm font-bold text-slate-900">グループ設定</h3>
              <button onClick={() => setIsSettingsOpen(false)} className="text-slate-400 hover:text-slate-600 font-bold text-sm">✕</button>
            </div>

            <div className="p-6 max-h-[75vh] overflow-y-auto space-y-5">
              {modalMessage && (
                <div className="p-2.5 bg-slate-100 rounded-lg text-xs text-slate-700 font-medium text-center">{modalMessage}</div>
              )}

              <form onSubmit={handleUpdateGroupInfo} className="space-y-3">
                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">グループ名</label>
                  <input type="text" required value={editGroupName} onChange={(e) => setEditGroupName(e.target.value)} className="w-full px-3 py-2 text-xs border border-slate-300 rounded-lg" />
                </div>
                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">生息地 (拠点)</label>
                  <input type="text" value={editGroupLocation} onChange={(e) => setEditGroupLocation(e.target.value)} placeholder="例: 東京・渋谷" className="w-full px-3 py-2 text-xs border border-slate-300 rounded-lg" />
                </div>
                <button type="submit" disabled={isModalSaving} className="w-full py-2 bg-slate-900 text-white font-semibold text-xs rounded-lg">更新</button>
              </form>

              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">招待リンク</label>
                <div className="flex gap-2">
                  <input type="text" readOnly value={`${typeof window !== 'undefined' ? window.location.origin : ''}/groups?join=${selectedGroup.id}`} className="flex-1 px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-xs text-slate-600 font-mono truncate" />
                  <button type="button" onClick={handleCopyInviteLink} className="px-3 py-2 bg-white border border-slate-300 text-xs font-semibold rounded-lg shrink-0">{copiedLink ? 'コピー完了' : 'コピー'}</button>
                </div>
              </div>

              <div>
                <label className="text-xs font-bold text-slate-700 block mb-2">メンバー一覧 ({groupMembers.length}名)</label>
                <div className="space-y-1.5 max-h-40 overflow-y-auto p-2 bg-slate-50 border border-slate-200 rounded-xl">
                  {groupMembers.map((member) => (
                    <div key={member.user_id} className="flex items-center justify-between p-2 bg-white border border-slate-100 rounded-lg">
                      <div className="flex items-center gap-2 min-w-0">
                        {renderAvatar(member.avatar_url, member.full_name)}
                        <span className="text-xs font-semibold text-slate-800 truncate">{member.full_name}</span>
                      </div>
                      {isOwner && member.user_id !== currentUser?.id && (
                        <button type="button" onClick={() => handleBanMember(member.user_id, member.full_name || 'ユーザー')} className="px-2 py-1 bg-red-50 text-red-600 text-[10px] font-bold rounded">BAN</button>
                      )}
                    </div>
                  ))}
                </div>
              </div>

              <div className="pt-3 border-t border-slate-100 space-y-2">
                <button type="button" onClick={handleLeaveGroup} className="w-full py-2 bg-slate-100 text-slate-700 font-semibold text-xs rounded-lg">退会する</button>
                {isOwner && <button type="button" onClick={handleDeleteGroup} className="w-full py-2 bg-red-50 text-red-600 font-semibold text-xs rounded-lg">グループ完全削除</button>}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

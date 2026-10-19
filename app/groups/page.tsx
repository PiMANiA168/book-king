'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { supabase } from '@/lib/supabaseClient';

type Group = {
  id: string;
  name: string;
  location?: string;
  created_by?: string;
  created_at: string;
};

type GroupMember = {
  user_id: string;
  role?: string;
  full_name?: string;
  avatar_url?: string;
};

export default function GroupsPage() {
  const [groups, setGroups] = useState<Group[]>([]);
  const [groupName, setGroupName] = useState('');
  const [joinGroupId, setJoinGroupId] = useState('');
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState('');
  const [currentUser, setCurrentUser] = useState<any>(null);
  const router = useRouter();

  // --------------------------------------------------
  // 設定モーダル用ステート
  // --------------------------------------------------
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [selectedGroup, setSelectedGroup] = useState<Group | null>(null);
  const [editGroupName, setEditGroupName] = useState('');
  const [editGroupLocation, setEditGroupLocation] = useState('');
  const [groupMembers, setGroupMembers] = useState<GroupMember[]>([]);
  const [copiedLink, setCopiedLink] = useState(false);
  const [modalMessage, setModalMessage] = useState('');
  const [isModalSaving, setIsModalSaving] = useState(false);

  // --------------------------------------------------
  // 招待リンクモーダル用ステート
  // --------------------------------------------------
  const [inviteGroup, setInviteGroup] = useState<Group | null>(null);
  const [isInviteModalOpen, setIsInviteModalOpen] = useState(false);
  const [isAlreadyMember, setIsAlreadyMember] = useState(false);
  const [isJoiningInvite, setIsJoiningInvite] = useState(false);

  // 所属しているグループ一覧を取得
  const fetchGroups = async () => {
    setLoading(true);
    const { data: { user } } = await supabase.auth.getUser();

    if (!user) {
      router.push('/login');
      return;
    }
    setCurrentUser(user);

    // 自分のグループID一覧を取得
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
      const { data: groupData } = await supabase
        .from('groups')
        .select('*')
        .in('id', groupIds);

      setGroups(groupData || []);
    } else {
      setGroups([]);
    }
    setLoading(false);
  };

  // 初期化 & 招待リンクの処理
  useEffect(() => {
    const init = async () => {
      await fetchGroups();
      checkInviteUrl();
    };
    init();
  }, []);

  // URLの `?join=xxx` をチェックして招待ポップアップを表示
  const checkInviteUrl = async () => {
    if (typeof window === 'undefined') return;
    const params = new URLSearchParams(window.location.search);
    const targetGroupId = params.get('join');

    if (!targetGroupId) return;

    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;

    // グループ情報の取得
    const { data: groupData, error } = await supabase
      .from('groups')
      .select('*')
      .eq('id', targetGroupId)
      .maybeSingle();

    if (error || !groupData) {
      setMessage('招待リンクのグループが見つかりませんでした。');
      return;
    }

    setInviteGroup(groupData);

    // すでに入っているか判定
    const { data: member } = await supabase
      .from('group_members')
      .select('group_id')
      .eq('group_id', targetGroupId)
      .eq('user_id', user.id)
      .maybeSingle();

    setIsAlreadyMember(!!member);
    setIsInviteModalOpen(true);
  };

  // 招待モーダルからの参加実行処理
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
        // URLパラメータをクリア
        router.replace('/groups');
        await fetchGroups();
      }
    } catch (err) {
      console.error('招待参加例外:', err);
    } finally {
      setIsJoiningInvite(false);
    }
  };

  // 新規グループ作成
  const handleCreateGroup = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!groupName.trim()) return;

    setMessage('');
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;

    // 1. groups テーブルに新しいグループを作成
    const { data: newGroup, error: groupError } = await supabase
      .from('groups')
      .insert([{ name: groupName.trim(), created_by: user.id, location: '未設定' }])
      .select()
      .single();

    if (groupError) {
      setMessage(`作成エラー: ${groupError.message}`);
      return;
    }

    // 2. 作成者を group_members テーブルに追加
    const { error: memberError } = await supabase
      .from('group_members')
      .insert([{ group_id: newGroup.id, user_id: user.id, role: 'owner' }]);

    if (memberError) {
      setMessage(`メンバー登録エラー: ${memberError.message}`);
      return;
    }

    setGroupName('');
    setMessage(`グループ「${newGroup.name}」を作成しました！`);
    fetchGroups();
  };

  // ID指定で既存グループに参加
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

  // --------------------------------------------------
  // グループ設定モーダル制御関数
  // --------------------------------------------------
  const openSettingsModal = async (group: Group) => {
    setSelectedGroup(group);
    setEditGroupName(group.name || '');
    setEditGroupLocation(group.location || '');
    setModalMessage('');
    setCopiedLink(false);
    setIsSettingsOpen(true);

    await fetchGroupMembers(group.id);
  };

  const fetchGroupMembers = async (groupId: string) => {
    try {
      const { data: membersData, error } = await supabase
        .from('group_members')
        .select('user_id, role, profiles(full_name, avatar_url)')
        .eq('group_id', groupId);

      if (!error && membersData) {
        const formatted: GroupMember[] = membersData.map((m: any) => ({
          user_id: m.user_id,
          role: m.role,
          full_name: m.profiles?.full_name || '名前未設定',
          avatar_url: m.profiles?.avatar_url || null,
        }));
        setGroupMembers(formatted);
      }
    } catch (err) {
      console.error('メンバー取得例外:', err);
    }
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
        setSelectedGroup({
          ...selectedGroup,
          name: editGroupName.trim(),
          location: editGroupLocation.trim(),
        });
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
    if (!window.confirm(`「${memberName}」をこのグループからBAN（追放）しますか？`)) return;

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
        setModalMessage(`「${memberName}」をグループからBANしました。`);
        await fetchGroupMembers(selectedGroup.id);
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
      const { error } = await supabase
        .from('group_members')
        .delete()
        .eq('group_id', selectedGroup.id)
        .eq('user_id', currentUser.id);

      if (error) {
        setModalMessage(`退会エラー: ${error.message}`);
      } else {
        setIsSettingsOpen(false);
        await fetchGroups();
      }
    } catch (err) {
      setModalMessage('退会処理中にエラーが発生しました。');
    } finally {
      setIsModalSaving(false);
    }
  };

  const handleDeleteGroup = async () => {
    if (!selectedGroup || !currentUser) return;
    if (!window.confirm(`「${selectedGroup.name}」を完全に削除しますか？\n（関連する予定データなども削除されます）`)) return;

    setIsModalSaving(true);
    try {
      const { error } = await supabase
        .from('groups')
        .delete()
        .eq('id', selectedGroup.id);

      if (error) {
        setModalMessage(`削除エラー: ${error.message}`);
      } else {
        setIsSettingsOpen(false);
        await fetchGroups();
      }
    } catch (err) {
      setModalMessage('削除処理中にエラーが発生しました。');
    } finally {
      setIsModalSaving(false);
    }
  };

  const isOwner = selectedGroup?.created_by === currentUser?.id;

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
                        className="p-1.5 bg-white border border-slate-200 text-slate-600 rounded-lg hover:bg-slate-100 hover:text-slate-900 transition cursor-pointer shrink-0"
                        title="グループ設定"
                      >
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                        </svg>
                      </button>
                    </div>
                    {g.location && (
                      <p className="text-xs text-slate-500 mt-1">📍 生息地: {g.location}</p>
                    )}
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
          {/* グループ新規作成 */}
          <section className="bg-white p-6 rounded-xl shadow-md border border-slate-200">
            <h2 className="text-lg font-bold mb-4 text-slate-800">新しいグループを作る</h2>
            <form onSubmit={handleCreateGroup} className="space-y-4">
              <div>
                <input
                  type="text"
                  value={groupName}
                  onChange={(e) => setGroupName(e.target.value)}
                  placeholder="例：富士急行こうの会"
                  className="w-full px-4 py-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm"
                />
              </div>
              <button
                type="submit"
                className="w-full py-2 bg-blue-600 text-white font-medium rounded-lg hover:bg-blue-700 transition cursor-pointer text-sm"
              >
                グループを作成
              </button>
            </form>
          </section>

          {/* IDで参加 */}
          <section className="bg-white p-6 rounded-xl shadow-md border border-slate-200">
            <h2 className="text-lg font-bold mb-4 text-slate-800">既存のグループに参加</h2>
            <form onSubmit={handleJoinGroup} className="space-y-4">
              <div>
                <input
                  type="text"
                  value={joinGroupId}
                  onChange={(e) => setJoinGroupId(e.target.value)}
                  placeholder="グループIDを貼り付け"
                  className="w-full px-4 py-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm"
                />
              </div>
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

      {/* --------------------------------------------------
          招待リンクモーダル
      -------------------------------------------------- */}
      {isInviteModalOpen && inviteGroup && (
        <div className="fixed inset-0 z-50 flex items-center justify-center backdrop-blur-md bg-slate-900/40 p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm overflow-hidden border border-slate-200 text-center p-6 space-y-4">
            <div className="w-12 h-12 rounded-full bg-blue-50 border border-blue-200 text-blue-600 flex items-center justify-center mx-auto text-xl font-bold">
              ✉️
            </div>

            <div>
              <h3 className="text-base font-bold text-slate-900">グループへの招待</h3>
              <p className="text-sm font-bold text-blue-600 mt-1">「{inviteGroup.name}」</p>
              {inviteGroup.location && (
                <p className="text-xs text-slate-400 mt-0.5">📍 {inviteGroup.location}</p>
              )}
            </div>

            {isAlreadyMember ? (
              <div className="space-y-3">
                <p className="text-xs text-slate-600 bg-slate-100 p-2.5 rounded-lg">
                  あなたは既にこのグループに参加しています。
                </p>
                <button
                  type="button"
                  onClick={() => {
                    setIsInviteModalOpen(false);
                    router.replace('/groups');
                  }}
                  className="w-full py-2 bg-slate-900 text-white font-semibold text-xs rounded-lg hover:bg-slate-800 transition cursor-pointer"
                >
                  閉じる
                </button>
              </div>
            ) : (
              <div className="space-y-3">
                <p className="text-xs text-slate-500">
                  このグループに参加して予定を共有しますか？
                </p>
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      setIsInviteModalOpen(false);
                      router.replace('/groups');
                    }}
                    className="flex-1 py-2 text-xs font-semibold border border-slate-300 rounded-lg text-slate-600 hover:bg-slate-50 transition cursor-pointer"
                  >
                    キャンセル
                  </button>
                  <button
                    type="button"
                    onClick={handleConfirmInviteJoin}
                    disabled={isJoiningInvite}
                    className="flex-1 py-2 bg-blue-600 text-white font-semibold text-xs rounded-lg hover:bg-blue-700 disabled:opacity-50 transition cursor-pointer"
                  >
                    {isJoiningInvite ? '参加中...' : 'グループに参加'}
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* --------------------------------------------------
          グループ設定モーダル (UserMenu.tsx 統一デザイン)
      -------------------------------------------------- */}
      {isSettingsOpen && selectedGroup && (
        <div className="fixed inset-0 z-50 flex items-center justify-center backdrop-blur-md bg-slate-900/40 p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md overflow-hidden border border-slate-200">
            {/* モーダルヘッダー */}
            <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100 bg-slate-50">
              <h3 className="text-sm font-bold text-slate-900">グループ設定</h3>
              <button
                type="button"
                onClick={() => setIsSettingsOpen(false)}
                className="text-slate-400 hover:text-slate-600 transition font-bold text-sm cursor-pointer"
              >
                ✕
              </button>
            </div>

            {/* モーダルコンテンツ */}
            <div className="p-6 max-h-[75vh] overflow-y-auto space-y-5">
              {modalMessage && (
                <div className="p-2.5 bg-slate-100 border border-slate-200 rounded-lg text-xs text-slate-700 font-medium text-center">
                  {modalMessage}
                </div>
              )}

              {/* 1. グループ名・生息地の変更 */}
              <form onSubmit={handleUpdateGroupInfo} className="space-y-3">
                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">グループ名</label>
                  <input
                    type="text"
                    required
                    value={editGroupName}
                    onChange={(e) => setEditGroupName(e.target.value)}
                    className="w-full px-3 py-2 text-xs border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-slate-800"
                  />
                </div>

                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">グループの生息地 (拠点)</label>
                  <input
                    type="text"
                    value={editGroupLocation}
                    onChange={(e) => setEditGroupLocation(e.target.value)}
                    placeholder="例: 東京・渋谷 / 学校の部室"
                    className="w-full px-3 py-2 text-xs border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-slate-800"
                  />
                </div>

                <button
                  type="submit"
                  disabled={isModalSaving || !editGroupName.trim()}
                  className="w-full py-2 bg-slate-900 text-white font-semibold text-xs rounded-lg hover:bg-slate-800 disabled:opacity-50 transition cursor-pointer"
                >
                  {isModalSaving ? '保存中...' : 'グループ情報を更新'}
                </button>
              </form>

              {/* 2. 招待リンク作成 & 自動コピー */}
              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">
                  グループへの招待リンク
                </label>
                <div className="flex gap-2">
                  <input
                    type="text"
                    readOnly
                    value={`${typeof window !== 'undefined' ? window.location.origin : ''}/groups?join=${selectedGroup.id}`}
                    className="flex-1 px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-xs text-slate-600 font-mono truncate"
                  />
                  <button
                    type="button"
                    onClick={handleCopyInviteLink}
                    className="px-3 py-2 bg-white border border-slate-300 text-slate-700 font-semibold text-xs rounded-lg hover:bg-slate-50 transition cursor-pointer shrink-0"
                  >
                    {copiedLink ? 'コピー完了！' : 'リンクをコピー'}
                  </button>
                </div>
              </div>

              {/* 3. メンバー閲覧 & BAN機能 */}
              <div>
                <div className="flex justify-between items-center mb-2">
                  <label className="text-xs font-bold text-slate-700">
                    メンバー一覧 ({groupMembers.length}名)
                  </label>
                  {isOwner && (
                    <span className="text-[10px] text-red-500 font-semibold">
                      ※作成者権限: BAN操作が可能
                    </span>
                  )}
                </div>

                <div className="space-y-1.5 max-h-40 overflow-y-auto p-2 bg-slate-50 border border-slate-200 rounded-xl">
                  {groupMembers.map((member) => (
                    <div key={member.user_id} className="flex items-center justify-between p-2 bg-white border border-slate-100 rounded-lg">
                      <div className="flex items-center gap-2.5 min-w-0">
                        <div className="w-6 h-6 rounded-full bg-slate-200 overflow-hidden flex items-center justify-center shrink-0">
                          {member.avatar_url ? (
                            <img src={member.avatar_url} alt="" className="w-full h-full object-cover" />
                          ) : (
                            <span className="text-[10px] font-bold text-slate-500">
                              {member.full_name?.substring(0, 1) || 'U'}
                            </span>
                          )}
                        </div>
                        <span className="text-xs font-semibold text-slate-800 truncate">
                          {member.full_name} {member.user_id === currentUser?.id && '（あなた）'}
                        </span>
                      </div>

                      {/* BANボタン（作成者のみ表示 & 自分自身は対象外） */}
                      {isOwner && member.user_id !== currentUser?.id && (
                        <button
                          type="button"
                          onClick={() => handleBanMember(member.user_id, member.full_name || 'ユーザー')}
                          disabled={isModalSaving}
                          className="px-2 py-1 bg-red-50 border border-red-200 text-red-600 font-bold text-[10px] rounded hover:bg-red-100 transition cursor-pointer shrink-0"
                        >
                          BAN
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              </div>

              {/* 4. 危険領域（退会 / 削除） */}
              <div className="pt-3 border-t border-slate-100 space-y-2">
                <button
                  type="button"
                  onClick={handleLeaveGroup}
                  disabled={isModalSaving}
                  className="w-full py-2 bg-slate-100 border border-slate-300 text-slate-700 font-semibold text-xs rounded-lg hover:bg-slate-200 transition cursor-pointer"
                >
                  グループから退会する
                </button>

                {isOwner && (
                  <button
                    type="button"
                    onClick={handleDeleteGroup}
                    disabled={isModalSaving}
                    className="w-full py-2 bg-red-50 border border-red-200 text-red-600 font-semibold text-xs rounded-lg hover:bg-red-100 transition cursor-pointer"
                  >
                    グループを完全削除する
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
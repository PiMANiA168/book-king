'use client';

import { useState, useEffect, useCallback } from 'react';
import { createClient } from '@supabase/supabase-js';
import Cropper from 'react-easy-crop';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const supabase = createClient(supabaseUrl, supabaseAnonKey);

// 画像切り抜き用ヘルパー関数
const getCroppedImg = async (
  imageSrc: string,
  pixelCrop: { x: number; y: number; width: number; height: number }
): Promise<Blob | null> => {
  const image = new Image();
  image.src = imageSrc;
  await new Promise((resolve) => {
    image.onload = resolve;
  });

  const canvas = document.createElement('canvas');
  canvas.width = 128;
  canvas.height = 128;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;

  ctx.drawImage(
    image,
    pixelCrop.x,
    pixelCrop.y,
    pixelCrop.width,
    pixelCrop.height,
    0,
    0,
    128,
    128
  );

  return new Promise((resolve) => {
    canvas.toBlob((blob) => resolve(blob), 'image/png');
  });
};

export default function UserMenu() {
  const [isOpenMenu, setIsOpenMenu] = useState(false);
  const [isOpenModal, setIsOpenModal] = useState(false);
  const [activeTab, setActiveTab] = useState<'profile' | 'account'>('profile');

  // ユーザー状態
  const [user, setUser] = useState<any>(null);
  const [fullName, setFullName] = useState('');
  const [bio, setBio] = useState('');
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null);
  const [email, setEmail] = useState('');
  const [newEmail, setNewEmail] = useState('');
  const [hasGoogle, setHasGoogle] = useState(false);

  // 画像クロップ関係
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [imageSrc, setImageSrc] = useState<string | null>(null);
  const [crop, setCrop] = useState({ x: 0, y: 0 });
  const [zoom, setZoom] = useState(1);
  const [croppedAreaPixels, setCroppedAreaPixels] = useState<any>(null);
  const [isCropping, setIsCropping] = useState(false);

  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');

  useEffect(() => {
    loadUserData();
  }, []);

  const loadUserData = async () => {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session?.user) return;

    const u = session.user;
    setUser(u);
    setEmail(u.email || '');

    // Google連携確認
    const isGoogle = u.app_metadata?.providers?.includes('google') || false;
    setHasGoogle(isGoogle);

    // プロフィール情報取得
    const { data: profile } = await supabase
      .from('profiles')
      .select('*')
      .eq('id', u.id)
      .maybeSingle();

    if (profile) {
      setFullName(profile.full_name || '');
      setBio(profile.bio || '');
      setAvatarUrl(profile.avatar_url || null);
    }
  };

  // ログアウト
  const handleLogout = async () => {
    await supabase.auth.signOut();
    window.location.href = '/';
  };

  // ファイル選択時
  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      const file = e.target.files[0];
      setSelectedFile(file);
      const reader = new FileReader();
      reader.onload = () => {
        setImageSrc(reader.result as string);
        setCrop({ x: 0, y: 0 });
        setZoom(1);
        setIsCropping(true);
      };
      reader.readAsDataURL(file);
    }
  };

  // クロップ確定時のピクセル領域保持
  const onCropComplete = useCallback((_croppedArea: any, croppedAreaPixels: any) => {
    setCroppedAreaPixels(croppedAreaPixels);
  }, []);

  // 128x128 クロップ＆保存処理
  const handleCropAndUpload = async () => {
    if (!imageSrc || !croppedAreaPixels || !user) return;

    setSaving(true);
    setMessage('');

    try {
      const blob = await getCroppedImg(imageSrc, croppedAreaPixels);
      if (!blob) {
        setMessage('画像の切り抜き処理に失敗しました');
        setSaving(false);
        return;
      }

      const filePath = `${user.id}/${Date.now()}.png`;

      const { error: uploadError } = await supabase.storage
        .from('avatars')
        .upload(filePath, blob, { contentType: 'image/png', upsert: true });

      if (uploadError) {
        console.error('Upload Error:', uploadError);
        setMessage('画像のアップロードに失敗しました');
        setSaving(false);
        return;
      }

      const { data: publicUrlData } = supabase.storage
        .from('avatars')
        .getPublicUrl(filePath);

      const publicUrl = publicUrlData.publicUrl;
      setAvatarUrl(publicUrl);
      setIsCropping(false);
      setImageSrc(null);
    } catch (err) {
      console.error(err);
      setMessage('エラーが発生しました');
    } finally {
      setSaving(false);
    }
  };

  // プロフィール更新
  const handleSaveProfile = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user) return;
    setSaving(true);
    setMessage('');

    const { error } = await supabase.from('profiles').upsert({
      id: user.id,
      full_name: fullName,
      bio: bio,
      avatar_url: avatarUrl,
      updated_at: new Date().toISOString(),
    });

    if (error) {
      setMessage('保存に失敗しました');
    } else {
      setMessage('プロフィールを更新しました');
    }
    setSaving(false);
  };

  // メールアドレス変更
  const handleChangeEmail = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newEmail.trim()) return;
    setSaving(true);
    setMessage('');

    const { error } = await supabase.auth.updateUser({ email: newEmail });
    if (error) {
      setMessage(`メール変更エラー: ${error.message}`);
    } else {
      setMessage('確認メールを新しいアドレス宛に送信しました。');
      setNewEmail('');
    }
    setSaving(false);
  };

  // Google連携の接続 / 解除
  const handleToggleGoogle = async () => {
    if (hasGoogle) {
      const { error } = await supabase.auth.unlinkIdentity({ provider: 'google' } as any);
      if (error) {
        setMessage(`連携解除エラー: ${error.message}`);
      } else {
        setMessage('Google連携を解除しました');
        setHasGoogle(false);
      }
    } else {
      await supabase.auth.signInWithOAuth({
        provider: 'google',
        options: { redirectTo: `${window.location.origin}/calendar` },
      });
    }
  };

  return (
    <div className="relative">
      {/* アカウントアイコンボタン */}
      <button
        type="button"
        onClick={() => setIsOpenMenu(!isOpenMenu)}
        className="w-9 h-9 rounded-full bg-slate-200 border border-slate-300 overflow-hidden flex items-center justify-center hover:ring-2 hover:ring-slate-400 transition cursor-pointer"
      >
        {avatarUrl ? (
          <img src={avatarUrl} alt="Avatar" className="w-full h-full object-cover" />
        ) : (
          <svg className="w-5 h-5 text-slate-500" fill="currentColor" viewBox="0 0 24 24">
            <path d="M12 12c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4zm0 2c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4z" />
          </svg>
        )}
      </button>

      {/* ドロップダウンメニュー（上向き展開） */}
      {isOpenMenu && (
        <div className="absolute bottom-full left-0 mb-2 w-48 bg-white rounded-xl shadow-lg border border-slate-200 py-1 z-50 overflow-hidden">
          <button
            type="button"
            onClick={() => {
              setIsOpenMenu(false);
              setIsOpenModal(true);
            }}
            className="w-full text-left px-4 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50 transition flex items-center gap-2 cursor-pointer"
          >
            <svg className="w-4 h-4 text-slate-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
            </svg>
            アカウント設定
          </button>
          <div className="border-t border-slate-100 my-1"></div>
          <button
            type="button"
            onClick={handleLogout}
            className="w-full text-left px-4 py-2 text-xs font-semibold text-red-600 hover:bg-red-50 transition flex items-center gap-2 cursor-pointer"
          >
            <svg className="w-4 h-4 text-red-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
            </svg>
            ログアウト
          </button>
        </div>
      )}

      {/* 設定モーダル（背景ぼかし＋ダイアログ本体） */}
      {isOpenModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center backdrop-blur-md bg-slate-900/40 p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md overflow-hidden border border-slate-200">
            {/* モーダルヘッダー */}
            <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100 bg-slate-50">
              <h3 className="text-sm font-bold text-slate-900">設定</h3>
              <button
                type="button"
                onClick={() => {
                  setIsOpenModal(false);
                  setIsCropping(false);
                  setMessage('');
                }}
                className="text-slate-400 hover:text-slate-600 transition font-bold text-sm cursor-pointer"
              >
                ✕
              </button>
            </div>

            {/* タブ切り替え */}
            <div className="flex border-b border-slate-100 px-6">
              <button
                type="button"
                onClick={() => { setActiveTab('profile'); setMessage(''); }}
                className={`py-3 text-xs font-bold border-b-2 mr-6 transition cursor-pointer ${
                  activeTab === 'profile'
                    ? 'border-slate-900 text-slate-900'
                    : 'border-transparent text-slate-400 hover:text-slate-600'
                }`}
              >
                プロフィール設定
              </button>
              <button
                type="button"
                onClick={() => { setActiveTab('account'); setMessage(''); }}
                className={`py-3 text-xs font-bold border-b-2 transition cursor-pointer ${
                  activeTab === 'account'
                    ? 'border-slate-900 text-slate-900'
                    : 'border-transparent text-slate-400 hover:text-slate-600'
                }`}
              >
                アカウント設定
              </button>
            </div>

            {/* モーダルコンテンツ */}
            <div className="p-6 max-h-[70vh] overflow-y-auto">
              {message && (
                <div className="mb-4 p-2.5 bg-slate-100 border border-slate-200 rounded-lg text-xs text-slate-700 font-medium text-center">
                  {message}
                </div>
              )}

              {/* クロップ画面表示中 */}
              {isCropping && imageSrc ? (
                <div className="flex flex-col items-center space-y-4">
                  <p className="text-xs text-slate-500 font-semibold">ドラッグで移動、スライダーで拡大縮小できます</p>
                  
                  {/* react-easy-crop 表示エリア */}
                  <div className="relative w-full h-64 rounded-xl overflow-hidden bg-slate-900 border border-slate-200">
                    <Cropper
                      image={imageSrc}
                      crop={crop}
                      zoom={zoom}
                      aspect={1}
                      cropShape="round"
                      showGrid={false}
                      onCropChange={setCrop}
                      onZoomChange={setZoom}
                      onCropComplete={onCropComplete}
                    />
                  </div>

                  {/* ズームスライダー */}
                  <div className="w-full flex items-center gap-3 px-2">
                    <span className="text-xs text-slate-500 font-bold w-12">ズーム</span>
                    <input
                      type="range"
                      min={1}
                      max={3}
                      step={0.1}
                      value={zoom}
                      onChange={(e) => setZoom(Number(e.target.value))}
                      className="w-full accent-slate-900 cursor-pointer h-1.5 bg-slate-200 rounded-lg"
                    />
                  </div>

                  <div className="flex gap-2 w-full pt-2">
                    <button
                      type="button"
                      onClick={() => setIsCropping(false)}
                      className="flex-1 py-2 text-xs font-semibold border border-slate-300 rounded-lg text-slate-600 hover:bg-slate-50 transition cursor-pointer"
                    >
                      キャンセル
                    </button>
                    <button
                      type="button"
                      onClick={handleCropAndUpload}
                      disabled={saving}
                      className="flex-1 py-2 text-xs font-semibold bg-slate-900 text-white rounded-lg hover:bg-slate-800 disabled:opacity-50 transition cursor-pointer"
                    >
                      {saving ? '保存中...' : '確定して適用'}
                    </button>
                  </div>
                </div>
              ) : activeTab === 'profile' ? (
                /* プロフィール設定タブ */
                <form onSubmit={handleSaveProfile} className="space-y-4">
                  <div className="flex flex-col items-center gap-3">
                    <div className="w-20 h-20 rounded-full bg-slate-100 border border-slate-200 overflow-hidden flex items-center justify-center">
                      {avatarUrl ? (
                        <img src={avatarUrl} alt="Avatar" className="w-full h-full object-cover" />
                      ) : (
                        <svg className="w-10 h-10 text-slate-400" fill="currentColor" viewBox="0 0 24 24">
                          <path d="M12 12c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4zm0 2c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4z" />
                        </svg>
                      )}
                    </div>
                    <label className="px-3 py-1.5 bg-white border border-slate-300 rounded-lg text-xs font-semibold text-slate-700 hover:bg-slate-50 transition cursor-pointer">
                      画像を選択
                      <input type="file" accept="image/*" onChange={handleFileChange} className="hidden" />
                    </label>
                  </div>

                  <div>
                    <label className="block text-xs font-bold text-slate-700 mb-1">名前</label>
                    <input
                      type="text"
                      value={fullName}
                      onChange={(e) => setFullName(e.target.value)}
                      placeholder="ユーザー名"
                      className="w-full px-3 py-2 text-xs border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-slate-800"
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-bold text-slate-700 mb-1">ひとこと</label>
                    <textarea
                      value={bio}
                      onChange={(e) => setBio(e.target.value)}
                      placeholder="ひとことメッセージ"
                      rows={3}
                      className="w-full px-3 py-2 text-xs border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-slate-800 resize-none"
                    />
                  </div>

                  <button
                    type="submit"
                    disabled={saving}
                    className="w-full py-2 bg-slate-900 text-white font-semibold text-xs rounded-lg hover:bg-slate-800 disabled:opacity-50 transition cursor-pointer"
                  >
                    {saving ? '保存中...' : 'プロフィールを更新'}
                  </button>
                </form>
              ) : (
                /* アカウント設定タブ */
                <div className="space-y-5">
                  <div>
                    <label className="block text-xs font-bold text-slate-700 mb-1">現在のメールアドレス</label>
                    <div className="px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-xs text-slate-600 font-mono">
                      {email}
                    </div>
                  </div>

                  <form onSubmit={handleChangeEmail} className="space-y-2">
                    <label className="block text-xs font-bold text-slate-700">新しいメールアドレスへ変更</label>
                    <div className="flex gap-2">
                      <input
                        type="email"
                        value={newEmail}
                        onChange={(e) => setNewEmail(e.target.value)}
                        placeholder="new@example.com"
                        className="flex-1 px-3 py-2 text-xs border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-slate-800"
                      />
                      <button
                        type="submit"
                        disabled={saving || !newEmail.trim()}
                        className="px-3 py-2 bg-slate-900 text-white font-semibold text-xs rounded-lg hover:bg-slate-800 disabled:opacity-50 transition cursor-pointer"
                      >
                        変更
                      </button>
                    </div>
                  </form>

                  <div className="border-t border-slate-100 pt-4">
                    <label className="block text-xs font-bold text-slate-700 mb-2">外部アカウント連携</label>
                    <div className="flex items-center justify-between p-3 border border-slate-200 rounded-xl bg-slate-50">
                      <div className="flex items-center gap-2">
                        <svg className="w-4 h-4" viewBox="0 0 24 24">
                          <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
                          <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
                          <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.06H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.94l2.85-2.22.81-.63z"/>
                          <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.84c.87-2.6 3.3-4.52 6.16-4.52z"/>
                        </svg>
                        <span className="text-xs font-semibold text-slate-800">Google</span>
                      </div>
                      <button
                        type="button"
                        onClick={handleToggleGoogle}
                        className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition cursor-pointer ${
                          hasGoogle
                            ? 'bg-red-50 text-red-600 border border-red-200 hover:bg-red-100'
                            : 'bg-white text-slate-700 border border-slate-300 hover:bg-slate-100'
                        }`}
                      >
                        {hasGoogle ? '連携解除' : '連携する'}
                      </button>
                    </div>
                  </div>

                  <div className="border-t border-slate-100 pt-4">
                    <button
                      type="button"
                      onClick={handleLogout}
                      className="w-full py-2 bg-red-50 border border-red-200 text-red-600 font-semibold text-xs rounded-lg hover:bg-red-100 transition cursor-pointer flex items-center justify-center gap-1.5"
                    >
                      <svg className="w-4 h-4 text-red-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
                      </svg>
                      ログアウト
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
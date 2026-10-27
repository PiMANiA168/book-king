'use client';

import { useState, useEffect } from 'react';
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const supabase = createClient(supabaseUrl, supabaseAnonKey);

export default function Home() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [fullName, setFullName] = useState(''); // 名前用のステート追加
  const [isSignUp, setIsSignUp] = useState(false);
  const [loading, setLoading] = useState(true);
  const [errorMsg, setErrorMsg] = useState('');

  // キャッシュ（アクティブセッション）があればカレンダーへ自動遷移
  useEffect(() => {
    const checkSession = async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (session) {
        window.location.href = '/calendar';
      } else {
        setLoading(false);
      }
    };
    checkSession();
  }, []);

  // メールアドレスでのログイン / 新規登録
  const handleAuth = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg('');
    setLoading(true);

    if (isSignUp) {
      if (!fullName.trim()) {
        setErrorMsg('お名前（表示名）を入力してください。');
        setLoading(false);
        return;
      }

      const { data: authData, error } = await supabase.auth.signUp({
        email,
        password,
        options: {
          data: {
            full_name: fullName.trim(), // サインアップメタデータとして名前を保存
          },
        },
      });

      if (error) {
        setErrorMsg(error.message);
        setLoading(false);
      } else {
        // バックアップとして profiles テーブルにも直接挿入
        if (authData.user) {
          await supabase.from('profiles').upsert({
            id: authData.user.id,
            full_name: fullName.trim(),
            email: email,
          });
        }
        window.location.href = '/calendar';
      }
    } else {
      const { error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) {
        setErrorMsg('ログインに失敗しました。メールアドレスとパスワードを確認してください。');
        setLoading(false);
      } else {
        window.location.href = '/calendar';
      }
    }
  };

  // Google連携ログイン / 新規登録
  const handleGoogleAuth = async () => {
    setLoading(true);
    await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: {
        redirectTo: `${window.location.origin}/calendar`,
      },
    });
  };

  if (loading) {
    return (
      <div className="h-screen flex items-center justify-center bg-slate-100 text-xs font-semibold text-slate-500">
        読み込み中...
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-100 flex flex-col justify-center items-center p-4">
      <div className="bg-white p-8 rounded-2xl shadow-xl w-full max-w-sm border border-slate-200">
        <h1 className="text-3xl font-black text-slate-900 text-center tracking-tight mb-2">
          BOOK KING
        </h1>
        <p className="text-xs text-slate-500 text-center mb-6">
          スマートにスケジュールを管理
        </p>

        {errorMsg && (
          <div className="mb-4 p-2.5 bg-red-50 border border-red-200 rounded-lg text-xs text-red-600 font-medium">
            {errorMsg}
          </div>
        )}

        {/* Googleログインボタン */}
        <button
          onClick={handleGoogleAuth}
          className="w-full mb-4 py-2.5 px-4 border border-slate-300 rounded-xl bg-white hover:bg-slate-50 transition text-xs font-bold text-slate-700 flex items-center justify-center gap-2 shadow-xs cursor-pointer"
        >
          <svg className="w-4 h-4" viewBox="0 0 24 24">
            <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
            <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
            <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.06H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.94l2.85-2.22.81-.63z"/>
            <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.84c.87-2.6 3.3-4.52 6.16-4.52z"/>
          </svg>
          Googleで{isSignUp ? '新規登録' : 'ログイン'}
        </button>

        <div className="relative my-4">
          <div className="absolute inset-0 flex items-center">
            <div className="w-full border-t border-slate-200"></div>
          </div>
          <div className="relative flex justify-center text-[10px] uppercase">
            <span className="bg-white px-2 text-slate-400">または</span>
          </div>
        </div>

        {/* 認証フォーム */}
        <form onSubmit={handleAuth} className="space-y-3">
          {/* 新規登録時のみ名前入力欄を表示 */}
          {isSignUp && (
            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1">お名前（表示名） *</label>
              <input
                type="text"
                value={fullName}
                onChange={(e) => setFullName(e.target.value)}
                placeholder="例: 山田 太郎"
                required={isSignUp}
                className="w-full px-3 py-2 text-xs border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-slate-800"
              />
            </div>
          )}

          <div>
            <label className="block text-xs font-bold text-slate-700 mb-1">メールアドレス *</label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              className="w-full px-3 py-2 text-xs border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-slate-800"
            />
          </div>

          <div>
            <label className="block text-xs font-bold text-slate-700 mb-1">パスワード *</label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              className="w-full px-3 py-2 text-xs border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-slate-800"
            />
          </div>

          <button
            type="submit"
            className="w-full py-2.5 bg-slate-900 text-white font-bold text-xs rounded-xl hover:bg-slate-800 transition cursor-pointer mt-2"
          >
            {isSignUp ? '新規登録' : 'ログイン'}
          </button>
        </form>

        <div className="mt-6 text-center">
          <button
            onClick={() => {
              setIsSignUp(!isSignUp);
              setErrorMsg('');
              setFullName('');
            }}
            className="text-xs text-slate-500 hover:text-slate-800 underline font-medium cursor-pointer"
          >
            {isSignUp ? 'すでにアカウントをお持ちの方（ログイン）' : 'アカウントをお持ちでない方（新規登録）'}
          </button>
        </div>
      </div>
    </div>
  );
}

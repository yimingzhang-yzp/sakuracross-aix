/**
 * /admin 配下を認証必須にする。
 * - Supabase 未設定 かつ 非本番: 開発用バイパス(何もしない)
 * - それ以外: Supabase セッションを確認し、未ログインなら /login へ
 */
import { createServerClient } from '@supabase/ssr';
import { type NextRequest, NextResponse } from 'next/server';

export async function middleware(request: NextRequest) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const configured = Boolean(url && anonKey);

  if (!configured) {
    if (process.env.NODE_ENV === 'production') {
      return new NextResponse('Supabase Auth が未設定です(NEXT_PUBLIC_SUPABASE_URL / ANON_KEY)', { status: 500 });
    }
    return NextResponse.next();
  }

  let response = NextResponse.next({ request });
  const supabase = createServerClient(url!, anonKey!, {
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll: (list) => {
        for (const { name, value } of list) request.cookies.set(name, value);
        response = NextResponse.next({ request });
        for (const { name, value, options } of list) response.cookies.set(name, value, options);
      },
    },
  });

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    const loginUrl = request.nextUrl.clone();
    loginUrl.pathname = '/login';
    loginUrl.searchParams.set('next', request.nextUrl.pathname);
    return NextResponse.redirect(loginUrl);
  }
  return response;
}

export const config = {
  matcher: ['/admin/:path*'],
};

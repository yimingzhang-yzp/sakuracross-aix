/**
 * Supabase Auth のセッション更新(トークンリフレッシュ)と /admin の未ログイン時リダイレクト。
 * Supabase 未設定時は何もしない(認可の最終判断は lib/admin/auth.ts の requireAdmin が行う)。
 */
import { createServerClient } from '@supabase/ssr';
import { type NextRequest, NextResponse } from 'next/server';

export async function middleware(request: NextRequest): Promise<NextResponse> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim();
  if (!url || !anonKey) {
    return NextResponse.next({ request });
  }

  let response = NextResponse.next({ request });
  const supabase = createServerClient(url, anonKey, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet) {
        for (const { name, value } of cookiesToSet) request.cookies.set(name, value);
        response = NextResponse.next({ request });
        for (const { name, value, options } of cookiesToSet) response.cookies.set(name, value, options);
      },
    },
  });

  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { pathname } = request.nextUrl;
  if (!user && pathname.startsWith('/admin')) {
    const loginUrl = request.nextUrl.clone();
    loginUrl.pathname = '/login';
    loginUrl.search = '';
    return NextResponse.redirect(loginUrl);
  }
  if (user && pathname === '/login' && !request.nextUrl.searchParams.has('error')) {
    const adminUrl = request.nextUrl.clone();
    adminUrl.pathname = '/admin';
    adminUrl.search = '';
    return NextResponse.redirect(adminUrl);
  }
  return response;
}

export const config = {
  matcher: ['/admin/:path*', '/login'],
};

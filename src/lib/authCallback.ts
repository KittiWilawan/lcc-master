import { supabase } from './supabase';

export type AuthCallbackKind = 'recovery' | 'session' | 'none';

function readCallbackParameters(url: URL): URLSearchParams {
  if (url.searchParams.size > 0) return url.searchParams;
  const fragment = url.hash.startsWith('#') ? url.hash.slice(1) : url.hash;
  return new URLSearchParams(fragment);
}

function isResetPasswordUrl(url: URL): boolean {
  const pathSegments = url.pathname.split('/').filter(Boolean);
  return url.hostname === 'reset-password' || pathSegments.includes('reset-password');
}

export async function applyAuthCallbackUrl(value: string): Promise<AuthCallbackKind> {
  const url = new URL(value);
  const parameters = readCallbackParameters(url);
  const callbackError = parameters.get('error_description');
  if (callbackError) throw new Error(callbackError);

  const code = parameters.get('code');
  if (code) {
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (error) throw error;
    return isResetPasswordUrl(url) ? 'recovery' : 'session';
  }

  const accessToken = parameters.get('access_token');
  const refreshToken = parameters.get('refresh_token');
  if (!accessToken || !refreshToken) return 'none';

  const { error } = await supabase.auth.setSession({
    access_token: accessToken,
    refresh_token: refreshToken,
  });
  if (error) throw error;
  return parameters.get('type') === 'recovery' || isResetPasswordUrl(url) ? 'recovery' : 'session';
}

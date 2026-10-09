import type { Cookies } from 'electron';

export async function clearBilibiliCookies(cookies: Pick<Cookies, 'get' | 'remove'>): Promise<void> {
  const entries = await cookies.get({ domain: 'bilibili.com' });
  for (const cookie of entries) {
    // Electron stores domain cookies with a leading dot; URL hosts cannot use it.
    const host = cookie.domain.replace(/^\./, '');
    const url = `https://${host}${cookie.path || '/'}`;
    await cookies.remove(url, cookie.name);
  }
}

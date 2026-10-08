import type { LivePageEvent } from '../shared/streaming';

declare global {
  interface Window {
    hammerLivePage: {
      sign: (parameters: string) => string;
      publish: (event: LivePageEvent) => void;
    };
    hammerLivePageInstalled?: boolean;
  }
}

// This function is serialized into the guest's main world. Keep it self-contained.
// Protocol adapted from ProgramRipper/BLiveWeb (MIT); see THIRD_PARTY_NOTICES.md.
export function installBilibiliLivePage() {
  if (location.origin !== 'https://link.bilibili.com' || window.hammerLivePageInstalled) return;
  window.hammerLivePageInstalled = true;
  const bridge = window.hammerLivePage;
  const nativeFetch = window.fetch.bind(window);
  const nativeOpen = XMLHttpRequest.prototype.open;
  const nativeSend = XMLHttpRequest.prototype.send;
  const nativeSetRequestHeader = XMLHttpRequest.prototype.setRequestHeader;
  const textGetter = Object.getOwnPropertyDescriptor(XMLHttpRequest.prototype, 'responseText')?.get;
  const responseGetter = Object.getOwnPropertyDescriptor(XMLHttpRequest.prototype, 'response')?.get;
  if (!textGetter || !responseGetter) throw new Error('浏览器不支持网页开播助手');
  const permissionPath = '/xlive/app-blink/v1/live/GetWebLivePermission';
  const webStartPath = '/xlive/app-blink/v1/streaming/WebLiveCenterStartLive';
  const startPath = '/room/v1/Room/startLive';
  const upstreamPath = '/xlive/app-blink/v1/live/FetchWebUpStreamAddr';
  const streamPath = '/live_stream/v1/StreamList/get_stream_by_roomId';
  const stopPath = '/room/v1/Room/stopLive';
  let roomId = 0;
  const loadListeners = new WeakMap<XMLHttpRequest, () => void>();

  const apiURL = (input: string) => {
    try {
      const url = new URL(input, location.href);
      return url.origin === 'https://api.live.bilibili.com' ? url : null;
    } catch {
      return null;
    }
  };
  const parameters = (url: URL, body?: unknown) => {
    const params = new URLSearchParams(url.search);
    if (typeof body === 'string' || body instanceof URLSearchParams) {
      let entries: URLSearchParams;
      try {
        const json = typeof body === 'string' && body.startsWith('{') ? JSON.parse(body) : null;
        entries = json ? new URLSearchParams(json) : new URLSearchParams(body.toString());
      } catch {
        entries = new URLSearchParams(body.toString());
      }
      entries.forEach((value, key) => params.set(key, value));
    } else if (body instanceof FormData) {
      body.forEach((value, key) => {
        if (typeof value === 'string') params.set(key, value);
      });
    }
    const id = Number(params.get('room_id') || params.get('roomid'));
    if (Number.isSafeInteger(id) && id > 0) roomId = id;
    return params;
  };
  const startBody = (params: URLSearchParams) => {
    // Match the userscript's live-client protocol, rather than the web-only start API.
    const body = new URLSearchParams({
      access_key: '',
      appkey: 'aae92bc66f3edfab',
      area_v2: params.get('area_v2') ?? '',
      build: '9343',
      csrf: params.get('csrf') ?? '',
      csrf_token: params.get('csrf_token') ?? params.get('csrf') ?? '',
      platform: 'pc_link',
      room_id: params.get('room_id') ?? String(roomId),
      ts: Math.floor(Date.now() / 1000).toString(),
    });
    body.sort();
    body.set('sign', bridge.sign(body.toString()));
    return body;
  };
  const request = (method: string, url: URL, body?: unknown) => {
    const params = parameters(url, body);
    if (method === 'POST' && (url.pathname === webStartPath || url.pathname === startPath)) {
      bridge.publish({ type: 'clear' });
      return { method: 'POST', url: new URL(startPath, url.origin), body: startBody(params) };
    }
    if (url.pathname === upstreamPath && roomId) {
      return { method: 'GET', url: new URL(`${streamPath}?room_id=${roomId}`, url.origin), body: null };
    }
    return { method, url, body };
  };
  const transform = (path: string, value: unknown) => {
    if (!value || typeof value !== 'object') return value;
    const payload = value as { code?: number; message?: string; msg?: string; data?: Record<string, unknown> };
    if (payload.code !== 0) {
      if ([webStartPath, startPath, upstreamPath, stopPath].includes(path)) {
        bridge.publish({
          type: 'error',
          message: `${payload.message || payload.msg || 'B站请求失败'}（${payload.code}）`,
        });
      }
      return value;
    }
    if (path === stopPath || path.endsWith('/WebLiveCenterStopLive')) bridge.publish({ type: 'clear' });
    const data = payload.data;
    if (!data) return value;
    if (path === permissionPath) {
      return { ...payload, data: { ...data, allow_live: true, fans_threshold: 0 } };
    }
    if ([startPath, webStartPath, upstreamPath, streamPath].includes(path)) {
      const candidate = data.rtmp ?? data.addr;
      const entries = Array.isArray(candidate) ? candidate : [candidate];
      for (const entry of entries) {
        if (!entry || typeof entry !== 'object') continue;
        const { addr, code } = entry as { addr?: unknown; code?: unknown };
        if (typeof addr === 'string' && /^rtmps?:\/\//i.test(addr) && typeof code === 'string' && code) {
          bridge.publish({ type: 'credentials', data: { roomId, server: addr, streamKey: code } });
          break;
        }
      }
      if (path === upstreamPath && data.rtmp) {
        const mapped: Record<string, unknown> = { ...data, addr: data.rtmp, line: data.stream_line };
        delete mapped.rtmp;
        delete mapped.stream_line;
        return { ...payload, data: mapped };
      }
    }
    return value;
  };
  const transformText = (path: string, text: string) => {
    try {
      return JSON.stringify(transform(path, JSON.parse(text)));
    } catch {
      return text;
    }
  };

  XMLHttpRequest.prototype.open = function (
    method: string,
    input: string | URL,
    async?: boolean,
    username: string | null = null,
    password: string | null = null
  ) {
    // A reused XHR must not retain the previous request's response overrides.
    delete (this as unknown as Record<string, unknown>).responseText;
    delete (this as unknown as Record<string, unknown>).response;
    this.send = nativeSend;
    this.setRequestHeader = nativeSetRequestHeader;
    const previous = loadListeners.get(this);
    if (previous) this.removeEventListener('load', previous);
    const url = apiURL(String(input));
    if (url) parameters(url);
    if (
      !url ||
      (![permissionPath, webStartPath, startPath, upstreamPath, streamPath, stopPath].includes(url.pathname) &&
        !url.pathname.endsWith('/WebLiveCenterStopLive'))
    )
      return nativeOpen.call(this, method, input, async ?? true, username, password);
    let active = request(method.toUpperCase(), url);
    nativeOpen.call(this, active.method, active.url.href, async ?? true, username, password);
    if (active.url.pathname === startPath && active.method === 'POST') {
      // setRequestHeader appends values; discard the page's content type before
      // setting the form content type once in send(). Preserve all other headers.
      this.setRequestHeader = (name, value) => {
        if (name.toLowerCase() !== 'content-type') nativeSetRequestHeader.call(this, name, value);
      };
    }
    let transformed = '';
    let raw = '';
    const read = () => {
      const text = textGetter.call(this);
      if (this.readyState === 4 && text !== raw) {
        raw = text;
        transformed = transformText(url.pathname, text);
      }
      return this.readyState === 4 ? transformed : text;
    };
    Object.defineProperties(this, {
      responseText: { configurable: true, get: read },
      response: {
        configurable: true,
        get: () => {
          if (this.responseType === '' || this.responseType === 'text') return read();
          const response = responseGetter.call(this);
          return this.responseType === 'json' && this.readyState === 4 ? transform(url.pathname, response) : response;
        },
      },
    });
    const loaded = () => {
      if (this.responseType === 'json') void this.response;
      else if (!this.responseType || this.responseType === 'text') void this.responseText;
    };
    loadListeners.set(this, loaded);
    this.addEventListener('load', loaded, { once: true });
    this.send = (body?: Document | XMLHttpRequestBodyInit | null) => {
      // open() had no body; recompute the start payload after send() supplies it.
      if (active.url.pathname === startPath && method.toUpperCase() === 'POST') {
        active = request(method.toUpperCase(), url, body);
        nativeSetRequestHeader.call(this, 'Content-Type', 'application/x-www-form-urlencoded');
        return nativeSend.call(this, active.body as XMLHttpRequestBodyInit | null);
      }
      parameters(url, body);
      return nativeSend.call(this, active.url.pathname === streamPath ? null : body);
    };
  };

  window.fetch = async (input, init) => {
    const inputURL = input instanceof Request ? input.url : String(input);
    const url = apiURL(inputURL);
    if (!url) return nativeFetch(input, init);
    const method = (init?.method ?? (input instanceof Request ? input.method : 'GET')).toUpperCase();
    let body = init?.body;
    if (!body && input instanceof Request && method !== 'GET' && method !== 'HEAD') body = await input.clone().text();
    const active = request(method, url, body);
    const changed = active.url.href !== url.href || active.body !== body;
    const options =
      input instanceof Request
        ? {
            credentials: input.credentials,
            headers: input.headers,
            signal: input.signal,
            mode: input.mode,
            redirect: input.redirect,
            ...init,
          }
        : init;
    const response = await nativeFetch(
      changed ? active.url.href : input,
      changed
        ? {
            ...options,
            method: active.method,
            body: active.body as BodyInit | null,
            credentials: 'include',
            headers:
              active.method === 'POST' ? { 'Content-Type': 'application/x-www-form-urlencoded' } : options?.headers,
          }
        : init
    );
    if (
      ![permissionPath, startPath, webStartPath, upstreamPath, streamPath, stopPath].includes(url.pathname) &&
      !url.pathname.endsWith('/WebLiveCenterStopLive')
    )
      return response;
    try {
      const original = await response.clone().json();
      const value = transform(url.pathname, original);
      if (value === original) return response;
      const replacement = new Response(JSON.stringify(value), {
        status: response.status,
        statusText: response.statusText,
        headers: response.headers,
      });
      Object.defineProperties(replacement, {
        url: { value: response.url },
        redirected: { value: response.redirected },
        type: { value: response.type },
      });
      return replacement;
    } catch {
      return response;
    }
  };
  bridge.publish({ type: 'ready' });
  document.addEventListener('DOMContentLoaded', () => bridge.publish({ type: 'ready' }), { once: true });
}

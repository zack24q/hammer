export const BILIBILI_LIVE_PAGE = 'https://link.bilibili.com/p/center/index#/my-room/start-live';

export interface StreamCredentials {
  roomId: number;
  server: string;
  streamKey: string;
}

export type LivePageEvent =
  | { type: 'ready' }
  | { type: 'credentials'; data: StreamCredentials }
  | { type: 'clear' }
  | { type: 'error'; message: string };

export type StreamingResult<T> = { success: true; data: T } | { success: false; error: string };

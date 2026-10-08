import { contextBridge, ipcRenderer } from 'electron';
import MD5 from 'crypto-js/md5';
import { installBilibiliLivePage } from './bilibiliLivePage';
import type { LivePageEvent } from '../shared/streaming';

if (process.isMainFrame && location.origin === 'https://link.bilibili.com' && location.pathname === '/p/center/index') {
  contextBridge.exposeInMainWorld('hammerLivePage', {
    sign: (parameters: string) => {
      if (typeof parameters !== 'string' || parameters.length > 8192) throw new Error('Invalid live parameters');
      return MD5(parameters + 'af125a0d5279fd576c1b4418a3e8276d').toString();
    },
    publish: (event: LivePageEvent) => {
      if (location.origin !== 'https://link.bilibili.com' || !event || typeof event !== 'object') return;
      if (event.type === 'ready' || event.type === 'clear')
        ipcRenderer.sendToHost('bilibili-live', { type: event.type });
      if (event.type === 'error' && typeof event.message === 'string') {
        ipcRenderer.sendToHost('bilibili-live', { type: 'error', message: event.message.slice(0, 500) });
      }
      if (event.type === 'credentials') {
        const data = event.data;
        if (
          data &&
          typeof data.server === 'string' &&
          data.server.length < 8192 &&
          /^rtmps?:\/\//i.test(data.server) &&
          typeof data.streamKey === 'string' &&
          data.streamKey.length > 0 &&
          data.streamKey.length < 8192
        ) {
          ipcRenderer.sendToHost('bilibili-live', {
            type: 'credentials',
            data: { roomId: Number(data.roomId) || 0, server: data.server, streamKey: data.streamKey },
          });
        }
      }
    },
  });
  contextBridge.executeInMainWorld({ func: installBilibiliLivePage });
}

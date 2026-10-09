import type { OBSWebSocket } from 'obs-websocket-js';

export async function configureOBSStream(
  obs: Pick<OBSWebSocket, 'call'>,
  server: string,
  streamKey: string,
  signal?: AbortSignal
) {
  if (!/^rtmps?:\/\//i.test(server) || !streamKey) throw new Error('推流地址或密钥无效，请重新获取');
  signal?.throwIfAborted();
  const { outputActive } = await obs.call('GetStreamStatus');
  signal?.throwIfAborted();
  if (outputActive) throw new Error('OBS正在推流，请先停止推流再修改配置');
  await obs.call('SetStreamServiceSettings', {
    streamServiceType: 'rtmp_custom',
    streamServiceSettings: { server, key: streamKey, use_auth: false },
  });
  // 只设置当前OBS配置，用户在OBS中选择画面并开始推流。
}

export async function configureOBSStreamConnection(
  obs: Pick<OBSWebSocket, 'connect' | 'disconnect' | 'call' | 'on' | 'off'>,
  url: string,
  password: string | undefined,
  server: string,
  streamKey: string,
  timeoutMs = 10000,
  signal?: AbortSignal
) {
  signal?.throwIfAborted();
  const controller = new AbortController();
  let rejectFailure: (error: Error) => void;
  const failure = new Promise<never>((_resolve, reject) => {
    rejectFailure = reject;
  });
  const fail = (error: Error) => {
    controller.abort(error);
    rejectFailure(error);
  };
  const closed = () => fail(new Error('OBS连接已断开，请检查OBS后重试'));
  const errored = (error: Error) => fail(new Error(error.message || 'OBS连接失败，请重试'));
  const aborted = () => fail(signal?.reason ?? new Error('OBS设置已取消'));
  signal?.addEventListener('abort', aborted, { once: true });
  obs.on('ConnectionClosed', closed);
  obs.on('ConnectionError', errored);
  const timer = setTimeout(() => fail(new Error('OBS设置超时，请检查连接后重试')), timeoutMs);

  try {
    await Promise.race([
      (async () => {
        await obs.connect(url, password);
        controller.signal.throwIfAborted();
        await configureOBSStream(obs, server, streamKey, controller.signal);
      })(),
      failure,
    ]);
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', aborted);
    controller.abort();
    obs.off('ConnectionClosed', closed);
    obs.off('ConnectionError', errored);
    // Socket shutdown can itself hang during a failed handshake. Bound cleanup
    // too, so a network failure cannot keep the dialog locked indefinitely.
    let cleanupTimer: ReturnType<typeof setTimeout> | undefined;
    try {
      await Promise.race([
        obs.disconnect().catch((): void => undefined),
        new Promise<void>(resolve => {
          cleanupTimer = setTimeout(resolve, 1000);
        }),
      ]);
    } finally {
      if (cleanupTimer !== undefined) clearTimeout(cleanupTimer);
    }
  }
}

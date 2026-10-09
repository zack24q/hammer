import React, { useEffect, useRef, useState } from 'react';
import { Button, Callout, Dialog, Flex, IconButton, Spinner, Text, TextField, Tooltip } from '@radix-ui/themes';
import { Cross2Icon } from '@radix-ui/react-icons';
import type { WebviewTag, IpcMessageEvent, DidFailLoadEvent, DidStartNavigationEvent } from 'electron';
import { useUserStore } from '../store/userStore';
import { useSettingStore } from '../store/settingStore';
import { useToast } from '../context/ToastContext';
import { obsWebSocketService } from '../services/obsWebSocket';
import { BILIBILI_LIVE_PAGE, type LivePageEvent, type StreamCredentials } from '../../shared/streaming';

const StreamingControls: React.FC = () => {
  const { isLoggedIn, userId } = useUserStore();
  const { obsConfig, updateOBSConfig } = useSettingStore();
  const { showToast } = useToast();
  const [open, setOpen] = useState(false);
  const [preload, setPreload] = useState('');
  const [credentials, setCredentials] = useState<StreamCredentials | null>(null);
  const [showKey, setShowKey] = useState(false);
  const [loading, setLoading] = useState(true);
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [reloadVersion, setReloadVersion] = useState(0);
  const webviewRef = useRef<WebviewTag>(null);
  const accountRef = useRef(0);
  const operationRef = useRef<AbortController | null>(null);

  useEffect(() => {
    accountRef.current += 1;
    setOpen(false);
    setCredentials(null);
    setShowKey(false);
    setError('');
    setBusy(false);
    return () => {
      accountRef.current += 1;
      operationRef.current?.abort();
      operationRef.current = null;
    };
  }, [userId, isLoggedIn]);

  useEffect(() => {
    if (!open) {
      setCredentials(null);
      setShowKey(false);
      return;
    }
    let disposed = false;
    setLoading(true);
    setReady(false);
    setError('');
    setPreload('');
    setCredentials(null);
    setShowKey(false);
    window.electron.streaming
      .getPageConfig()
      .then(result => {
        if (disposed) return;
        if (result.success === false) throw new Error(result.error);
        setPreload(result.data.preload);
      })
      .catch(error => {
        if (!disposed) {
          setLoading(false);
          setError(error instanceof Error ? error.message : '开播页面初始化失败');
        }
      });
    return () => {
      disposed = true;
    };
  }, [open, reloadVersion]);

  useEffect(() => {
    const guest = webviewRef.current;
    if (!open || !preload || !guest) return;
    let pageFailed = false;
    const clearCredentials = () => {
      operationRef.current?.abort();
      setCredentials(null);
      setShowKey(false);
    };
    const message = (event: IpcMessageEvent) => {
      if (event.channel !== 'bilibili-live') return;
      // Only the dedicated preload in the official live center can publish these messages.
      const url = new URL(guest.getURL());
      if (url.origin !== 'https://link.bilibili.com' || url.pathname !== '/p/center/index') return;
      const data = event.args[0] as LivePageEvent;
      if (data?.type === 'ready' && !pageFailed) setReady(true);
      if (data?.type === 'clear') {
        clearCredentials();
        setError('');
      }
      if (data?.type === 'error') setError(data.message);
      if (data?.type === 'credentials') {
        setCredentials(data.data);
        setShowKey(false);
        setError('');
      }
    };
    const zoom = () => guest.setZoomFactor(0.75);
    const loaded = () => setLoading(false);
    const navigating = (event: DidStartNavigationEvent) => {
      if (!event.isMainFrame || event.isInPlace) return;
      pageFailed = false;
      clearCredentials();
      setLoading(true);
      setReady(false);
      setError('');
    };
    const failed = (event: DidFailLoadEvent) => {
      if (!event.isMainFrame || event.errorCode === -3) return;
      pageFailed = true;
      clearCredentials();
      setLoading(false);
      setReady(false);
      setError(`开播页面加载失败：${event.errorDescription}，请点击重新加载`);
    };
    guest.addEventListener('ipc-message', message);
    guest.addEventListener('dom-ready', zoom);
    guest.addEventListener('did-stop-loading', loaded);
    guest.addEventListener('did-start-navigation', navigating);
    guest.addEventListener('did-fail-load', failed);
    return () => {
      guest.removeEventListener('ipc-message', message);
      guest.removeEventListener('dom-ready', zoom);
      guest.removeEventListener('did-stop-loading', loaded);
      guest.removeEventListener('did-start-navigation', navigating);
      guest.removeEventListener('did-fail-load', failed);
    };
  }, [open, preload]);

  const run = async (operation: (signal: AbortSignal) => Promise<void>) => {
    if (operationRef.current) return;
    const controller = new AbortController();
    operationRef.current = controller;
    const account = accountRef.current;
    setBusy(true);
    setError('');
    try {
      await operation(controller.signal);
    } catch (error) {
      if (accountRef.current === account && !controller.signal.aborted)
        setError(error instanceof Error ? error.message : '操作失败，请重试');
    } finally {
      if (operationRef.current === controller) {
        operationRef.current = null;
        setBusy(false);
      }
    }
  };

  const configureOBS = () =>
    run(async signal => {
      if (!credentials) return;
      const account = accountRef.current;
      if (
        !obsConfig.address.trim() ||
        !Number.isInteger(obsConfig.port) ||
        obsConfig.port < 1 ||
        obsConfig.port > 65535
      ) {
        throw new Error('请填写有效的OBS地址和端口（1到65535）');
      }
      obsWebSocketService.setConfig(obsConfig);
      await obsWebSocketService.configureStream(credentials.server, credentials.streamKey, signal);
      if (accountRef.current === account && !signal.aborted)
        showToast('已写入OBS，请在OBS中点击「开始直播」', 'success');
    });

  const copy = async (value: string, label: string) => {
    try {
      await navigator.clipboard.writeText(value);
      showToast(`${label}已复制`, 'success');
    } catch {
      showToast('复制失败，请手动选择并复制', 'error');
    }
  };

  const disabled = busy;

  return (
    <Dialog.Root open={open} onOpenChange={value => !busy && setOpen(value)}>
      <Tooltip content="打开B站官网进行开播，获取推流码" side="top">
        <Dialog.Trigger>
          <Button disabled={!isLoggedIn}>B站开播设置</Button>
        </Dialog.Trigger>
      </Tooltip>
      <Dialog.Content
        maxWidth="1200px"
        style={{ width: 'calc(100vw - 48px)', height: 'calc(100vh - 48px)', display: 'flex', flexDirection: 'column' }}
        aria-describedby="streaming-description"
      >
        <Flex justify="between" align="center" gap="3" mb="2">
          <Flex gap="3" align="center" wrap="wrap">
            <Dialog.Title mb="0">B站开播设置</Dialog.Title>
            <Flex gap="2" align="center">
              {loading && <Spinner />}
              <Text size="1" color="gray">
                {ready ? '开播助手已成功启用' : loading ? '正在加载官方页面…' : '助手未就绪，请重新加载'}
              </Text>
              {!ready && !loading && (
                <Button
                  variant="soft"
                  disabled={busy}
                  onClick={() => {
                    setCredentials(null);
                    setShowKey(false);
                    setReloadVersion(value => value + 1);
                  }}
                >
                  重新加载
                </Button>
              )}
            </Flex>
          </Flex>
          <Dialog.Close>
            <IconButton variant="ghost" color="gray" disabled={busy} aria-label="关闭弹窗" style={{ flexShrink: 0 }}>
              <Cross2Icon width="18" height="18" />
            </IconButton>
          </Dialog.Close>
        </Flex>
        <Dialog.Description id="streaming-description" mb="2">
          在官方页面选择「第三方软件开播」，若提示身份验证，请按页面提示完成，成功后可复制或自动填写到OBS。
        </Dialog.Description>
        {error && (
          <Callout.Root color="red" mb="2" role="alert">
            <Callout.Text>{error}</Callout.Text>
          </Callout.Root>
        )}
        <Flex gap="3" style={{ flex: 1, minHeight: 0 }}>
          <div
            style={{
              flex: 1,
              minWidth: 0,
              border: '1px solid var(--gray-6)',
              borderRadius: 8,
              overflow: 'hidden',
              background: '#fff',
            }}
          >
            {preload && (
              <webview
                ref={webviewRef}
                src={BILIBILI_LIVE_PAGE}
                preload={preload}
                // @ts-expect-error React requires a string for this Electron attribute.
                allowpopups="true"
                style={{ width: '100%', height: '100%' }}
              />
            )}
          </div>
          <Flex direction="column" gap="3" style={{ width: 240, flexShrink: 0, overflowY: 'auto' }}>
            <Text weight="bold">OBS推流设置</Text>
            {credentials ? (
              <Flex direction="column" gap="3">
                <Text as="label" size="2">
                  推流地址
                  <Flex gap="2" mt="1">
                    <TextField.Root aria-label="推流地址" value={credentials.server} readOnly className="flex-1" />
                    <Button variant="soft" onClick={() => copy(credentials.server, '推流地址')}>
                      复制地址
                    </Button>
                  </Flex>
                </Text>
                <Text as="label" size="2">
                  推流码（串流密钥）
                  <Flex gap="2" mt="1" wrap="wrap">
                    <TextField.Root
                      aria-label="推流密钥"
                      type={showKey ? 'text' : 'password'}
                      value={credentials.streamKey}
                      readOnly
                      className="flex-1"
                    />
                    <Button variant="soft" onClick={() => setShowKey(!showKey)}>
                      {showKey ? '隐藏' : '显示'}
                    </Button>
                    <Button variant="soft" onClick={() => copy(credentials.streamKey, '推流密钥')}>
                      复制密钥
                    </Button>
                  </Flex>
                </Text>
                <details>
                  <summary className="cursor-pointer text-sm">OBS连接设置</summary>
                  <Text size="1" color="gray" as="p" mt="2">
                    在OBS的「工具 → WebSocket服务器设置」中启用服务器。此配置与点歌机共用。
                  </Text>
                  <Flex gap="2" mt="2" wrap="wrap">
                    <Text as="label" size="2" className="flex-1">
                      地址
                      <TextField.Root
                        aria-label="OBS地址"
                        value={obsConfig.address}
                        disabled={disabled}
                        onChange={event => updateOBSConfig({ address: event.target.value })}
                      />
                    </Text>
                    <Text as="label" size="2">
                      端口
                      <TextField.Root
                        aria-label="OBS端口"
                        type="number"
                        min={1}
                        max={65535}
                        value={obsConfig.port}
                        disabled={disabled}
                        onChange={event => updateOBSConfig({ port: Number(event.target.value) })}
                      />
                    </Text>
                    <Text as="label" size="2" className="flex-1">
                      密码
                      <TextField.Root
                        aria-label="OBS密码"
                        type="password"
                        value={obsConfig.password}
                        disabled={disabled}
                        onChange={event => updateOBSConfig({ password: event.target.value })}
                      />
                    </Text>
                  </Flex>
                </details>
                <Button onClick={configureOBS} disabled={disabled}>
                  {busy && <Spinner />}
                  自动设置到OBS
                </Button>
                <Text size="1" color="gray">
                  写入后请在OBS中点击「开始直播」。OBS正在推流时无法覆盖配置。
                </Text>
              </Flex>
            ) : (
              <Text size="2" color="gray">
                在左侧官方页面开播或获取推流码后，地址和密钥会自动显示在这里。
              </Text>
            )}
            <Text size="1" color="gray">
              关闭弹窗不会停止直播。下播时先在OBS停止推流，再在左侧页面结束直播。推流码仅保存在内存中，重新开播后请使用新码。
            </Text>
          </Flex>
        </Flex>
      </Dialog.Content>
    </Dialog.Root>
  );
};

export default StreamingControls;

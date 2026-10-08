import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useUserStore } from '../store/userStore';
import { useSettingStore } from '../store/settingStore';
import { Button, Spinner, TextField, Flex, Text, Separator, Callout, Badge, Box, Tooltip } from '@radix-ui/themes';
import { WebviewTag } from 'electron';
import StreamingControls from '../components/StreamingControls';

// MARK: 控制台
const ControlPanel: React.FC = () => {
  const { roomId } = useUserStore();
  const webviewRef = useRef<WebviewTag>(null);
  const [webviewLoading, setWebviewLoading] = useState(true);
  const { consoleConnected, setConsoleConnected, contentProtection } = useSettingStore();
  const [localRoomId, setLocalRoomId] = useState<number>();
  const [chatOverlayOpen, setChatOverlayOpen] = useState(false);
  const [closingChatOverlay, setClosingChatOverlay] = useState(false);

  // 注入并初始化 event_bridge_settings 的代码
  const injectEventBridgeSettings = useCallback((webview: WebviewTag) => {
    const initScript = `
(function() {
  try {
    // 初始化 event_bridge_settings
    const eventBridgeSettings = localStorage.getItem('event_bridge_settings');
    if (!eventBridgeSettings || eventBridgeSettings === 'null') {
      const defaultEventBridgeSettings = { address: 'localhost', port: 9696 };
      localStorage.setItem('event_bridge_settings', JSON.stringify(defaultEventBridgeSettings));
      console.log('已初始化 event_bridge_settings:', defaultEventBridgeSettings);
    } else {
      console.log('event_bridge_settings 已存在:', JSON.parse(eventBridgeSettings));
    }

    // 初始化 obs_connection_settings
    const obsConnectionSettings = localStorage.getItem('obs_connection_settings');
    if (!obsConnectionSettings || obsConnectionSettings === 'null') {
      const defaultObsConnectionSettings = { address: 'localhost', port: 4455 };
      localStorage.setItem('obs_connection_settings', JSON.stringify(defaultObsConnectionSettings));
      console.log('已初始化 obs_connection_settings:', defaultObsConnectionSettings);
    } else {
      console.log('obs_connection_settings 已存在:', JSON.parse(obsConnectionSettings));
    }
  } catch (error) {
    console.error('初始化设置失败:', error);
  }
})();`;

    // 立即执行初始化脚本
    webview.executeJavaScript(initScript).catch(console.error);
  }, []);

  // 处理 webview 加载完成事件
  const handleWebviewLoad = useCallback(() => {
    const webview = webviewRef.current;
    if (!webview) return;
    console.log('控制台webview加载完成');
    setWebviewLoading(false);
    // 注入 event_bridge_settings 初始化代码
    injectEventBridgeSettings(webview);
  }, [injectEventBridgeSettings]);

  // 当 consoleConnected 变为 true 时，设置 webview 事件监听
  useEffect(() => {
    if (!consoleConnected) return;

    const webview = webviewRef.current;
    if (!webview) return;

    const zoom = () => webview.setZoomFactor(0.75);
    webview.addEventListener('dom-ready', zoom);
    webview.addEventListener('did-finish-load', handleWebviewLoad);
    return () => {
      webview.removeEventListener('dom-ready', zoom);
      webview.removeEventListener('did-finish-load', handleWebviewLoad);
    };
  }, [consoleConnected, handleWebviewLoad]);

  // 打开弹幕悬浮框
  const handleOpenChatOverlay = async () => {
    try {
      const result = await window.electron.chatOverlay.open(contentProtection.chatOverlayWindow);
      if (result.success) {
        setChatOverlayOpen(true);
        console.log('弹幕悬浮框已打开，窗口ID:', result.windowId);
      } else {
        console.error('打开弹幕悬浮框失败:', result.error);
      }
    } catch (error) {
      console.error('打开弹幕悬浮框时出错:', error);
    }
  };

  // 关闭弹幕悬浮框
  const handleCloseChatOverlay = async () => {
    try {
      setClosingChatOverlay(true);
      const result = await window.electron.chatOverlay.close();
      if (result.success) {
        setChatOverlayOpen(false);
      } else {
        console.error('关闭弹幕悬浮框失败:', result.error);
      }
    } catch (error) {
      console.error('关闭弹幕悬浮框时出错:', error);
    } finally {
      setClosingChatOverlay(false);
    }
  };

  // 切换弹幕悬浮框状态
  const handleToggleChatOverlay = () => {
    if (chatOverlayOpen) {
      handleCloseChatOverlay();
    } else {
      handleOpenChatOverlay();
    }
  };

  // 重置弹幕悬浮窗大小与位置
  const handleResetChatOverlaySizeAndPosition = async () => {
    try {
      const result = await window.electron.chatOverlay.resetSizeAndPosition();
      if (result.success) {
        console.log('弹幕悬浮窗大小与位置重置成功');
      } else {
        console.error('重置弹幕悬浮窗失败:', result.error);
      }
    } catch (error) {
      console.error('重置弹幕悬浮窗大小与位置时出错:', error);
    }
  };

  // 监听弹幕浮层窗口关闭事件
  useEffect(() => {
    const cleanup = window.electron.chatOverlay.onClosed(() => {
      setChatOverlayOpen(false);
      console.log('弹幕浮层窗口已关闭');
    });

    return cleanup;
  }, []);

  if (!roomId) {
    return (
      <Flex direction="column" gap="3" align="start">
        <StreamingControls />
        <Callout.Root color="blue" size="1" className="mb-3 !p-2">
          <Callout.Text>
            使用弹幕控制台，请先关联账号并在
            <Badge color="indigo" variant="solid" ml="1" mr="1">
              弹幕机
            </Badge>
            中同步设置
          </Callout.Text>
        </Callout.Root>
      </Flex>
    );
  }

  // 渲染操作模块
  const renderOperationSection = () => (
    <Box mb="4">
      <Flex align="center" mb="2">
        <Text size="1" color="gray">
          操作
        </Text>
        <Separator orientation="horizontal" className="flex-auto ml-2" />
      </Flex>
      <Flex align="center" gap="2" wrap="wrap">
        {!consoleConnected && (
          <>
            <Text>房间号</Text>
            <TextField.Root
              className="w-24"
              placeholder="房间号"
              type="number"
              defaultValue={roomId}
              value={localRoomId}
              onChange={e => setLocalRoomId(Number(e.target.value))}
            />
          </>
        )}
        <StreamingControls />
        {!consoleConnected ? (
          <Tooltip content="最好先开启 OBS 的 WebSocket 服务器，以便在控制台中便捷控制直播与场景" side="top">
            <Button
              variant="solid"
              onClick={() => setConsoleConnected(!consoleConnected)}
              disabled={!localRoomId && !roomId}
            >
              打开控制台并连接弹幕与 OBS
            </Button>
          </Tooltip>
        ) : (
          <Button
            variant="solid"
            onClick={handleToggleChatOverlay}
            disabled={closingChatOverlay}
            color={chatOverlayOpen ? 'red' : undefined}
          >
            {chatOverlayOpen ? '关闭弹幕悬浮框' : '打开弹幕悬浮框'}
          </Button>
        )}
        {chatOverlayOpen && (
          <Button size="2" onClick={handleResetChatOverlaySizeAndPosition}>
            重置弹幕悬浮窗大小位置
          </Button>
        )}
      </Flex>
    </Box>
  );

  // 渲染控制台面板模块
  const renderConsolePanel = () => (
    <Box position="relative" flexGrow="1" className="border rounded-sm [border-color:var(--gray-5)]">
      <webview
        ref={webviewRef}
        src={`https://chat.laplace.live/dashboard/${localRoomId || roomId}`}
        className="h-full"
        // @ts-expect-error 官方类型定义有误
        allowpopups="true"
      />
      {webviewLoading && (
        <Flex position="absolute" left="3" top="3" align="center" gap="2">
          <Spinner />
          <Text color="gray">加载控制台中...</Text>
        </Flex>
      )}
    </Box>
  );

  return (
    <Flex direction="column" height="100%">
      {renderOperationSection()}
      {consoleConnected ? renderConsolePanel() : null}
    </Flex>
  );
};

export default ControlPanel;

import React, { useRef, useEffect, useState } from 'react';
import {
  Button,
  TextField,
  Flex,
  Text,
  Spinner,
  Callout,
  Badge,
  Separator,
  IconButton,
  Tooltip,
  Box,
} from '@radix-ui/themes';
import { ReloadIcon, ClipboardCopyIcon } from '@radix-ui/react-icons';
import { ConfigProps, uploadCookies } from '../services/cookies';
import { buildLaplaceSettingsScript } from '../services/laplaceSettings';
import { WebviewTag } from 'electron';
import { useToast } from '../context/ToastContext';
import { useSettingStore } from '../store/settingStore';
import { useUserStore } from '../store/userStore';
import { WINDOW_CONFIG } from '../../main/config';

interface DanmakuViewerProps {
  url?: string;
}

// MARK: 弹幕机
const DanmakuViewer: React.FC<DanmakuViewerProps> = ({ url = 'https://chat.laplace.live/' }) => {
  const webviewRef = useRef<WebviewTag>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [webviewLoading, setWebviewLoading] = useState(true);
  const { showToast } = useToast();
  const { roomId, userId, username } = useUserStore();
  const { theme } = useSettingStore();

  // 使用settingStore管理弹幕机配置
  const { danmakuConfig, regenerateDanmakuIds, getMergedToken } = useSettingStore();

  // 获取合并的token字符串
  const mergedToken = getMergedToken();

  // 获取用户登录状态
  const { isLoggedIn } = useUserStore();

  // 在新窗口中打开链接
  const openInNewWindow = () => {
    try {
      // 使用window.open()创建新窗口
      const newWindow = window.open(
        url,
        '_blank',
        `width=${WINDOW_CONFIG.DANMAKU_VIEWER.WIDTH},height=${WINDOW_CONFIG.DANMAKU_VIEWER.HEIGHT}`
      );
      if (newWindow) {
        newWindow.focus();
        console.log('已在新窗口中打开:', url);
      } else {
        console.error('无法打开新窗口，可能被浏览器阻止');
        showToast('无法打开新窗口', 'error');
      }
    } catch (err) {
      console.error('打开新窗口失败:', err);
      showToast('打开新窗口失败', 'error');
    }
  };

  // 设置token到webview中的输入框
  // const setSyncToken = (token: string) => {
  //   const webview = webviewRef.current;
  //   if (webview) {
  //     // 直接调用React的onChange方法
  //     const scriptToExecute = `
  //       {
  //         const tokenInput = document.getElementById('laplace-login-sync-token-input');
  //         if (tokenInput) {
  //           // 设置值
  //           tokenInput.value = "${token}";

  //           // 查找React属性并触发onChange
  //           const reactPropsKey = Object.keys(tokenInput).find(key => key.startsWith('__reactProps$'));
  //           if (reactPropsKey) {
  //             const reactProps = tokenInput[reactPropsKey];
  //             if (reactProps && reactProps.onChange) {
  //               // 创建一个合成事件对象
  //               const syntheticEvent = {
  //                 currentTarget: tokenInput,
  //               };
  //               // 调用React的onChange处理函数
  //               reactProps.onChange(syntheticEvent);
  //             }
  //           }
  //         }
  //       }
  //     `;

  //     webview
  //       .executeJavaScript(scriptToExecute)
  //       .catch(err => console.error('Error setting token:', err));
  //   }
  // };

  // 直接设置token到弹幕机
  // const setTokenToDanmaku = (text: string) => {
  //   setSyncToken(text);
  //   showToast('已设置同步密钥到LAPLACE', 'success');
  // };

  // 同步cookie
  // const handleUploadCookies = async () => {
  //   // 检查用户是否已登录
  //   if (!isLoggedIn) {
  //     showToast('请先关联账号', 'error');
  //     return;
  //   }

  //   setIsLoading(true);
  //   try {
  //     const configData: ConfigProps = {
  //       uuid: danmakuConfig.uuid,
  //       password: danmakuConfig.password,
  //     };

  //     console.log('开始上传Cookie数据, 配置:', configData);

  //     const result = await uploadCookies(configData);

  //     console.log('上传结果:', result);

  //     showToast(result.message, result.success ? 'success' : 'error');

  //     // 如果同步成功，则设置token到弹幕查看器
  //     if (result.success) {
  //       console.log('Cookie同步成功');
  //     }
  //   } catch (error) {
  //     console.error('上传过程中出错:', error);
  //     showToast(`上传失败: ${error}`, 'error');
  //   } finally {
  //     setIsLoading(false);
  //   }
  // };

  // 一键设置
  const setOptions = async () => {
    const webview = webviewRef.current;
    if (!webview || webviewLoading) {
      showToast('LAPLACE页面未加载完成', 'error');
      return;
    }

    const scriptToExecute = buildLaplaceSettingsScript({
      roomId: String(roomId ?? ''),
      userId: String(userId ?? ''),
      username,
      colorScheme: theme,
      loginSyncToken: mergedToken,
    });

    try {
      const result = await webview.executeJavaScript(scriptToExecute);
      if (result?.success) {
        setWebviewLoading(true);
        webview.reload();
        showToast(result.message, 'success');
      } else {
        showToast(result?.message || '设置失败', 'error');
        console.error('设置LAPLACE配置失败:', result);
      }
    } catch (error) {
      console.error('执行脚本失败:', error);
      showToast('设置失败', 'error');
    }
  };

  // 合并同步登录状态和一键设置的功能
  const handleSyncAndSetOptions = async () => {
    // 检查用户是否已登录
    if (!isLoggedIn) {
      showToast('请先关联账号', 'error');
      return;
    }

    if (webviewLoading || !webviewRef.current) {
      showToast('LAPLACE页面未加载完成', 'error');
      return;
    }
    if (!roomId) {
      showToast('未获取到有效的直播间号，请重新关联账号', 'error');
      return;
    }

    setIsLoading(true);
    try {
      const configData: ConfigProps = {
        uuid: danmakuConfig.uuid,
        password: danmakuConfig.password,
      };

      console.log('开始上传Cookie数据, 配置:', configData);

      const result = await uploadCookies(configData);

      console.log('上传结果:', result);

      // 如果同步成功，继续执行一键设置
      if (result.success) {
        showToast('登录状态同步成功', 'success');
        await setOptions();
      } else {
        showToast(result.message, 'error');
      }
    } catch (error) {
      console.error('同步过程中出错:', error);
      showToast(`同步失败: ${error}`, 'error');
    } finally {
      setIsLoading(false);
    }
  };

  // 重新生成IDs
  const generateNewIds = () => {
    regenerateDanmakuIds();
  };

  // 复制到剪贴板
  const copyToClipboard = () => {
    try {
      navigator.clipboard.writeText(mergedToken);
      showToast('已复制密钥到剪贴板', 'success');
    } catch (err) {
      console.error('复制失败:', err);
      showToast('复制失败，请手动复制', 'error');
    }
  };

  // 复制OBS链接
  const copyOBSLink = () => {
    const webview = webviewRef.current;
    if (webview) {
      // 执行脚本在webview中查找id为roomUrl的input元素并获取其值
      const scriptToExecute = `
        (function() {
          // 查找id为roomUrl的input元素
          const roomUrlInput = document.getElementById('roomUrl');
          
          if (roomUrlInput) {
            console.log('找到roomUrl输入框');
            return roomUrlInput.value || '';
          } else {
            console.error('未找到roomUrl输入框');
            return null;
          }
        })();
      `;

      webview
        .executeJavaScript(scriptToExecute)
        .then(result => {
          if (result) {
            // 复制链接到剪贴板
            navigator.clipboard
              .writeText(result)
              .then(() => {
                console.log('OBS链接已复制:', result);
                showToast('OBS 链接已复制到剪贴板', 'success');
              })
              .catch(err => {
                console.error('复制到剪贴板失败:', err);
                showToast('复制到剪贴板失败', 'error');
              });
          } else {
            showToast('未找到OBS链接，请先在 LAPLACE 中配置直播间', 'error');
          }
        })
        .catch(err => {
          console.error('获取OBS链接失败:', err);
          showToast('获取OBS链接失败', 'error');
        });
    } else {
      showToast('LAPLACE页面未加载完成', 'error');
    }
  };

  useEffect(() => {
    // 当webview加载完成后执行相关操作
    const webview = webviewRef.current;

    const handleWebviewLoad = () => {
      // laplace的配置初始值
      // const options = {
      //   json: {
      //     roomIds: ['10291374'],
      //     roomSearchHistory: [
      //       { value: '5440', uid: '9617619', label: '5440', username: '哔哩哔哩直播' },
      //       { value: '10291374', uid: '15557555', label: '10291374', username: '心如止水小阿酒' },
      //     ],
      //     roomSearchHistoryOpenPlatform: [
      //       { value: '5440', uid: '9617619', label: '5440', username: '哔哩哔哩直播' },
      //     ],
      //     colorScheme: 'dark',
      //     runningMode: 'obs',
      //     connectionMode: 'direct',
      //     uiLang: 'zh-Hans',
      //     panelGiftFilterByPrice: 1,
      //     panelEventHideRead: false,
      //     panelEventHideResult: false,
      //     customCss: '',
      //     dashboardShowMetrics: true,
      //     dashboardUseCst: false,
      //     dashboardShowTopRankUsers: true,
      //     useCst: false,
      //     danmakuFetcherApi: '',
      //     eventFetcherAuth: '',
      //     showUsername: true,
      //     showAvatar: true,
      //     showAvatarFrame: true,
      //     showSystemMessage: true,
      //     showStickyBar: true,
      //     sortStickyBarByPrice: false,
      //     showPhoneNotVerified: false,
      //     showOnlyCurrentMedal: false,
      //     showAutoDanmaku: false,
      //     showUserLevelAbove: 0,
      //     showGiftPriceAbove: 1,
      //     showGiftHighlightAbove: 29.99,
      //     showGiftStickyAbove: 29.99,
      //     showGiftStickyAlways: false,
      //     showGiftFree: false,
      //     showEnterEvent: false,
      //     showEnterEventCurrentGuardOnly: false,
      //     showFollowEvent: false,
      //     showDanmaku: true,
      //     showGift: true,
      //     showSuperChat: true,
      //     showToast: true,
      //     showRedEnvelop: true,
      //     showLottery: true,
      //     showNotice: false,
      //     showGuardBadge: true,
      //     eventMessageColor: '',
      //     eventGuardUsernameColor0: '',
      //     eventGuardUsernameColor1: '',
      //     eventGuardUsernameColor2: '',
      //     eventGuardUsernameColor3: '',
      //     showMedal: false,
      //     showMedalLightenedOnly: true,
      //     showWealthMedal: false,
      //     showUserLvl: false,
      //     showEmote: true,
      //     showCurrentRank: true,
      //     showModBadge: true,
      //     limitEventAmount: 50,
      //     limitStickyAmount: 10,
      //     autoHideEvent: 0,
      //     filterByMedalRange: [0, 40],
      //     baseFontSize: 20,
      //     altDanmakuLayout: false,
      //     customAvatarApi: '',
      //     showGiftEffect: false,
      //     showGiftEffectAbove: 99,
      //     dashboardAutoShowGiftEffect: true,
      //     dashboardAutoShowGiftEffectAbove: 0,
      //     remoteEmotesApi: '',
      //     sceneName: '',
      //     loginSyncToken: 'uNBgy4mVWi3XBUg64UK9cv@57QhWHJvBMpfqDbtgMPbrR',
      //     loginSyncServer: '',
      //     enableCloudTheme: null,
      //     cloudTheme: '',
      //     remoteTheme: null,
      //   },
      //   meta: { values: { enableCloudTheme: ['undefined'], remoteTheme: ['undefined'] } },
      // };

      // 设置localStorage的初始值
      // webview.executeJavaScript(`
      //   (function() {
      //     if (!localStorage.getItem('laplaceChatActiveTab')) {
      //       localStorage.setItem('laplaceChatActiveTab', '"advanced"');
      //       console.log('已设置laplaceChatActiveTab初始值为advanced');
      //     }
      //     if (!localStorage.getItem('laplaceChatOptions_v4')) {
      //       localStorage.setItem('laplaceChatOptions_v4', '${JSON.stringify(options)}');
      //       console.log('已设置laplaceChatOptions_v4初始值');
      //     }
      //   })();
      // `);

      console.log('弹幕机webview加载完成');
      setWebviewLoading(false);
    };

    if (webview) {
      const zoom = () => webview.setZoomFactor(0.75);
      webview.addEventListener('dom-ready', zoom);
      webview.addEventListener('did-finish-load', handleWebviewLoad);
      return () => {
        webview.removeEventListener('dom-ready', zoom);
        webview.removeEventListener('did-finish-load', handleWebviewLoad);
      };
    }
  }, []);

  // 渲染操作模块
  const renderOperationSection = () => (
    <Box mb="4">
      <Flex align="center" mb="2">
        <Text size="1" color="gray">
          操作
        </Text>
        <Separator orientation="horizontal" className="flex-auto ml-2" />
      </Flex>
      <Flex align="center" gap="2">
        <Text>密钥</Text>
        <TextField.Root placeholder="用户密钥" value={mergedToken} readOnly>
          <TextField.Slot side="right">
            <Tooltip content="复制到剪贴板">
              <IconButton size="1" variant="ghost" color="blue" onClick={copyToClipboard}>
                <ClipboardCopyIcon />
              </IconButton>
            </Tooltip>
            <Tooltip content="重新生成密钥">
              <IconButton size="1" variant="ghost" color="red" onClick={generateNewIds}>
                <ReloadIcon />
              </IconButton>
            </Tooltip>
          </TextField.Slot>
        </TextField.Root>
        <Tooltip content="同步登录状态后，自动在 LAPLACE 中完成配置">
          <Button onClick={handleSyncAndSetOptions} variant="solid" disabled={isLoading}>
            <Spinner size="1" loading={isLoading} />
            {isLoading ? '同步中' : '一键同步并设置'}
          </Button>
        </Tooltip>
        {/* <Tooltip content="将密钥、房间号等信息同步到 LAPLACE 中">
          <Button variant="soft" onClick={setOptions}>
            仅设置配置
          </Button>
        </Tooltip> */}
        <Tooltip content="新开窗口并放大，更方便配置">
          <Button variant="soft" onClick={openInNewWindow}>
            新窗口打开 LAPLACE
          </Button>
        </Tooltip>
        <Tooltip content="与 LAPLACE 页面中的复制作用相同">
          <Button variant="soft" color="green" onClick={copyOBSLink}>
            复制 OBS 链接
          </Button>
        </Tooltip>
      </Flex>
    </Box>
  );

  // 渲染弹幕配置模块
  const renderConfigSection = () => (
    <Flex flexGrow="1" direction="column">
      <Flex align="center" mb="2">
        <Text size="1" color="gray">
          弹幕配置 (LAPLACE)
        </Text>
        <Separator orientation="horizontal" className="flex-auto ml-2" />
      </Flex>
      <Box position="relative" flexGrow="1" className="border rounded-sm [border-color:var(--gray-5)]">
        <webview
          ref={webviewRef}
          src={url}
          className="h-full"
          // @ts-expect-error 官方类型定义有误
          allowpopups="true"
        />
        {webviewLoading && (
          <Flex position="absolute" left="3" top="3" align="center" gap="2">
            <Spinner />
            <Text color="gray">加载弹幕配置中...</Text>
          </Flex>
        )}
      </Box>
    </Flex>
  );

  return (
    <Flex direction="column" height="100%">
      {/* 用户提示信息 */}
      <Callout.Root color="blue" size="1" className="mb-2 !p-2">
        <Callout.Text>
          初次打开先
          <Badge color="indigo" variant="solid" ml="1" mr="1">
            关联账号
          </Badge>
          ，成功后点击
          <Badge color="indigo" variant="solid" ml="1" mr="1">
            一键同步并设置
          </Badge>
          完成所有配置。接下来在 LAPLACE 中进行弹幕的配置，每次修改完点击
          <Badge color="green" ml="1" mr="1">
            复制 OBS 链接
          </Badge>
          ，再粘贴到 OBS 中。
        </Callout.Text>
      </Callout.Root>

      {renderOperationSection()}
      {renderConfigSection()}
    </Flex>
  );
};

export default DanmakuViewer;

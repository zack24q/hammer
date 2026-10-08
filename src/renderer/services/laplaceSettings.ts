export interface LaplaceSettings {
  roomId: string;
  userId: string;
  username: string;
  colorScheme: string;
  loginSyncToken: string;
}

// 此函数会序列化后在 webview 中运行，不能引用模块外部的变量。
function applyLaplaceSettings(storage: Pick<Storage, 'getItem' | 'setItem'>, settings: LaplaceSettings) {
  const isObject = (value: unknown): value is Record<string, unknown> =>
    typeof value === 'object' && value !== null && !Array.isArray(value);

  try {
    if (!/^\d+$/.test(settings.roomId) || Number(settings.roomId) <= 0) {
      return { success: false, message: '未获取到有效的直播间号，请重新关联账号' };
    }

    const raw = storage.getItem('laplaceChatOptions_v4');
    const config: unknown = raw === null ? {} : JSON.parse(raw);
    if (!isObject(config)) {
      return { success: false, message: 'LAPLACE配置格式无效，请在页面中恢复配置后重试' };
    }

    config.roomIds = [settings.roomId];
    config.colorScheme = settings.colorScheme;
    config.loginSyncToken = settings.loginSyncToken;

    const history = Array.isArray(config.roomSearchHistory) ? config.roomSearchHistory : [];
    const index = history.findIndex(item => isObject(item) && String(item.value) === settings.roomId);
    const room = {
      ...(index >= 0 ? history[index] : {}),
      value: settings.roomId,
      uid: settings.userId,
      label: settings.roomId,
      username: settings.username,
    };
    if (index >= 0) history[index] = room;
    else history.push(room);
    config.roomSearchHistory = history;

    storage.setItem('laplaceChatOptions_v4', JSON.stringify(config));
    storage.setItem('laplaceChatActiveTab', JSON.stringify('advanced'));
    return { success: true, message: '已更新LAPLACE配置' };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { success: false, message: `设置失败: ${message}` };
  }
}

export function buildLaplaceSettingsScript(settings: LaplaceSettings): string {
  return `(${applyLaplaceSettings.toString()})(localStorage, ${JSON.stringify(settings)});`;
}

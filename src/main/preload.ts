import { contextBridge, ipcRenderer } from 'electron';
import type { StreamingResult } from '../shared/streaming';

// 声明全局类型
declare global {
  interface Window {
    electron: ElectronAPI;
  }
}

// 定义通用的更新相关类型
type UpdateErrorInfo = { message: string };
type UpdateDownloadedInfo = {
  releaseNotes: string;
  releaseName: string;
  releaseDate: Date;
  updateURL: string;
};

interface ElectronAPI {
  streaming: {
    getPageConfig: () => Promise<StreamingResult<{ preload: string }>>;
  };
  cookies: {
    getCookiesByDomains: (domains: string[]) => Promise<{
      success: boolean;
      data?: Record<string, Electron.Cookie[]>;
      error?: string;
    }>;
  };
  window: {
    resetSizeAndPosition: () => Promise<{
      success: boolean;
      error?: string;
    }>;
    setContentProtection: (enabled: boolean) => Promise<{
      success: boolean;
      error?: string;
    }>;
    getContentProtectionSettings: () => Promise<{
      success: boolean;
      data?: { mainWindow: boolean; chatOverlayWindow: boolean };
      error?: string;
    }>;
  };
  app: {
    quit: () => Promise<{
      success: boolean;
    }>;
    logout: () => Promise<{
      success: boolean;
      error?: string;
    }>;
    checkForUpdates: () => Promise<{
      success: boolean;
      currentVersion?: string;
      latestVersion?: string;
      hasUpdate?: boolean;
      releaseUrl?: string;
      releaseNotes?: string;
      publishedAt?: string;
      error?: string;
    }>;
    downloadUpdate: () => Promise<{
      success: boolean;
      error?: string;
    }>;
    installUpdate: () => Promise<{
      success: boolean;
      error?: string;
    }>;
    onUpdateAvailable: (callback: () => void) => () => void;
    onUpdateError: (callback: (info: UpdateErrorInfo) => void) => () => void;
    onUpdateDownloaded: (callback: (info: UpdateDownloadedInfo) => void) => () => void;
  };
  chatOverlay: {
    open: (contentProtectionEnabled?: boolean) => Promise<{
      success: boolean;
      windowId?: number;
      error?: string;
    }>;
    close: () => Promise<{
      success: boolean;
      error?: string;
    }>;
    onClosed: (callback: () => void) => () => void;
    resetSizeAndPosition: () => Promise<{
      success: boolean;
      error?: string;
    }>;
    setContentProtection: (enabled: boolean) => Promise<{
      success: boolean;
      error?: string;
    }>;
  };
}

const electronAPI: ElectronAPI = {
  streaming: {
    getPageConfig: () => ipcRenderer.invoke('streaming:get-page-config'),
  },
  // Cookies相关操作
  cookies: {
    // 获取指定域名的cookies
    getCookiesByDomains: domains => {
      return ipcRenderer.invoke('get-cookies-by-domains', domains);
    },
  },

  // Window相关操作
  window: {
    // 重置窗口大小与位置
    resetSizeAndPosition: () => ipcRenderer.invoke('window:reset-size-and-position'),
    setContentProtection: enabled => ipcRenderer.invoke('window:set-content-protection', enabled),
    getContentProtectionSettings: () => ipcRenderer.invoke('window:get-content-protection-settings'),
  },

  // App相关操作
  app: {
    // 退出应用程序
    quit: () => ipcRenderer.invoke('app:quit'),
    logout: () => ipcRenderer.invoke('app:logout'),
    // 检查更新
    checkForUpdates: () => ipcRenderer.invoke('app:check-for-updates'),
    // 执行更新
    downloadUpdate: () => ipcRenderer.invoke('app:download-update'),
    // 安装更新
    installUpdate: () => ipcRenderer.invoke('app:install-update'),
    // 监听更新可用事件
    onUpdateAvailable: callback => {
      ipcRenderer.on('app:update-available', callback);
      // 返回清理函数
      return () => {
        ipcRenderer.off('app:update-available', callback);
      };
    },
    // 监听更新错误事件
    onUpdateError: callback => {
      const listener = (_: Electron.IpcRendererEvent, info: UpdateErrorInfo) => callback(info);
      ipcRenderer.on('app:update-error', listener);
      // 返回清理函数
      return () => {
        ipcRenderer.off('app:update-error', listener);
      };
    },
    // 监听更新下载完成事件
    onUpdateDownloaded: callback => {
      const listener = (_: Electron.IpcRendererEvent, info: UpdateDownloadedInfo) => callback(info);
      ipcRenderer.on('app:update-downloaded', listener);
      // 返回清理函数
      return () => {
        ipcRenderer.off('app:update-downloaded', listener);
      };
    },
  },

  // ChatOverlay相关操作
  chatOverlay: {
    // 打开聊天窗口
    open: contentProtectionEnabled => {
      return ipcRenderer.invoke('chat-overlay:open', contentProtectionEnabled);
    },
    // 关闭聊天窗口
    close: () => {
      return ipcRenderer.invoke('chat-overlay:close');
    },
    // 监听弹幕浮层关闭事件
    onClosed: callback => {
      ipcRenderer.on('chat-overlay:closed', callback);
      // 返回清理函数
      return () => {
        ipcRenderer.removeListener('chat-overlay:closed', callback);
      };
    },
    // 重置聊天窗口大小与位置
    resetSizeAndPosition: () => {
      return ipcRenderer.invoke('chat-overlay:reset-size-and-position');
    },
    setContentProtection: enabled => {
      return ipcRenderer.invoke('chat-overlay:set-content-protection', enabled);
    },
  },
};

// 暴露安全的API给渲染进程
contextBridge.exposeInMainWorld('electron', electronAPI);

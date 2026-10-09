import CryptoJS from 'crypto-js';
import axios from 'axios';
import { gzip } from 'pako';

// 支持的域名配置
export const SUPPORTED_DOMAINS = [
  {
    domain: 'bilibili.com',
    localStorage: false,
  },
];

// 默认同步服务器
export const DEFAULT_SYNC_SERVER = 'https://login-sync.laplace.cn';

export interface ConfigProps {
  endpoint?: string;
  domains?: string[];
  uuid: string;
  password: string;
}

// 获取指定域名的cookies
export const getCookiesByDomains = async (domains: string[]): Promise<Record<string, Electron.Cookie[]>> => {
  const result = await window.electron.cookies.getCookiesByDomains(domains);
  if (!result.success) throw new Error(result.error || '获取登录状态失败，请重试');
  return result.data || {};
};

// 上传cookies到服务器
export const uploadCookies = async (config: ConfigProps): Promise<{ success: boolean; message: string }> => {
  try {
    const { uuid, password, endpoint = DEFAULT_SYNC_SERVER, domains = SUPPORTED_DOMAINS.map(d => d.domain) } = config;

    // 参数验证
    if (!uuid || !password) {
      return { success: false, message: '参数错误: 缺少UUID和密码' };
    }

    // 获取cookies
    const cookieData = await getCookiesByDomains(domains);
    if (!Object.values(cookieData).some(cookies => cookies.length > 0)) {
      return { success: false, message: '未获取到登录状态，请重新关联账号' };
    }

    // 加密数据
    const key = CryptoJS.MD5(uuid + '-' + password)
      .toString()
      .substring(0, 16);

    const dataToEncrypt = JSON.stringify({ cookie_data: cookieData });

    const encrypted = CryptoJS.AES.encrypt(dataToEncrypt, key).toString();

    // 准备请求数据
    const requestUrl = `${endpoint}/update`;

    // 准备payload
    const payload = {
      uuid,
      encrypted,
    };

    // 对payload进行gzip压缩
    const compressedData = gzip(JSON.stringify(payload));

    // 请求头设置
    const headers = {
      'Content-Type': 'application/json',
      'Content-Encoding': 'gzip',
    };

    // 发送请求
    const response = await axios.post(requestUrl, compressedData, {
      headers,
      // 确保axios正确处理二进制数据
      responseType: 'json',
      timeout: 15000,
    });

    if (response.data && response.data.action === 'done') {
      // 保存最后上传时间和数据hash
      // localStorage.setItem(
      //   'LAST_UPLOADED_COOKIE',
      //   JSON.stringify({
      //     timestamp: new Date().getTime(),
      //     sha256: CryptoJS.SHA256(
      //       uuid + '-' + password + '-' + requestUrl + '-' + dataToEncrypt
      //     ).toString(),
      //   })
      // );

      return {
        success: true,
        message: response.data.note || '上传成功',
      };
    } else {
      return {
        success: false,
        message: '上传失败，请检查网络连接和服务器状态',
      };
    }
  } catch (error) {
    console.error('Upload cookies error:', error instanceof Error ? error.message : String(error));
    return {
      success: false,
      message: `上传出错: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
};

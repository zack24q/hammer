// Electron includes the localized application name in its default User-Agent.
// Sites that copy navigator.userAgent into Fetch headers require a byte string.
export function getWebUserAgent(userAgent: string, appName: string): string {
  if (!/[\u0080-\uffff]/.test(appName)) return userAgent;
  return userAgent.replace(`${appName}/`, 'Hammer/');
}

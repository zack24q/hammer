import type { ForgeConfig } from '@electron-forge/shared-types';
import { MakerSquirrel } from '@electron-forge/maker-squirrel';
// import { MakerZIP } from '@electron-forge/maker-zip';
// import { MakerDeb } from '@electron-forge/maker-deb';
// import { MakerRpm } from '@electron-forge/maker-rpm';
import { VitePlugin } from '@electron-forge/plugin-vite';
import { FusesPlugin } from '@electron-forge/plugin-fuses';
import { FuseV1Options, FuseVersion } from '@electron/fuses';
import { PublisherGithub } from '@electron-forge/publisher-github';
import { GITHUB_CONFIG } from './src/main/config';

const config: ForgeConfig = {
  packagerConfig: {
    asar: true,
    icon: 'src/assets/icon.ico',
    extraResource: ['src/assets/icon.ico'],
  },
  rebuildConfig: {},
  makers: [
    new MakerSquirrel({
      title: '锤子',
      iconUrl: 'https://img.picui.cn/free/2025/06/28/685f5bdde3af6.ico',
      authors: '阿酒(zack)',
      setupExe: 'Setup.exe',
      remoteReleases: `${GITHUB_CONFIG.PROXY}/https://github.com/zack24q/hammer/releases/latest/download`,
    }),
    // new MakerZIP({}, ['darwin']),
    // new MakerRpm({}),
    // new MakerDeb({}),
  ],
  publishers: [
    new PublisherGithub({
      repository: {
        owner: 'zack24q',
        name: 'hammer',
      },
      generateReleaseNotes: true,
      prerelease: true,
      draft: false,
      force: false,
    }),
  ],
  plugins: [
    new VitePlugin({
      // `build` can specify multiple entry builds, which can be Main process, Preload scripts, Worker process, etc.
      // If you are familiar with Vite configuration, it will look really familiar.
      build: [
        {
          // `entry` is just an alias for `build.lib.entry` in the corresponding file of `config`.
          entry: 'src/main/main.ts',
          config: 'vite.main.config.ts',
          target: 'main',
        },
        {
          entry: 'src/main/preload.ts',
          config: 'vite.preload.config.ts',
          target: 'preload',
        },
        {
          entry: {
            'preload-chat-overlay': 'chat-overlay/src/preload.ts',
          },
          config: 'vite.preload-chat-overlay.config.ts',
          target: 'preload',
        },
      ],
      renderer: [
        {
          name: 'main_window',
          config: 'vite.renderer.config.mts',
        },
        {
          name: 'chat_overlay_window',
          config: 'vite.renderer-chat-overlay.config.ts',
        },
      ],
    }),
    // Fuses are used to enable/disable various Electron functionality
    // at package time, before code signing the application
    new FusesPlugin({
      version: FuseVersion.V1,
      [FuseV1Options.RunAsNode]: false,
      [FuseV1Options.EnableCookieEncryption]: true,
      [FuseV1Options.EnableNodeOptionsEnvironmentVariable]: false,
      [FuseV1Options.EnableNodeCliInspectArguments]: false,
      [FuseV1Options.EnableEmbeddedAsarIntegrityValidation]: true,
      [FuseV1Options.OnlyLoadAppFromAsar]: true,
    }),
  ],
};

export default config;

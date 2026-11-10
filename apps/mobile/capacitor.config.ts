import type { CapacitorConfig } from '@capacitor/cli';

/**
 * Jamiyati for Android and iOS (phones and tablets). The UI is apps/web built in "native" mode and bundled on the device;
 * it talks to the server at VITE_API_ORIGIN. The appId is permanent once published to the stores.
 */
const config: CapacitorConfig = {
  appId: 'sa.refers.jamiyati',
  appName: 'جمعيتي',
  webDir: '../web/dist-native',
  android: {
    allowMixedContent: false,
    captureInput: true,
    webContentsDebuggingEnabled: false,
  },
  ios: {
    contentInset: 'never',
    scheme: 'Jamiyati',
  },
  plugins: {
    SplashScreen: { launchAutoHide: false, backgroundColor: '#0F172A', showSpinner: false, androidScaleType: 'CENTER_CROP' },
    StatusBar: { overlaysWebView: false, style: 'LIGHT', backgroundColor: '#FFFFFF' },
  },
};

export default config;

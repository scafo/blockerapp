import type { CapacitorConfig } from '@capacitor/cli';

// App Android/iOS: il gioco web (dist/) dentro una WebView. Orientamento bloccato in orizzontale nel manifest.
const config: CapacitorConfig = {
  appId: 'com.ashenatlas.game',
  appName: 'ARCHEON',
  webDir: 'dist',
  backgroundColor: '#000000',
  android: {
    allowMixedContent: false,
  },
};

export default config;

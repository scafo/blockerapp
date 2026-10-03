import type { CapacitorConfig } from '@capacitor/cli';

// App Android/iOS: il gioco web (dist/) dentro una WebView. Orientamento bloccato in orizzontale nel manifest.
const config: CapacitorConfig = {
  appId: 'com.ashenatlas.game',
  appName: 'Ashen Atlas',
  webDir: 'dist',
  backgroundColor: '#2B2118',
  android: {
    allowMixedContent: false,
  },
};

export default config;

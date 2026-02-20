import { registerRootComponent } from 'expo';
import { enableScreens } from 'react-native-screens';

import App from './App';

// Temporary safety switch: disable native screens to prevent Android crash
// (java.lang.String cannot be cast to java.lang.Boolean)
// Keep this until we confirm stable navigation
enableScreens(false);

// registerRootComponent calls AppRegistry.registerComponent('main', () => App);
// It also ensures that whether you load the app in Expo Go or in a native build,
// the environment is set up appropriately
if (__DEV__) console.log('[apps/mobile] Custom Entry Point (index.ts) Running');
registerRootComponent(App);

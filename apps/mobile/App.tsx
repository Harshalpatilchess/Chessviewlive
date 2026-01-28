import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { coreHello, CORE_VERSION } from '@chessview/core';
import TournamentsScreen from './src/screens/TournamentsScreen';
import TournamentBoardsScreen from './src/screens/TournamentBoardsScreen';
import TournamentLeaderboardScreen from './src/screens/TournamentLeaderboardScreen';
import GameScreen from './src/screens/GameScreen';
import SettingsScreen from './src/screens/SettingsScreen';
import FavouritePlayersScreen from './src/screens/FavouritePlayersScreen';
import ChooseCountryScreen from './src/screens/ChooseCountryScreen';
import BoardDesignScreen from './src/screens/BoardDesignScreen';
import HelpScreen from './src/screens/HelpScreen';
import { TopPlayersScreen, ContactScreen, OrganizerScreen } from './src/screens/PlaceholderScreens';
import type { RootStackParamList } from './src/navigation/types';
import { SettingsProvider } from './src/contexts/SettingsContext';

import { prewarmMemoryCache } from './src/cache/memoryCache';
import { TATA_STEEL_2026_SLUG } from './src/services/tataSteel';

const Stack = createNativeStackNavigator<RootStackParamList>();

import { resolveTournamentKey } from './src/utils/resolveTournamentKey';

// Prewarm Tata Steel cache as early as possible (fire and forget)
prewarmMemoryCache(resolveTournamentKey({ slug: TATA_STEEL_2026_SLUG }));

export default function App() {

  console.log('[apps/mobile]', coreHello(), CORE_VERSION);

  return (
    <SettingsProvider>
      <NavigationContainer>
        <Stack.Navigator
          screenOptions={{
            headerShown: false,
            animation: 'slide_from_right',
          }}
        >
          <Stack.Screen name="Tournaments" component={TournamentsScreen} />
          <Stack.Screen name="TournamentBoards" component={TournamentBoardsScreen} />
          <Stack.Screen name="TournamentLeaderboard" component={TournamentLeaderboardScreen} />
          <Stack.Screen name="Game" component={GameScreen} />
          <Stack.Screen name="Settings" component={SettingsScreen} />
          <Stack.Screen name="FavouritePlayers" component={FavouritePlayersScreen} />
          <Stack.Screen name="ChooseCountry" component={ChooseCountryScreen} />
          <Stack.Screen name="BoardDesign" component={BoardDesignScreen} />
          <Stack.Screen name="Help" component={HelpScreen} />
          <Stack.Screen name="TopPlayers" component={TopPlayersScreen} />
          <Stack.Screen name="Contact" component={ContactScreen} />
          <Stack.Screen name="Organizer" component={OrganizerScreen} />
        </Stack.Navigator>
      </NavigationContainer>
    </SettingsProvider>
  );
}

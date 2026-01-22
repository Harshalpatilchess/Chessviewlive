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
import type { RootStackParamList } from './src/navigation/types';
import { SettingsProvider } from './src/contexts/SettingsContext';

const Stack = createNativeStackNavigator<RootStackParamList>();

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
        </Stack.Navigator>
      </NavigationContainer>
    </SettingsProvider>
  );
}

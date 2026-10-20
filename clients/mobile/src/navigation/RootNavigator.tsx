import React from 'react';
import { DarkTheme, DefaultTheme, NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { CameraScannerScreen } from '../screens/CameraScannerScreen';
import { CalculatorScreen } from '../screens/CalculatorScreen';
import { SolutionDetailScreen } from '../screens/SolutionDetailScreen';
import { SettingsScreen } from '../screens/SettingsScreen';
import { HistoryScreen } from '../screens/HistoryScreen';
import { useTheme } from '../theme';

export type RootStackParamList = {
  Camera: undefined;
  Calculator: { initialLatex?: string } | undefined;
  Solution: { latex?: string; historyId?: number; ocrConfidence?: number | null };
  History: undefined;
  Settings: undefined;
};

const Stack = createNativeStackNavigator<RootStackParamList>();

export const RootNavigator: React.FC = () => {
  const { c, scheme } = useTheme();
  const base = scheme === 'dark' ? DarkTheme : DefaultTheme;
  const navTheme = { ...base, colors: { ...base.colors, background: c.bg, card: c.bg, text: c.text, primary: c.primary, border: c.line } };
  return (
    <NavigationContainer theme={navTheme}>
      <Stack.Navigator initialRouteName="Camera" screenOptions={{ headerShown: false, animation: 'fade_from_bottom' }}>
        <Stack.Screen name="Camera" component={CameraScannerScreen} options={{ animation: 'fade' }} />
        <Stack.Screen name="Calculator" component={CalculatorScreen} />
        <Stack.Screen name="Solution" component={SolutionDetailScreen} />
        <Stack.Screen name="History" component={HistoryScreen} />
        <Stack.Screen name="Settings" component={SettingsScreen} />
      </Stack.Navigator>
    </NavigationContainer>
  );
};

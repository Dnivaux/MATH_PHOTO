import React from 'react';
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { CameraScannerScreen } from '../screens/CameraScannerScreen';
import { CalculatorScreen } from '../screens/CalculatorScreen';
import { SolutionDetailScreen } from '../screens/SolutionDetailScreen';
import { SettingsScreen } from '../screens/SettingsScreen';

export type RootStackParamList = {
  Camera: undefined;
  Calculator: { initialLatex?: string } | undefined;
  Solution: { latex: string };
  Settings: undefined;
};

const Stack = createNativeStackNavigator<RootStackParamList>();

export const RootNavigator: React.FC = () => {
  return (
    <NavigationContainer>
      <Stack.Navigator
        initialRouteName="Camera"
        screenOptions={{
          headerShown: false,
          animation: 'fade',
        }}
      >
        <Stack.Screen name="Camera" component={CameraScannerScreen} />
        <Stack.Screen
          name="Calculator"
          component={CalculatorScreen}
          options={{ animation: 'slide_from_bottom' }}
        />
        <Stack.Screen
          name="Solution"
          component={SolutionDetailScreen}
          options={{ animation: 'slide_from_right' }}
        />
        <Stack.Screen
          name="Settings"
          component={SettingsScreen}
          options={{ animation: 'slide_from_right' }}
        />
      </Stack.Navigator>
    </NavigationContainer>
  );
};

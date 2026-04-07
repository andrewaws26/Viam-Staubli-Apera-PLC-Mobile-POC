/**
 * Entry point — redirects to sign-in or tabs based on auth state.
 */

import { Redirect } from 'expo-router';
import { useAppAuth } from '@/auth/auth-provider';
import { View, ActivityIndicator } from 'react-native';
import { colors } from '@/theme/colors';

export default function Index() {
  const { isSignedIn, isLoaded } = useAppAuth();

  if (!isLoaded) {
    return (
      <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: colors.background }}>
        <ActivityIndicator color={colors.primary} size="large" />
      </View>
    );
  }

  if (!isSignedIn) {
    return <Redirect href="/(auth)/sign-in" />;
  }

  return <Redirect href="/(tabs)" />;
}

/**
 * Root layout — wraps the entire app with providers.
 * AuthProvider (Clerk) + Sync engine initialization.
 */

import React, { useEffect } from 'react';
import { Stack } from 'expo-router';
import { StatusBar } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { AuthProvider } from '@/auth/auth-provider';
import { initSyncEngine } from '@/sync/sync-engine';
import { registerGpsTask } from '@/services/gps-tracker';
import { addNotificationResponseListener } from '@/services/push-notifications';
import { colors } from '@/theme/colors';
import { router } from 'expo-router';

export default function RootLayout() {
  useEffect(() => {
    // Register background GPS task
    registerGpsTask();

    // Initialize sync engine (network listener + periodic sync)
    const cleanupSync = initSyncEngine();

    // Handle team chat push notification taps
    const cleanupNotif = addNotificationResponseListener((response) => {
      const data = response.notification.request.content.data;
      if (data?.type === 'team_chat' && data?.threadId) {
        router.push(`/chat/thread?id=${data.threadId}`);
      }
    });

    return () => {
      cleanupSync();
      cleanupNotif();
    };
  }, []);

  return (
    <GestureHandlerRootView style={{ flex: 1, backgroundColor: colors.background }}>
      <StatusBar barStyle="light-content" backgroundColor={colors.background} />
      <AuthProvider>
        <Stack
          screenOptions={{
            headerShown: false,
            contentStyle: { backgroundColor: colors.background },
            animation: 'slide_from_right',
          }}
        />
      </AuthProvider>
    </GestureHandlerRootView>
  );
}

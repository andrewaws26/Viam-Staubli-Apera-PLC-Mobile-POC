/**
 * Sign-in screen with Google + Microsoft buttons.
 * Dark theme matching web dashboard. IronSight logo at top.
 */

import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { useOAuth, useAuth } from '@clerk/clerk-expo';
import { useRouter } from 'expo-router';
import * as WebBrowser from 'expo-web-browser';
import * as Linking from 'expo-linking';
import Button from '@/components/ui/Button';
import { colors } from '@/theme/colors';
import { spacing } from '@/theme/spacing';
import { typography } from '@/theme/typography';

WebBrowser.maybeCompleteAuthSession();

export default function SignIn() {
  const { startOAuthFlow: startGoogle } = useOAuth({ strategy: 'oauth_google' });
  const { startOAuthFlow: startMicrosoft } = useOAuth({ strategy: 'oauth_microsoft' });
  const { isSignedIn } = useAuth();
  const router = useRouter();

  // If already signed in (e.g. from previous OAuth), redirect immediately
  React.useEffect(() => {
    if (isSignedIn) {
      router.replace('/(tabs)');
    }
  }, [isSignedIn]);

  const handleOAuth = async (startFlow: typeof startGoogle) => {
    try {
      const redirectUrl = Linking.createURL('/');
      const { createdSessionId, setActive } = await startFlow({ redirectUrl });
      if (createdSessionId && setActive) {
        await setActive({ session: createdSessionId });
        router.replace('/(tabs)');
      }
    } catch (err: any) {
      // "You're already signed in" means session exists — just redirect
      if (err?.message?.includes('already signed') || err?.errors?.[0]?.message?.includes('already signed')) {
        router.replace('/(tabs)');
        return;
      }
      console.error('OAuth sign-in error:', err);
    }
  };

  return (
    <View style={styles.container}>
      <View style={styles.content}>
        <View style={styles.logoSection}>
          <Text style={styles.logoText}>IRONSIGHT</Text>
          <Text style={styles.subtitle}>Fleet Diagnostics</Text>
        </View>

        <Text style={styles.heading}>Sign In</Text>
        <Text style={styles.description}>
          Use the same account you use on the web dashboard.
        </Text>

        <View style={styles.buttons}>
          <Button
            title="Continue with Google"
            onPress={() => handleOAuth(startGoogle)}
            variant="secondary"
            size="lg"
            fullWidth
          />
          <Button
            title="Continue with Microsoft"
            onPress={() => handleOAuth(startMicrosoft)}
            variant="secondary"
            size="lg"
            fullWidth
          />
        </View>
      </View>

      <Text style={styles.footer}>B&B Metals · IronSight Fleet Monitoring</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
    justifyContent: 'center',
    paddingHorizontal: spacing['3xl'],
  },
  content: {
    gap: spacing.xl,
  },
  logoSection: {
    alignItems: 'center',
    marginBottom: spacing['3xl'],
  },
  logoText: {
    color: colors.primaryLight,
    fontSize: typography.sizes['4xl'],
    fontWeight: typography.weights.black,
    letterSpacing: 4,
  },
  subtitle: {
    color: colors.textSecondary,
    fontSize: typography.sizes.base,
    fontWeight: typography.weights.medium,
    letterSpacing: 2,
    textTransform: 'uppercase',
    marginTop: spacing.xs,
  },
  heading: {
    color: colors.text,
    fontSize: typography.sizes['2xl'],
    fontWeight: typography.weights.bold,
  },
  description: {
    color: colors.textSecondary,
    fontSize: typography.sizes.sm,
  },
  buttons: {
    gap: spacing.md,
    marginTop: spacing.lg,
  },
  footer: {
    color: colors.textMuted,
    fontSize: typography.sizes.xs,
    textAlign: 'center',
    position: 'absolute',
    bottom: spacing['4xl'],
    left: 0,
    right: 0,
  },
});

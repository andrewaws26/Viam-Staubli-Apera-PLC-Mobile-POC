/**
 * Sign-in screen with Google + Microsoft buttons.
 * Dark theme matching web dashboard. IronSight logo at top.
 *
 * In QA bypass mode (__DEV__ + EXPO_PUBLIC_QA_BYPASS=1), shows a
 * "Dev Sign In" button that skips OAuth entirely.
 */

import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { useRouter } from 'expo-router';
import Button from '@/components/ui/Button';
import { colors } from '@/theme/colors';
import { spacing } from '@/theme/spacing';
import { typography } from '@/theme/typography';

const QA_BYPASS = __DEV__ && process.env.EXPO_PUBLIC_QA_BYPASS === '1';

// ── QA Bypass Sign-In (no Clerk) ──────────────────────────────────

function QASignIn() {
  const router = useRouter();
  // Access the QA bypass provider's qaSignIn via context
  const { useAppAuth } = require('@/auth/auth-provider');
  const auth = useAppAuth();

  const handleDevSignIn = () => {
    if ('qaSignIn' in auth) {
      (auth as any).qaSignIn();
    }
    router.replace('/(tabs)');
  };

  return (
    <View style={styles.container}>
      <View style={styles.content}>
        <View style={styles.logoSection}>
          <Text style={styles.logoText}>IRONSIGHT</Text>
          <Text style={styles.subtitle}>Fleet Diagnostics</Text>
        </View>

        <Text style={styles.heading}>QA Test Mode</Text>
        <Text style={styles.description}>
          Dev build with auth bypass enabled.
        </Text>

        <View style={styles.buttons}>
          <Button
            title="Dev Sign In"
            onPress={handleDevSignIn}
            variant="primary"
            size="lg"
            fullWidth
          />
        </View>
      </View>

      <Text style={styles.footer}>QA Bypass · Dev Build Only</Text>
    </View>
  );
}

// ── Production Sign-In (Clerk OAuth) ──────────────────────────────

function OAuthSignIn() {
  const { useOAuth, useAuth } = require('@clerk/clerk-expo');
  const WebBrowser = require('expo-web-browser');
  const Linking = require('expo-linking');

  WebBrowser.maybeCompleteAuthSession();

  const { startOAuthFlow: startGoogle } = useOAuth({ strategy: 'oauth_google' });
  const { startOAuthFlow: startMicrosoft } = useOAuth({ strategy: 'oauth_microsoft' });
  const { isSignedIn } = useAuth();
  const router = useRouter();

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

// ── Export ─────────────────────────────────────────────────────────

export default function SignIn() {
  return QA_BYPASS ? <QASignIn /> : <OAuthSignIn />;
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
    fontFamily: typography.fonts.display,
    letterSpacing: 4,
  },
  subtitle: {
    color: colors.textSecondary,
    fontSize: typography.sizes.base,
    fontFamily: typography.fonts.label,
    letterSpacing: 2,
    textTransform: 'uppercase',
    marginTop: spacing.xs,
  },
  heading: {
    color: colors.text,
    fontSize: typography.sizes['2xl'],
    fontFamily: typography.fonts.heading,
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

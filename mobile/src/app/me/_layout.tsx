/**
 * Me section layout — stack navigator with dark headers for
 * timesheets, PTO, and other profile sub-screens.
 */

import { Stack } from 'expo-router';
import { colors } from '@/theme/colors';
import { typography } from '@/theme/typography';

export default function MeLayout() {
  return (
    <Stack
      screenOptions={{
        headerShown: true,
        headerStyle: { backgroundColor: colors.surface0 },
        headerTintColor: colors.text,
        headerTitleStyle: {
          fontFamily: typography.fonts.heading,
          fontSize: typography.sizes.base,
        },
        contentStyle: { backgroundColor: colors.background },
        animation: 'slide_from_right',
      }}
    />
  );
}

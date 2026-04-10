/**
 * Tab navigator — 5 tabs: Home, Fleet, Work, Chat, Me.
 * Truck/Cell/AI merged under Fleet as push screens.
 */

import { Tabs } from 'expo-router';
import { View, Text } from 'react-native';
import Svg, { Path } from 'react-native-svg';
import { colors } from '@/theme/colors';
import { typography } from '@/theme/typography';
import StatusBanner from '@/components/ui/StatusBanner';

const TAB_ICONS: Record<string, string> = {
  Home: 'M10 20v-6h4v6h5v-8h3L12 3 2 12h3v8z',
  Fleet: 'M3 3h7v7H3V3zm11 0h7v7h-7V3zM3 14h7v7H3v-7zm11 0h7v7h-7v-7z',
  Work: 'M19 3h-4.18C14.4 1.84 13.3 1 12 1s-2.4.84-2.82 2H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm-7-.25c.41 0 .75.34.75.75s-.34.75-.75.75-.75-.34-.75-.75.34-.75.75-.75zM10 17l-4-4 1.41-1.41L10 14.17l6.59-6.59L18 9l-8 8z',
  Chat: 'M20 2H4c-1.1 0-2 .9-2 2v18l4-4h14c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2zm0 14H5.17L4 17.17V4h16v12z',
  Me: 'M12 12c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4zm0 2c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4z',
};

function TabIcon({ name, focused }: { name: string; focused: boolean }) {
  const path = TAB_ICONS[name];
  if (!path) return <Text style={{ fontSize: 20, opacity: focused ? 1 : 0.5 }}>{'•'}</Text>;
  return (
    <Svg width={22} height={22} viewBox="0 0 24 24" fill="none">
      <Path d={path} fill={focused ? colors.primaryLight : colors.textMuted} />
    </Svg>
  );
}

export default function TabLayout() {
  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      <StatusBanner />
      <Tabs
        screenOptions={{
          headerStyle: {
            backgroundColor: colors.surface0,
            shadowColor: 'transparent',
            elevation: 0,
          },
          headerTintColor: colors.text,
          headerTitleStyle: {
            fontFamily: typography.fonts.display,
            fontSize: typography.sizes.lg,
            letterSpacing: typography.letterSpacing.wide,
          },
          headerShadowVisible: false,
          tabBarStyle: {
            backgroundColor: colors.surface0,
            borderTopColor: colors.border,
            borderTopWidth: 1,
            height: 85,
            paddingBottom: 25,
            paddingTop: 8,
          },
          tabBarActiveTintColor: colors.primaryLight,
          tabBarInactiveTintColor: colors.textMuted,
          tabBarLabelStyle: {
            fontSize: typography.sizes['2xs'],
            fontFamily: typography.fonts.heading,
            letterSpacing: typography.letterSpacing.wide,
            textTransform: 'uppercase',
          },
        }}
      >
        <Tabs.Screen
          name="index"
          options={{
            title: 'Home',
            headerTitle: 'IronSight',
            tabBarIcon: ({ focused }) => <TabIcon name="Home" focused={focused} />,
          }}
        />
        <Tabs.Screen
          name="fleet"
          options={{
            title: 'Fleet',
            headerTitle: 'Fleet Overview',
            tabBarIcon: ({ focused }) => <TabIcon name="Fleet" focused={focused} />,
          }}
        />
        <Tabs.Screen
          name="work"
          options={{
            title: 'Work',
            headerTitle: 'Work Board',
            tabBarIcon: ({ focused }) => <TabIcon name="Work" focused={focused} />,
          }}
        />
        <Tabs.Screen
          name="chat"
          options={{
            title: 'Chat',
            headerTitle: 'Team Chat',
            tabBarIcon: ({ focused }) => <TabIcon name="Chat" focused={focused} />,
          }}
        />
        <Tabs.Screen
          name="me"
          options={{
            title: 'Me',
            headerTitle: 'My Account',
            tabBarIcon: ({ focused }) => <TabIcon name="Me" focused={focused} />,
          }}
        />
        {/* Hidden tabs — accessible via push navigation, not shown in tab bar */}
        <Tabs.Screen name="truck" options={{ href: null }} />
        <Tabs.Screen name="cell" options={{ href: null }} />
        <Tabs.Screen name="ai" options={{ href: null }} />
        <Tabs.Screen name="inspect" options={{ href: null }} />
      </Tabs>
    </View>
  );
}

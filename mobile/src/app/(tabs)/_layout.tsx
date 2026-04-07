/**
 * Tab navigator with 5 tabs: Fleet, Truck, AI, Inspect, More.
 * Bottom tab bar with dark theme and purple accents.
 */

import { Tabs } from 'expo-router';
import { Text } from 'react-native';
import { colors } from '@/theme/colors';
import { typography } from '@/theme/typography';
import StatusBanner from '@/components/ui/StatusBanner';
import { View } from 'react-native';

function TabIcon({ label, focused }: { label: string; focused: boolean }) {
  const icons: Record<string, string> = {
    Fleet: '🚛',
    Truck: '📊',
    Cell: '🤖',
    Chat: '💬',
    Work: '📋',
    AI: '🧠',
    More: '⋯',
  };
  return (
    <Text style={{ fontSize: 22, opacity: focused ? 1 : 0.5 }}>
      {icons[label] || '•'}
    </Text>
  );
}

export default function TabLayout() {
  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      <StatusBanner />
      <Tabs
        screenOptions={{
          headerStyle: { backgroundColor: colors.background },
          headerTintColor: colors.text,
          headerTitleStyle: {
            fontWeight: typography.weights.bold,
            fontSize: typography.sizes.lg,
          },
          tabBarStyle: {
            backgroundColor: colors.background,
            borderTopColor: colors.border,
            borderTopWidth: 1,
            height: 85,
            paddingBottom: 25,
            paddingTop: 8,
          },
          tabBarActiveTintColor: colors.primaryLight,
          tabBarInactiveTintColor: colors.textMuted,
          tabBarLabelStyle: {
            fontSize: typography.sizes.xs,
            fontWeight: typography.weights.semibold,
          },
        }}
      >
        <Tabs.Screen
          name="index"
          options={{
            title: 'Fleet',
            headerTitle: 'IronSight Fleet',
            tabBarIcon: ({ focused }) => <TabIcon label="Fleet" focused={focused} />,
          }}
        />
        <Tabs.Screen
          name="truck"
          options={{
            title: 'Truck',
            headerTitle: 'Truck Detail',
            tabBarIcon: ({ focused }) => <TabIcon label="Truck" focused={focused} />,
          }}
        />
        <Tabs.Screen
          name="cell"
          options={{
            title: 'Cell',
            headerTitle: 'Robot Cell',
            tabBarIcon: ({ focused }) => <TabIcon label="Cell" focused={focused} />,
          }}
        />
        <Tabs.Screen
          name="chat"
          options={{
            title: 'Chat',
            headerTitle: 'Team Chat',
            tabBarIcon: ({ focused }) => <TabIcon label="Chat" focused={focused} />,
          }}
        />
        <Tabs.Screen
          name="work"
          options={{
            title: 'Work',
            headerTitle: 'Work Board',
            tabBarIcon: ({ focused }) => <TabIcon label="Work" focused={focused} />,
          }}
        />
        <Tabs.Screen
          name="ai"
          options={{
            title: 'AI',
            headerShown: false,
            tabBarIcon: ({ focused }) => <TabIcon label="AI" focused={focused} />,
          }}
        />
        <Tabs.Screen
          name="inspect"
          options={{
            href: null, // Hidden from tab bar, accessible via navigation
          }}
        />
        <Tabs.Screen
          name="more"
          options={{
            title: 'More',
            headerTitle: 'More',
            tabBarIcon: ({ focused }) => <TabIcon label="More" focused={focused} />,
          }}
        />
      </Tabs>
    </View>
  );
}

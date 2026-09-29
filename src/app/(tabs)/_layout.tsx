import { Tabs } from 'expo-router';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { View, StyleSheet } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '../../context/ThemeContext';

export default function TabLayout() {
  const insets = useSafeAreaInsets();
  const { colors, isDarkMode, seniorMode } = useTheme();
  const bottomPadding = Math.max(insets.bottom, 12);
  const tabHeight = (seniorMode ? 78 : 68) + bottomPadding;

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: colors.accentText,
        tabBarInactiveTintColor: colors.textMuted,
        tabBarStyle: {
          backgroundColor: colors.tabBarBg,
          borderTopWidth: isDarkMode ? 1 : 0,
          borderTopColor: colors.tabBarBorder,
          height: tabHeight,
          paddingBottom: bottomPadding,
          paddingTop: 10,
          shadowColor: isDarkMode ? 'transparent' : '#0f172a',
          shadowOffset: { width: 0, height: -4 },
          shadowOpacity: isDarkMode ? 0 : 0.06,
          shadowRadius: 12,
          elevation: isDarkMode ? 0 : 8,
        },
        tabBarLabelStyle: {
          fontSize: seniorMode ? 14 : 11,
          fontWeight: '700',
          letterSpacing: 0.3,
          marginTop: 3,
          lineHeight: seniorMode ? 19 : 15,
        },
        tabBarItemStyle: {
          minHeight: 56,
          paddingVertical: 3,
        },
      }}
    >
      <Tabs.Screen
        name="home"
        options={{
          title: 'หน้าหลัก',
          tabBarIcon: ({ color, focused }) => (
            <View style={[styles.iconContainer, focused && { backgroundColor: isDarkMode ? '#064e3b' : '#ecfdf5' }]}>
              <MaterialCommunityIcons 
                name={focused ? "home" : "home-outline"} 
                size={seniorMode ? 28 : 24} 
                color={color} 
              />
            </View>
          ),
        }}
      />
      <Tabs.Screen
        name="history"
        options={{
          title: 'ประวัติ',
          href: seniorMode ? null : undefined,
          tabBarIcon: ({ color, focused }) => (
            <View style={[styles.iconContainer, focused && { backgroundColor: isDarkMode ? '#064e3b' : '#ecfdf5' }]}>
              <MaterialCommunityIcons 
                name={focused ? "clock" : "clock-outline"} 
                size={seniorMode ? 28 : 24} 
                color={color} 
              />
            </View>
          ),
        }}
      />
      <Tabs.Screen
        name="members"
        options={{
          title: 'คนที่ดูแล',
          tabBarIcon: ({ color, focused }) => (
            <View style={[styles.iconContainer, focused && { backgroundColor: isDarkMode ? '#064e3b' : '#ecfdf5' }]}>
              <MaterialCommunityIcons 
                name={focused ? "account-group" : "account-group-outline"} 
                size={seniorMode ? 28 : 24} 
                color={color} 
              />
            </View>
          ),
        }}
      />
      <Tabs.Screen
        name="alerts"
        options={{
          title: 'แจ้งเตือน',
          tabBarIcon: ({ color, focused }) => (
            <View style={[styles.iconContainer, focused && { backgroundColor: isDarkMode ? '#064e3b' : '#ecfdf5' }]}>
              <MaterialCommunityIcons 
                name={focused ? "bell" : "bell-outline"} 
                size={seniorMode ? 28 : 24} 
                color={color} 
              />
            </View>
          ),
        }}
      />
      <Tabs.Screen
        name="analytics"
        options={{
          title: 'สถิติ',
          href: seniorMode ? null : undefined,
          tabBarIcon: ({ color, focused }) => (
            <View style={[styles.iconContainer, focused && { backgroundColor: isDarkMode ? '#064e3b' : '#ecfdf5' }]}>
              <MaterialCommunityIcons 
                name={focused ? "chart-line" : "chart-line-variant"} 
                size={seniorMode ? 28 : 24} 
                color={color} 
              />
            </View>
          ),
        }}
      />
    </Tabs>
  );
}

const styles = StyleSheet.create({
  iconContainer: {
    width: 40,
    height: 32,
    borderRadius: 10,
    justifyContent: 'center',
    alignItems: 'center',
  },
});

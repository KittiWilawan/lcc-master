import React, { createContext, useContext, useState, useCallback, useEffect, ReactNode } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';

interface ThemeContextType {
  isDarkMode: boolean;
  toggleDarkMode: () => void;
  seniorMode: boolean;
  toggleSeniorMode: () => void;
  colors: ReturnType<typeof getColors>;
}

export function getColors(isDark: boolean) {
  return {
    // Backgrounds
    background: isDark ? '#0f172a' : '#f8fafc',
    card: isDark ? '#1e293b' : '#ffffff',
    cardBorder: isDark ? '#334155' : '#e2e8f0',
    headerBg: isDark ? '#0f172a' : '#ffffff',
    headerBorder: isDark ? '#1e293b' : '#f1f5f9',
    inputBg: isDark ? '#1e293b' : '#f8fafc',

    // Text
    textPrimary: isDark ? '#f1f5f9' : '#0f172a',
    textSecondary: isDark ? '#94a3b8' : '#64748b',
    textMuted: isDark ? '#64748b' : '#94a3b8',

    // Accent
    accent: '#059669',
    accentBg: isDark ? '#064e3b' : '#ecfdf5',
    accentText: isDark ? '#34d399' : '#059669',

    // Danger
    danger: '#dc2626',
    dangerBg: isDark ? '#450a0a' : '#fef2f2',

    // Warning
    warning: '#f59e0b',
    warningBg: isDark ? '#451a03' : '#fefce8',

    // Tab bar
    tabBarBg: isDark ? '#0f172a' : '#ffffff',
    tabBarBorder: isDark ? '#1e293b' : 'transparent',

    // Misc
    separator: isDark ? '#1e293b' : '#f1f5f9',
    overlay: isDark ? 'rgba(0,0,0,0.7)' : 'rgba(0,0,0,0.5)',
    chipBg: isDark ? '#1e293b' : '#f0fdf4',
  };
}

const ThemeContext = createContext<ThemeContextType>({
  isDarkMode: false,
  toggleDarkMode: () => {},
  seniorMode: false,
  toggleSeniorMode: () => {},
  colors: getColors(false),
});

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [isDarkMode, setIsDarkMode] = useState(false);
  const [seniorMode, setSeniorMode] = useState(false);

  const loadTheme = useCallback(async () => {
    try {
      const [storedTheme, storedSeniorMode] = await Promise.all([
        AsyncStorage.getItem('@dark_mode'),
        AsyncStorage.getItem('@senior_mode'),
      ]);
      setIsDarkMode(storedTheme === 'true');
      setSeniorMode(storedSeniorMode === 'true');
    } catch (e) {
      console.log('Error loading theme:', e);
    }
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void loadTheme();
  }, [loadTheme]);

  const toggleDarkMode = async () => {
    const newVal = !isDarkMode;
    setIsDarkMode(newVal);
    try {
      await AsyncStorage.setItem('@dark_mode', newVal ? 'true' : 'false');
    } catch (e) {
      console.log('Error saving theme:', e);
    }
  };

  const toggleSeniorMode = async () => {
    const newValue = !seniorMode;
    setSeniorMode(newValue);
    try {
      await AsyncStorage.setItem('@senior_mode', newValue ? 'true' : 'false');
    } catch (error) {
      console.log('Error saving senior mode:', error);
    }
  };

  const colors = getColors(isDarkMode);

  return (
    <ThemeContext.Provider value={{ isDarkMode, toggleDarkMode, seniorMode, toggleSeniorMode, colors }}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme() {
  return useContext(ThemeContext);
}

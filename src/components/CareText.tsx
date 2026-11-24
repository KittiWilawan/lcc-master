import { createContext, forwardRef, useContext } from 'react';
import { StyleSheet, Text as NativeText, type TextProps } from 'react-native';
import { useTheme } from '../context/ThemeContext';
import { readableTypography } from '../lib/readability';

const InheritedSize = createContext<number | undefined>(undefined);

/** Keep readable sizes while preserving nested text, system font scaling and caller styles. */
export const CareText = forwardRef<NativeText, TextProps>(function CareText({ style, children, ...props }, ref) {
  const { seniorMode } = useTheme();
  const inherited = useContext(InheritedSize);
  const resolved = StyleSheet.flatten(style);
  const typography = readableTypography(resolved?.fontSize, resolved?.lineHeight, seniorMode, inherited);
  return <NativeText {...props} ref={ref} style={[style, typography]}>
    <InheritedSize.Provider value={typography.fontSize}>{children}</InheritedSize.Provider>
  </NativeText>;
});

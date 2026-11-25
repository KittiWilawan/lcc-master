import { Switch, View, type SwitchProps } from 'react-native';
import { CareText } from './CareText';
import { useTheme } from '../context/ThemeContext';
import readability from '../config/readability.json';

export function SettingSwitch(props: SwitchProps) {
  const { colors, seniorMode } = useTheme();
  return <View style={{ alignItems: 'center', justifyContent: 'center', minHeight: seniorMode ? readability.seniorTouchTargetSize : readability.touchTargetSize }}>
    <Switch {...props} trackColor={{ false: colors.textSecondary, true: colors.accentText }} thumbColor="white" />
    <CareText accessible={false} importantForAccessibility="no" style={{ fontWeight: '700', color: props.value ? colors.accentText : colors.textPrimary }}>
      {props.value ? 'เปิดอยู่' : 'ปิดอยู่'}
    </CareText>
  </View>;
}

import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { TouchableOpacity } from 'react-native';
import { useTheme } from '../context/ThemeContext';
import readability from '../config/readability.json';
import { CareText } from './CareText';

export function SetupReturnButton() {
  const router = useRouter();
  const { colors, seniorMode } = useTheme();
  return <TouchableOpacity accessibilityRole="button" accessibilityLabel="กลับไปตรวจขั้นตอนตั้งค่าถัดไป"
    onPress={() => router.navigate('/setup-guide')}
    style={{ minHeight: seniorMode ? readability.seniorTouchTargetSize : readability.touchTargetSize, padding: 12,
      marginBottom: 16, borderRadius: 12, flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: colors.accentBg }}>
    <MaterialCommunityIcons name="arrow-left" size={24} color={colors.accentText} />
    <CareText style={{ flex: 1, color: colors.accentText, fontWeight: '700' }}>กลับไปตรวจขั้นตอนถัดไป</CareText>
  </TouchableOpacity>;
}

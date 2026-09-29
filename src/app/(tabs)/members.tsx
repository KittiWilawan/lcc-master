import { MaterialCommunityIcons } from '@expo/vector-icons';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as ImagePicker from 'expo-image-picker';
import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useState } from 'react';
import {
  ActivityIndicator, Alert, Image, KeyboardAvoidingView, Modal, Platform,
  ScrollView, StyleSheet, Switch, Text, TextInput, TouchableOpacity, View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '../../context/ThemeContext';
import {
  addCareRecipient, FamilyMember, listFamilyMembers, removeCareRecipient,
  setCareRecipientTracking, updateCareRecipient, uploadCareRecipientAvatar,
} from '../../lib/familyMembers';
import { getFriendlyErrorMessage } from '../../lib/friendlyError';
import { supabase } from '../../lib/supabase';

const forest = '#17473D';
const emerald = '#168765';

export default function MembersScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { colors, isDarkMode } = useTheme();
  const [members, setMembers] = useState<FamilyMember[]>([]);
  const [familyId, setFamilyId] = useState<string | null>(null);
  const [isOwner, setIsOwner] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [editing, setEditing] = useState<FamilyMember | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [name, setName] = useState('');
  const [relationship, setRelationship] = useState('');
  const [avatarUri, setAvatarUri] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const refresh = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const storedId = await AsyncStorage.getItem('familyId');
      setFamilyId(storedId);
      if (!storedId) { setMembers([]); setIsOwner(false); return; }
      const [{ data: auth, error: authError }, { data: family, error: familyError }, people] = await Promise.all([
        supabase.auth.getUser(),
        supabase.from('families').select('owner_id').eq('id', storedId).single(),
        listFamilyMembers(storedId),
      ]);
      if (authError) throw authError;
      if (familyError) throw familyError;
      setIsOwner(Boolean(auth.user && family?.owner_id === auth.user.id));
      setMembers(people);
    } catch (error) {
      setLoadError(getFriendlyErrorMessage(error, 'โหลดข้อมูลครอบครัวไม่สำเร็จ กรุณาลองอีกครั้ง'));
    } finally { setLoading(false); }
  }, []);

  useFocusEffect(useCallback(() => { void refresh(); }, [refresh]));

  const recipients = members.filter((member) => !member.user_id);
  const caregivers = members.filter((member) => Boolean(member.user_id));
  const trackedCount = recipients.filter((member) => member.is_tracked).length;

  const openForm = (member: FamilyMember | null = null) => {
    setEditing(member);
    setName(member?.display_name ?? '');
    setRelationship(member?.role ?? '');
    setAvatarUri(null);
    setShowForm(true);
  };

  const chooseAvatar = async () => {
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'], allowsEditing: true, aspect: [1, 1], quality: 0.7,
    });
    if (!result.canceled && result.assets[0]?.uri) setAvatarUri(result.assets[0].uri);
  };

  const save = async () => {
    const cleanName = name.trim();
    if (!cleanName) { Alert.alert('กรุณาใส่ชื่อ', 'ชื่อช่วยให้ผู้ดูแลทราบว่าเหตุการณ์เกิดกับใคร'); return; }
    if (!familyId || !isOwner) { Alert.alert('ไม่มีสิทธิ์เพิ่มข้อมูล', 'ให้ผู้สร้างครอบครัวเพิ่มผู้ที่ต้องการดูแล'); return; }
    setSaving(true);
    try {
      const memberId = editing?.id ?? await addCareRecipient(familyId, cleanName, relationship.trim());
      if (editing) await updateCareRecipient(memberId, cleanName, relationship.trim());
      if (avatarUri) {
        try { await uploadCareRecipientAvatar(memberId, avatarUri); }
        catch (error) {
          Alert.alert('บันทึกชื่อแล้ว', 'อัปโหลดรูปไม่สำเร็จ สามารถเพิ่มรูปภายหลังได้');
          console.error('Avatar upload failed', error);
        }
      }
      setShowForm(false);
      await refresh();
    } catch (error) {
      Alert.alert('บันทึกไม่สำเร็จ', getFriendlyErrorMessage(error));
    } finally { setSaving(false); }
  };

  const toggleTracking = async (member: FamilyMember) => {
    const next = !member.is_tracked;
    setMembers((current) => current.map((item) => item.id === member.id ? { ...item, is_tracked: next } : item));
    try { await setCareRecipientTracking(member.id, next); }
    catch (error) {
      setMembers((current) => current.map((item) => item.id === member.id ? { ...item, is_tracked: member.is_tracked } : item));
      Alert.alert('เปลี่ยนสถานะไม่สำเร็จ', getFriendlyErrorMessage(error));
    }
  };

  const confirmRemove = (member: FamilyMember) => Alert.alert(
    'ลบผู้รับการดูแล?', `ลบ ${member.display_name} ออกจากครอบครัว? กล้องที่เคยผูกไว้จะไม่มีชื่อผู้รับการดูแล`, [
      { text: 'ยกเลิก', style: 'cancel' },
      { text: 'ลบ', style: 'destructive', onPress: async () => {
        try { await removeCareRecipient(member.id); await refresh(); }
        catch (error) { Alert.alert('ลบไม่สำเร็จ', getFriendlyErrorMessage(error)); }
      } },
    ],
  );

  const leaveFamily = () => Alert.alert('ออกจากครอบครัว?', 'คุณจะไม่ได้รับข้อมูลและการแจ้งเตือนของครอบครัวนี้', [
    { text: 'ยกเลิก', style: 'cancel' },
    { text: 'ออกจากครอบครัว', style: 'destructive', onPress: async () => {
      try {
        const { data } = await supabase.auth.getUser();
        if (!data.user || !familyId) throw new Error('ไม่พบบัญชีหรือครอบครัว');
        const { error } = await supabase.from('family_members').delete()
          .eq('family_id', familyId).eq('user_id', data.user.id);
        if (error) throw error;
        await AsyncStorage.multiRemove(['familyId', 'familyCode']);
        router.replace('/family-setup');
      } catch (error) {
        Alert.alert('ออกจากครอบครัวไม่สำเร็จ', getFriendlyErrorMessage(error));
      }
    } },
  ]);

  const recipientCard = (member: FamilyMember) => (
    <View key={member.id} style={[styles.personCard, { backgroundColor: colors.card, borderColor: colors.cardBorder }]}>
      <View style={styles.personRow}>
        <View style={[styles.avatar, { backgroundColor: colors.accentBg }]}>
          {member.avatar_url ? <Image source={{ uri: member.avatar_url }} style={styles.avatarImage} />
            : <MaterialCommunityIcons name="account-heart-outline" size={30} color={colors.accentText} />}
        </View>
        <View style={styles.personDetails}>
          <Text style={[styles.personName, { color: colors.textPrimary }]} numberOfLines={1}>{member.display_name}</Text>
          <Text style={[styles.personRelation, { color: colors.textSecondary }]} numberOfLines={1}>
            {member.role || 'ผู้รับการดูแล'} · ไม่ต้องมีบัญชีหรือมือถือ
          </Text>
        </View>
        <View style={[styles.statePill, { backgroundColor: member.is_tracked ? colors.accentBg : colors.inputBg }]}>
          <View style={[styles.stateDot, { backgroundColor: member.is_tracked ? colors.accentText : colors.textMuted }]} />
          <Text style={{ color: member.is_tracked ? colors.accentText : colors.textSecondary, fontSize: 11, fontWeight: '700' }}>
            {member.is_tracked ? 'เลือกดูแล' : 'พักไว้'}
          </Text>
        </View>
      </View>
      <View style={[styles.cardDivider, { backgroundColor: colors.separator }]} />
      <View style={styles.identityRow}>
        <View style={[styles.identityIcon, { backgroundColor: member.identity_reference_count === 4 ? '#DCFCE7' : colors.inputBg }]}>
          <MaterialCommunityIcons name="account-search-outline" size={20} color={member.identity_reference_count === 4 ? emerald : colors.textMuted} />
        </View>
        <View style={styles.identityCopy}>
          <Text style={[styles.identityTitle, { color: colors.textPrimary }]}>ยืนยันคนในห้องที่มีหลายคน</Text>
          <Text style={[styles.identityHint, { color: colors.textSecondary }]}>
            {member.identity_reference_count === 4 ? 'สแกนบุคคลครบ 4 มุม' : `สแกนแล้ว ${member.identity_reference_count}/4 มุม`}
          </Text>
        </View>
        {isOwner && <TouchableOpacity style={[styles.identityButton, { borderColor: colors.cardBorder }]} onPress={() => router.push({
          pathname: '/identity-enrollment',
          params: { memberId: member.id, memberName: member.display_name },
        })}>
          <Text style={styles.identityButtonText}>{member.identity_reference_count ? 'จัดการ' : 'ตั้งค่า'}</Text>
        </TouchableOpacity>}
      </View>
      <View style={[styles.cardDivider, { backgroundColor: colors.separator }]} />
      <View style={styles.cardFooter}>
        <View style={styles.toggleCopy}>
          <Text style={[styles.toggleTitle, { color: colors.textPrimary }]}>รวมในการเฝ้าดู</Text>
          <Text style={[styles.toggleHint, { color: colors.textSecondary }]}>ต้องผูกกล้องและเปิดระบบ AI เพิ่ม</Text>
        </View>
        <Switch value={member.is_tracked} onValueChange={() => void toggleTracking(member)} disabled={!isOwner}
          trackColor={{ false: colors.cardBorder, true: '#91D7BC' }} thumbColor={member.is_tracked ? emerald : '#CBD5D1'} />
      </View>
      {isOwner && <View style={styles.actions}>
        <TouchableOpacity style={[styles.actionButton, { borderColor: colors.cardBorder }]} onPress={() => openForm(member)}>
          <MaterialCommunityIcons name="pencil-outline" size={17} color={colors.textSecondary} />
          <Text style={{ color: colors.textSecondary, fontWeight: '700' }}>แก้ไข</Text>
        </TouchableOpacity>
        <TouchableOpacity style={[styles.actionButton, styles.removeButton]} onPress={() => confirmRemove(member)}>
          <MaterialCommunityIcons name="trash-can-outline" size={17} color="#B94747" />
          <Text style={{ color: '#B94747', fontWeight: '700' }}>ลบ</Text>
        </TouchableOpacity>
      </View>}
    </View>
  );

  return <View style={[styles.container, { backgroundColor: colors.background }]}>
    <View style={[styles.topBar, { paddingTop: Math.max(insets.top + 12, 24), backgroundColor: colors.headerBg, borderBottomColor: colors.headerBorder }]}>
      <View><Text style={[styles.overline, { color: colors.accentText }]}>LOOKLANCARE</Text>
        <Text style={[styles.topTitle, { color: colors.textPrimary }]}>ผู้รับการดูแล</Text></View>
      <TouchableOpacity style={[styles.topIcon, { backgroundColor: colors.accentBg }]} onPress={() => router.push('/profile')} accessibilityLabel="เปิดโปรไฟล์">
        <MaterialCommunityIcons name="account-circle-outline" size={25} color={colors.accentText} />
      </TouchableOpacity>
    </View>
    <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
      <View style={styles.hero}>
        <View style={styles.heroIcon}><MaterialCommunityIcons name="home-heart" size={28} color="#FFFFFF" /></View>
        <Text style={styles.heroTitle}>ดูแลได้ แม้ท่านไม่มีมือถือ</Text>
        <Text style={styles.heroBody}>เพิ่มชื่อผู้สูงอายุไว้ในครอบครัว แล้วผูกกล้องกับท่าน ผู้ดูแลที่มีบัญชีจะเป็นคนรับแจ้งเตือน</Text>
        <View style={styles.heroStats}>
          <View><Text style={styles.statNumber}>{recipients.length}</Text><Text style={styles.statLabel}>ผู้รับการดูแล</Text></View>
          <View style={styles.statSeparator} />
          <View><Text style={styles.statNumber}>{trackedCount}</Text><Text style={styles.statLabel}>เลือกให้เฝ้าดู</Text></View>
          <View style={styles.statSeparator} />
          <View><Text style={styles.statNumber}>{caregivers.length}</Text><Text style={styles.statLabel}>ผู้ดูแล</Text></View>
        </View>
      </View>
      {trackedCount === 0 && (
        <View style={[styles.noticeCard, { backgroundColor: colors.accentBg, borderColor: colors.cardBorder, borderWidth: 1 }]}>
          <Text style={{ color: colors.accentText, fontSize: 14, fontWeight: '800' }}>AI กำลังใช้โหมดตรวจทุกคน</Text>
          <Text style={{ color: colors.textSecondary, fontSize: 12, lineHeight: 18, marginTop: 4 }}>
            เมื่อยังไม่เปิดเลือกใคร ระบบจะตรวจการล้มของทุกคนในภาพ และจะไม่เดาชื่อบุคคล
          </Text>
        </View>
      )}
      <View style={styles.sectionHeading}>
        <View><Text style={[styles.sectionTitle, { color: colors.textPrimary }]}>ผู้รับการดูแล</Text>
          <Text style={[styles.sectionSubtitle, { color: colors.textSecondary }]}>เพิ่มได้ด้วยชื่ออย่างเดียว</Text></View>
        {isOwner && <TouchableOpacity style={styles.addButton} onPress={() => openForm()} accessibilityLabel="เพิ่มผู้รับการดูแล">
          <MaterialCommunityIcons name="plus" size={20} color="#FFFFFF" /><Text style={styles.addButtonText}>เพิ่มคน</Text>
        </TouchableOpacity>}
      </View>
      {loading ? <ActivityIndicator color={colors.accentText} style={styles.loading} />
        : loadError ? <View style={[styles.noticeCard, { backgroundColor: colors.card }]}>
            <Text style={{ color: colors.danger }}>{loadError}</Text>
            <TouchableOpacity onPress={() => void refresh()}><Text style={styles.retryText}>ลองอีกครั้ง</Text></TouchableOpacity>
          </View>
        : !familyId ? <View style={[styles.noticeCard, { backgroundColor: colors.card }]}>
            <Text style={[styles.emptyTitle, { color: colors.textPrimary }]}>ยังไม่ได้เข้าครอบครัว</Text>
            <TouchableOpacity onPress={() => router.push('/family-setup')}><Text style={styles.retryText}>ตั้งค่าครอบครัว</Text></TouchableOpacity>
          </View>
        : recipients.length ? recipients.map(recipientCard)
        : <View style={[styles.emptyCard, { backgroundColor: colors.card, borderColor: colors.cardBorder }]}>
            <View style={[styles.emptyIcon, { backgroundColor: colors.accentBg }]}><MaterialCommunityIcons name="account-plus-outline" size={32} color={colors.accentText} /></View>
            <Text style={[styles.emptyTitle, { color: colors.textPrimary }]}>ยังไม่มีผู้รับการดูแล</Text>
            <Text style={[styles.emptyBody, { color: colors.textSecondary }]}>เริ่มจากเพิ่มชื่อคุณตาหรือคุณยาย โดยไม่ต้องสมัครบัญชีให้ท่าน</Text>
            {isOwner && <TouchableOpacity style={styles.emptyAction} onPress={() => openForm()}><Text style={styles.emptyActionText}>เพิ่มคนแรก</Text></TouchableOpacity>}
          </View>}
      <View style={styles.sectionHeading}>
        <View><Text style={[styles.sectionTitle, { color: colors.textPrimary }]}>ผู้ดูแลที่มีบัญชี</Text>
          <Text style={[styles.sectionSubtitle, { color: colors.textSecondary }]}>เปิดรับแจ้งเตือนในโปรไฟล์ของแต่ละคนได้</Text></View>
      </View>
      <View style={[styles.caregiverCard, { backgroundColor: colors.card, borderColor: colors.cardBorder }]}>
        {caregivers.length ? caregivers.map((member, index) => <View key={member.id} style={[styles.caregiverRow, index > 0 && { borderTopWidth: 1, borderTopColor: colors.separator }]}>
          <View style={[styles.smallAvatar, { backgroundColor: colors.accentBg }]}><MaterialCommunityIcons name="account-check-outline" size={21} color={colors.accentText} /></View>
          <View style={styles.personDetails}><Text style={[styles.caregiverName, { color: colors.textPrimary }]}>{member.display_name}</Text>
            <Text style={{ color: colors.textSecondary, fontSize: 12 }}>{member.role || 'ผู้ดูแล'}</Text></View>
          <MaterialCommunityIcons name="check-circle" size={19} color={colors.accentText} />
        </View>) : <Text style={[styles.emptyBody, { color: colors.textSecondary }]}>ยังไม่มีบัญชีผู้ดูแลในครอบครัวนี้</Text>}
      </View>
      <View style={[styles.tipCard, { backgroundColor: isDarkMode ? colors.card : '#E5F4ED' }]}>
        <MaterialCommunityIcons name="information-outline" size={21} color={colors.accentText} />
        <Text style={[styles.tipText, { color: colors.textPrimary }]}>การเลือกให้เฝ้าดูยังไม่เปิด AI ทันที ต้องเพิ่มกล้อง ผูกกับผู้รับการดูแล และให้คอมตรวจภาพทำงานก่อน</Text>
      </View>
      {!isOwner && familyId && <TouchableOpacity style={styles.leaveButton} onPress={leaveFamily}>
        <Text style={{ color: '#B94747', fontWeight: '700' }}>ออกจากครอบครัวนี้</Text>
      </TouchableOpacity>}
    </ScrollView>
    <Modal visible={showForm} transparent animationType="slide" onRequestClose={() => setShowForm(false)}>
      <KeyboardAvoidingView style={styles.modalOverlay} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <View style={[styles.formSheet, { backgroundColor: colors.card, paddingBottom: Math.max(insets.bottom, 24) }]}>
          <View style={styles.sheetHandle} />
          <View style={styles.sheetHeader}>
            <View><Text style={[styles.sheetTitle, { color: colors.textPrimary }]}>{editing ? 'แก้ไขผู้รับการดูแล' : 'เพิ่มผู้รับการดูแล'}</Text>
              <Text style={[styles.sheetSubtitle, { color: colors.textSecondary }]}>ไม่ต้องใช้อีเมล รหัสผ่าน หรือมือถือ</Text></View>
            <TouchableOpacity onPress={() => setShowForm(false)} accessibilityLabel="ปิด"><MaterialCommunityIcons name="close" size={23} color={colors.textSecondary} /></TouchableOpacity>
          </View>
          <ScrollView keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
            <TouchableOpacity style={[styles.photoPicker, { backgroundColor: colors.accentBg, borderColor: colors.accentText }]} onPress={() => void chooseAvatar()}>
              {avatarUri || editing?.avatar_url ? <Image source={{ uri: avatarUri || editing?.avatar_url || '' }} style={styles.photoPreview} />
                : <MaterialCommunityIcons name="camera-plus-outline" size={32} color={colors.accentText} />}
            </TouchableOpacity>
            <Text style={[styles.photoCaption, { color: colors.textSecondary }]}>เพิ่มรูปได้ภายหลัง · ไม่จำเป็นต่อการบันทึก</Text>
            <Text style={[styles.fieldLabel, { color: colors.textPrimary }]}>ชื่อที่เรียก <Text style={{ color: '#B94747' }}>*</Text></Text>
            <TextInput style={[styles.input, { backgroundColor: colors.inputBg, borderColor: colors.cardBorder, color: colors.textPrimary }]}
              placeholder="เช่น คุณยายสมใจ" placeholderTextColor={colors.textMuted} value={name} onChangeText={setName} autoCapitalize="words" maxLength={80} />
            <Text style={[styles.fieldLabel, { color: colors.textPrimary }]}>ความสัมพันธ์ (ไม่บังคับ)</Text>
            <TextInput style={[styles.input, { backgroundColor: colors.inputBg, borderColor: colors.cardBorder, color: colors.textPrimary }]}
              placeholder="เช่น คุณยาย" placeholderTextColor={colors.textMuted} value={relationship} onChangeText={setRelationship} maxLength={60} />
            <Text style={[styles.formHint, { color: colors.textSecondary }]}>หลังบันทึก ไปหน้าหลักเพื่อผูกกล้องกับท่าน การแจ้งเตือนจะส่งไปยังมือถือของผู้ดูแล</Text>
            <TouchableOpacity style={[styles.saveButton, saving && { opacity: 0.65 }]} onPress={() => void save()} disabled={saving}>
              {saving ? <ActivityIndicator color="#FFFFFF" /> : <Text style={styles.saveButtonText}>{editing ? 'บันทึกการแก้ไข' : 'เพิ่มผู้รับการดูแล'}</Text>}
            </TouchableOpacity>
          </ScrollView>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  </View>;
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  topBar: { paddingHorizontal: 22, paddingBottom: 18, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', borderBottomWidth: 1 },
  overline: { fontSize: 11, fontWeight: '800', letterSpacing: 1.8, marginBottom: 3 },
  topTitle: { fontSize: 25, fontWeight: '800' },
  topIcon: { width: 43, height: 43, borderRadius: 15, alignItems: 'center', justifyContent: 'center' },
  content: { padding: 20, paddingBottom: 42 },
  hero: { backgroundColor: forest, borderRadius: 25, padding: 22, marginBottom: 29 },
  heroIcon: { width: 49, height: 49, borderRadius: 17, backgroundColor: '#2E6758', alignItems: 'center', justifyContent: 'center', marginBottom: 19 },
  heroTitle: { color: '#FFFFFF', fontSize: 21, lineHeight: 29, fontWeight: '800', marginBottom: 8 },
  heroBody: { color: '#CDE4DA', fontSize: 13, lineHeight: 21, maxWidth: 330 },
  heroStats: { marginTop: 22, paddingTop: 18, borderTopWidth: 1, borderTopColor: '#487367', flexDirection: 'row', alignItems: 'center', justifyContent: 'space-around' },
  statNumber: { color: '#FFFFFF', fontSize: 23, fontWeight: '800', textAlign: 'center' },
  statLabel: { color: '#CDE4DA', fontSize: 11, textAlign: 'center', marginTop: 2 },
  statSeparator: { width: 1, height: 30, backgroundColor: '#487367' },
  sectionHeading: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14, marginTop: 4 },
  sectionTitle: { fontSize: 19, fontWeight: '800' },
  sectionSubtitle: { fontSize: 12, marginTop: 4 },
  addButton: { flexDirection: 'row', gap: 5, alignItems: 'center', backgroundColor: emerald, borderRadius: 12, paddingHorizontal: 13, paddingVertical: 10 },
  addButtonText: { color: '#FFFFFF', fontSize: 13, fontWeight: '800' },
  loading: { marginVertical: 30 },
  noticeCard: { borderRadius: 18, padding: 22, gap: 12, marginBottom: 22 },
  retryText: { color: emerald, fontWeight: '800', marginTop: 10 },
  personCard: { borderWidth: 1, borderRadius: 20, padding: 16, marginBottom: 12 },
  personRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  avatar: { width: 54, height: 54, borderRadius: 19, alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
  avatarImage: { width: 54, height: 54 },
  personDetails: { flex: 1, minWidth: 0 },
  personName: { fontSize: 16, fontWeight: '800' },
  personRelation: { fontSize: 11, marginTop: 4 },
  statePill: { flexDirection: 'row', gap: 5, alignItems: 'center', borderRadius: 20, paddingHorizontal: 8, paddingVertical: 6 },
  stateDot: { width: 6, height: 6, borderRadius: 3 },
  cardDivider: { height: 1, marginTop: 15, marginBottom: 12 },
  identityRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  identityIcon: { width: 38, height: 38, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  identityCopy: { flex: 1 },
  identityTitle: { fontSize: 12, fontWeight: '800' },
  identityHint: { fontSize: 11, marginTop: 3 },
  identityButton: { borderWidth: 1, borderRadius: 10, paddingHorizontal: 11, paddingVertical: 7 },
  identityButtonText: { color: emerald, fontSize: 12, fontWeight: '800' },
  cardFooter: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  toggleCopy: { flex: 1 },
  toggleTitle: { fontSize: 13, fontWeight: '700' },
  toggleHint: { fontSize: 11, marginTop: 3 },
  actions: { flexDirection: 'row', gap: 8, marginTop: 14 },
  actionButton: { flex: 1, borderWidth: 1, borderRadius: 11, paddingVertical: 9, flexDirection: 'row', gap: 6, alignItems: 'center', justifyContent: 'center' },
  removeButton: { backgroundColor: '#FCECEC', borderColor: '#F7D5D5' },
  emptyCard: { borderWidth: 1, borderRadius: 20, alignItems: 'center', padding: 25, marginBottom: 24 },
  emptyIcon: { width: 66, height: 66, borderRadius: 22, alignItems: 'center', justifyContent: 'center', marginBottom: 16 },
  emptyTitle: { fontSize: 17, fontWeight: '800', textAlign: 'center' },
  emptyBody: { fontSize: 13, lineHeight: 20, textAlign: 'center', marginTop: 7 },
  emptyAction: { marginTop: 19, backgroundColor: emerald, borderRadius: 12, paddingVertical: 11, paddingHorizontal: 25 },
  emptyActionText: { color: '#FFFFFF', fontWeight: '800' },
  caregiverCard: { borderWidth: 1, borderRadius: 19, paddingHorizontal: 16, paddingVertical: 6, marginBottom: 17 },
  caregiverRow: { flexDirection: 'row', alignItems: 'center', gap: 11, paddingVertical: 13 },
  smallAvatar: { width: 41, height: 41, borderRadius: 14, alignItems: 'center', justifyContent: 'center' },
  caregiverName: { fontSize: 14, fontWeight: '700', marginBottom: 2 },
  tipCard: { borderRadius: 15, padding: 15, flexDirection: 'row', gap: 10, marginTop: 3 },
  tipText: { flex: 1, fontSize: 12, lineHeight: 19 },
  leaveButton: { alignItems: 'center', padding: 17, marginTop: 17 },
  modalOverlay: { flex: 1, backgroundColor: 'rgba(18,35,28,0.55)', justifyContent: 'flex-end' },
  formSheet: { borderTopLeftRadius: 25, borderTopRightRadius: 25, paddingHorizontal: 23, paddingTop: 10, maxHeight: '88%' },
  sheetHandle: { width: 41, height: 5, borderRadius: 4, backgroundColor: '#CBD6CF', alignSelf: 'center', marginBottom: 20 },
  sheetHeader: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16 },

  sheetTitle: { fontSize: 21, fontWeight: '800' },
  sheetSubtitle: { fontSize: 12, marginTop: 4 },
  photoPicker: { width: 82, height: 82, borderRadius: 25, borderWidth: 1, borderStyle: 'dashed', alignItems: 'center', justifyContent: 'center', alignSelf: 'center', marginTop: 13, overflow: 'hidden' },
  photoPreview: { width: 82, height: 82 },
  photoCaption: { fontSize: 11, textAlign: 'center', marginTop: 8, marginBottom: 23 },
  fieldLabel: { fontSize: 13, fontWeight: '700', marginBottom: 8 },
  input: { borderWidth: 1, borderRadius: 13, paddingHorizontal: 14, paddingVertical: 12, fontSize: 16, marginBottom: 18 },
  formHint: { fontSize: 12, lineHeight: 19, marginTop: 1 },
  saveButton: { backgroundColor: emerald, borderRadius: 14, height: 51, alignItems: 'center', justifyContent: 'center', marginTop: 23, marginBottom: 9 },
  saveButtonText: { color: '#FFFFFF', fontSize: 15, fontWeight: '800' },
});

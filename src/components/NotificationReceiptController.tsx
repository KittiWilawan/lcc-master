import { useEffect } from 'react';
import { AppState, Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import Constants, { ExecutionEnvironment } from 'expo-constants';
import type { Session } from '@supabase/supabase-js';
import { supabase } from '../lib/supabase';
import { observePhoneTest } from '../lib/selfTestReceipts';
import config from '../../android/app/src/main/assets/monitoring/cloud.json';

/** App acknowledgements prove JS observed/opened a push, not that a person read it. */
export function NotificationReceiptController({ session }: { session: Session | null }) {
  const userId = session?.user.id;
  useEffect(() => {
    if (!userId || Platform.OS === 'web' || Constants.executionEnvironment === ExecutionEnvironment.StoreClient) return;
    let active = true; let busy = false;
    const key = `@pending_notification_receipts:${userId}`;
    let operations = Promise.resolve();
    const drain = async () => {
      if (!active || busy) return;
      busy = true;
      try {
        const rows = JSON.parse(await AsyncStorage.getItem(key) ?? '[]') as { eventId: string; opened: boolean }[];
        const remaining = [];
        for (const row of rows) {
          if (!active) return;
          const { error } = await supabase.functions.invoke(config.functionName, { body: { action: 'acknowledge', ...row } });
          if (error) remaining.push(row);
        }
        if (active) await AsyncStorage.setItem(key, JSON.stringify(remaining));
      } catch { /* Resume retries only this account's private queue. */ }
      finally { busy = false; }
    };
    const acknowledge = (data: Record<string, unknown> | undefined, opened: boolean) => {
      if (active && data?.type === 'notification_test') {
        void observePhoneTest(userId, data).catch(() => undefined);
        return;
      }
      if (!active || !data || data.type !== 'fall_alert' || typeof data.eventId !== 'string') return;
      const eventId = data.eventId;
      operations = operations.then(async () => {
        if (!active) return;
        const rows = JSON.parse(await AsyncStorage.getItem(key) ?? '[]') as { eventId: string; opened: boolean }[];
        const previous = rows.find((row) => row.eventId === eventId);
        if (previous) previous.opened ||= opened; else rows.push({ eventId, opened });
        await AsyncStorage.setItem(key, JSON.stringify(rows.slice(-config.maxAcknowledgements)));
        await drain();
      }).catch(() => undefined);
    };
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const notifications = require('expo-notifications') as typeof import('expo-notifications');
    const received = notifications.addNotificationReceivedListener((notification) => acknowledge(notification.request.content.data, false));
    const response = notifications.addNotificationResponseReceivedListener((result) => acknowledge(result.notification.request.content.data, true));
    void notifications.getLastNotificationResponseAsync().then((last) => {
      if (last) acknowledge(last.notification.request.content.data, true);
    }).catch(() => undefined);
    const checkPresented = () => {
      void notifications.getPresentedNotificationsAsync().then(items => {
        for (const item of items) {
          if (item.request.content.data?.type === 'notification_test') acknowledge(item.request.content.data, false);
        }
      }).catch(() => undefined);
    };
    checkPresented();
    const state = AppState.addEventListener('change', (next) => {
      if (next === 'active') { checkPresented(); operations = operations.then(drain); }
    });
    operations = operations.then(drain);
    return () => { active = false; received.remove(); response.remove(); state.remove(); };
  }, [userId]);
  return null;
}

import { Alert as NativeAlert, type AlertButton, type AlertOptions } from 'react-native';

export type AppAlertKind = 'info' | 'success' | 'error' | 'confirm';
export interface AppAlertMessage {
  kind: AppAlertKind;
  title: string;
  message?: string;
  buttons: AlertButton[];
  options?: AlertOptions;
}
type Presenter = (message: AppAlertMessage) => void;
let presenter: Presenter | null = null;

export function attachAlertPresenter(next: Presenter): () => void {
  presenter = next;
  return () => { if (presenter === next) presenter = null; };
}

function present(kind: AppAlertKind, title: string, message?: string, buttons?: AlertButton[], options?: AlertOptions): void {
  if (!presenter) { NativeAlert.alert(title, message, buttons, options); return; }
  presenter({ kind, title, message, buttons: buttons?.length ? buttons : [{ text: 'ตกลง' }], options });
}

export const AppAlert = {
  alert: (title: string, message?: string, buttons?: AlertButton[], options?: AlertOptions) => present('info', title, message, buttons, options),
  info: (title: string, message?: string, buttons?: AlertButton[]) => present('info', title, message, buttons),
  success: (title: string, message?: string, buttons?: AlertButton[]) => present('success', title, message, buttons),
  error: (title: string, message?: string, buttons?: AlertButton[]) => present('error', title, message, buttons),
  confirm: (title: string, message?: string, buttons?: AlertButton[]) => present('confirm', title, message, buttons),
};

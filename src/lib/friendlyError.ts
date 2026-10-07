interface ErrorLike {
  name?: unknown;
  message?: unknown;
  code?: unknown;
  status?: unknown;
}

function readError(error: unknown): ErrorLike {
  if (typeof error === 'object' && error !== null) return error as ErrorLike;
  return {};
}

export function getFriendlyErrorMessage(
  error: unknown,
  fallback = 'ระบบทำรายการไม่สำเร็จ กรุณาลองอีกครั้ง'
): string {
  const details = readError(error);
  const message = typeof details.message === 'string' ? details.message.toLowerCase() : '';
  const code = typeof details.code === 'string' ? details.code.toLowerCase() : '';

  if (details.name === 'TimeoutError' || details.name === 'AbortError') {
    return 'ระบบตอบกลับช้าเกินไป กรุณาลองอีกครั้งเมื่อการเชื่อมต่อพร้อม';
  }
  if (typeof details.status === 'number' && details.status >= 500) {
    return 'ระบบส่วนกลางไม่พร้อมชั่วคราว กรุณารอสักครู่แล้วลองอีกครั้ง';
  }
  if (details.name === 'AuthRetryableFetchError') {
    return 'ติดต่อระบบบัญชีไม่ได้ กรุณาตรวจการเชื่อมต่อแล้วลองอีกครั้ง';
  }

  if (message.includes('network') || message.includes('fetch') || message.includes('timeout')) {
    return 'เชื่อมต่อระบบไม่ได้ กรุณาตรวจอินเทอร์เน็ตแล้วลองอีกครั้ง';
  }
  if (message.includes('jwt') || message.includes('session') || message.includes('not authenticated')) {
    return 'การเข้าสู่ระบบหมดอายุ กรุณาเข้าสู่ระบบใหม่';
  }
  if (message.includes('permission') || message.includes('policy') || code === '42501') {
    return 'บัญชีนี้ไม่มีสิทธิ์ทำรายการ กรุณาตรวจว่าคุณอยู่ในครอบครัวที่ถูกต้อง';
  }
  if (message.includes('duplicate') || code === '23505') {
    return 'มีข้อมูลนี้อยู่แล้ว กรุณาตรวจรายการเดิมก่อนเพิ่มใหม่';
  }
  if (message.includes('storage') || message.includes('upload')) {
    return 'บันทึกรูปไม่สำเร็จ กรุณาตรวจอินเทอร์เน็ตและลองใช้รูปใหม่';
  }
  return fallback;
}

export function getAuthErrorMessage(error: unknown): string {
  const details = readError(error);
  const code = typeof details.code === 'string' ? details.code : '';
  const messages: Record<string, string> = {
    invalid_credentials: 'อีเมลหรือรหัสผ่านไม่ถูกต้อง กรุณาตรวจสอบแล้วลองอีกครั้ง',
    email_not_confirmed: 'กรุณากดยืนยันอีเมลจากกล่องจดหมายก่อนเข้าสู่ระบบ',
    user_already_exists: 'อีเมลนี้มีบัญชีอยู่แล้ว กรุณาเข้าสู่ระบบหรือขอรหัสผ่านใหม่',
    email_address_invalid: 'รูปแบบอีเมลไม่ถูกต้อง กรุณาตรวจสอบอีกครั้ง',
    weak_password: 'รหัสผ่านยังไม่ปลอดภัย กรุณาใช้รหัสผ่านที่ยาวและคาดเดายากขึ้น',
    over_request_rate_limit: 'มีการทำรายการถี่เกินไป กรุณารอสักครู่แล้วลองใหม่',
  };
  return messages[code] ?? getFriendlyErrorMessage(error, 'ระบบบัญชีทำรายการไม่สำเร็จ กรุณาลองอีกครั้ง');
}

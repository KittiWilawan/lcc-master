/** Validate the public Android client configuration without exposing its keys. */
export function validateAndroidPushConfig(value, expectedPackage) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('ไฟล์ตั้งค่า Firebase ต้องเป็น JSON object');
  if (value.type === 'service_account' || Object.hasOwn(value, 'private_key') || Object.hasOwn(value, 'private_key_id')) {
    throw new Error('ห้ามนำ private service-account key เข้าแอป ให้ใช้ google-services.json ของ Android');
  }
  const project = value.project_info;
  const nonblank = (text) => typeof text === 'string' && text.trim().length > 0;
  const client = Array.isArray(value.client) ? value.client.find((item) => item?.client_info?.android_client_info?.package_name === expectedPackage) : undefined;
  if (!nonblank(expectedPackage) || !client) throw new Error('ไม่พบ Android client ที่ตรงกับ package ของแอป');
  if (!nonblank(project?.project_id) || !nonblank(project?.project_number) || !nonblank(client.client_info?.mobilesdk_app_id)) {
    throw new Error('ข้อมูลโปรเจกต์หรือ Android application ID ในไฟล์ไม่ครบ');
  }
  if (!Array.isArray(client.api_key) || !client.api_key.some((item) => nonblank(item?.current_key))) {
    throw new Error('ไฟล์ Android client ไม่มี API key สำหรับลงทะเบียน Firebase');
  }
  return { projectId: project.project_id, projectNumber: project.project_number, applicationId: client.client_info.mobilesdk_app_id, packageName: expectedPackage };
}

export function matchingAndroidPushConfigs(first, second) {
  return Boolean(first && second && first.projectId === second.projectId && first.projectNumber === second.projectNumber
    && first.applicationId === second.applicationId && first.packageName === second.packageName);
}

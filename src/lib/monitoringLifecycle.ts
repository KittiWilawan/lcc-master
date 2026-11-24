import { getNativeCameraCapabilities, getDeliveryRegistration } from './cameraMonitoring';
import { isBackgroundMonitoringRunning, stopBackgroundMonitoring } from './backgroundMonitoring';
import { clearSignedInUserStorage } from './authSession';

/** Navigation keeps native monitoring; a different authenticated owner must end its private scope. */
export function monitoringOwnerNeedsReset(userId: string, owners: (string | null | undefined)[], running: boolean): boolean {
  const known = owners.filter((owner): owner is string => typeof owner === 'string' && owner.length > 0);
  return known.length ? known.some((owner) => owner !== userId) : running;
}

export async function reconcileMonitoringOwner(userId: string) {
  const [capabilities, registration, running] = await Promise.all([
    getNativeCameraCapabilities().catch(() => undefined), getDeliveryRegistration().catch(() => undefined),
    isBackgroundMonitoringRunning().catch(() => false),
  ]);
  const owners = [capabilities?.recovery?.userId, registration?.userId];
  if (monitoringOwnerNeedsReset(userId, owners, running)) {
    await stopBackgroundMonitoring();
    if (owners.some((owner) => typeof owner === 'string' && owner.length > 0 && owner !== userId)) await clearSignedInUserStorage();
  }
}

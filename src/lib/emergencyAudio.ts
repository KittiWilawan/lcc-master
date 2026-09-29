import * as Speech from 'expo-speech';

export function playEmergencySiren(): void {
  if (typeof window === 'undefined') return;
  try {
    const AudioContextClass = window.AudioContext;
    if (!AudioContextClass) return;
    const context = new AudioContextClass();
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    oscillator.type = 'sawtooth';
    oscillator.frequency.setValueAtTime(880, context.currentTime);
    oscillator.frequency.exponentialRampToValueAtTime(440, context.currentTime + 0.3);
    gain.gain.setValueAtTime(0.2, context.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.01, context.currentTime + 0.5);
    oscillator.connect(gain);
    gain.connect(context.destination);
    oscillator.start();
    oscillator.stop(context.currentTime + 0.5);
  } catch {
    // Audio is optional; visual and vibration alerts remain available.
  }
}

export function speakCalmingMessage(personName?: string): void {
  const name = personName || 'คุณ';
  Speech.speak(`ระบบพบเหตุที่อาจเป็นการล้มของ${name} และกำลังแจ้งผู้ดูแล โปรดขอความช่วยเหลือหากทำได้`, {
    language: 'th-TH',
  });
}

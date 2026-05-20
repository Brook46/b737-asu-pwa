// Hebrew translation. Tier A is a passthrough (no offline translator without an
// on-device model, which is not part of this initial cut). Tier B/C hooks are
// stubs ready to be wired up later.

export async function translate(text, targetLang) {
  if (targetLang !== 'he') return { text, translated: false };
  // No on-device model loaded yet — return original text with a flag so the UI
  // can show a hint.
  return { text, translated: false, reason: 'on-device model not enabled' };
}

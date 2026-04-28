/** Read persisted login payload without throwing if data is corrupt. */
export function readStoredStudent() {
  try {
    const raw = localStorage.getItem('student');
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

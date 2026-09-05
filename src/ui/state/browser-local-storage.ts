export function browserLocalStorage(): Storage | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    // Browser policy can deny the property getter before any storage method runs.
    return null;
  }
}

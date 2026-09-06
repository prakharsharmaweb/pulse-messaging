/**
 * In-process presence tracking. userId -> set of live socket ids.
 * Multi-tab safe: a user is "online" while at least one socket is connected.
 */
const sockets = new Map<string, Set<string>>();
const lastSeen = new Map<string, string>();

export function addSocket(userId: string, socketId: string): boolean {
  const set = sockets.get(userId) ?? new Set<string>();
  const wasOffline = set.size === 0;
  set.add(socketId);
  sockets.set(userId, set);
  return wasOffline;
}

export function removeSocket(userId: string, socketId: string): boolean {
  const set = sockets.get(userId);
  if (!set) return false;
  set.delete(socketId);
  if (set.size === 0) {
    sockets.delete(userId);
    lastSeen.set(userId, new Date().toISOString());
    return true; // became offline
  }
  return false;
}

export function isOnline(userId: string): boolean {
  return (sockets.get(userId)?.size ?? 0) > 0;
}

export function onlineUserIds(): string[] {
  return [...sockets.keys()];
}

export function getLastSeen(userId: string): string {
  return lastSeen.get(userId) ?? new Date().toISOString();
}

"use client";

import type { SendMessageInput } from "@/lib/socket/events";

/**
 * Persistent outbox for messages that have been optimistically shown but not yet
 * acknowledged by the server. Survives reloads and disconnects so nothing that
 * the user "sent" is silently lost. Keyed by clientId for idempotent replay.
 */
const KEY = "rtm.outbox.v1";

type OutboxEntry = SendMessageInput & { createdAt: number };

function read(): Record<string, OutboxEntry> {
  if (typeof window === "undefined") return {};
  try {
    return JSON.parse(localStorage.getItem(KEY) ?? "{}");
  } catch {
    return {};
  }
}

function write(data: Record<string, OutboxEntry>) {
  try {
    localStorage.setItem(KEY, JSON.stringify(data));
  } catch {
    /* quota / private mode — optimistic UI still works for the session */
  }
}

export const outbox = {
  add(entry: SendMessageInput) {
    const data = read();
    data[entry.clientId] = { ...entry, createdAt: Date.now() };
    write(data);
  },
  remove(clientId: string) {
    const data = read();
    delete data[clientId];
    write(data);
  },
  all(): OutboxEntry[] {
    return Object.values(read()).sort((a, b) => a.createdAt - b.createdAt);
  },
};

"use client";

/**
 * Desktop notifications + a subtle sound for messages that arrive while the tab
 * is not focused. Both are per-user preferences persisted in localStorage and
 * default to on; either can be muted from the sidebar or the command palette.
 */

const SOUND_KEY = "rtm.sound";
const NOTIF_KEY = "rtm.notifications";

function pref(key: string): boolean {
  if (typeof window === "undefined") return true;
  try {
    return localStorage.getItem(key) !== "off";
  } catch {
    return true;
  }
}

export const notificationPrefs = {
  get sound() {
    return pref(SOUND_KEY);
  },
  get notifications() {
    return pref(NOTIF_KEY);
  },
  setSound(on: boolean) {
    try {
      localStorage.setItem(SOUND_KEY, on ? "on" : "off");
    } catch {
      /* ignore */
    }
  },
  setNotifications(on: boolean) {
    try {
      localStorage.setItem(NOTIF_KEY, on ? "on" : "off");
    } catch {
      /* ignore */
    }
  },
};

let audio: HTMLAudioElement | null = null;

export function playPop() {
  if (!notificationPrefs.sound) return;
  try {
    if (!audio) {
      audio = new Audio("/sounds/pop.wav");
      audio.volume = 0.35;
    }
    audio.currentTime = 0;
    void audio.play().catch(() => {});
  } catch {
    /* ignore */
  }
}

export async function ensureNotificationPermission(): Promise<boolean> {
  if (typeof window === "undefined" || !("Notification" in window)) return false;
  if (Notification.permission === "granted") return true;
  if (Notification.permission === "denied") return false;
  try {
    return (await Notification.requestPermission()) === "granted";
  } catch {
    return false;
  }
}

export async function notifyMessage(opts: {
  title: string;
  body: string;
  onClick: () => void;
}) {
  if (!notificationPrefs.notifications) return;
  if (typeof document !== "undefined" && !document.hidden) return;
  const ok = await ensureNotificationPermission();
  if (!ok) return;
  try {
    const n = new Notification(opts.title, {
      body: opts.body,
      icon: "/icon.svg",
      tag: "rtm-message",
    });
    n.onclick = () => {
      window.focus();
      opts.onClick();
      n.close();
    };
  } catch {
    /* ignore */
  }
}

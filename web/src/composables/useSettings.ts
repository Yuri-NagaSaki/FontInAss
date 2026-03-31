import { reactive } from "vue";

const STORAGE_KEY = "fontinass_settings";

export interface Settings {
  SRT_FORMAT: string;
  SRT_STYLE: string;
  CLEAR_FONTS: boolean;
  STRICT_MODE: boolean;
  EXTRACT_FONTS: boolean;
  CLEAR_AFTER_DOWNLOAD: boolean;
}

const defaults: Settings = {
  SRT_FORMAT: "",
  SRT_STYLE: "",
  CLEAR_FONTS: false,
  STRICT_MODE: true,
  EXTRACT_FONTS: false,
  CLEAR_AFTER_DOWNLOAD: true,
};

// Load once at module init
const loaded = (() => {
  try {
    const s = localStorage.getItem(STORAGE_KEY);
    return s ? JSON.parse(s) : {};
  } catch {
    return {};
  }
})();

const settings = reactive<Settings>({ ...defaults, ...loaded });

export function useSettings() {
  const save = () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
  };

  const toggle = (key: keyof Settings) => {
    (settings as Record<string, unknown>)[key] = !settings[key];
  };

  const get = (key: string): boolean =>
    Boolean(settings[key as keyof Settings]);

  return { settings, save, toggle, get };
}

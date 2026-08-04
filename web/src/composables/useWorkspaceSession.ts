import { computed, readonly, ref } from "vue";
import type { WorkspaceSessionResponse } from "../api/client";
import {
  fetchWorkspaceSession,
  loginWithAniBT,
  logoutWorkspace,
} from "../api/client";

const session = ref<WorkspaceSessionResponse | null>(null);
const loading = ref(false);
const error = ref("");
let inFlight: Promise<WorkspaceSessionResponse> | null = null;

async function refresh(force = false): Promise<WorkspaceSessionResponse> {
  if (!force && session.value) return session.value;
  if (inFlight) return inFlight;
  loading.value = true;
  error.value = "";
  inFlight = fetchWorkspaceSession()
    .then((value) => {
      session.value = value;
      return value;
    })
    .catch((cause) => {
      error.value = cause instanceof Error ? cause.message : String(cause);
      const anonymous = { authenticated: false as const };
      session.value = anonymous;
      return anonymous;
    })
    .finally(() => {
      loading.value = false;
      inFlight = null;
    });
  return inFlight;
}

export function useWorkspaceSession() {
  const authenticated = computed(() => session.value?.authenticated === true);
  const canManage = computed(
    () => session.value?.authenticated === true && session.value.canManage,
  );
  return {
    session: readonly(session),
    loading: readonly(loading),
    error: readonly(error),
    authenticated,
    canManage,
    refresh,
    login(returnTo = `${window.location.pathname}${window.location.search}`) {
      loginWithAniBT(returnTo);
    },
    async logout(global = false) {
      await logoutWorkspace(global);
      session.value = { authenticated: false };
      if (!global) window.location.assign("/");
    },
  };
}

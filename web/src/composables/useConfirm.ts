import { ref } from "vue";

export type ConfirmVariant = "default" | "danger" | "warning";

export interface ConfirmOptions {
  title?: string;
  message: string;
  detail?: string;
  confirmText?: string;
  cancelText?: string;
  variant?: ConfirmVariant;
}

export interface AlertOptions {
  title?: string;
  message: string;
  detail?: string;
  confirmText?: string;
  variant?: ConfirmVariant;
}

interface ConfirmState extends ConfirmOptions {
  open: boolean;
  alertOnly: boolean;
  resolve: ((value: boolean) => void) | null;
}

const state = ref<ConfirmState>({
  open: false,
  alertOnly: false,
  message: "",
  resolve: null,
});

export function useConfirm() {
  function confirm(options: ConfirmOptions): Promise<boolean> {
    return new Promise<boolean>((resolve) => {
      state.value = {
        open: true,
        alertOnly: false,
        title: options.title,
        message: options.message,
        detail: options.detail,
        confirmText: options.confirmText,
        cancelText: options.cancelText,
        variant: options.variant ?? "default",
        resolve,
      };
    });
  }

  function alert(options: AlertOptions): Promise<void> {
    return new Promise<void>((resolve) => {
      state.value = {
        open: true,
        alertOnly: true,
        title: options.title,
        message: options.message,
        detail: options.detail,
        confirmText: options.confirmText,
        variant: options.variant ?? "default",
        resolve: () => resolve(),
      };
    });
  }

  function _resolve(value: boolean) {
    const r = state.value.resolve;
    state.value.open = false;
    state.value.resolve = null;
    if (r) r(value);
  }

  return { state, confirm, alert, _resolve };
}

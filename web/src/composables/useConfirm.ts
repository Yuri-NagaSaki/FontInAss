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

interface ConfirmState extends ConfirmOptions {
  open: boolean;
  resolve: ((value: boolean) => void) | null;
}

const state = ref<ConfirmState>({
  open: false,
  message: "",
  resolve: null,
});

export function useConfirm() {
  function confirm(options: ConfirmOptions): Promise<boolean> {
    return new Promise<boolean>((resolve) => {
      state.value = {
        open: true,
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

  function _resolve(value: boolean) {
    const r = state.value.resolve;
    state.value.open = false;
    state.value.resolve = null;
    if (r) r(value);
  }

  return { state, confirm, _resolve };
}

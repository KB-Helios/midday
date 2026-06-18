import { isLocalDesktopRuntime } from "@midday/utils/envs";
import { Resend } from "resend";

function createLocalResend() {
  const ok = async () => ({ data: null, error: null });

  return {
    batch: {
      send: ok,
    },
    contacts: {
      create: ok,
      remove: ok,
    },
    emails: {
      send: ok,
    },
  } as unknown as Resend;
}

export const resend = isLocalDesktopRuntime()
  ? createLocalResend()
  : new Resend(process.env.RESEND_API_KEY!);

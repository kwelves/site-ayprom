import { createRpcClient } from "./rpc-client";
import { navigate } from "./router";

// One RPC client per browser tab: its memory is what makes repeated page opens instant.
export const rpc = createRpcClient({
  fetchImpl: (input, init) => fetch(input, init),
  navigate: (url) => navigate(url),
  onUnauthorized: (reason) => {
    rpc.clear();
    navigate(reason ? `/admin/login?session=${reason}` : "/admin/login", { replace: true });
  },
});

export const rpcCall = (name: string, args: unknown[]) => rpc.call(name, args);
export const rpcRead = (name: string, args: unknown[]) => rpc.read(name, args);

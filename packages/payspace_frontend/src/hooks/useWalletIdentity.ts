import { useEffect, useState } from "react";
import { ccc } from "@ckb-ccc/connector-react";

type WalletIdentityState = {
  connected: boolean;
  address: string | null;
  identity: string | null;
  walletName: string | null;
  open: () => unknown;
  close: () => unknown;
  disconnect: () => unknown;
};

export function useWalletIdentity(): WalletIdentityState {
  const { open, close, disconnect, wallet } = ccc.useCcc();
  const signer = ccc.useSigner();

  const [address, setAddress] = useState<string | null>(null);
  const [identity, setIdentity] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function load(): Promise<void> {
      if (!signer) {
        setAddress(null);
        setIdentity(null);
        return;
      }

      try {
        const [recommendedAddress, currentIdentity] = await Promise.all([
          signer.getRecommendedAddress(),
          signer.getIdentity(),
        ]);
        if (!cancelled) {
          setAddress(recommendedAddress ?? null);
          setIdentity(currentIdentity ?? null);
        }
      } catch {
        if (!cancelled) {
          setAddress(null);
          setIdentity(null);
        }
      }
    }

    void load();
    return () => {
      cancelled = true;
    };
  }, [signer]);

  return {
    connected: !!signer,
    address,
    identity,
    walletName: wallet?.name ?? null,
    open,
    close,
    disconnect,
  };
}

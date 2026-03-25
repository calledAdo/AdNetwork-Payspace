import { SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import { AppSidebar } from "@/components/AppSidebar";
import { Outlet, useLocation, useNavigate } from "react-router-dom";
import { Wallet } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useWalletIdentity } from "@/hooks/useWalletIdentity";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

function shorten(value: string | null): string {
  if (!value) return "Connect";
  return value.length > 16 ? `${value.slice(0, 8)}...${value.slice(-6)}` : value;
}

export function AppLayout() {
  const walletState = useWalletIdentity();
  const location = useLocation();
  const navigate = useNavigate();
  const mode: "advertiser" | "publisher" = location.pathname.startsWith("/publisher")
    ? "publisher"
    : "advertiser";

  return (
    <SidebarProvider>
      <div className="min-h-screen flex w-full">
        <AppSidebar mode={mode} />
        <div className="flex-1 flex flex-col min-w-0">
          <header className="h-14 flex items-center justify-between border-b border-border/50 px-4 glass">
            <div className="flex items-center gap-3">
              <SidebarTrigger className="text-muted-foreground hover:text-foreground" />
              <Select
                value={mode}
                onValueChange={(next) => {
                  navigate(next === "publisher" ? "/publisher/dashboard" : "/advertiser/dashboard");
                }}
              >
                <SelectTrigger className="w-[170px] h-9 border-primary/20 bg-background/40">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="advertiser">Campaigner</SelectItem>
                  <SelectItem value="publisher">Publisher</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="flex items-center gap-3">
              <div className="flex items-center gap-2 px-3 py-1.5 rounded-full glass text-xs font-mono text-muted-foreground">
                <span className="h-2 w-2 rounded-full bg-success animate-pulse-glow" />
                CKB Mainnet
              </div>
              <Button
                variant="outline"
                size="sm"
                className="gap-2 border-primary/30 text-primary hover:bg-primary/10"
                onClick={() => {
                  if (walletState.connected) {
                    void walletState.disconnect();
                    return;
                  }
                  void walletState.open();
                }}
              >
                <Wallet className="h-3.5 w-3.5" />
                {shorten(walletState.address)}
              </Button>
            </div>
          </header>
          <main className="flex-1 overflow-auto">
            <Outlet />
          </main>
        </div>
      </div>
    </SidebarProvider>
  );
}

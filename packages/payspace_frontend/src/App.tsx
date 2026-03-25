import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ccc } from "@ckb-ccc/connector-react";
import { BrowserRouter, Route, Routes } from "react-router-dom";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AppLayout } from "@/components/AppLayout";
import Index from "./pages/Index";
import AdvertiserOnboard from "./pages/AdvertiserOnboard";
import AdvertiserDashboard from "./pages/AdvertiserDashboard";
import AdvertiserPlacementDetail from "./pages/AdvertiserPlacementDetail";
import PublisherOnboard from "./pages/PublisherOnboard";
import PublisherDashboard from "./pages/PublisherDashboard";
import PublisherPlacementDetail from "./pages/PublisherPlacementDetail";
import PublisherNewPlacement from "./pages/PublisherNewPlacement";
import WalletPage from "./pages/WalletPage";
import NotFound from "./pages/NotFound";

const queryClient = new QueryClient();

const App = () => (
  <ccc.Provider>
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <Toaster />
        <Sonner />
        <BrowserRouter>
          <Routes>
            <Route element={<AppLayout />}>
              <Route path="/" element={<Index />} />
              <Route path="/advertiser/onboard" element={<AdvertiserOnboard />} />
              <Route path="/advertiser/dashboard" element={<AdvertiserDashboard />} />
              <Route path="/advertiser/placement/:placementId" element={<AdvertiserPlacementDetail />} />
              <Route path="/publisher/onboard" element={<PublisherOnboard />} />
              <Route path="/publisher/dashboard" element={<PublisherDashboard />} />
              <Route path="/publisher/placement/:placementId" element={<PublisherPlacementDetail />} />
              <Route path="/publisher/new-placement" element={<PublisherNewPlacement />} />
              <Route path="/wallet" element={<WalletPage />} />
            </Route>
            <Route path="*" element={<NotFound />} />
          </Routes>
        </BrowserRouter>
      </TooltipProvider>
    </QueryClientProvider>
  </ccc.Provider>
);

export default App;

import { Switch, Route, Router as WouterRouter, Redirect } from "wouter";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import NotFound from "@/pages/not-found";
import { Report } from "@/pages/report";
import { IcpSettings } from "@/pages/icp";
import { Qualify } from "@/pages/qualify";
import History from "@/pages/history";
import Job from "@/pages/job";
import Settings from "@/pages/settings";
import { MapsSearch } from "@/pages/maps";
import { Layout } from "@/components/layout";
import { useEffect } from "react";
import { setApiKey } from "@workspace/api-client-react";
import { getCrawlerApiKey } from "@/lib/crawlerAuth";

const queryClient = new QueryClient();

function AppInit() {
  useEffect(() => {
    const key = getCrawlerApiKey();
    if (key) setApiKey(key);
  }, []);
  return null;
}

function Router() {
  return (
    <Layout>
      <Switch>
        <Route path="/"><Redirect to="/maps" /></Route>
        <Route path="/report/:jobId" component={Report} />
        <Route path="/icp" component={IcpSettings} />
        <Route path="/qualify" component={Qualify} />
        <Route path="/maps" component={MapsSearch} />
        <Route path="/history" component={History} />
        <Route path="/job/:jobId" component={Job} />
        <Route path="/settings" component={Settings} />
        <Route component={NotFound} />
      </Switch>
    </Layout>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, "")}>
          <AppInit />
          <Router />
        </WouterRouter>
        <Toaster />
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;

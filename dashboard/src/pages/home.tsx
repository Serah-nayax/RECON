import { useState } from "react";
import { useLocation, Link } from "wouter";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { format } from "date-fns";
import { useStartCrawl, useListCrawlJobs, getListCrawlJobsQueryKey } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Slider } from "@/components/ui/slider";
import { useToast } from "@/hooks/use-toast";
import { Globe, Search, ArrowRight, Loader2, AlertCircle } from "lucide-react";

const crawlSchema = z.object({
  url: z.string().url({ message: "Please enter a valid URL." }),
  depth: z.number().min(1).max(3),
  maxPages: z.number().min(1).max(50),
});

export default function Home() {
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const startCrawl = useStartCrawl();
  const { data: crawlJobsData, isLoading: isLoadingJobs, error: jobsError } = useListCrawlJobs({
    query: {
      queryKey: getListCrawlJobsQueryKey(),
      refetchInterval: 5000,
    }
  });

  const form = useForm<z.infer<typeof crawlSchema>>({
    resolver: zodResolver(crawlSchema),
    defaultValues: {
      url: "",
      depth: 1,
      maxPages: 10,
    },
  });

  const onSubmit = (values: z.infer<typeof crawlSchema>) => {
    startCrawl.mutate(
      { data: values },
      {
        onSuccess: (res) => {
          queryClient.invalidateQueries({ queryKey: getListCrawlJobsQueryKey() });
          toast({
            title: "Crawl started",
            description: `Job ID: ${res.jobId}`,
          });
          setLocation(`/report/${res.jobId}`);
        },
        onError: (err) => {
          toast({
            title: "Failed to start crawl",
            description: err.message || "An unexpected error occurred.",
            variant: "destructive",
          });
        },
      }
    );
  };

  const getStatusBadge = (status: string) => {
    switch (status) {
      case "done":
        return <Badge className="bg-primary text-primary-foreground hover:bg-primary/80">DONE</Badge>;
      case "running":
        return <Badge variant="secondary" className="animate-pulse text-blue-400">RUNNING</Badge>;
      case "failed":
        return <Badge variant="destructive">FAILED</Badge>;
      case "pending":
      default:
        return <Badge variant="outline" className="text-muted-foreground">PENDING</Badge>;
    }
  };

  return (
    <div className="space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-500">
      <div>
        <h1 className="text-3xl font-mono font-bold tracking-tight mb-2">TARGET_ACQUISITION</h1>
        <p className="text-muted-foreground">Deploy crawler to extract business intelligence.</p>
      </div>

      <div className="grid gap-8 md:grid-cols-12">
        <Card className="md:col-span-5 border-muted/50 shadow-none bg-card/50 backdrop-blur">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-lg">
              <Globe className="h-5 w-5 text-primary" />
              New Crawl Target
            </CardTitle>
            <CardDescription>Enter the primary URL to begin signal extraction.</CardDescription>
          </CardHeader>
          <CardContent>
            <Form {...form}>
              <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
                <FormField
                  control={form.control}
                  name="url"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel className="font-mono text-xs text-muted-foreground uppercase">Target URL</FormLabel>
                      <FormControl>
                        <Input
                          placeholder="https://example.com"
                          className="bg-background/50 border-muted font-mono"
                          data-testid="input-url"
                          {...field}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <div className="grid grid-cols-2 gap-4">
                  <FormField
                    control={form.control}
                    name="depth"
                    render={({ field }) => (
                      <FormItem>
                        <div className="flex items-center justify-between">
                          <FormLabel className="font-mono text-xs text-muted-foreground uppercase">Depth</FormLabel>
                          <span className="text-xs font-mono text-primary">{field.value}</span>
                        </div>
                        <FormControl>
                          <Slider
                            min={1}
                            max={3}
                            step={1}
                            value={[field.value]}
                            onValueChange={(vals) => field.onChange(vals[0])}
                            className="py-2"
                            data-testid="slider-depth"
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  <FormField
                    control={form.control}
                    name="maxPages"
                    render={({ field }) => (
                      <FormItem>
                        <div className="flex items-center justify-between">
                          <FormLabel className="font-mono text-xs text-muted-foreground uppercase">Max Pages</FormLabel>
                          <span className="text-xs font-mono text-primary">{field.value}</span>
                        </div>
                        <FormControl>
                          <Slider
                            min={1}
                            max={50}
                            step={1}
                            value={[field.value]}
                            onValueChange={(vals) => field.onChange(vals[0])}
                            className="py-2"
                            data-testid="slider-max-pages"
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </div>

                <Button
                  type="submit"
                  className="w-full font-mono font-bold"
                  disabled={startCrawl.isPending}
                  data-testid="button-submit-crawl"
                >
                  {startCrawl.isPending ? (
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  ) : (
                    <Search className="mr-2 h-4 w-4" />
                  )}
                  INITIATE_CRAWL
                </Button>
              </form>
            </Form>
          </CardContent>
        </Card>

        <Card className="md:col-span-7 border-muted/50 shadow-none bg-card/50 backdrop-blur">
          <CardHeader>
            <CardTitle className="text-lg">Recent Operations</CardTitle>
            <CardDescription>Status of past intelligence gathering jobs.</CardDescription>
          </CardHeader>
          <CardContent>
            {isLoadingJobs ? (
              <div className="flex items-center justify-center p-8 text-muted-foreground">
                <Loader2 className="h-6 w-6 animate-spin mr-2" />
                <span className="font-mono text-sm">LOADING_RECORDS...</span>
              </div>
            ) : jobsError ? (
              <div className="flex flex-col items-center justify-center p-8 text-destructive">
                <AlertCircle className="h-8 w-8 mb-2" />
                <span className="text-sm">Failed to load operations history.</span>
              </div>
            ) : !crawlJobsData?.jobs || crawlJobsData.jobs.length === 0 ? (
              <div className="text-center p-8 text-muted-foreground border border-dashed border-muted rounded-lg">
                <p className="font-mono text-sm">NO_OPERATIONS_FOUND</p>
              </div>
            ) : (
              <div className="rounded-md border border-muted/50 overflow-hidden">
                <Table>
                  <TableHeader className="bg-muted/20">
                    <TableRow className="hover:bg-transparent">
                      <TableHead className="font-mono text-xs">TARGET</TableHead>
                      <TableHead className="font-mono text-xs w-[100px]">STATUS</TableHead>
                      <TableHead className="font-mono text-xs hidden sm:table-cell">INITIATED</TableHead>
                      <TableHead className="text-right font-mono text-xs w-[80px]">ACTION</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {crawlJobsData.jobs.map((job) => (
                      <TableRow
                        key={job.jobId}
                        className="group hover:bg-muted/20 cursor-pointer"
                        onClick={() => setLocation(`/report/${job.jobId}`)}
                        data-testid={`row-job-${job.jobId}`}
                      >
                        <TableCell className="font-medium">
                          <div className="truncate max-w-[200px] md:max-w-[300px]" title={job.url}>
                            {job.url}
                          </div>
                          <div className="text-xs text-muted-foreground font-mono mt-1 hidden sm:block">
                            ID: {job.jobId.substring(0, 8)}...
                          </div>
                        </TableCell>
                        <TableCell>
                          {getStatusBadge(job.status)}
                        </TableCell>
                        <TableCell className="text-muted-foreground text-xs hidden sm:table-cell">
                          {format(new Date(job.createdAt), "MMM d, HH:mm")}
                        </TableCell>
                        <TableCell className="text-right">
                          <Button variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground group-hover:text-primary transition-colors" asChild>
                            <Link href={`/report/${job.jobId}`} data-testid={`link-report-${job.jobId}`}>
                              <ArrowRight className="h-4 w-4" />
                            </Link>
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

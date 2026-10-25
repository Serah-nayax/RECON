export function getCrawlerApiKey(): string {
  if (typeof window === "undefined") return "";

  return (
    import.meta.env.VITE_CRAWLER_API_KEY ||
    window.localStorage.getItem("crawler_api_key") ||
    ""
  );
}
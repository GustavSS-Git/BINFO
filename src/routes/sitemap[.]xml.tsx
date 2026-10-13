import { createFileRoute } from "@tanstack/react-router";
import { byggSitemapXml } from "@/lib/sitemap";
import { hamtaSitemapDataFn } from "@/server/analysFn";

/**
 * `/sitemap.xml` — statiska sidor, `/brf`, områden med minst en förening och
 * varje listad förening med `lastmod`. Server-route (ingen React): datat
 * hämtas via serverfunktionen, så inga serverimporter når klientgrafen.
 * Edge-cachas på samma sätt som registersidorna.
 */
export const Route = createFileRoute("/sitemap.xml")({
  server: {
    handlers: {
      GET: async () => {
        const poster = await hamtaSitemapDataFn();
        return new Response(byggSitemapXml(poster), {
          headers: {
            "Content-Type": "application/xml; charset=utf-8",
            "Cache-Control": "public, s-maxage=3600, stale-while-revalidate=86400",
          },
        });
      },
    },
  },
});

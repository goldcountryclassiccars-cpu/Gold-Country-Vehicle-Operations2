import { PageSkeleton } from "@/components/skeleton";

/**
 * Shared loading boundary for every authenticated page.
 *
 * Two things happen once this file exists:
 *   1. A click paints a skeleton instantly instead of leaving the old page
 *      on screen looking frozen while the server works.
 *   2. Next.js can prefetch these dynamic routes up to their loading
 *      boundary, so the shell is often already in the client cache.
 *
 * Individual routes can override this with their own loading.tsx.
 */
export default function Loading() {
  return <PageSkeleton />;
}

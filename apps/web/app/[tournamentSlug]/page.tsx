import { redirect } from "next/navigation";
import { normalizeTournamentSlug } from "@/lib/boardId";

type TournamentRedirectPageProps = {
  params: Promise<{ tournamentSlug: string }>;
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
};

const buildQueryString = (searchParams?: Record<string, string | string[] | undefined>) => {
  if (!searchParams) return "";
  const qs = new URLSearchParams();
  for (const [key, value] of Object.entries(searchParams)) {
    if (key === "tab") continue;
    if (typeof value === "string") {
      if (value.trim()) {
        qs.set(key, value);
      }
    } else if (Array.isArray(value)) {
      const filtered = value.filter(item => typeof item === "string" && item.trim().length > 0) as string[];
      filtered.forEach(item => qs.append(key, item));
    }
  }
  const serialized = qs.toString();
  return serialized ? `?${serialized}` : "";
};

export default async function TournamentRedirectPage({
  params,
  searchParams,
}: TournamentRedirectPageProps) {
  const resolvedParams = await params;
  const resolvedSearchParams = searchParams ? await searchParams : undefined;
  const rawSlug = resolvedParams?.tournamentSlug ?? "";
  const tournamentSlug = normalizeTournamentSlug(rawSlug.trim());
  const queryString = buildQueryString(resolvedSearchParams);
  redirect(`/broadcast/${encodeURIComponent(tournamentSlug)}${queryString}`);
}

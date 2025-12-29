import { redirect } from "next/navigation";

type ReplayAliasPageProps = {
  params: Promise<{ boardId: string }>;
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
};

const buildQueryString = (searchParams?: Record<string, string | string[] | undefined>) => {
  if (!searchParams) return "";
  const qs = new URLSearchParams();
  for (const [key, value] of Object.entries(searchParams)) {
    if (typeof value === "string") {
      qs.set(key, value);
    } else if (Array.isArray(value)) {
      qs.delete(key);
      for (const item of value) {
        if (typeof item === "string") qs.append(key, item);
      }
    }
  }
  const serialized = qs.toString();
  return serialized ? `?${serialized}` : "";
};

export default async function ReplayAliasPage({ params, searchParams }: ReplayAliasPageProps) {
  const resolvedParams = await params;
  const resolvedSearchParams = searchParams ? await searchParams : undefined;
  const boardId = resolvedParams?.boardId ?? "";
  redirect(`/replay/${encodeURIComponent(boardId)}${buildQueryString(resolvedSearchParams)}`);
}

import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { headers } from "next/headers";
import {
  Archive,
  Heart,
  LayoutGrid,
  Menu,
  MessageCircle,
  Radio,
  Search,
  Users,
} from "lucide-react";
import InstallAppCard from "@/components/site/InstallAppCard";
import HomeSidebarFooterNav from "@/components/site/HomeSidebarFooterNav";
import SidebarToggleInput from "@/components/site/SidebarToggleInput";
import TournamentBannerCard from "@/components/site/TournamentBannerCard";
import { LiveViewer } from "@/components/viewer/LiveViewer";
import ReplayBoardPage from "@/app/replay/[boardId]/page";
import { DEFAULT_TOURNAMENT_SLUG, normalizeTournamentSlug } from "@/lib/boardId";
import { getTournamentImageBySlug } from "@/lib/tournamentImages";
import { TOURNAMENTS } from "@/lib/tournamentCatalog";
import {
  getTournamentBoardsForRound,
  getTournamentGameManifest,
  selectFeaturedBroadcast,
  type TournamentGame,
} from "@/lib/tournamentManifest";

export const metadata: Metadata = {
  title: "Chessviewlive",
  description: "Premium live + replay chess viewing with instant cloud eval.",
};

type HomeProps = {
  searchParams?: Record<string, string | string[] | undefined>;
};

type TournamentSummary = {
  slug: string;
  name: string;
  round: number;
  boardCount: number;
  topRating: number | null;
  topPlayer: string | null;
  heroImage?: string | null;
  flagCode?: string | null;
  roundLabel?: string | null;
  startsAt?: string | null;
  endsAt?: string | null;
  topPlayers?: Array<{ name: string; rating: number }>;
  isLive: boolean;
  isPast: boolean;
  status?: "Live" | "Ongoing" | "Completed" | "Upcoming";
};

type DiscoveryRound = {
  id: string;
  slug: string;
  name: string;
};

type DiscoveryItem = {
  tournament: {
    slug: string;
    name: string;
  };
  current: {
    kind: "live";
    round: DiscoveryRound;
  };
};

type DiscoveryResponse = {
  source: "discovery";
  fetchedAt?: string;
  items: DiscoveryItem[];
  error: string | null;
};

type BroadcastCardItem = {
  slug: string;
  name: string;
  roundLabel: string;
  timeLabel?: string | null;
  status: "Live" | "Ongoing" | "Completed" | "Upcoming";
  heroImage?: string | null;
  logoImage?: string | null;
  flagCode?: string | null;
  sortDateMs: number | null;
  isLive: boolean;
  isPast: boolean;
};

const resolveParam = (value?: string | string[]) => {
  if (Array.isArray(value)) return value[0];
  return value;
};

const getTopRatedPlayer = (games: TournamentGame[]) => {
  let topRating = 0;
  let topPlayer: string | null = null;

  games.forEach(game => {
    if (Number.isFinite(game.whiteRating) && game.whiteRating > topRating) {
      topRating = game.whiteRating;
      topPlayer = game.white;
    }
    if (Number.isFinite(game.blackRating) && game.blackRating > topRating) {
      topRating = game.blackRating;
      topPlayer = game.black;
    }
  });

  return {
    topRating: topRating > 0 ? topRating : null,
    topPlayer,
  };
};

const normalizeFilter = (value?: string): "all" | "current" | "past" | "top" => {
  const candidate = value?.toLowerCase() ?? "all";
  if (candidate === "current" || candidate === "past" || candidate === "top") return candidate;
  return "all";
};

const normalizeTournamentName = (value: string) =>
  value.replace(/[—–]/g, " ").replace(/\s+/g, " ").trim();

const formatStartDate = (iso: string) => {
  const date = new Date(iso);
  if (!Number.isFinite(date.getTime())) return null;
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  }).format(date);
};

const deriveBroadcastStatus = ({
  summary,
  discovery,
}: {
  summary: TournamentSummary | null;
  discovery: DiscoveryItem | null;
}): "Live" | "Ongoing" | "Completed" | "Upcoming" => {
  if (discovery?.current?.kind === "live") return "Live";
  if (summary?.status) return summary.status;
  if (summary?.isLive) return "Live";
  if (summary?.isPast) return "Completed";
  return "Upcoming";
};

const fetchDiscoveryLive = async (): Promise<DiscoveryResponse | null> => {
  try {
    const headerList = await headers();
    const host = headerList.get("host");
    const proto = headerList.get("x-forwarded-proto") ?? "http";
    const baseUrl = host ? `${proto}://${host}` : "http://localhost:3000";
    const res = await fetch(`${baseUrl}/api/discovery/live`, {
      next: { revalidate: 45 },
    });
    if (!res.ok) return null;
    const data = (await res.json()) as DiscoveryResponse;
    if (!data || !Array.isArray(data.items)) return null;
    return data;
  } catch {
    return null;
  }
};

export default async function Home({ searchParams }: HomeProps) {
  const sp = await Promise.resolve(searchParams as Record<string, string | string[] | undefined>);
  const filterParam = resolveParam(sp?.filter);
  const queryParam = resolveParam(sp?.q);
  const activeFilter = normalizeFilter(filterParam);
  const query = queryParam?.trim().toLowerCase() ?? "";
  const discoveryResponse = await fetchDiscoveryLive();
  const discoveryItems = discoveryResponse?.items ?? [];

  const summaries = TOURNAMENTS.map(tournament => {
    const boards = getTournamentBoardsForRound(tournament.slug, tournament.round) ?? [];
    const games = boards
      .map(board => getTournamentGameManifest(tournament.slug, tournament.round, board))
      .filter((game): game is TournamentGame => Boolean(game));
    const { topRating, topPlayer } = getTopRatedPlayer(games);
    const isLive = games.some(game => game.status === "live");
    const isPast = games.length > 0 && games.every(game => game.status === "final");

    return {
      ...tournament,
      boardCount: boards.length,
      topRating,
      topPlayer,
      isLive,
      isPast,
    } satisfies TournamentSummary;
  });

  const curatedBySlug = new Map(
    summaries.map(summary => [
      normalizeTournamentSlug(summary.slug, summary.slug),
      summary,
    ])
  );

  const discoveryBySlug = new Map<string, DiscoveryItem>();
  discoveryItems.forEach(item => {
    const normalizedSlug = normalizeTournamentSlug(item.tournament.slug, item.tournament.slug);
    if (!discoveryBySlug.has(normalizedSlug)) {
      discoveryBySlug.set(normalizedSlug, item);
    }
  });

  const mergedSlugs = new Set<string>([...curatedBySlug.keys(), ...discoveryBySlug.keys()]);
  const mergedBroadcasts: BroadcastCardItem[] = Array.from(mergedSlugs).map(slug => {
    const summary = curatedBySlug.get(slug) ?? null;
    const discovery = discoveryBySlug.get(slug) ?? null;
    const roundLabel =
      discovery?.current.round.name ??
      summary?.roundLabel ??
      `Round ${summary?.round ?? 1}`;
    const startsAt = summary?.startsAt ? new Date(summary.startsAt) : null;
    const endsAt = summary?.endsAt ? new Date(summary.endsAt) : null;
    const startsAtMs =
      startsAt && Number.isFinite(startsAt.getTime()) ? startsAt.getTime() : null;
    const endsAtMs =
      endsAt && Number.isFinite(endsAt.getTime()) ? endsAt.getTime() : null;
    const sortDateMs = startsAtMs ?? endsAtMs ?? null;
    const formattedStart = summary?.startsAt ? formatStartDate(summary.startsAt) : null;
    const timeLabel = discovery ? null : formattedStart ? `Starts ${formattedStart}` : null;
    const rawName = summary?.name ?? discovery?.tournament.name ?? slug;
    const tournamentImages = getTournamentImageBySlug(slug, rawName);
    const heroImage = tournamentImages.heroImage ?? null;
    const logoImage = tournamentImages.logoImage ?? null;
    const flagCode = tournamentImages.flagCode ?? null;
    const isLive = discovery ? true : summary?.isLive ?? false;
    const isPast = discovery ? false : summary?.isPast ?? false;
    const status = deriveBroadcastStatus({ summary, discovery });

    return {
      slug,
      name: normalizeTournamentName(rawName),
      roundLabel,
      timeLabel,
      status,
      heroImage,
      logoImage,
      flagCode,
      sortDateMs,
      isLive,
      isPast,
    };
  });

  const currentTournamentOrder = summaries
    .filter(summary => summary.isLive)
    .map(summary => summary.slug);
  const allTournamentOrder = summaries.map(summary => summary.slug);
  const featuredSelection = selectFeaturedBroadcast({
    tournamentOrder: allTournamentOrder,
    currentTournamentOrder,
  });

  const sortedBroadcasts = [...mergedBroadcasts].sort((a, b) => {
    if (a.isLive !== b.isLive) return a.isLive ? -1 : 1;
    const aDate = a.sortDateMs;
    const bDate = b.sortDateMs;
    if (a.isLive && b.isLive) {
      if (aDate == null && bDate != null) return -1;
      if (aDate != null && bDate == null) return 1;
    }
    if (aDate != null && bDate != null) return bDate - aDate;
    if (aDate != null) return -1;
    if (bDate != null) return 1;
    return a.slug.localeCompare(b.slug);
  });

  const filteredByStatus = sortedBroadcasts.filter(item => {
    if (activeFilter === "current") return item.isLive;
    if (activeFilter === "past") return item.isPast;
    return true;
  });
  const filteredBroadcasts = query
    ? filteredByStatus.filter(item =>
        item.name.toLowerCase().includes(query) || item.slug.includes(query)
      )
    : filteredByStatus;

  const filterLabelMap: Record<string, string> = {
    all: "All tournaments",
    current: "Current tournaments",
    past: "Past tournaments",
    top: "Top players",
  };

  const buildFilterHref = (filterKey: string) => {
    const params = new URLSearchParams();
    if (filterKey && filterKey !== "all") params.set("filter", filterKey);
    if (queryParam) params.set("q", queryParam);
    const queryString = params.toString();
    return queryString ? `/?${queryString}` : "/";
  };

  const featuredViewerParams = featuredSelection
    ? {
        boardId: featuredSelection.boardId,
        tournamentId: featuredSelection.tournamentSlug,
      }
    : null;
  return (
    <div className="min-h-screen bg-[#020817] text-slate-100">
      <div className="flex min-h-screen">
        <SidebarToggleInput className="peer sr-only" />
        <aside className="sticky top-0 self-start flex h-[100dvh] w-16 flex-col items-center overflow-y-auto border-r border-white/10 bg-[#030d1f]/90 px-2 py-2 transition-all duration-300 ease-out [&_.nav-item]:mx-auto [&_.nav-item]:h-11 [&_.nav-item]:w-11 [&_.nav-item]:justify-center [&_.nav-item]:gap-0 [&_.nav-item]:px-0 [&_.nav-item]:py-0 [&_.nav-item]:overflow-hidden [&_.install-card]:gap-0 [&_.install-card]:p-0 [&_.install-card-inner]:gap-0 [&_.install-card-inner]:p-0 [&_.install-cta]:hidden [&_.install-mark]:h-9 [&_.install-mark]:w-9 peer-checked:w-64 peer-checked:items-stretch peer-checked:px-3 peer-checked:[&_.nav-label]:opacity-100 peer-checked:[&_.nav-label]:translate-x-0 peer-checked:[&_.nav-label]:pointer-events-auto peer-checked:[&_.nav-label]:max-w-[12rem] peer-checked:[&_.nav-item]:mx-0 peer-checked:[&_.nav-item]:h-auto peer-checked:[&_.nav-item]:w-full peer-checked:[&_.nav-item]:gap-3 peer-checked:[&_.nav-item]:px-3 peer-checked:[&_.nav-item]:py-2 peer-checked:[&_.nav-item]:justify-start peer-checked:[&_.install-card]:px-0 peer-checked:[&_.install-card]:py-0 peer-checked:[&_.install-card-inner]:gap-1 peer-checked:[&_.install-card-inner]:px-3 peer-checked:[&_.install-card-inner]:pt-0 peer-checked:[&_.install-card-inner]:pb-2 peer-checked:[&_.install-cta]:flex peer-checked:[&_.install-cta]:w-full peer-checked:[&_.install-cta]:rounded-xl peer-checked:[&_.install-cta]:px-4 peer-checked:[&_.install-cta]:py-2 peer-checked:[&_.install-mark]:h-[140px] peer-checked:[&_.install-mark]:w-[140px]">
          <div className="flex flex-1 flex-col">
            <div className="pt-2">
              <div className="flex flex-col gap-1.5">
                <div className="hidden items-center justify-start px-1 peer-checked:flex">
                  <Link href="/" className="flex w-full items-center">
                    <Image
                      src="/brand/logo-full.png"
                      alt="Chessviewlive"
                      width={240}
                      height={64}
                      className="w-full max-w-[220px] h-auto drop-shadow-[0_0_18px_rgba(59,130,246,0.35)]"
                      priority
                    />
                  </Link>
                </div>
                <label
                  htmlFor="sidebar-toggle"
                  className="nav-item mt-5 flex items-center justify-center gap-3 rounded-2xl border border-white/10 bg-white/5 px-3 py-1.5 text-sm text-slate-300 transition hover:border-white/40"
                  aria-label="Toggle sidebar"
                >
                  <Menu className="h-5 w-5" aria-hidden />
                  <span className="nav-label pointer-events-none max-w-0 overflow-hidden opacity-0 translate-x-2 transition-all">
                    Menu
                  </span>
                </label>
              </div>

              <nav className="mt-3 space-y-4">
              {[
                { key: "all", label: "All tournaments", icon: LayoutGrid },
                { key: "current", label: "Current tournaments", icon: Radio },
                { key: "past", label: "Past tournaments", icon: Archive },
              ].map(item => {
                const isActive = activeFilter === item.key;
                const Icon = item.icon;
                return (
                  <Link
                    key={item.key}
                    href={buildFilterHref(item.key)}
                    className={`nav-item flex items-center justify-center gap-3 rounded-2xl border px-3 py-1.5 text-sm transition ${
                      isActive
                        ? "border-emerald-400/60 bg-emerald-400/10 text-white"
                        : "border-white/10 text-slate-300 hover:border-white/40 hover:text-white"
                    }`}
                    aria-current={isActive ? "page" : undefined}
                    title={item.label}
                  >
                    <Icon className="h-5 w-5" aria-hidden />
                    <span className="nav-label pointer-events-none max-w-0 overflow-hidden opacity-0 translate-x-2 transition-all">
                      {item.label}
                    </span>
                  </Link>
                );
              })}
              </nav>
            </div>

            <div className="flex flex-1 flex-col">
              <div className="flex-1" />
              <HomeSidebarFooterNav />
              <div className="flex-1" />
            </div>

            <div className="space-y-0 pt-2">
              <details className="group">
                <summary
                  className="nav-item flex cursor-pointer list-none items-center justify-center gap-3 rounded-2xl border border-white/10 bg-white/5 px-3 py-1 text-sm text-slate-300 transition hover:border-white/40 [&::-webkit-details-marker]:hidden"
                  title="Contact"
                >
                  <MessageCircle className="h-5 w-5" aria-hidden />
                  <span className="nav-label pointer-events-none max-w-0 overflow-hidden opacity-0 translate-x-2 transition-all">
                    Contact
                  </span>
                </summary>
                <div className="contact-menu max-h-0 overflow-hidden rounded-2xl border border-white/10 bg-[#050f22] p-0 text-xs text-slate-300 opacity-0 pointer-events-none transition group-open:mt-3 group-open:max-h-56 group-open:p-3 group-open:opacity-100 group-open:pointer-events-auto">
                  <Link
                    href="https://wa.me/"
                    target="_blank"
                    rel="noreferrer"
                    className="flex items-center justify-between rounded-xl border border-white/10 px-3 py-2 transition hover:border-white/40"
                  >
                    WhatsApp
                    <span className="text-[10px] uppercase tracking-[0.3em] text-slate-500">WA</span>
                  </Link>
                  <Link
                    href="mailto:hello@chessviewlive.com"
                    className="flex items-center justify-between rounded-xl border border-white/10 px-3 py-2 transition hover:border-white/40"
                  >
                    Email
                    <span className="text-[10px] uppercase tracking-[0.3em] text-slate-500">EM</span>
                  </Link>
                  <Link
                    href="#"
                    className="flex items-center justify-between rounded-xl border border-white/10 px-3 py-2 transition hover:border-white/40"
                  >
                    DM
                    <span className="text-[10px] uppercase tracking-[0.3em] text-slate-500">DM</span>
                  </Link>
                </div>
              </details>

              <div className="install-card-outer">
                <InstallAppCard markSrc="/brand/logo-mark.png" />
              </div>

              <Link
                href="/organizers"
                className="nav-item flex items-center justify-center gap-3 rounded-2xl border border-white/10 bg-white/5 px-3 py-1 text-sm text-slate-300 transition hover:border-white/40 hover:text-white"
                title="Organizers"
              >
                <Users className="h-5 w-5" aria-hidden />
                <span className="nav-label pointer-events-none max-w-0 overflow-hidden opacity-0 translate-x-2 transition-all">
                  Organizers
                </span>
              </Link>
            </div>
          </div>
        </aside>

        <main className="flex-1 min-h-screen px-4 py-4 lg:px-8">
          <div className="mx-auto grid w-full max-w-[1440px] gap-4">
            <section className="flex min-h-0 h-[calc(60dvh-0.6rem)] flex-col">
              <div className="flex min-h-0 flex-1 overflow-hidden rounded-3xl border border-white/10 bg-slate-950/70 shadow-xl ring-1 ring-white/5">
                {featuredViewerParams ? (
                  featuredSelection?.mode === "replay" ? (
                    <ReplayBoardPage
                      params={Promise.resolve(featuredViewerParams)}
                      viewerDensity="compact"
                      viewerVariant="mini"
                      liveUpdatesEnabled={false}
                    />
                  ) : (
                    <LiveViewer
                      boardId={featuredViewerParams.boardId}
                      tournamentId={featuredViewerParams.tournamentId}
                      density="compact"
                      variant="mini"
                      liveUpdatesEnabled={false}
                    />
                  )
                ) : (
                  <div className="flex h-full items-center justify-center px-6 text-center">
                    <p className="text-sm text-slate-300">No featured broadcast available yet.</p>
                  </div>
                )}
              </div>
            </section>

            <section className="flex min-h-0 flex-col overflow-hidden rounded-3xl border border-white/10 bg-slate-950/60 p-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="text-sm font-semibold text-white">Broadcasts</div>
                <form method="get" action="/" className="flex items-center gap-2">
                  {activeFilter !== "all" ? (
                    <input type="hidden" name="filter" value={activeFilter} />
                  ) : null}
                  <div className="flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-3 py-1.5">
                    <Search className="h-4 w-4 text-slate-400" aria-hidden />
                    <input
                      id="tournament-search"
                      name="q"
                      defaultValue={queryParam ?? ""}
                      placeholder="Search tournaments"
                      className="w-40 bg-transparent text-xs text-white placeholder:text-slate-500 outline-none"
                    />
                  </div>
                </form>
              </div>

              <div className="mt-1 flex-1 min-h-0">
                <div className="relative">
                  <div className="lg:pr-1">
                    <div className="grid auto-rows-fr gap-3 sm:grid-cols-2 lg:grid-cols-4">
                      {filteredBroadcasts.length > 0 ? (
                        filteredBroadcasts.map(item => {
                          const normalizedSlug = normalizeTournamentSlug(
                            item.slug,
                            DEFAULT_TOURNAMENT_SLUG
                          );

                          return (
                            <TournamentBannerCard
                              key={item.slug}
                              href={`/broadcast/${encodeURIComponent(normalizedSlug)}`}
                              name={item.name}
                              roundLabel={item.roundLabel}
                              timeLabel={item.timeLabel}
                              status={item.status}
                              heroImage={item.heroImage}
                              logoImage={item.logoImage}
                              flagCode={item.flagCode}
                              priority={item.slug === DEFAULT_TOURNAMENT_SLUG}
                            />
                          );
                        })
                      ) : (
                        <div className="rounded-2xl border border-white/10 bg-white/5 p-6 text-sm text-slate-300 sm:col-span-2 xl:col-span-3">
                          No tournaments match this filter yet.
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            </section>
          </div>
        </main>
      </div>
    </div>
  );
}

import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import {
  Archive,
  LayoutGrid,
  Menu,
  MessageCircle,
  Radio,
  Search,
  Trophy,
  Users,
} from "lucide-react";
import InstallAppCard from "@/components/site/InstallAppCard";
import TournamentHeroImage from "@/components/site/TournamentHeroImage";
import { LiveViewer } from "@/components/viewer/LiveViewer";
import ReplayBoardPage from "@/app/replay/[boardId]/page";
import { DEFAULT_TOURNAMENT_SLUG } from "@/lib/boardId";
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
  placeholderFlag?: string | null;
  roundLabel?: string | null;
  startsAt?: string | null;
  topPlayers?: Array<{ name: string; rating: number }>;
  isLive: boolean;
  isPast: boolean;
};

type TournamentConfig = {
  slug: string;
  name: string;
  round: number;
  heroImage?: string | null;
  placeholderFlag?: string | null;
  roundLabel?: string | null;
  startsAt?: string | null;
  topPlayers?: Array<{ name: string; rating: number }>;
};

const DEFAULT_ROUND = 1;
const TOURNAMENTS: TournamentConfig[] = [
  {
    slug: DEFAULT_TOURNAMENT_SLUG,
    name: "Worldcup 2025",
    round: DEFAULT_ROUND,
    roundLabel: "Round 1",
    startsAt: "2025-08-02T12:00:00Z",
    // Dev check: ensure /tournaments/worldcup2025/hero.jpg exists under /public.
    heroImage: "/tournaments/worldcup2025/hero.jpg",
    topPlayers: [
      { name: "Carlsen", rating: 2830 },
      { name: "Nepomniachtchi", rating: 2778 },
      { name: "Aronian", rating: 2765 },
      { name: "Firouzja", rating: 2760 },
      { name: "Caruana", rating: 2798 },
    ],
  },
  {
    slug: "candidates2026",
    name: "Candidates 2026",
    round: DEFAULT_ROUND,
    roundLabel: "Round 3",
    startsAt: "2026-03-12T14:00:00Z",
    placeholderFlag: "\uD83C\uDDEE\uD83C\uDDF3",
    topPlayers: [
      { name: "Praggnanandhaa", rating: 2766 },
      { name: "Nakamura", rating: 2775 },
      { name: "Abdusattorov", rating: 2768 },
      { name: "So", rating: 2757 },
    ],
  },
  {
    slug: "norway-chess-2026",
    name: "Norway Chess 2026",
    round: DEFAULT_ROUND,
    roundLabel: "Round 5",
    startsAt: "2026-05-18T12:00:00Z",
    placeholderFlag: "\uD83C\uDDF3\uD83C\uDDF4",
    topPlayers: [
      { name: "Carlsen", rating: 2830 },
      { name: "Firouzja", rating: 2760 },
      { name: "Gukesh", rating: 2765 },
      { name: "Caruana", rating: 2798 },
    ],
  },
  {
    slug: "tata-steel-2026",
    name: "Tata Steel 2026",
    round: DEFAULT_ROUND,
    roundLabel: "Round 7",
    startsAt: "2026-01-20T11:00:00Z",
    placeholderFlag: "\uD83C\uDDF3\uD83C\uDDF1",
    topPlayers: [
      { name: "Ding", rating: 2791 },
      { name: "Nepomniachtchi", rating: 2778 },
      { name: "Wei Yi", rating: 2759 },
      { name: "Aronian", rating: 2765 },
    ],
  },
  {
    slug: "grandprix-2025",
    name: "FIDE Grand Prix 2025",
    round: DEFAULT_ROUND,
    roundLabel: "Stage 2",
    startsAt: "2025-11-02T15:00:00Z",
    placeholderFlag: "\uD83C\uDDFA\uD83C\uDDF8",
    topPlayers: [
      { name: "So", rating: 2757 },
      { name: "Dominguez", rating: 2740 },
      { name: "Aronian", rating: 2765 },
      { name: "Duda", rating: 2750 },
    ],
  },
  {
    slug: "sinquefield-2025",
    name: "Sinquefield Cup 2025",
    round: DEFAULT_ROUND,
    roundLabel: "Round 4",
    startsAt: "2025-08-20T17:00:00Z",
    placeholderFlag: "\uD83C\uDDFA\uD83C\uDDF8",
    topPlayers: [
      { name: "Caruana", rating: 2798 },
      { name: "Nakamura", rating: 2775 },
      { name: "So", rating: 2757 },
      { name: "Aronian", rating: 2765 },
    ],
  },
  {
    slug: "us-championship-2025",
    name: "US Championship 2025",
    round: DEFAULT_ROUND,
    roundLabel: "Round 6",
    startsAt: "2025-10-05T16:00:00Z",
    placeholderFlag: "\uD83C\uDDFA\uD83C\uDDF8",
    topPlayers: [
      { name: "Nakamura", rating: 2775 },
      { name: "So", rating: 2757 },
      { name: "Sevian", rating: 2715 },
      { name: "Xiong", rating: 2705 },
    ],
  },
  {
    slug: "india-open-2025",
    name: "India Open 2025",
    round: DEFAULT_ROUND,
    roundLabel: "Round 2",
    startsAt: "2025-09-12T09:00:00Z",
    placeholderFlag: "\uD83C\uDDEE\uD83C\uDDF3",
    topPlayers: [
      { name: "Gukesh", rating: 2765 },
      { name: "Arjun", rating: 2751 },
      { name: "Vidit", rating: 2736 },
      { name: "Praggnanandhaa", rating: 2766 },
    ],
  },
  {
    slug: "qatar-masters-2025",
    name: "Qatar Masters 2025",
    round: DEFAULT_ROUND,
    roundLabel: "Round 8",
    startsAt: "2025-12-01T10:00:00Z",
    placeholderFlag: "\uD83C\uDDF6\uD83C\uDDE6",
    topPlayers: [
      { name: "Mamedyarov", rating: 2746 },
      { name: "Firouzja", rating: 2760 },
      { name: "Carlsen", rating: 2830 },
      { name: "Aronian", rating: 2765 },
    ],
  },
  {
    slug: "speed-chess-2025",
    name: "Speed Chess 2025",
    round: DEFAULT_ROUND,
    roundLabel: "Stage 1",
    startsAt: "2025-07-28T18:00:00Z",
    placeholderFlag: "\uD83C\uDDEC\uD83C\uDDE7",
    topPlayers: [
      { name: "Nakamura", rating: 2775 },
      { name: "Carlsen", rating: 2830 },
      { name: "Firouzja", rating: 2760 },
      { name: "So", rating: 2757 },
    ],
  },
];

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

const formatRelativeTime = (target: Date, now: Date = new Date()) => {
  const diffSeconds = Math.round((target.getTime() - now.getTime()) / 1000);
  const absSeconds = Math.abs(diffSeconds);
  const rtf = new Intl.RelativeTimeFormat("en", { numeric: "auto" });

  if (absSeconds < 60) return rtf.format(diffSeconds, "second");
  const diffMinutes = Math.round(diffSeconds / 60);
  if (Math.abs(diffMinutes) < 60) return rtf.format(diffMinutes, "minute");
  const diffHours = Math.round(diffMinutes / 60);
  if (Math.abs(diffHours) < 24) return rtf.format(diffHours, "hour");
  const diffDays = Math.round(diffHours / 24);
  if (Math.abs(diffDays) < 30) return rtf.format(diffDays, "day");
  const diffMonths = Math.round(diffDays / 30);
  if (Math.abs(diffMonths) < 12) return rtf.format(diffMonths, "month");
  const diffYears = Math.round(diffMonths / 12);
  return rtf.format(diffYears, "year");
};

export default function Home({ searchParams }: HomeProps) {
  const filterParam = resolveParam(searchParams?.filter);
  const queryParam = resolveParam(searchParams?.q);
  const activeFilter = normalizeFilter(filterParam);
  const query = queryParam?.trim().toLowerCase() ?? "";

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

  const currentTournamentOrder = summaries
    .filter(summary => summary.isLive)
    .map(summary => summary.slug);
  const allTournamentOrder = summaries.map(summary => summary.slug);
  const featuredSelection = selectFeaturedBroadcast({
    tournamentOrder: allTournamentOrder,
    currentTournamentOrder,
  });

  const filteredByStatus = summaries.filter(summary => {
    if (activeFilter === "current") return summary.isLive;
    if (activeFilter === "past") return summary.isPast;
    return true;
  });
  const filteredSummaries = query
    ? filteredByStatus.filter(summary =>
        summary.name.toLowerCase().includes(query) || summary.slug.includes(query)
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
        <input
          id="sidebar-toggle"
          type="checkbox"
          className="peer sr-only"
          defaultChecked
        />
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
              <div className="border-t border-white/10 pt-3">
                <Link
                  href={buildFilterHref("top")}
                  className={`nav-item flex items-center justify-center gap-3 rounded-2xl border px-3 py-1.5 text-sm transition ${
                    activeFilter === "top"
                      ? "border-emerald-400/60 bg-emerald-400/10 text-white"
                      : "border-white/10 text-slate-300 hover:border-white/40 hover:text-white"
                  }`}
                  aria-current={activeFilter === "top" ? "page" : undefined}
                  title="Top players"
                >
                  <Trophy className="h-5 w-5" aria-hidden />
                  <span className="nav-label pointer-events-none max-w-0 overflow-hidden opacity-0 translate-x-2 transition-all">
                    Top players
                  </span>
                </Link>
              </div>
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
                    />
                  ) : (
                    <LiveViewer
                      boardId={featuredViewerParams.boardId}
                      tournamentId={featuredViewerParams.tournamentId}
                      density="compact"
                      variant="mini"
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
              <div className="flex flex-wrap items-center justify-end gap-3">
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
                      {filteredSummaries.length > 0 ? (
                        filteredSummaries.map(summary => {
                          const roundLabel = summary.roundLabel ?? `Round ${summary.round}`;
                          const startsAt = summary.startsAt ? new Date(summary.startsAt) : null;
                          const hasValidStart =
                            startsAt && Number.isFinite(startsAt.getTime()) ? startsAt : null;
                          const timeLabel = hasValidStart
                            ? hasValidStart.getTime() > Date.now()
                              ? `Starts ${formatRelativeTime(hasValidStart)}`
                              : formatRelativeTime(hasValidStart)
                            : null;
                          const playerLine = summary.topPlayers?.length
                            ? summary.topPlayers
                                .map(player => `${player.name} ${player.rating}`)
                                .join(", ")
                            : null;

                          const placeholderFlag = summary.placeholderFlag ?? "\uD83C\uDFC6";

                          return (
                            <article
                              key={summary.slug}
                              className="flex h-full min-h-[176px] flex-col overflow-hidden rounded-2xl border border-white/10 bg-[#050f22] shadow-[0_18px_40px_rgba(2,8,23,0.45)]"
                            >
                              <div className="relative aspect-[16/6] w-full overflow-hidden bg-gradient-to-br from-slate-900 via-slate-950 to-black">
                                {summary.heroImage ? (
                                  <TournamentHeroImage
                                    src={summary.heroImage}
                                    alt={`${summary.name} banner`}
                                    sizes="(min-width: 1280px) 320px, (min-width: 640px) 45vw, 100vw"
                                    className="object-cover"
                                    priority={summary.slug === DEFAULT_TOURNAMENT_SLUG}
                                  />
                                ) : (
                                  <>
                                    <div className="absolute inset-0 bg-gradient-to-br from-slate-900 via-slate-950 to-black" />
                                    <div className="relative flex h-full w-full items-center justify-center">
                                      <span className="text-5xl drop-shadow-[0_12px_24px_rgba(2,6,23,0.5)]">
                                        {placeholderFlag}
                                      </span>
                                    </div>
                                  </>
                                )}
                              </div>
                              <div className="flex flex-1 flex-col p-2">
                                <div className="flex items-center justify-between gap-3 text-[11px] font-medium text-slate-400">
                                  <span className="tracking-[0.08em] text-slate-400">
                                    {roundLabel}
                                  </span>
                                  {timeLabel ? (
                                    <span className="text-slate-500">{timeLabel}</span>
                                  ) : null}
                                </div>
                                <h3 className="mt-1 text-base font-semibold text-white truncate">
                                  <Link
                                    href={`/t/${encodeURIComponent(summary.slug)}`}
                                    className="transition hover:text-white/90"
                                  >
                                    {summary.name}
                                  </Link>
                                </h3>
                                {playerLine ? (
                                  <p className="mt-1 text-[11px] text-slate-400 truncate">
                                    {playerLine}
                                  </p>
                                ) : null}
                              </div>
                            </article>
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

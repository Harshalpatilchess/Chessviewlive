import { BROADCASTS } from "@/lib/broadcasts/catalog";
import TournamentBannerCard from "@/components/site/TournamentBannerCard";
import { DEFAULT_TOURNAMENT_SLUG, normalizeTournamentSlug } from "@/lib/boardId";
import { getTournamentImageBySlug } from "@/lib/tournamentImages";

const normalizeTournamentName = (value: string) =>
  value.replace(/[—–]/g, " ").replace(/\s+/g, " ").trim();

export default function BroadcastsIndexPage() {
  return (
    <main className="min-h-screen bg-[#05070f] text-slate-100">
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_top,_rgba(56,189,248,0.12),_transparent_55%)]" />
      <div className="relative mx-auto w-full max-w-5xl px-4 py-12 sm:px-6 lg:px-8">
        <header className="mb-10">
          <p className="text-xs font-semibold uppercase tracking-[0.4em] text-slate-400">Broadcasts</p>
          <h1 className="mt-3 text-3xl font-semibold text-white sm:text-4xl">
            Curated live boards, polished for viewing
          </h1>
          <p className="mt-4 max-w-2xl text-sm text-slate-300">
            A focused index of premium tournament feeds, ready to open inside the broadcast hub.
          </p>
        </header>

        <section className="grid auto-rows-fr gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {BROADCASTS.map(tournament => {
            const normalizedSlug = normalizeTournamentSlug(
              tournament.slug,
              DEFAULT_TOURNAMENT_SLUG
            );
            const name = normalizeTournamentName(tournament.title);
            const tournamentImages = getTournamentImageBySlug(normalizedSlug, name);
            return (
              <TournamentBannerCard
                key={tournament.slug}
                href={`/broadcast/${encodeURIComponent(normalizedSlug)}`}
                name={name}
                roundLabel={`Round ${tournament.defaultRound}`}
                status={tournament.isLiveHint ? "Live" : "Upcoming"}
                heroImage={tournamentImages.heroImage ?? null}
                logoImage={tournamentImages.logoImage ?? null}
                flagCode={tournamentImages.flagCode ?? null}
                priority={tournament.slug === DEFAULT_TOURNAMENT_SLUG}
              />
            );
          })}
        </section>
      </div>
    </main>
  );
}

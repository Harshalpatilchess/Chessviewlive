import { StatusBar } from 'expo-status-bar';
import { StyleSheet, Text, View, FlatList, TouchableOpacity, useWindowDimensions, Modal, Pressable, Alert, TextInput, RefreshControl, ActivityIndicator, InteractionManager } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { type GameSummary } from '@chessview/core';
import { getDefaultRound, isGameOngoing, isGameFinished, computeTournamentState } from '../utils/roundSelection';
import { broadcastTheme } from '../theme/broadcastTheme';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { RootStackParamList } from '../navigation/types';
import { useIsFocused } from '@react-navigation/native';
import MiniBoard from '../components/MiniBoard';
import Capsule from '../components/Capsule';
import EngineBar from '../components/EngineBar';
import AboutModal from '../components/AboutModal';
import RoundSelectorCapsule from '../components/RoundSelectorCapsule';
import RoundSelectorSheet from '../components/RoundSelectorSheet';
import Sidebar from '../components/Sidebar';
import { memo, useState, useRef, useEffect, useMemo, useCallback } from 'react';
import { getSettings } from '../utils/settingsStorage';
import { lastDebugStats, TATA_STEEL_2026_SLUG, LICHESS_MASTERS_BROADCAST_ID } from '../services/tataSteel'; // Updated import
import { getLichessRoundId } from '../services/tataSteel';
import { usePollTournamentGames, getCachedGames } from '../hooks/usePollTournamentGames';
import { useGameClock } from '../hooks/useGameClock';
import { parsePgnToMainlineMoves } from '../utils/pgnUtils';
import { getSyncPreview, getSyncRoundUi, updateSyncRoundUi } from '../cache/memoryCache';
import { previewMemory } from '../cache/previewMemory'; // New Unified Memory
import { getTournamentPreview } from '../cache/previewMemory';
import { loadPreviewCache, getCachedPreview } from '../utils/previewCache';
import { saveTournamentPreview, saveRoundPreview } from '../cache/previewStore';
import { getRoundUiCache, saveRoundUiCache } from '../utils/roundUiCache';
import { resolveTournamentKey } from '../utils/resolveTournamentKey';


import { fetchBroadcastTournament, fetchBroadcastRound, BroadcastRoundMeta, fetchRoundPgn, parsePgnForRound } from '../services/lichessBroadcast';
import { OfficialSourceRegistry } from '../config/OfficialSourceRegistry'; // Added import
import { SHOW_OFFICIAL_FEED_ROW } from '../config/debugFlags';

const SHOW_ROUND_AUDIT_LOGS = __DEV__ && false; // Gated audit logs
const SHOW_DEBUG_BANNER = false; // Toggle to show/hide the red debug overlay



const PREVIEW_CACHE_PREFIX = 'previewFenCache:';

type RenderGame = GameSummary & { previewFen?: string; previewLastMove?: string };

const START_FEN = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
const FALLBACK_FEN = START_FEN;

// Performance Tracker (Shared between Screen and GameCard)
const PERF_TRACKER: Record<string, { mount: number; hydrate: number; logged: boolean }> = {};

type Props = NativeStackScreenProps<RootStackParamList, 'TournamentBoards'>;

type FilterType = 'ALL' | 'LIVE' | 'FINISHED';

// Fixed card height for getItemLayout optimization
const CARD_HEIGHT = 400; // Approximate: 16 (pad) + 30 (row) + 6 (gap) + 260 (board) + 6 (gap) + 30 (row) + 16 (pad)
const CARD_MARGIN = 16;
const ITEM_HEIGHT = CARD_HEIGHT + CARD_MARGIN;

// NOTE: useRoundRowFenAudit is defined below and used here


// Ensure we always have rounds 1..13 even if no games loaded
function getFallbackRounds(): number[] {
    return Array.from({ length: 13 }, (_, i) => 13 - i); // [13, 12, ... 1]
}

function normalizeName(name: string): string {
    return name.toLowerCase().replace(/[.,-]/g, ' ').replace(/\s+/g, ' ').trim().split(' ').sort().join(' ');
}

// Global Cache for Broadcast Metadata to avoid 16s fetch loop on cold start
const BROADCAST_META_CACHE: Record<string, BroadcastRoundMeta[]> = {};
const BROADCAST_META_INFLIGHT: Record<string, Promise<BroadcastRoundMeta[]>> = {};

function getUniqueRowKey(game: GameSummary): string {
    // Priority 1: Lichess Game ID (most stable)
    if ((game as any).lichessGameId) return (game as any).lichessGameId;
    if (game.gameId) return game.gameId;

    // Priority 2: Composite Key (Round + Players)
    const r = game.round ?? 'ur';
    // Use raw names if available, fall back to anything unique
    const w = game.whiteName ? normalizeName(game.whiteName) : 'white';
    const b = game.blackName ? normalizeName(game.blackName) : 'black';
    return `${r}-${w}-${b}`;
}

function useNowTicker(enabled: boolean) {
    const [now, setNow] = useState(Date.now());
    useEffect(() => {
        if (!enabled) return;
        const interval = setInterval(() => {
            setNow(Date.now());
        }, 1000);
        return () => clearInterval(interval);
    }, [enabled]);
    return now;
}

export default function TournamentBoardsScreen({ route, navigation }: Props) {
    const { tournamentSlug: rawSlug, tournamentId, initialRound, snapshot } = route.params;
    // Fallback name if passed param is missing (shouldn't happen with new typing but safe)
    const tournamentName = route.params.tournamentName || snapshot?.name || '';

    // [SYNC_PREVIEW_INIT] Synchronous read to ensure instant rendering (User Request B.1)
    // CANONICAL KEY RESOLUTION
    const canonicalKey = resolveTournamentKey(route.params);
    const tournamentSlug = canonicalKey; // Override local usage variable

    // Log once
    useEffect(() => {
        console.log(`[SCREEN_KEY] tKey=${canonicalKey} round=${initialRound}`);
    }, []);

    // Resolving Round ID for Universal Cache
    // We might not have broadcastRounds immediately on first render if strictly fetching.
    // BUT we might have it from `route.params` if passed, or we just rely on "tata-steel" legacy key for first frame,
    // and then switch to round-precise key once available. 
    // Actually, `previewMemory` is sync.
    // Let's rely on the `mergedGames` computation to look up dynamically.

    const [roundIdMap, setRoundIdMap] = useState<Record<number, string>>({});



    // Track if user has manually changed the round
    const hasUserSelectedRound = useRef(false);

    // STATE REORDERING: Define selectedRound BEFORE hook to pass it as optimization param.
    // Use Synchronous Cache to initialize it intelligently without waiting for hook return.
    const [selectedRound, setSelectedRound] = useState<number | null>(() => {
        if (initialRound) {
            hasUserSelectedRound.current = true;
            return initialRound;
        }

        // TATA STEEL OVERRIDE (SAFEGUARD):
        // If initialRound was NOT passed, logic falls back to cache/default.
        // We removed the hardcoded '7' override to ensure we respect Home logic.
        // If Home logic fails to pass round, we will calculate it here.

        // Try Memory Cache
        const cached = getCachedGames(tournamentSlug);
        if (cached && cached.length > 0) {
            const dummyTournament = { slug: tournamentSlug, rounds: snapshot?.rounds || 13, status: snapshot?.status || 'ONGOING' } as any;
            const state = computeTournamentState(dummyTournament, cached, Date.now());
            return state.selectedRound;
        }

        return null;
    });

    // [PROGRESSIVE_MOUNT]
    // Start with 0 or small number to render list skeleton/text instantly
    // Then increment to fill in boards.
    const [boardsReadyCount, setBoardsReadyCount] = useState(100);

    // Progressive mounting removed for instant preview


    // FEN Backfill Cache (Key -> { fen, lastMove })
    // We store computed FENs here so we don't re-parse constantly


    // Force re-render of FlatList when previews arrive
    const [previewsVersion, setPreviewsVersion] = useState(0);

    // [ROUND_UI_CACHE] State for instant render
    // SYNCHRONOUS INITIALIZATION from Memory Cache
    const [uiCacheGames, setUiCacheGames] = useState<GameSummary[]>(() => {
        if (selectedRound && tournamentSlug) {
            const mem = getSyncRoundUi(tournamentSlug, selectedRound);
            if (mem) {
                if (__DEV__) console.log(`[ROUND_UI_CACHE] Sync Hit from MemoryCache for R${selectedRound}`);
                return mem as unknown as GameSummary[];
            }
        }
        return [];
    });

    // [ROUND_UI_CACHE] Async Fallback / Update on Round Change
    useEffect(() => {
        // If we switched rounds, we might not have it in state key if state not reset?
        // Actually, key={selectedRound} on component would be better? 
        // But we are in one screen.

        // Try sync get first (for update case)
        if (selectedRound) {
            const mem = getSyncRoundUi(tournamentSlug, selectedRound);
            if (mem) {
                setUiCacheGames(mem as unknown as GameSummary[]);
            } else {
                setUiCacheGames([]); // clear stale
                // Fallback to async check (legacy utils still work as fallback)
                getRoundUiCache(tournamentSlug, selectedRound).then(cached => {
                    if (cached && cached.length > 0) {
                        setUiCacheGames(cached as unknown as GameSummary[]);
                        // Also update memory maps if we found anything
                        updateSyncRoundUi(tournamentSlug, selectedRound, cached);
                        if (__DEV__) console.log(`[ROUND_UI_CACHE] Async Loaded ${cached.length} games for R${selectedRound}`);
                    }
                });
            }
        } else {
            setUiCacheGames([]);
        }
    }, [selectedRound, tournamentSlug]);

    const isFocused = useIsFocused();



    // State to break polling cycle: Check status asynchronously derived from games
    const [stopPollingForRound, setStopPollingForRound] = useState(() => {
        if (!selectedRound) return false;
        // Optimization: Check synchronous cache first
        const cached = getCachedGames(tournamentSlug);
        const roundGames = cached.filter(g => {
            const gr = typeof g.round === 'string' ? parseInt(g.round, 10) : g.round;
            return gr === selectedRound;
        });
        if (roundGames.length > 0) {
            return roundGames.every(g => (g.whiteResult && g.blackResult) || (g as any).status === 'Finished');
        }
        return false;
    });

    const pollOptions = useMemo(() => ({
        enabled: true,
        selectedRound: selectedRound,
        pollingEnabled: isFocused && !stopPollingForRound && !route.params.initialPreviewMap?.[Object.keys(route.params.initialPreviewMap || {})[0]]?.result
    }), [selectedRound, isFocused, stopPollingForRound, route.params.initialPreviewMap]);

    // Lichess Broadcast Integration State
    const [broadcastRounds, setBroadcastRounds] = useState<BroadcastRoundMeta[]>([]);
    const [broadcastGames, setBroadcastGames] = useState<GameSummary[]>([]);

    // Update Round ID Map when broadcast rounds arrive
    useEffect(() => {
        if (broadcastRounds && broadcastRounds.length > 0) {
            const map: Record<number, string> = {};
            broadcastRounds.forEach(r => {
                // Extract number
                const rNum = parseInt(r.slug?.match(/(\d+)/)?.[1] || r.name.match(/\d+/)?.[0] || '0', 10);
                if (rNum > 0 && r.id) map[rNum] = r.id;
            });
            setRoundIdMap(map);
        }
    }, [broadcastRounds]);

    // [UNIVERSAL_CACHE_LOAD] Ensure Round Preview Memory is Loaded
    useEffect(() => {
        if (selectedRound) {
            // Priority 1: RoundId
            if (roundIdMap[selectedRound]) {
                const rId = roundIdMap[selectedRound];
                previewMemory.ensureRoundPreviewInMemory(rId).then(() => {
                    setPreviewsVersion(v => v + 1);
                });
            } else {
                // Priority 2: Fallback (Universal)
                // We fake a roundID that matches our fallback logic: "Fallback:${tournamentSlug}:${selectedRound}"
                // The memory logic triggers "previewFenByRound:Fallback:..." which is what we want.
                const fallbackId = `Fallback:${tournamentSlug}:${selectedRound}`;
                previewMemory.ensureRoundPreviewInMemory(fallbackId).then(() => {
                    setPreviewsVersion(v => v + 1);
                });
            }
        }
    }, [selectedRound, roundIdMap, tournamentSlug]);

    const { games: polledGames, refresh, isRefreshing, isHydrated, ensureRoundLoaded, loadingRound, failedRounds } = usePollTournamentGames(tournamentSlug, 15000, pollOptions);

    // [CLOCK TICKER] Global per-screen ticker
    // Only run if round is active AND we have live games? 
    // Actually, simple rule: if round NOT finished, we might have live games.
    // Better: Check if ANY game in displayGames is live?
    // We can't access displayGames here fully yet (it's defined below).
    // But we have `games` and `broadcastGames`.
    // Let's define `shouldTickClocks` derived from state below, but `useNowTicker` is called here.
    // React rules: hooks must be top level. 
    // We can pass `false` initially and update? No, hooks order.
    // We'll compute a preliminary "hasLive" based on `games`?
    // Or just move `useNowTicker` down? No, hooks must be at top level.
    // We can compute `isRoundLive` from `selectedRound` + `broadcastRounds` here safely?

    // Quick heuristic: If we have ANY live game in our data, run ticker.
    const hasLiveGames = useMemo(() => {
        if (!polledGames) return false;
        return polledGames.some(g => g.isLive);
    }, [polledGames]);

    const shouldTickClocks = hasLiveGames;

    const nowTicker = useNowTicker(shouldTickClocks);



    // Stable Games Logic: Never clear list on temporary fetch gaps
    const [stableGames, setStableGames] = useState<GameSummary[]>([]);
    useEffect(() => {
        if (polledGames.length > 0) {
            setStableGames(polledGames);
        }
    }, [polledGames]);

    const games = polledGames.length > 0 ? polledGames : stableGames;

    // EFFECT: Initial Load Tracking
    useEffect(() => {
        if (selectedRound) {
            if (SHOW_ROUND_AUDIT_LOGS) {
                console.log(`[ROUND_PREVIEW_ENTER] roundId=${selectedRound}`);
            }

            // PRELOAD PREVIEW CACHE
            loadPreviewCache(tournamentSlug, selectedRound).then(() => {
                // Force re-render once cache is loaded
                setPreviewsVersion(v => v + 1);
            });

            // Universal Cache Pre-warm
            const rId = roundIdMap[selectedRound];
            if (rId) {
                previewMemory.ensureRoundPreviewInMemory(rId).then(() => {
                    setPreviewsVersion(v => v + 1);
                });
            } else {
                const fallbackId = `Fallback:${tournamentSlug}:${selectedRound}`;
                previewMemory.ensureRoundPreviewInMemory(fallbackId).then(() => {
                    setPreviewsVersion(v => v + 1);
                });
            }
        }
    }, [selectedRound, tournamentSlug, roundIdMap]);


    // OPEN LOGGING (Mount only)
    useEffect(() => {
        console.log(`TOURNAMENT_OPEN ${tournamentSlug}, initialParam=${initialRound}, selected=${selectedRound}, now=${Date.now()}`);
    }, []);





    const [filter, setFilter] = useState<FilterType>('ALL');



    // Derived effect to update polling status (Defined here after dependencies are ready)
    useEffect(() => {
        if (!selectedRound) return;

        // 1. Check Broadcast Metadata
        const roundMeta = broadcastRounds?.find(r => r.name.includes(`${selectedRound}`) || r.slug?.endsWith(`${selectedRound}`));
        if (roundMeta?.finished) {
            if (!stopPollingForRound) setStopPollingForRound(true);
            return;
        }

        // 2. Check Games
        const roundGames = games.filter(g => {
            const gr = typeof g.round === 'string' ? parseInt(g.round, 10) : g.round;
            return gr === selectedRound;
        });

        if (roundGames.length > 0) {
            const allFinished = roundGames.every(g =>
                (g.whiteResult && g.blackResult) || (g as any).status === 'Finished'
            );
            if (allFinished !== stopPollingForRound) {
                setStopPollingForRound(allFinished);
            }
        }
    }, [selectedRound, games, broadcastRounds, stopPollingForRound]);

    // Adapter for safe access
    const getSafeBroadcastRounds = () => broadcastRounds || [];

    // ...

    // ...


    const [menuDropdownVisible, setMenuDropdownVisible] = useState(false);
    const [overflowDropdownVisible, setOverflowDropdownVisible] = useState(false);
    const [isSearchMode, setIsSearchMode] = useState(false);
    const [searchQuery, setSearchQuery] = useState('');
    const [debouncedSearchQuery, setDebouncedSearchQuery] = useState('');
    const [showTitleTooltip, setShowTitleTooltip] = useState(false);
    const [liveGamesFilter, setLiveGamesFilter] = useState(false);
    const [countryGamesFilter, setCountryGamesFilter] = useState(false);
    const [flipBoards, setFlipBoards] = useState(false);
    const [selectedCountry, setSelectedCountry] = useState<string>('IN'); // Default to India
    const [aboutModalVisible, setAboutModalVisible] = useState(false);
    const [roundSelectorVisible, setRoundSelectorVisible] = useState(false);
    const [sidebarVisible, setSidebarVisible] = useState(false);

    const searchInputRef = useRef<TextInput>(null);
    const flatListRef = useRef<FlatList>(null);

    // Compute available rounds from games data OR tournament metadata
    const availableRounds = useMemo(() => {
        // 1. Try to get total rounds from metadata
        const totalRounds = snapshot?.rounds || 13; // default to 13 if unknown, but better to use metadata

        // If we have metadata, just generate 1..Total
        // This satisfies requirement: "(a) show ALL rounds in the dropdown (R1..R13)"
        if (snapshot?.rounds) {
            return Array.from({ length: snapshot.rounds }, (_, i) => snapshot.rounds - i); // Descending: [13, 12, ... 1]
        }

        // 2. Fallback: Derive from games if metadata missing
        const roundsSet = new Set<number>();
        games.forEach(game => {
            if (game.round !== undefined && game.round !== null) {
                const roundNum = typeof game.round === 'string' ? parseInt(game.round, 10) : game.round;
                if (!isNaN(roundNum) && roundNum > 0) {
                    roundsSet.add(roundNum);
                }
            }
        });

        // 3. Fallback to default if no games and no metadata
        if (roundsSet.size === 0) {
            return getFallbackRounds();
        }

        // If we only have derived rounds, we might miss empty rounds.
        // Let's take max round and fill gaps? Requirement says "Do NOT default unknown rounds to LIVE".
        // It says "Derive totalRounds from tournament metadata... Else compute from Baseline games: max(roundNumber)... then create roundNumbers = 1..maxRound"
        const maxR = Math.max(...Array.from(roundsSet));
        return Array.from({ length: maxR }, (_, i) => maxR - i); // Descending
    }, [games, snapshot]);

    // Track if user has manually changed the round (Defined above)

    // Initial Broadcast Metadata Fetch (Determine Default Round)
    useEffect(() => {
        // If we have an initialRound param, we respect it and skip auto-detection override
        if (initialRound) return;

        // Fetch Broadcast Config if possible (Universal Support)
        // if (tournamentSlug !== TATA_STEEL_2026_SLUG) return; // Removed strict check

        // Fetch Broadcast Config
        const loadBroadcast = async () => {
            // We need the broadcast ID. For Tata Steel 2026 it's known. 
            // Ideally passed in or looked up.
            const broadcastId = LICHESS_MASTERS_BROADCAST_ID;
            const data = await fetchBroadcastTournament(broadcastId);

            if (data && data.rounds && Array.isArray(data.rounds)) {
                const safeRounds = data.rounds;
                setBroadcastRounds(safeRounds);

                if (__DEV__) console.log(`[Broadcast] Loaded ${safeRounds.length} rounds.`);

                // Determine BEST round from Broadcast data (Live > Finished > Upcoming)
                const now = Date.now();
                let bestRoundNum = 1;

                // 1. Check for LIVE (Started & Not Finished) or STARTING SOON (Active)
                // Note: 'finished' is boolean. 'startsAt' is timestamp.

                // Sort rounds by number (implied index)
                // Lichess rounds array is usually ordered.

                const activeRound = data.rounds.find(r => !r.finished && r.startsAt && r.startsAt < now + 60 * 60 * 1000);
                // Logic: If round started (startsAt < now) and not finished -> LIVE
                // OR if round starts really soon (upcoming in 1h), might as well show it.

                const lastFinished = [...data.rounds].reverse().find(r => r.finished);

                if (activeRound) {
                    // Extract number
                    bestRoundNum = parseInt(activeRound.slug || activeRound.name.match(/\d+/)?.[0] || '1');
                    if (__DEV__) console.log(`[Broadcast] Defaulting to LIVE/ACTIVE Round ${bestRoundNum}`);
                } else if (lastFinished) {
                    bestRoundNum = parseInt(lastFinished.slug || lastFinished.name.match(/\d+/)?.[0] || '1');
                    if (__DEV__) console.log(`[Broadcast] Defaulting to LAST FINISHED Round ${bestRoundNum}`);
                } else {
                    // Upcoming?
                    const nextUpcoming = data.rounds.find(r => r.startsAt && r.startsAt > now);
                    if (nextUpcoming) {
                        bestRoundNum = parseInt(nextUpcoming.slug || nextUpcoming.name.match(/\d+/)?.[0] || '1');
                        if (__DEV__) console.log(`[Broadcast] Defaulting to NEXT UPCOMING Round ${bestRoundNum}`);
                    }
                }

                // Update selection if we haven't selected manually
                if (!hasUserSelectedRound.current) {
                    setSelectedRound(bestRoundNum);
                }
            }
        };

        loadBroadcast();
        loadBroadcast();
    }, [tournamentSlug, initialRound]);

    const missingMetadataLogRef = useRef<Set<string>>(new Set());




    // Live Polling Effect (When Round Selected)
    useEffect(() => {
        if (!selectedRound) {
            setBroadcastGames([]);
            return;
        }

        // MVP: Do not poll if round is already finished
        if (stopPollingForRound) {
            return;
        }

        let isMounted = true;
        const roundNum = selectedRound;

        const pollLive = async () => {
            if (!isMounted) return;

            // Resolve Round ID
            let roundId = '';
            // Try looking up in broadcastRounds
            const currentRounds = broadcastRounds || [];
            let roundMeta = currentRounds.find(r => r.name.includes(`Round ${roundNum}`) || r.slug.endsWith(`${roundNum}`));

            if (!roundMeta) {
                // Log once per round
                const logKey = `${tournamentSlug}-R${roundNum}`;
                if (!missingMetadataLogRef.current.has(logKey)) {
                    missingMetadataLogRef.current.add(logKey);
                    if (__DEV__) console.log(`[BroadcastPoll] No metadata for R${roundNum} yet.`);
                }
                return;
            }
            roundId = roundMeta.id;

            // Fetch
            const liveGames = await fetchBroadcastRound(roundId);
            if (isMounted && liveGames.length > 0) {
                setBroadcastGames(liveGames);
                // Log success
                if (__DEV__) console.log(`[BroadcastPoll] Updated ${liveGames.length} games for R${roundNum}`);
            }
        };

        // Poll immediately and then interval
        pollLive();

        // Polling interval: 5s
        const interval = setInterval(pollLive, 5000);

        return () => {
            isMounted = false;
            clearInterval(interval);
        };
    }, [selectedRound, tournamentSlug, broadcastRounds, stopPollingForRound]);


    // EFFECT: Update round when games first load (Async/Disk Cache case) or Hydration completes
    // AND: Auto-switch round if live games appear/change, provided user hasn't manually selected.

    useEffect(() => {
        if (!isHydrated) return;

        // If we haven't selected ANY round yet (hydration just finished):
        if (selectedRound === null) {
            const dummyTournament = { slug: tournamentSlug, rounds: snapshot?.rounds || 13, status: snapshot?.status || 'ONGOING' } as any;
            const state = computeTournamentState(dummyTournament, games, Date.now());
            setSelectedRound(state.selectedRound);
            if (__DEV__) console.log(`[HydrationGate] isHydrated=true -> selecting R${state.selectedRound} (${state.debugSource})`);
            return;
        }

        // Auto-switch logic (if not manually overridden)
        if (!hasUserSelectedRound.current) {
            const dummyTournament = { slug: tournamentSlug, rounds: snapshot?.rounds || 13, status: snapshot?.status || 'ONGOING' } as any;
            const state = computeTournamentState(dummyTournament, games, Date.now());

            // Only update if it changed
            if (state.selectedRound !== selectedRound) {
                // Heuristic: only auto-switch if the new round is LIVE or we are clearly stale.
                // The computeTournamentState already prefers LIVE.
                // If previously we were on R6 (finished) and R7 becomes LIVE, state.selectedRound will be 7.
                // If previously on R6 (finished) and R7 (finished) loads? We switch to R7.
                // This adheres to "Default selected round = liveRound ?? latestFinished".

                setSelectedRound(state.selectedRound);
                if (__DEV__) console.log(`[AutoSwitch] switching R${selectedRound}->R${state.selectedRound} source=${state.debugSource}`);
            }
        }
    }, [games, isHydrated, snapshot]); // Re-run whenever games update

    // Periodic Revalidator (Lightweight, every 30s)
    // Ensures status labels "In X min" update, and checks for live games if polling is slow/off
    useEffect(() => {
        if (!isHydrated) return;

        const interval = setInterval(() => {
            if (hasUserSelectedRound.current) return;

            const dummyTournament = { slug: tournamentSlug, rounds: snapshot?.rounds || 13, status: snapshot?.status || 'ONGOING' } as any;
            // Note: 'games' is closed over from render scope, might be stale if strict deps used?
            // Actually 'games' changes often so this effect would re-mount.
            // Better to just let the main effect handle 'games' changes.
            // This interval is more for time-based updates (In X min) if we stored status in state.
            // But status is computed in render. So we just need to force re-render?
            // Actually, we need to check if we should SWITCH round due to time? 
            // Valid switch: "In X min" changed? No, round selection is simpler now.
            // The only time-based switch was "upcoming", but we removed that.
            // So this interval might barely be needed for round switching, just re-render.
            // But we can keep it to log status.

            const state = computeTournamentState(dummyTournament, games, Date.now());
            if (state.selectedRound !== selectedRound && !hasUserSelectedRound.current) {
                setSelectedRound(state.selectedRound);
                if (__DEV__) console.log(`[TimerReval] auto-switching R${state.selectedRound}`);
            }
        }, 30000);
        return () => clearInterval(interval);
    }, [games, isHydrated, snapshot, selectedRound]);

    // Trigger lazy load when round selected (Placed here to access selectedRound safeley)
    useEffect(() => {
        if (isHydrated && selectedRound !== null) {
            ensureRoundLoaded(selectedRound);
        }
    }, [selectedRound, isHydrated, ensureRoundLoaded]);

    // Load selected country from settings
    useEffect(() => {
        loadSelectedCountry();
    }, []);

    // Reload settings when screen gains focus (e.g., returning from Settings)
    useEffect(() => {
        const unsubscribe = navigation.addListener('focus', () => {
            loadSelectedCountry();
        });
        return unsubscribe;
    }, [navigation]);

    const loadSelectedCountry = async () => {
        const settings = await getSettings();
        setSelectedCountry(settings.selectedCountry);
    };

    // Auto-focus search input when entering search mode
    useEffect(() => {
        if (isSearchMode && searchInputRef.current) {
            searchInputRef.current.focus();
        }
    }, [isSearchMode]);

    // Debounce search query for performance (150ms delay)
    useEffect(() => {
        const timer = setTimeout(() => {
            setDebouncedSearchQuery(searchQuery);
        }, 150);

        return () => clearTimeout(timer);
    }, [searchQuery]);

    // Helper to calculate search match score for a game
    const getSearchScore = (game: GameSummary, query: string): number => {
        if (!query) return 0;

        const lowerQuery = query.toLowerCase();
        const whiteName = game.whiteName.toLowerCase();
        const blackName = game.blackName.toLowerCase();

        let score = 0;

        // Check white player
        const whiteStartsWith = whiteName.startsWith(lowerQuery);
        const whiteContains = whiteName.includes(lowerQuery);

        // Check black player
        const blackStartsWith = blackName.startsWith(lowerQuery);
        const blackContains = blackName.includes(lowerQuery);

        // Scoring:
        // - Exact prefix match: 100 points
        // - Contains match: 50 points
        // - Both players match: bonus multiplier

        if (whiteStartsWith) score += 100;
        else if (whiteContains) score += 50;

        if (blackStartsWith) score += 100;
        else if (blackContains) score += 50;

        if ((whiteStartsWith || whiteContains) && (blackStartsWith || blackContains)) {
            score *= 1.5;
        }

        return score;
    };


    // 0. STRICT ROUND FILTER (Single Source of Truth)
    const roundGames = useMemo(() => {
        let source = games;

        // [ROUND_UI_CACHE] Fallback to cache if main games list is empty
        // We only use cache if we have nothing better, to avoid overwriting fresh data with stale cache
        if ((!games || games.length === 0) && uiCacheGames.length > 0) {
            source = uiCacheGames;
        }

        if (!source) return [];
        if (selectedRound === null) return [];

        const filtered = source.filter(g => {
            const r = (g.round !== undefined && g.round !== null)
                ? (typeof g.round === 'string' ? parseInt(g.round, 10) : g.round)
                : -1;
            return r === selectedRound;
        });

        // Loophole: If `games` is present but has 0 games for this round (e.g. partial fetch mismatch?),
        // AND we have cache?
        // Actually, if `games` is non-empty but the filter result is empty, it usually means
        // we successfully loaded the tournament but this round is empty?
        // OR it means we haven't loaded this round yet (if using granular loading)?
        // Current hook `usePollTournamentGames` loads ALL games or specific round.
        // If `games` is populated, it's usually the whole thing or a "fresh" snapshot.
        // If filter is empty, it might be safer to fallback to cache too?
        if (filtered.length === 0 && uiCacheGames.length > 0) {
            return uiCacheGames.filter(g => {
                const r = (g.round !== undefined && g.round !== null)
                    ? (typeof g.round === 'string' ? parseInt(g.round, 10) : g.round)
                    : -1;
                return r === selectedRound;
            });
        }

        return filtered;
    }, [games, uiCacheGames, selectedRound]);

    // [MERGED_GAMES_LOGIC]
    // [MERGED_GAMES_LOGIC]
    // [STABLE_KEY_GENERATOR]
    const getStableRowKey = useCallback((g: GameSummary, index: number) => {
        const w = g.whiteName ? normalizeName(g.whiteName).replace(/\s+/g, '') : 'white';
        const b = g.blackName ? normalizeName(g.blackName).replace(/\s+/g, '') : 'black';
        return `${index}|${w}|${b}`;
    }, []);

    const activeRoundId = selectedRound ? roundIdMap[selectedRound] : undefined;
    const fallbackRoundKey = selectedRound ? `previewFenByRoundFallback:${tournamentSlug}:${selectedRound}` : undefined;

    const memoryPreview = useMemo(() => {
        // 1. Try Round-Based Key first (Universal)
        if (activeRoundId) {
            const rKey = `previewFenByRound:${activeRoundId}`;
            if (previewMemory.has(rKey)) {
                return previewMemory.get(rKey);
            }
        }
        // 2. Try Fallback Key
        if (fallbackRoundKey) {
            // Check if our wrapper has this key (since we manually forced it in hydration)
            if (previewMemory.has(fallbackRoundKey)) {
                return previewMemory.get(fallbackRoundKey);
            }
        }
        return previewMemory.get(tournamentSlug);
    }, [tournamentSlug, activeRoundId, fallbackRoundKey, previewsVersion]);

    // [UNIVERSAL_HYDRATION]
    const hasAttemptedHydration = useRef<Set<string>>(new Set());

    useEffect(() => {
        if (!selectedRound || !isHydrated) return;

        // Check cache status
        let hasPreviews = false;
        if (memoryPreview && Object.keys(memoryPreview).length > 0) hasPreviews = true;

        const sessKey = `${tournamentSlug}-${selectedRound}`;
        let appliedCount = 0;
        let total = 0;
        if (roundGames && roundGames.length > 0) {
            total = roundGames.length;
            if (memoryPreview) {
                roundGames.forEach(g => {
                    if (memoryPreview[getUniqueRowKey(g)] || (g.gameId && memoryPreview[g.gameId])) appliedCount++;
                });
            }
        }

        // Diagnostic Log (Once per round view)
        // [PREVIEW_DIAG]
        if (hasPreviews) {
            if (!hasAttemptedHydration.current.has(sessKey + '_diag')) {
                const keyType = activeRoundId ? 'primary' : 'fallback';
                const rid = activeRoundId || 'none';
                console.log(`[PREVIEW_DIAG] tKey=${tournamentSlug} round=${selectedRound} roundId=${rid} cacheApplied=${appliedCount}/${total} didHydrate=no(cached) key=${keyType}`);
                hasAttemptedHydration.current.add(sessKey + '_diag');
            }
            return;
        }

        // If missing cache, attempt hydration
        if (!hasAttemptedHydration.current.has(sessKey)) {
            hasAttemptedHydration.current.add(sessKey);

            const doHydrate = async () => {
                const rid = activeRoundId || 'none';
                console.log(`[PREVIEW_HYDRATE] Triggering one-time hydration for R${selectedRound} (ID: ${rid})`);

                let hydratedCount = 0;
                let newMap: Record<string, any> = {};

                try {
                    let pgnText = '';
                    if (activeRoundId) {
                        // Attempt PGN Fetch
                        const fetched = await fetchRoundPgn(activeRoundId);
                        if (fetched) pgnText = fetched;
                    }

                    if (pgnText) {
                        const parsedGamesMap = parsePgnForRound(pgnText);
                        const parsedDataMap = new Map();

                        parsedGamesMap.forEach((pgnString) => {
                            const white = pgnString.match(/\[White\s+"([^"]+)"\]/)?.[1];
                            const black = pgnString.match(/\[Black\s+"([^"]+)"\]/)?.[1];
                            if (!white || !black) return;

                            const { finalFen, lastMove } = parsePgnToMainlineMoves(pgnString);
                            if (!finalFen) return;

                            // Result
                            const resMatch = pgnString.match(/\[Result\s+"(.*?)"\]/);
                            const resStr = resMatch ? resMatch[1] : '*';
                            let wRes = '*', bRes = '*';
                            if (resStr === '1-0') { wRes = '1'; bRes = '0'; }
                            else if (resStr === '0-1') { wRes = '0'; bRes = '1'; }
                            else if (resStr === '1/2-1/2') { wRes = '½'; bRes = '½'; }

                            const val = {
                                fen: finalFen,
                                lastMove,
                                whiteResult: wRes,
                                blackResult: bRes
                            };

                            const wNorm = normalizeName(white);
                            const bNorm = normalizeName(black);
                            parsedDataMap.set(`${wNorm}|${bNorm}`, val);
                            parsedDataMap.set(`${bNorm}|${wNorm}`, val);
                        });

                        roundGames.forEach((g, idx) => {
                            const w = normalizeName(g.whiteName);
                            const b = normalizeName(g.blackName);
                            const match = parsedDataMap.get(`${w}|${b}`);

                            if (match && match.fen) {
                                const stableKey = getStableRowKey(g, idx);
                                const rowKey = getUniqueRowKey(g);
                                const entry = {
                                    previewFen: match.fen,
                                    lastMove: match.lastMove,
                                    result: match.whiteResult !== '*' ? `${match.whiteResult}-${match.blackResult}` : undefined,
                                    updatedAt: Date.now()
                                };
                                if (entry.previewFen) {
                                    newMap[stableKey] = entry;
                                    if (g.gameId) newMap[g.gameId] = entry;
                                    newMap[rowKey] = entry;
                                    hydratedCount++;
                                }
                            }
                        });
                    } else {
                        console.log(`[PREVIEW_HYDRATE] No PGN Text available for R${selectedRound}`);
                    }
                } catch (e) {
                    console.warn(`[HydrationError] ${e}`);
                }

                if (hydratedCount > 0) {
                    const keyType = activeRoundId ? 'primary' : 'fallback';
                    // Use target key
                    const targetKey = activeRoundId ? `previewFenByRound:${activeRoundId}` : fallbackRoundKey;
                    const finalMap = { ...(previewMemory.get(targetKey!) || {}), ...newMap };

                    previewMemory.set(targetKey!, finalMap);

                    if (activeRoundId) {
                        saveRoundPreview(activeRoundId, finalMap);
                    } else if (fallbackRoundKey) {
                        // Save using the fallback key string as the ID for storage
                        // The storage helper uses the ID to form `previewFenByRound:${ID}`
                        // So we pass `Fallback:${slug}:${round}` as ID
                        saveRoundPreview(`Fallback:${tournamentSlug}:${selectedRound}`, finalMap);
                    }
                    setPreviewsVersion(v => v + 1);

                    if (!hasAttemptedHydration.current.has(sessKey + '_diag')) {
                        console.log(`[PREVIEW_DIAG] tKey=${tournamentSlug} round=${selectedRound} roundId=${rid} cacheApplied=${hydratedCount}/${total} didHydrate=yes key=${keyType}`);
                        hasAttemptedHydration.current.add(sessKey + '_diag');
                    }
                } else {
                    if (!hasAttemptedHydration.current.has(sessKey + '_diag')) {
                        console.log(`[PREVIEW_DIAG] tKey=${tournamentSlug} round=${selectedRound} roundId=${rid} cacheApplied=0/${total} didHydrate=failed key=none`);
                        hasAttemptedHydration.current.add(sessKey + '_diag');
                    }
                }
            };
            doHydrate();
        }
    }, [selectedRound, isHydrated, roundGames, tournamentSlug, activeRoundId, fallbackRoundKey, memoryPreview]);

    const hasLoggedPreviewApply = useRef<string>("");

    const mergedGames = useMemo(() => {
        // Safety check for roundGames
        let base = roundGames || [];

        // 1. Apply Broadcast Overlay (Live Status/Moves)
        // Convert to Map for O(1) matching
        if (broadcastGames && broadcastGames.length > 0) {
            const broadcastMap = new Map<string, GameSummary>();
            broadcastGames.forEach(g => {
                // Key by whiteName for loose matching as fallback
                if (g.whiteName) broadcastMap.set(g.whiteName, g);
                // Also could key by ID if available
            });

            base = base.map(bg => {
                // Try exact ID match first
                let match: GameSummary | undefined;
                if (bg.gameId) {
                    match = broadcastGames.find(g => g.gameId === bg.gameId);
                }

                // Fallback to name match
                if (!match && bg.whiteName) {
                    match = broadcastMap.get(bg.whiteName);
                }

                if (match) {
                    return { ...bg, ...match, source: 'broadcast' };
                }
                return bg;
            });
        }

        // 2. Apply In-Memory Preview Cache (Universal)
        if (memoryPreview) {
            let appliedCount = 0;
            base = base.map((g, idx) => {
                // Try multiple keys for robustness
                const keysToCheck = [
                    getStableRowKey(g, idx),             // Stable: index|white|black
                    getUniqueRowKey(g),                  // Existing unique key
                    (g as any).lichessGameId,            // Direct ID
                    g.gameId                             // Fallback ID
                ].filter(Boolean);

                let entry;
                for (const k of keysToCheck) {
                    if (memoryPreview[k]) {
                        entry = memoryPreview[k];
                        break;
                    }
                }

                if (entry) {
                    appliedCount++;
                    let wRes = g.whiteResult;
                    let bRes = g.blackResult;

                    // If result missing in game but present in cache (fetched earlier)
                    if (entry.result && (!wRes || wRes === '*')) {
                        const parts = entry.result.split('-');
                        if (parts.length === 2) {
                            wRes = parts[0];
                            bRes = parts[1];
                        }
                    }

                    return {
                        ...g,
                        previewFen: entry.previewFen,
                        previewLastMove: entry.lastMove,
                        whiteResult: wRes,
                        blackResult: bRes
                    };
                }
                return g;
            });

            // Log Preview Apply (Once per round/source)
            if (activeRoundId && appliedCount > 0) {
                const logKey = `${activeRoundId}-${appliedCount}`;
                if (hasLoggedPreviewApply.current !== logKey) {
                    const source = previewMemory.has(`previewFenByRound:${activeRoundId}`) ? 'memory' : 'legacy_storage';
                    console.log(`[PREVIEW_APPLY] roundId=${activeRoundId} applied=${appliedCount}/${base.length} source=${source}`);
                    hasLoggedPreviewApply.current = logKey;
                }
            }
        }

        // 3. Apply Prewarmed Map (Legacy/Fallback from Route Params)
        const initialMap = route.params.initialPreviewMap;
        if (initialMap && !memoryPreview) {
            base = base.map(g => {
                const key = getUniqueRowKey(g);
                const entry = initialMap[key];
                if (entry) {
                    let wRes = g.whiteResult;
                    let bRes = g.blackResult;
                    if (entry.result && (!wRes || wRes === '*')) {
                        const parts = entry.result.split('-');
                        if (parts.length === 2) {
                            wRes = parts[0];
                            bRes = parts[1];
                        }
                    }
                    return {
                        ...g,
                        previewFen: entry.previewFen || entry.fen, // handle legacy 'fen' key
                        previewLastMove: entry.lastMove,
                        whiteResult: wRes,
                        blackResult: bRes
                    };
                }
                return g;
            });
        }

        return base as RenderGame[];
    }, [roundGames, broadcastGames, memoryPreview, route.params.initialPreviewMap, getStableRowKey, activeRoundId, fallbackRoundKey]);

    // LOGGING EFFECT: Round Render Stats (Guarded, single log)
    // LOGGING EFFECT: Round Render Stats (Guarded, multiple checks)
    // [METRIC_TTFCB]
    const metricLogHistory = useRef<Set<string>>(new Set());
    const metricStart = useRef(Date.now());
    const metricRound = useRef(selectedRound);

    if (selectedRound !== metricRound.current) {
        // Reset timer only if switching from a valid round (User Change)
        // If switching from NULL (Initial Load), keep the Mount timer to measure full hydration time
        if (metricRound.current !== null) {
            metricStart.current = Date.now();
        }
        metricRound.current = selectedRound;
    }

    useEffect(() => {
        if (!selectedRound) return;
        const key = `${canonicalKey}:${selectedRound}`;
        if (metricLogHistory.current.has(key)) return;

        const cachedCount = mergedGames.filter(g => !!g.previewFen).length;
        if (cachedCount > 0) {
            const now = Date.now();
            const ms = now - metricStart.current;
            const total = mergedGames.length;
            // Approximation for logging
            const source = (previewMemory.has(`previewFenByRound:${roundIdMap[selectedRound] || 0}`) || previewMemory.has(canonicalKey)) ? 'memory' : 'storage';
            console.log(`[METRIC_TTFCB] tKey=${canonicalKey} round=${selectedRound} ms=${Math.round(ms)} source=${source} cachedBoards=${cachedCount}/${total}`);
            metricLogHistory.current.add(key);
        }
    }, [mergedGames, selectedRound, canonicalKey, roundIdMap, previewsVersion]);

    const hasLoggedFenApplied = useRef<string>("");
    useEffect(() => {
        if (!__DEV__) return;
        // Don't log if empty or no round
        if (!mergedGames || mergedGames.length === 0 || !selectedRound) return;

        // Use a key to prevent spam for the same data state
        // Key includes round to reset on round switch
        const stateKey = `${tournamentSlug}-${selectedRound}`;
        if (hasLoggedFenApplied.current === stateKey) return;

        const usedCount = mergedGames.filter(g => !!(g as any).previewFen).length;
        const source = memoryPreview ? 'memoryPreview' : 'hook/legacy';
        console.log(`[ROUND_FIRST_RENDER_FEN_APPLIED] usedPreviewFenCount=${usedCount} total=${mergedGames.length} source=${source} gamesLen=${mergedGames.length}`);
        hasLoggedFenApplied.current = stateKey;
    }, [mergedGames?.length || 0, selectedRound, tournamentSlug]);



    // Filter games based on selected filter and persistent toggles
    const filteredGames = mergedGames.filter(game => {
        // First apply round filter
        if (selectedRound === null) return false;

        // STRICT FILTER: Game MUST have a valid round matching selectedRound
        const r = (game.round !== undefined && game.round !== null)
            ? (typeof game.round === 'string' ? parseInt(game.round, 10) : game.round)
            : -1; // -1 denotes missing/invalid round

        if (r !== selectedRound) return false;

        // Then apply persistent filters
        if (liveGamesFilter && !game.isLive) return false;


        if (countryGamesFilter) {
            // Use selected country from Settings (defaults to 'IN' if not set)
            const matchesCountry =
                game.whiteFederation === selectedCountry ||
                game.blackFederation === selectedCountry;

            if (!matchesCountry) return false;
        }

        // Then apply temporary filter from segmented control
        if (filter === 'LIVE') return game.isLive;
        if (filter === 'FINISHED') return !game.isLive;
        return true; // ALL
    });

    // Apply search ranking if query exists
    const displayGames = debouncedSearchQuery.trim()
        ? [...filteredGames].sort((a, b) => {
            const scoreA = getSearchScore(a, debouncedSearchQuery.trim());
            const scoreB = getSearchScore(b, debouncedSearchQuery.trim());
            return scoreB - scoreA; // Higher scores first
        })
        : [...filteredGames].sort((a, b) => {
            // Sort by Board Ascending for default view
            const getBoard = (g: GameSummary) => {
                const b = (g as any).board;
                if (typeof b === 'number') return b || 99999; // Treat 0 as invalid
                if (typeof b === 'string') {
                    const parsed = parseInt(b, 10);
                    return (isNaN(parsed) || parsed === 0) ? 99999 : parsed;
                }
                return 99999;
            };
            return getBoard(a) - getBoard(b);
        });

    const hasSearchResults = debouncedSearchQuery.trim() && displayGames.some(game => getSearchScore(game, debouncedSearchQuery.trim()) > 0);

    // [MINIBOARD_STATUS_RULE]
    // Log the decision logic for live/static UI
    const isRoundFinished = useMemo(() => {
        if (!selectedRound) return false;
        // 1. Metadata check
        const meta = broadcastRounds?.find(r => r.name.includes(`${selectedRound}`) || r.slug?.endsWith(`${selectedRound}`));
        if (meta?.finished) return true;

        // 2. Fallback: If we have games and ALL are finished
        if (displayGames.length > 0) {
            const allFinished = displayGames.every(g => {
                const hasResult = g.whiteResult && g.whiteResult !== '*' && g.blackResult && g.blackResult !== '*';
                // Also consider explicit 'Finished' status
                return hasResult || (g as any).status === 'Finished';
            });
            if (allFinished) return true;
        }
        return false;
    }, [broadcastRounds, selectedRound, displayGames]);

    const lastLoggedRoundRef = useRef<string | null>(null);

    useEffect(() => {
        if (selectedRound) {
            const gamesWithLastMove = displayGames.filter(g => !!((g as any).previewLastMove || g.lastMove)).length;
            const logKey = `${tournamentSlug}-${selectedRound}-${isRoundFinished}-${gamesWithLastMove}`;

            if (lastLoggedRoundRef.current === logKey) return;
            lastLoggedRoundRef.current = logKey;

            if (SHOW_ROUND_AUDIT_LOGS) {
                console.log(`[MINIBOARD_LASTMOVE_RULE] roundNum=${selectedRound} isLive=${!isRoundFinished} gamesWithLastMove=${gamesWithLastMove} total=${displayGames.length}`);
                console.log(`[MINIBOARD_STATUS_RULE] roundNum=${selectedRound} roundIsFinished=${isRoundFinished} clocksEnabled=${!isRoundFinished} highlightsEnabled=true`);
                console.log(`[MINIBOARD_HIGHLIGHT_ENABLED] roundNum=${selectedRound} enabled=true gamesHighlighted=${gamesWithLastMove} total=${displayGames.length}`);
            }
        }
    }, [selectedRound, isRoundFinished, displayGames, tournamentSlug]);

    // [ROUND_GAMES_SOURCE_AUDIT] - Diagnostic Log
    useEffect(() => {
        if (selectedRound) {

            const parsedCount = games ? games.filter(g => {
                const gr = typeof g.round === 'string' ? parseInt(g.round, 10) : g.round;
                return gr === selectedRound;
            }).length : 0;
            const hydratedCount = mergedGames ? mergedGames.filter(g => {
                const gr = typeof g.previewFen !== 'undefined'; // Just checking if preview logic touched it
                const r = typeof g.round === 'string' ? parseInt(g.round, 10) : g.round;
                return r === selectedRound;
            }).length : 0;

            console.log(`[ROUND_GAMES_SOURCE_AUDIT] tournamentKey=${tournamentSlug} roundNum=${selectedRound} parsedGamesCount=${parsedCount} hydratedGamesCount=${hydratedCount} displayedGamesCount=${displayGames.length}`);
        }
    }, [selectedRound, games, mergedGames, displayGames.length, tournamentSlug]);

    // [ROUND_PREVIEW_FEN_SUMMARY] - Diagnostic Log
    useEffect(() => {
        if (selectedRound && mergedGames.length > 0 && SHOW_ROUND_AUDIT_LOGS) {
            const total = mergedGames.length;
            const nonStartCount = mergedGames.filter(g => g.fen && !g.fen.startsWith('rnbqk')).length;
            const withPreviewCount = mergedGames.filter(g => g.previewFen).length;
            const missingPreviewIds = mergedGames.filter(g => !g.previewFen).length;

            console.log(`[ROUND_PREVIEW_FEN_SUMMARY] tournamentKey=${tournamentSlug} roundNum=${selectedRound} totalGames=${total} withPreviewCount=${withPreviewCount} nonStartCount=${nonStartCount} missingPreviewIds=${missingPreviewIds}`);
        }
    }, [mergedGames, selectedRound, tournamentSlug]);

    // [ROUND_ROW_KEY_AUDIT] - Ensure keys are unique
    useEffect(() => {
        if (selectedRound && displayGames.length > 0 && SHOW_ROUND_AUDIT_LOGS) {
            const keys = displayGames.map(g => getUniqueRowKey(g));
            const distinctKeys = new Set(keys);
            const duplicates = keys.filter((item, index) => keys.indexOf(item) !== index);
            const duplicateSet = new Set(duplicates);

            console.log(`[ROUND_ROW_KEY_AUDIT] tournamentKey=${tournamentSlug} roundNum=${selectedRound} keys=[${keys.slice(0, 5).join(',')}...] duplicateKeys=[${Array.from(duplicateSet).join(',')}]`);
        }
    }, [displayGames, selectedRound, tournamentSlug]);

    // RENDER LOG
    const mountTime = useRef(Date.now()).current;

    // Guarded Render Log
    useEffect(() => {
        if (selectedRound && displayGames.length > 0 && SHOW_ROUND_AUDIT_LOGS) {
            console.log(`[ROUND_PREVIEW_RENDERED] roundId=${selectedRound} msSinceMount=${Date.now() - mountTime}`);

            // [ROUND_MINIBOARD_WIRING]
            const sample = displayGames[0];
            const key = getUniqueRowKey(sample);
            const fenToRender = sample.previewFen ?? (sample as any).startFen ?? START_FEN;

            console.log(`[ROUND_MINIBOARD_WIRING] roundNum=${selectedRound} total=${displayGames.length} withPreview=${displayGames.filter(g => !!g.previewFen).length} sample={key:${key}, hasPreview:${!!sample.previewFen}, startPrefix:${((sample as any).startFen || '').slice(0, 10)}, previewPrefix:${(sample.previewFen || '').slice(0, 10)}, usedPrefix:${fenToRender.slice(0, 10)}}`);
        }
    }, [selectedRound, displayGames, tournamentSlug]);





    // [ROUND_UI_CACHE] Write-back Effect with Hash Guard to Prevent Infinite Loop
    const lastSavedHash = useRef('');
    const pendingSaveTimeout = useRef<NodeJS.Timeout | null>(null);

    useEffect(() => {
        // Only write if hydrated and we have games to show
        if (isHydrated && displayGames.length > 0 && selectedRound && activeRoundId) {

            // Compute stable hash to stop infinite loop
            // We only care about fields that affect preview: gameId, white, black, previewFen, lastMove, result
            const contentHash = displayGames.map(g => {
                const pFen = (g as any).previewFen || '';
                const res = (g.whiteResult && g.blackResult) ? `${g.whiteResult}-${g.blackResult}` : '';
                const lm = (g as any).previewLastMove || g.lastMove || '';
                return `${g.gameId}:${pFen}:${res}:${lm}`;
            }).join('|');

            if (contentHash === lastSavedHash.current) {
                // No change in meaningful data -> skip save/log
                return;
            }
            lastSavedHash.current = contentHash;

            // 1. Sync Cache (Immediate) - Keep UI snappy
            saveRoundUiCache(tournamentSlug, selectedRound, displayGames);
            updateSyncRoundUi(tournamentSlug, selectedRound, displayGames);

            // 2. Preview Cache (Debounced + Universal RoundId)
            if (pendingSaveTimeout.current) clearTimeout(pendingSaveTimeout.current);

            pendingSaveTimeout.current = setTimeout(() => {
                const newPreviewMap: Record<string, any> = {};
                displayGames.forEach((g, idx) => {
                    const fen = (g as any).previewFen;
                    if (fen) {
                        const stableKey = getStableRowKey(g, idx);
                        const rowKey = getUniqueRowKey(g);

                        const entry = {
                            previewFen: fen,
                            lastMove: (g as any).previewLastMove || g.lastMove,
                            result: (g.whiteResult && g.blackResult) ? `${g.whiteResult}-${g.blackResult}` : undefined,
                            updatedAt: Date.now()
                        };

                        newPreviewMap[stableKey] = entry;
                        if (g.gameId) newPreviewMap[g.gameId] = entry;
                        newPreviewMap[rowKey] = entry;
                    }
                });

                if (Object.keys(newPreviewMap).length > 0) {
                    const roundKey = `previewFenByRound:${activeRoundId}`;
                    const existing = previewMemory.get(roundKey) || {};
                    const merged = { ...existing, ...newPreviewMap };
                    previewMemory.set(roundKey, merged);

                    saveRoundPreview(activeRoundId, merged);
                    // console.log(`[PREVIEW_SAVE_DEBOUNCED] Saved ${Object.keys(newPreviewMap).length} entries for ${activeRoundId}`);
                }
            }, 2000); // 2s debounce
        }

        return () => {
            if (pendingSaveTimeout.current) clearTimeout(pendingSaveTimeout.current);
        };
    }, [displayGames, isHydrated, selectedRound, tournamentSlug, activeRoundId, getStableRowKey]);

    // Call the audit hook log
    // Call the audit hook log - Removed to reduce spam
    // useRoundRowFenAudit(tournamentSlug, selectedRound, displayGames);

    return (
        <View style={styles.container}>
            <StatusBar style="light" />

            <Sidebar visible={sidebarVisible} onClose={() => setSidebarVisible(false)} />

            {/* DEV Banner */}
            {__DEV__ && SHOW_DEBUG_BANNER && tournamentSlug === TATA_STEEL_2026_SLUG && (
                <View style={{ backgroundColor: '#4a1e1e', padding: 8, borderBottomWidth: 1, borderColor: '#ff4444' }}>
                    <Text style={{ color: '#fff', fontSize: 10, fontFamily: 'monospace' }}>
                        DEV: {lastDebugStats.slug} | Src: {lastDebugStats.source}
                    </Text>
                    <Text style={{ color: '#aaa', fontSize: 10 }}>URL: {lastDebugStats.dgtUrl.slice(0, 40)}...</Text>
                    <Text style={{ color: '#8f8', fontSize: 10, fontWeight: 'bold' }}>
                        Matched: {lastDebugStats.matchCount}/{lastDebugStats.totalPlayers} | Unmatched: {lastDebugStats.unmatched.join(', ') || 'NONE'}
                    </Text>
                    <Text style={{ color: '#fea', fontSize: 10 }}>
                        Sample: {lastDebugStats.sampleMapping}
                    </Text>
                </View>
            )}

            {/* Compact Header */}
            <View style={styles.compactHeader}>
                {!isSearchMode ? (
                    <>
                        {/* Normal Mode */}
                        {/* Left: Hamburger Icon */}
                        <TouchableOpacity
                            style={styles.iconButton}
                            onPress={() => setSidebarVisible(true)}
                        >
                            <Text style={styles.iconText}>☰</Text>
                        </TouchableOpacity>

                        {/* Center: Tournament Name + Subtitle (tappable for tooltip) */}
                        <TouchableOpacity
                            style={styles.headerCenter}
                            activeOpacity={0.7}
                            onPress={() => {
                                setShowTitleTooltip(true);
                                setTimeout(() => setShowTitleTooltip(false), 2000);
                            }}
                        >
                            <View style={styles.headerCenterContent}>
                                <Text style={styles.compactTournamentName} numberOfLines={1} ellipsizeMode="tail">
                                    {tournamentName}
                                </Text>
                                {selectedRound !== null && (
                                    <RoundSelectorCapsule
                                        round={selectedRound}
                                        onPress={() => setRoundSelectorVisible(true)}
                                    />
                                )}
                            </View>

                            {/* Tooltip */}
                            {showTitleTooltip && (
                                <View style={styles.tooltip}>
                                    <Text style={styles.tooltipText}>{tournamentName}</Text>
                                </View>
                            )}
                        </TouchableOpacity>

                        {/* Right: Search, Menu, Overflow Icons */}
                        <View style={styles.headerRight}>
                            {/* Search Icon */}
                            <TouchableOpacity
                                style={styles.iconButtonCompact}
                                onPress={() => setIsSearchMode(true)}
                            >
                                <Ionicons name="search-outline" size={20} color={broadcastTheme.colors.slate300} />
                            </TouchableOpacity>

                            {/* Menu/Options Icon */}
                            <TouchableOpacity
                                style={styles.iconButtonCompact}
                                onPress={() => setMenuDropdownVisible(true)}
                            >
                                <Ionicons name="options-outline" size={20} color={broadcastTheme.colors.slate300} />
                            </TouchableOpacity>

                            {/* Overflow Icon */}
                            <TouchableOpacity
                                style={styles.iconButtonCompact}
                                onPress={() => setOverflowDropdownVisible(true)}
                            >
                                <Ionicons name="ellipsis-vertical" size={20} color={broadcastTheme.colors.slate300} />
                            </TouchableOpacity>
                        </View>
                    </>
                ) : (
                    <>
                        {/* Search Mode */}
                        {/* Left: Back Arrow */}
                        <TouchableOpacity
                            style={styles.iconButton}
                            onPress={() => {
                                setIsSearchMode(false);
                                setSearchQuery('');
                            }}
                        >
                            <Ionicons name="arrow-back" size={24} color={broadcastTheme.colors.slate200} />
                        </TouchableOpacity>

                        {/* Center: Search Input */}
                        <TextInput
                            ref={searchInputRef}
                            style={styles.searchInput}
                            placeholder="Search games/players"
                            placeholderTextColor={broadcastTheme.colors.slate400}
                            value={searchQuery}
                            onChangeText={setSearchQuery}
                            autoCapitalize="none"
                            autoCorrect={false}
                        />

                        {/* Right: Clear Icon (only when text exists) */}
                        {searchQuery.length > 0 && (
                            <TouchableOpacity
                                style={styles.iconButton}
                                onPress={() => setSearchQuery('')}
                            >
                                <Ionicons name="close-circle" size={20} color={broadcastTheme.colors.slate400} />
                            </TouchableOpacity>
                        )}
                    </>
                )}
            </View>

            {/* Official Source Info Row */}
            {SHOW_OFFICIAL_FEED_ROW && (
                <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', paddingVertical: 6, backgroundColor: broadcastTheme.colors.background, borderBottomWidth: 1, borderBottomColor: broadcastTheme.colors.borderDefault }}>
                    <Ionicons name="globe-outline" size={12} color={broadcastTheme.colors.slate400} style={{ marginRight: 4 }} />
                    <Text style={{ color: broadcastTheme.colors.slate400, fontSize: 11 }}>
                        Official Feed: <Text style={{ color: broadcastTheme.colors.slate200, fontWeight: '600' }}>
                            {(() => {
                                const conf = OfficialSourceRegistry[tournamentSlug];
                                const status = conf?.officialRoundPgnUrlTemplate ? 'set' : 'not_set';
                                console.log(`[OFFICIAL_FEED_ROW_RENDER] tournamentKey=${tournamentSlug} status=${status}`);

                                if (!conf?.officialRoundPgnUrlTemplate) return 'Not set';
                                // Extract domain
                                const match = conf?.officialRoundPgnUrlTemplate?.match(/https?:\/\/([^\/]+)/);
                                return match ? match[1] : 'Configured';
                            })()}
                        </Text>
                    </Text>
                </View>
            )}

            {/* LIVE Round Chip - Conditional */}


            {/* Menu Dropdown */}
            <Modal
                visible={menuDropdownVisible}
                transparent={true}
                animationType="fade"
                onRequestClose={() => setMenuDropdownVisible(false)}
            >
                <Pressable
                    style={styles.modalOverlay}
                    onPress={() => setMenuDropdownVisible(false)}
                >
                    <View style={styles.dropdown}>
                        {/* Country games filter */}
                        <TouchableOpacity
                            style={styles.dropdownItemWithCheckbox}
                            onPress={() => {
                                setCountryGamesFilter(!countryGamesFilter);
                            }}
                        >
                            <View style={styles.checkbox}>
                                {countryGamesFilter && (
                                    <Ionicons name="checkmark" size={16} color={broadcastTheme.colors.slate50} />
                                )}
                            </View>
                            <Text style={styles.dropdownItemText}>Country games</Text>
                        </TouchableOpacity>

                        {/* Live games filter */}
                        <TouchableOpacity
                            style={styles.dropdownItemWithCheckbox}
                            onPress={() => {
                                setLiveGamesFilter(!liveGamesFilter);
                            }}
                        >
                            <View style={styles.checkbox}>
                                {liveGamesFilter && (
                                    <Ionicons name="checkmark" size={16} color={broadcastTheme.colors.slate50} />
                                )}
                            </View>
                            <Text style={styles.dropdownItemText}>Live games</Text>
                        </TouchableOpacity>

                        {/* Flip boards filter */}
                        <TouchableOpacity
                            style={styles.dropdownItemWithCheckbox}
                            onPress={() => {
                                setFlipBoards(!flipBoards);
                            }}
                        >
                            <View style={styles.checkbox}>
                                {flipBoards && (
                                    <Ionicons name="checkmark" size={16} color={broadcastTheme.colors.slate50} />
                                )}
                            </View>
                            <Text style={styles.dropdownItemText}>Flip boards</Text>
                        </TouchableOpacity>

                        {/* Leaderboard (action, not filter) */}
                        <TouchableOpacity
                            style={styles.dropdownItemWithCheckbox}
                            onPress={() => {
                                setMenuDropdownVisible(false);
                                navigation.navigate('TournamentLeaderboard', {
                                    tournamentSlug,
                                    tournamentName,
                                });
                            }}
                        >
                            <View style={styles.checkbox} />
                            <Text style={styles.dropdownItemText}>Leaderboard</Text>
                        </TouchableOpacity>
                    </View>
                </Pressable>
            </Modal>

            {/* Overflow Dropdown */}
            <Modal
                visible={overflowDropdownVisible}
                transparent={true}
                animationType="fade"
                onRequestClose={() => setOverflowDropdownVisible(false)}
            >
                <Pressable
                    style={styles.modalOverlay}
                    onPress={() => setOverflowDropdownVisible(false)}
                >
                    <View style={styles.dropdown}>
                        <TouchableOpacity
                            style={styles.dropdownItem}
                            onPress={() => {
                                setOverflowDropdownVisible(false);
                                navigation.navigate('Settings');
                            }}
                        >
                            <Text style={styles.dropdownItemText}>Settings</Text>
                        </TouchableOpacity>
                        <TouchableOpacity
                            style={styles.dropdownItem}
                            onPress={() => {
                                setOverflowDropdownVisible(false);
                                navigation.navigate('Help');
                            }}
                        >
                            <Text style={styles.dropdownItemText}>Help</Text>
                        </TouchableOpacity>
                        <TouchableOpacity
                            style={styles.dropdownItem}
                            onPress={() => {
                                setOverflowDropdownVisible(false);
                                setAboutModalVisible(true);
                            }}
                        >
                            <Text style={styles.dropdownItemText}>About</Text>
                        </TouchableOpacity>
                    </View>
                </Pressable>
            </Modal>

            {/* About Modal */}
            <AboutModal
                visible={aboutModalVisible}
                onClose={() => setAboutModalVisible(false)}
                onFeedback={() => navigation.navigate('Help')}
            />

            {/* Round Selector Sheet */}
            <RoundSelectorSheet
                visible={roundSelectorVisible}
                rounds={availableRounds}
                selectedRound={selectedRound ?? 1} // Fallback safe, though typically not visible if null
                onSelectRound={(r) => {
                    hasUserSelectedRound.current = true;
                    setSelectedRound(r);
                }}
                onClose={() => setRoundSelectorVisible(false)}
            />

            {/* Games Feed */}
            {
                selectedRound === null ? (
                    <View style={styles.listContent}>
                        {/* Skeleton State during hydration gate */}
                        <SkeletonGameCard />
                        <SkeletonGameCard />
                        <SkeletonGameCard />
                    </View>
                ) : debouncedSearchQuery.trim() && !hasSearchResults ? (
                    <View style={styles.emptyState}>
                        <Text style={styles.emptyStateTitle}>No matching games</Text>
                        <Text style={styles.emptyStateSubtitle}>Try a player name or board number.</Text>
                    </View>
                ) : displayGames.length === 0 ? (
                    <View style={styles.listContent}>
                        {/* Fallback to Skeletons if loading round data to avoid blank screen */}
                        {Array.from({ length: 6 }).map((_, i) => <SkeletonGameCard key={i} />)}
                    </View>
                ) : (
                    <FlatList
                        ref={flatListRef}
                        data={displayGames}
                        key={`version-${previewsVersion}`} // FORCE REMOUNT on version change
                        extraData={[displayGames, shouldTickClocks ? nowTicker : 0]} // Update when games or ticker changes (gated)
                        keyExtractor={(item) => getUniqueRowKey(item)}
                        refreshControl={
                            <RefreshControl
                                refreshing={isRefreshing && !loadingRound} // Only show pull-to-refresh spinner if not doing specific round load (which has its own logic/UI maybe? or share it)
                                onRefresh={refresh}
                                tintColor={broadcastTheme.colors.sky400}
                                colors={[broadcastTheme.colors.sky400]}
                            />
                        }
                        ListHeaderComponent={
                            loadingRound === selectedRound ? (
                                <View style={{ paddingVertical: 12, alignItems: 'center', flexDirection: 'row', justifyContent: 'center', gap: 8 }}>
                                    <ActivityIndicator size="small" color={broadcastTheme.colors.sky400} />
                                    <Text style={{ color: broadcastTheme.colors.slate400, fontSize: 12 }}>Checking for updates...</Text>
                                </View>
                            ) : null
                        }
                        renderItem={({ item, index }) => {
                            const key = getUniqueRowKey(item);
                            // 1. memoryPreview (normalized) 2. item.previewFen (if any) 3. START_FEN
                            // Robust Lookup: by rowKey OR by gameId
                            // Logic updated to support fallback keys implicitly via memoryPreview construction
                            const cached = memoryPreview?.[key] || (item.gameId ? memoryPreview?.[item.gameId] : undefined);

                            const fenForPieces = cached?.previewFen ?? item.previewFen ?? START_FEN;
                            const lastMoveForHighlight = cached?.lastMove ?? item.lastMove;

                            return (
                                <GameCard
                                    showBoard={index < boardsReadyCount}
                                    game={item}
                                    flipBoards={flipBoards}
                                    navigation={navigation}
                                    tournamentSlug={tournamentSlug}
                                    tournamentName={tournamentName}
                                    isRoundFinished={isRoundFinished}
                                    now={nowTicker}
                                    previewFen={fenForPieces}
                                    lastMove={lastMoveForHighlight}
                                />
                            );
                        }}
                        contentContainerStyle={styles.listContent}
                        showsVerticalScrollIndicator={false}
                        initialNumToRender={2}
                        maxToRenderPerBatch={2}
                        windowSize={5}
                        removeClippedSubviews={true} // Optimized for list perf
                    />

                )
            }
        </View >
    );
}



// Helper function to convert country code to flag emoji
function getFlagEmoji(countryCode?: string): string {
    if (!countryCode || countryCode.length !== 2) return '';
    const codePoints = countryCode
        .toUpperCase()
        .split('')
        .map(char => 127397 + char.charCodeAt(0));
    return String.fromCodePoint(...codePoints);
}

// Format clock with zero-padding (mm:ss or hh:mm:ss)
function formatClock(clock: string): string {
    const parts = clock.split(':');
    if (parts.length === 2) {
        // mm:ss format
        const mins = parts[0].padStart(2, '0');
        const secs = parts[1].padStart(2, '0');
        return `${mins}:${secs}`;
    } else if (parts.length === 3) {
        // hh:mm:ss format
        const hours = parts[0].padStart(2, '0');
        const mins = parts[1].padStart(2, '0');
        const secs = parts[2].padStart(2, '0');
        return `${hours}:${mins}:${secs}`;
    }
    return clock; // fallback
}

interface PlayerRowProps {
    name: string;
    title?: string;
    federation?: string;
    rating?: number;
    displayValue: string; // clock or result
    boardSize: number; // Width to constrain the row to
}

const PlayerRow = memo(({ name, title, federation, rating, displayValue, boardSize }: PlayerRowProps) => {
    const flag = getFlagEmoji(federation);
    // Format clock if displayValue looks like a time (contains ':')
    const formattedDisplay = displayValue.includes(':') ? formatClock(displayValue) : displayValue;

    return (
        <View style={[styles.playerRow, { width: boardSize }]}>
            <View style={styles.playerInfo}>
                {flag && <Text style={styles.flag}>{flag}</Text>}
                {title && <Capsule variant="title">{title}</Capsule>}
                <Text style={styles.playerName} numberOfLines={1} ellipsizeMode="tail">
                    {name}
                </Text>
                {rating && <Text style={styles.rating}>{rating}</Text>}
            </View>
            <Text style={styles.displayValue}>{formattedDisplay}</Text>
        </View>
    );
});






const SkeletonGameCard = memo(() => {
    const { width } = useWindowDimensions();

    // Exact same responsive calculation as GameCard
    const CARD_PADDING = 32;
    const SCREEN_PADDING = 32;
    const BORDER = 2;
    const AVAILABLE_WIDTH = width - SCREEN_PADDING - CARD_PADDING - BORDER;
    const MIN_BOARD_SIZE = 180;
    const MAX_BOARD_SIZE = 400;

    const baseBoardSize = Math.max(MIN_BOARD_SIZE, Math.min(AVAILABLE_WIDTH, MAX_BOARD_SIZE));
    const boardSize = Math.round(baseBoardSize * 0.75);

    return (
        <View style={[styles.gameCard, { opacity: 0.6 }]}>
            <View style={{ flexDirection: 'column' }}>
                {/* Top Player Skeleton */}
                <View style={{ marginBottom: 2, alignSelf: 'center', width: boardSize, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', height: 20 }}>
                    <View style={{ width: '50%', height: 12, backgroundColor: broadcastTheme.colors.slate800, borderRadius: 2 }} />
                    <View style={{ width: '15%', height: 12, backgroundColor: broadcastTheme.colors.slate800, borderRadius: 2 }} />
                </View>

                {/* Board Skeleton */}
                <View style={{ alignSelf: 'center', marginVertical: 4 }}>
                    <View style={{ width: boardSize, height: boardSize, backgroundColor: broadcastTheme.colors.slate800, borderRadius: 4 }} />
                </View>

                {/* Bottom Player Skeleton */}
                <View style={{ marginTop: 2, alignSelf: 'center', width: boardSize, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', height: 20 }}>
                    <View style={{ width: '50%', height: 12, backgroundColor: broadcastTheme.colors.slate800, borderRadius: 2 }} />
                    <View style={{ width: '15%', height: 12, backgroundColor: broadcastTheme.colors.slate800, borderRadius: 2 }} />
                </View>
            </View>
        </View>
    );
});

const GameCard = memo(({ game, flipBoards, navigation, tournamentSlug, tournamentName, isRoundFinished, now, showBoard = true, previewFen, lastMove }: {
    game: RenderGame;
    flipBoards: boolean;
    navigation: any;
    tournamentSlug: string;
    tournamentName: string;
    isRoundFinished: boolean;
    now: number;
    showBoard?: boolean;
    previewFen?: string;
    lastMove?: string;
}) => {

    const { width } = useWindowDimensions();

    const isStartFen = !previewFen || previewFen.startsWith('rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR');

    // Use override if provided, else embedded previewFen, else startFen
    // Goal: ensure we show the preview or the start position, not the live FEN if preview is missing.
    const fenToRender = previewFen ?? game.previewFen ?? (game as any).startFen ?? START_FEN;
    const activeFen = fenToRender; // Alias for existing
    const activeLastMove = lastMove ?? game.previewLastMove ?? game.lastMove;

    // Logs removed to reduce spam per user request.



    // Responsive calculation
    // Responsive calculation for vertical layout
    const CARD_PADDING = 32; // 16 (left) + 16 (right)
    const SCREEN_PADDING = 32; // 16 (left) + 16 (right)
    const BORDER = 2;
    const AVAILABLE_WIDTH = width - SCREEN_PADDING - CARD_PADDING - BORDER;
    const MIN_BOARD_SIZE = 180;
    const MAX_BOARD_SIZE = 400;

    // Clamp board to available width, then reduce by 25% for compact view
    const baseBoardSize = Math.max(MIN_BOARD_SIZE, Math.min(AVAILABLE_WIDTH, MAX_BOARD_SIZE));
    const boardSize = Math.round(baseBoardSize * 0.75);


    // Live UI Rules:
    // 1. If round is explicitly finished, NEVER show live UI.
    // 2. If game result is known (not *), NEVER show live UI.
    // 3. Otherwise trust game.isLive
    const hasFinalResult = game.whiteResult && game.whiteResult !== '*' && game.blackResult && game.blackResult !== '*';
    const isFinishedLabel = (game as any).status === 'Finished' || (game as any).status === 'Completed';

    // UI RULE: Clocks only if isLive is explicitly true AND not finished
    const shouldShowLiveUI = game.isLive === true && !isRoundFinished && !hasFinalResult && !isFinishedLabel;

    // DEV-only debug flag
    const SHOW_CLOCK_DEBUG = __DEV__ && false;

    useEffect(() => {
        if (!shouldShowLiveUI) return;
        if (SHOW_CLOCK_DEBUG) {
            console.log(`[CLOCK_BASE] gameId=${game.gameId} w=${(game as any).whiteSeconds} b=${(game as any).blackSeconds} capturedAt=${(game as any).clockCapturedAt} fen=${game.fen} sideToMove=${(game as any).turn}`);
        }
    }, []); // Log once on mount



    // Clock debug logs removed.

    const { whiteDisplay, blackDisplay } = useGameClock(
        (game as any).whiteSeconds || 0,
        (game as any).blackSeconds || 0,
        (game as any).clockCapturedAt || game.lastUpdatedAt,
        shouldShowLiveUI,
        (game as any).turn || 'w',
        now,
        game.whiteClock && game.whiteClock !== '00:00' && game.whiteClock !== '0:00' ? game.whiteClock : '—',
        game.blackClock && game.blackClock !== '00:00' && game.blackClock !== '0:00' ? game.blackClock : '—'
    );

    // Determine display value for each player (clock if live, result if finished)
    // UI RULE: If status unknown or round finished, prefer result placeholder (—)
    const blackDisplayValue = shouldShowLiveUI ? blackDisplay : (game.blackResult || '—');
    const whiteDisplayValue = shouldShowLiveUI ? whiteDisplay : (game.whiteResult || '—');


    // Determine which player appears on top based on flip state
    const topPlayer = flipBoards ? {
        name: game.whiteName,
        title: game.whiteTitle,
        federation: game.whiteFederation,
        rating: game.whiteRating,
        displayValue: whiteDisplayValue,
    } : {
        name: game.blackName,
        title: game.blackTitle,
        federation: game.blackFederation,
        rating: game.blackRating,
        displayValue: blackDisplayValue,
    };

    const bottomPlayer = flipBoards ? {
        name: game.blackName,
        title: game.blackTitle,
        federation: game.blackFederation,
        rating: game.blackRating,
        displayValue: blackDisplayValue,
    } : {
        name: game.whiteName,
        title: game.whiteTitle,
        federation: game.whiteFederation,
        rating: game.whiteRating,
        displayValue: whiteDisplayValue,
    };

    return (
        <TouchableOpacity
            style={[
                styles.gameCard,
                shouldShowLiveUI && styles.gameCardLive
            ]}

            activeOpacity={0.7}
            onPress={() => {
                navigation.navigate('Game', {
                    gameId: game.gameId,
                    tournamentSlug,
                    tournamentName,
                    round: game.round ?? 1,
                    whiteName: game.whiteName,
                    blackName: game.blackName,
                    whiteTitle: game.whiteTitle,
                    blackTitle: game.blackTitle,
                    whiteFederation: game.whiteFederation,
                    blackFederation: game.blackFederation,
                    whiteRating: game.whiteRating,
                    blackRating: game.blackRating,
                    whiteClock: game.whiteClock,
                    blackClock: game.blackClock,
                    whiteResult: game.whiteResult,
                    blackResult: game.blackResult,
                    isLive: game.isLive,
                    fen: game.fen,
                    pgn: game.pgn,
                    lastMove: game.lastMove,
                    evalCp: game.scoreCp ?? game.evalCp,
                });
            }}
        >
            <View style={{ flexDirection: 'column' }}>
                {/* Top player (Black when normal, White when flipped) */}
                <View style={{ marginBottom: 2, alignSelf: 'center' }}>
                    <PlayerRow
                        name={topPlayer.name}
                        title={topPlayer.title}
                        federation={topPlayer.federation}
                        rating={topPlayer.rating}
                        displayValue={topPlayer.displayValue}
                        boardSize={boardSize}
                    />
                </View>

                {/* Mini Chess Board + Engine Bar (Centered) */}
                <View style={{ alignSelf: 'center', flexDirection: 'row', gap: 6, alignItems: 'center' }}>
                    {showBoard !== false ? (
                        <MiniBoard
                            // FORCE REMOUNT on fen change to ensure immediate visual update.
                            // key guarantees the board can’t “stick” to the first fen it saw.
                            key={`${getUniqueRowKey(game)}:${activeFen}`}
                            fen={fenToRender}
                            size={boardSize}
                            lastMove={activeLastMove}
                            flipped={flipBoards}
                            gameId={game.gameId} // Log prop
                            tournamentKey={tournamentSlug} // Log prop
                            round={game.round} // Log prop
                        />
                    ) : (
                        <View style={{
                            width: boardSize,
                            height: boardSize,
                            backgroundColor: broadcastTheme.colors.background,
                            borderColor: broadcastTheme.colors.slate800,
                            borderWidth: 1,
                            borderRadius: 2,
                            opacity: 0.5
                        }} />
                    )}

                    {/* DEV DEBUG BADGE */}
                    <EngineBar evalCp={game.scoreCp ?? game.evalCp} height={boardSize} />
                </View>

                {/* Bottom player (White when normal, Black when flipped) */}
                <View style={{ marginTop: 2, alignSelf: 'center' }}>
                    <PlayerRow
                        name={bottomPlayer.name}
                        title={bottomPlayer.title}
                        federation={bottomPlayer.federation}
                        rating={bottomPlayer.rating}
                        displayValue={bottomPlayer.displayValue}
                        boardSize={boardSize}
                    />
                </View>
            </View>
        </TouchableOpacity>
    );
});

const styles = StyleSheet.create({
    container: {
        flex: 1,
        backgroundColor: broadcastTheme.colors.background,
    },
    compactHeader: {
        flexDirection: 'row',
        alignItems: 'center',
        paddingTop: 50,
        paddingBottom: 12,
        paddingHorizontal: 16,
        backgroundColor: broadcastTheme.colors.background,
        borderBottomWidth: 1,
        borderBottomColor: broadcastTheme.colors.borderDefault,
    },
    headerCenter: {
        flex: 1,
        marginHorizontal: 12,
        alignItems: 'center',
    },
    headerCenterContent: {
        alignItems: 'center',
        gap: 4, // Vertical spacing between title and capsule
    },
    compactTournamentName: {
        fontSize: 16,
        fontWeight: '700' as '700',
        color: broadcastTheme.colors.slate50,
    },
    compactSubtitle: {
        fontSize: 12,
        color: '#FFFFFF', // Pure white for readability
        marginTop: 2,
    },
    tooltip: {
        position: 'absolute',
        top: -35,
        backgroundColor: broadcastTheme.colors.slate800,
        paddingVertical: 6,
        paddingHorizontal: 12,
        borderRadius: broadcastTheme.radii.md,
        borderWidth: 1,
        borderColor: broadcastTheme.colors.borderDefault,
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.3,
        shadowRadius: 4,
        elevation: 5,
        zIndex: 1000,
    },
    tooltipText: {
        fontSize: 13,
        color: broadcastTheme.colors.slate50,
        fontWeight: '500' as '500',
    },
    headerRight: {
        flexDirection: 'row',
        gap: 6, // Reduced from 12 to show more of tournament name
    },
    iconButton: {
        width: 40,
        height: 40,
        alignItems: 'center',
        justifyContent: 'center',
    },
    iconButtonCompact: {
        width: 32,
        height: 40,
        alignItems: 'center',
        justifyContent: 'center',
    },
    iconText: {
        fontSize: 20,
        color: broadcastTheme.colors.slate200,
    },
    searchIcon: {
        fontSize: 18,
        color: broadcastTheme.colors.slate400,
    },
    searchInput: {
        flex: 1,
        height: 40,
        backgroundColor: broadcastTheme.colors.slate900,
        borderRadius: broadcastTheme.radii.md,
        borderWidth: 1,
        borderColor: broadcastTheme.colors.borderDefault,
        paddingHorizontal: 12,
        fontSize: 15,
        color: broadcastTheme.colors.slate50,
        marginHorizontal: 8,
    },
    modalOverlay: {
        flex: 1,
        backgroundColor: 'rgba(0, 0, 0, 0.5)',
        justifyContent: 'flex-start',
        alignItems: 'flex-end',
        paddingTop: 100,
        paddingRight: 16,
    },
    dropdown: {
        backgroundColor: broadcastTheme.colors.slate900,
        borderRadius: broadcastTheme.radii.lg,
        borderWidth: 1,
        borderColor: broadcastTheme.colors.borderDefault,
        minWidth: 180,
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 4 },
        shadowOpacity: 0.3,
        shadowRadius: 8,
        elevation: 8,
    },
    dropdownItem: {
        paddingVertical: 14,
        paddingHorizontal: 16,
        borderBottomWidth: 1,
        borderBottomColor: broadcastTheme.colors.borderDefault,
    },
    dropdownItemWithCheckbox: {
        flexDirection: 'row',
        alignItems: 'center',
        paddingVertical: 14,
        paddingHorizontal: 16,
        borderBottomWidth: 1,
        borderBottomColor: broadcastTheme.colors.borderDefault,
        gap: 12,
    },
    checkbox: {
        width: 20,
        height: 20,
        borderWidth: 2,
        borderColor: broadcastTheme.colors.slate400,
        borderRadius: 3,
        alignItems: 'center',
        justifyContent: 'center',
    },
    dropdownItemText: {
        fontSize: 14,
        fontWeight: '500' as '500',
        color: broadcastTheme.colors.slate50,
    },
    listContent: {
        padding: 0, // No padding on list itself, spacers handled by logic if needed
    },
    gameCard: {
        backgroundColor: 'rgba(2, 6, 23, 0.7)', // slate-950/70
        borderRadius: broadcastTheme.radii.xl,
        padding: 10,
        marginBottom: 8,
        borderWidth: 1,
        borderColor: broadcastTheme.colors.borderDefault,
        overflow: 'visible',
    },
    gameCardLive: {
        borderColor: 'rgba(56, 189, 248, 0.7)', // sky-400/70
        backgroundColor: broadcastTheme.colors.slate900,
    },
    // Old vertical styles removed

    playerRow: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        width: '100%',
    },
    playerInfo: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 2,
        flex: 1,
        minWidth: 0, // Allow text truncation
    },
    flag: {
        fontSize: 13,
        lineHeight: 15,
    },
    playerName: {
        fontSize: 15,
        fontWeight: '600' as '600',
        color: broadcastTheme.colors.slate50,
        flex: 1,
        minWidth: 50, // Ensure name doesn't completely disappear
    },
    rating: {
        fontSize: 12,
        fontWeight: '600' as '600',
        color: broadcastTheme.colors.slate400,
    },
    displayValue: {
        fontSize: 13,
        fontWeight: '700' as '700',
        color: broadcastTheme.colors.sky400,
        fontVariant: ['tabular-nums'],
        marginLeft: 8,
    },
    clock: {
        fontSize: 16,
        fontWeight: '700' as '700',
        color: broadcastTheme.colors.sky400,
        fontVariant: ['tabular-nums'],
    },
    emptyState: {
        flex: 1,
        alignItems: 'center',
        justifyContent: 'center',
        paddingTop: 100,
    },
    emptyStateTitle: {
        fontSize: 16,
        fontWeight: '600' as '600',
        color: broadcastTheme.colors.slate200,
        marginBottom: 4,
    },
    emptyStateSubtitle: {
        fontSize: 14,
        color: broadcastTheme.colors.slate400,
    },

});


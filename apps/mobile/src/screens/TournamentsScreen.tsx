import { useRef, useEffect, useState, useMemo, useCallback } from 'react';
import { StatusBar } from 'expo-status-bar';
import { StyleSheet, Text, View, FlatList, SectionList, Image, TouchableOpacity, TextInput, LayoutAnimation, Platform, UIManager, RefreshControl, ScrollView } from 'react-native';
import { getTournaments, type Tournament } from '@chessview/core';
import { colors } from '../theme/colors';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { RootStackParamList } from '../navigation/types';
import { useIsFocused } from '@react-navigation/native';
import { prefetchTournament, getCachedGames } from '../hooks/usePollTournamentGames';
import { TATA_STEEL_2026_SLUG } from '../services/tataSteel';
import { fetchTataSteelGames, fetchTataSteelLiveSnapshot } from '../services/tataSteel';
import { isGameLive, getDefaultRound, computeHomeRoundAndStatus } from '../utils/roundSelection';
import { preloadRoundUiCache } from '../utils/roundUiCache'; // [ROUND_UI_CACHE]
import { resolveTournamentKey } from '../utils/resolveTournamentKey';
import Sidebar from '../components/Sidebar';
import { Ionicons } from '@expo/vector-icons';
import { broadcastTheme } from '../theme/broadcastTheme';
import { previewMemory } from '../cache/previewMemory';
import { fetchLiveBroadcasts, saveLiveCache, loadLiveCache, type DiscoveryItem } from '../services/discoveryService';

if (Platform.OS === 'android') {
    if (UIManager.setLayoutAnimationEnabledExperimental) {
        UIManager.setLayoutAnimationEnabledExperimental(true);
    }
}

import AsyncStorage from '@react-native-async-storage/async-storage';

// ... (other imports)

// PROBE CONFIG
const PROBE_TTL = 60000; // 60s
const CACHE_TTL = 180000; // 3 mins (Strict TTL for persistence)
const PROBE_DEBOUNCE = 1000;
const PROBE_HISTORY: Record<string, number> = {}; // lastProbeTime per slug

// KEY_EXTRACTOR WARNING GUARD (prevent spam)
const KEY_EXTRACTOR_WARNED = new Set<number>();

const LIVE_OVERRIDES_KEY = 'home_live_overrides_v1';

// 15m for LIVE=true, 2m for LIVE=false (to catch restarts quickly)
const LIVE_TTL_MS = 15 * 60 * 1000;
const NOT_LIVE_TTL_MS = 2 * 60 * 1000;

type LiveOverride = {
    isLive: boolean | null;
    round?: number;
    lastUpdated: number;
    // New fields for enhanced status
    nextRound?: { round: number, startsAt: number };
    latestFinished?: number;
};
type LiveOverridesMap = Record<string, LiveOverride>;

// Helper: Load overrides from disk with intelligent expiration
const loadLiveOverrides = async (): Promise<LiveOverridesMap> => {
    try {
        const json = await AsyncStorage.getItem(LIVE_OVERRIDES_KEY);
        if (json) {
            const data = JSON.parse(json);
            const now = Date.now();
            const valid: LiveOverridesMap = {};

            Object.entries(data).forEach(([slug, val]: [string, any]) => {
                const age = now - val.lastUpdated;
                if (val.isLive === true) {
                    // LIVE=true: Keep for 15 mins
                    if (age < LIVE_TTL_MS) valid[slug] = val;
                } else {
                    // LIVE=false (or null): Keep short (2 mins)
                    // If too old, we discard it so it becomes "unknown" (triggers Checking...)
                    if (age < NOT_LIVE_TTL_MS) valid[slug] = val;
                }
            });
            return valid;
        }
    } catch (e) {
        console.warn('Failed to load live overrides', e);
    }
    return {};
};

// Helper: Save overrides to disk
const saveLiveOverrides = async (overrides: LiveOverridesMap) => {
    try {
        await AsyncStorage.setItem(LIVE_OVERRIDES_KEY, JSON.stringify(overrides));
    } catch (e) {
        console.warn('Failed to save live overrides', e);
    }
};

type Props = NativeStackScreenProps<RootStackParamList, 'Tournaments'>;

export default function TournamentsScreen({ navigation, route }: Props) {
    const filter = route.params?.filter || 'ALL';
    const [sidebarVisible, setSidebarVisible] = useState(false);
    const allTournaments = getTournaments();
    const sectionListRef = useRef<SectionList>(null);

    // Local Search State
    const [searchQuery, setSearchQuery] = useState('');
    const [isSearchMode, setIsSearchMode] = useState(false);
    const searchInputRef = useRef<TextInput>(null);
    const [refreshing, setRefreshing] = useState(false);

    // Live Discovery State
    const [liveDiscoveryItems, setLiveDiscoveryItems] = useState<DiscoveryItem[]>([]);
    const discoveryIntervalRef = useRef<NodeJS.Timeout | null>(null);

    // Live Probe State Override
    const [liveOverrides, setLiveOverrides] = useState<LiveOverridesMap>({});
    const [pendingProbes, setPendingProbes] = useState<Set<string>>(new Set());

    // Load persisted overrides on mount
    useEffect(() => {
        loadLiveOverrides().then(saved => {
            const now = Date.now();
            let hasLive = false;

            // Debug Log
            if (__DEV__) {
                Object.entries(saved).forEach(([slug, data]) => {
                    if (slug.includes('tata') || slug.includes('steel')) {
                        const ageSec = Math.floor((now - data.lastUpdated) / 1000);
                        console.log(`HOME_CACHE TataSteel loaded live=${data.isLive} ageSec=${ageSec}`);
                    }
                });
            }

            setLiveOverrides(saved);
        });
    }, []);

    // [AUTO_REFRESH] Minute tick for status labels ("In X min")
    const isFocused = useIsFocused();
    const [now, setNow] = useState(Date.now());
    const intervalRef = useRef<NodeJS.Timeout | null>(null);

    useEffect(() => {
        if (isFocused) {
            setNow(Date.now()); // Immediate update on focus

            // Ref guard to prevent double-intervals in StrictMode
            if (!intervalRef.current) {
                intervalRef.current = setInterval(() => {
                    setNow(Date.now());
                }, 60000);
            }
        }

        return () => {
            if (intervalRef.current) {
                clearInterval(intervalRef.current);
                intervalRef.current = null;
            }
        };
    }, [isFocused]);

    // Shared Probe Function
    const executeProbe = useCallback(async (slug: string) => {
        // Only probe Tata Steel for now (as per safe rollout / existing logic)
        // or any tournament we want to enable "Instant Live" for.
        if (!slug.includes('tata') && !slug.includes('steel')) return;

        const nowMs = Date.now();
        // Skip if recently probed in memory session
        if (PROBE_HISTORY[slug] && (nowMs - PROBE_HISTORY[slug] < PROBE_TTL)) return;

        PROBE_HISTORY[slug] = nowMs;
        setPendingProbes(prev => new Set(prev).add(slug));

        try {
            // Limited concurrency check could go here if we had a queue, 
            // but for "top 5" simple parallel execution is fine.
            const snapshot = await fetchTataSteelLiveSnapshot();

            // Always update if we got valid snapshot
            if (snapshot.liveRound || snapshot.latestFinished || snapshot.nextRound) {
                const round = snapshot.isLive ? snapshot.liveRound : snapshot.latestFinished;

                if (__DEV__) {
                    const elapsed = Date.now() - nowMs;
                    console.log(`HOME_PROBE [${slug}] live=${snapshot.isLive} round=${round} next=${snapshot.nextRound?.round} elapsedMs=${elapsed}`);
                }

                setLiveOverrides(prev => {
                    const nextVal: LiveOverride = {
                        isLive: snapshot.isLive,
                        round: round ?? undefined,
                        nextRound: snapshot.nextRound ?? undefined,
                        latestFinished: snapshot.latestFinished ?? undefined,
                        lastUpdated: Date.now()
                    };
                    const newVal = { ...prev, [slug]: nextVal };
                    saveLiveOverrides(newVal); // Persist update
                    return newVal;
                });
            } else {
                if (__DEV__) console.warn(`HOME_PROBE [${slug}] snapshot returned empty/null - ignoring.`);
            }

        } catch (e) {
            console.warn('[HomeProbe] Check failed', e);
        } finally {
            setPendingProbes(prev => {
                const next = new Set(prev);
                next.delete(slug);
                return next;
            });
        }
    }, []);

    // Immediate Probe on Mount (Top N tournaments)
    useEffect(() => {
        // Run immediately on active tournaments
        const candidates = allTournaments
            .filter(t => t.status !== 'FINISHED' && (t.slug.includes('tata') || t.slug.includes('steel')))
            .slice(0, 5); // Limit to top 5 relevant ones

        candidates.forEach(t => executeProbe(t.slug));

        // [ROUND_UI_CACHE] Pre-warm Memory Cache for Tata Steel
        // We speculatively load Round 9, 10, 11 (or ideally current round if known)
        // Since we don't know exact round easily here without probe result, 
        // we can just load a few recent ones or wait for probe?
        // Let's just blindly load 8, 9, 10, 11, 12, 13 to be safe? It's cheap (AsyncStorage read).
        // Or better: load "most likely" rounds.
        if (allTournaments.some(t => t.slug === TATA_STEEL_2026_SLUG)) {
            // TODO: Ideally we get this from liveOverrides or defaults.
            // For now, let's load a range.
            [8, 9, 10, 11, 12, 13].forEach(r => preloadRoundUiCache(TATA_STEEL_2026_SLUG, r));

            // [PREWARM_PREVIEW_MEMORY]
            (async () => {
                const tournamentKey = TATA_STEEL_2026_SLUG;
                if (__DEV__) console.log(`[PREWARM_PREVIEW_START] tournamentKey=${tournamentKey}`);
                const start = Date.now();

                try {
                    const { setTournamentPreview } = require('../cache/previewMemory');
                    const rounds = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13];
                    const keys = rounds.map(r => `previewFenCache:${tournamentKey}:${r}`);
                    const roundKeys = rounds.map(r => `ROUND_UI_CACHE:${tournamentKey}:${r}`);

                    const [previewPairs, roundPairs] = await Promise.all([
                        AsyncStorage.multiGet(keys),
                        AsyncStorage.multiGet(roundKeys)
                    ]);

                    const mergedMap: any = {};
                    let itemsCount = 0;

                    // Parse previews
                    previewPairs.forEach(([key, val]) => {
                        if (val) {
                            try {
                                const data = JSON.parse(val);
                                Object.assign(mergedMap, data);
                                itemsCount += Object.keys(data).length;

                                // [PREWARM_SAMPLE]
                                if (__DEV__ && itemsCount > 0 && itemsCount < 50) { // Log once/early
                                    const sampleId = Object.keys(data)[0];
                                    if (sampleId) {
                                        const sample = data[sampleId];
                                        console.log(`[PREWARM_SAMPLE] gameId=${sampleId} keys=${Object.keys(sample).join(',')} hasPreviewFen=${!!sample.previewFen} hasFen=${!!sample.fen} fenLen=${(sample.fen || sample.previewFen || '').length}`);
                                    }
                                }
                            } catch (e) { }
                        }
                    });

                    // Parse round UI for results
                    roundPairs.forEach(([key, val]) => {
                        if (val) {
                            try {
                                const data = JSON.parse(val);
                                if (data && data.games) {
                                    data.games.forEach((g: any) => {
                                        const w = g.whiteName ? g.whiteName.toLowerCase().replace(/[.,-\s]+/g, '') : 'white';
                                        const b = g.blackName ? g.blackName.toLowerCase().replace(/[.,-\s]+/g, '') : 'black';
                                        const gameKey = (g as any).lichessGameId || g.gameId || `${g.round}-${w}-${b}`;

                                        if (mergedMap[gameKey]) {
                                            if (g.whiteResult && g.blackResult) {
                                                mergedMap[gameKey].result = `${g.whiteResult}-${g.blackResult}`;
                                            }
                                        }
                                    });
                                }
                            } catch (e) { }
                        }
                    });

                    setTournamentPreview(tournamentKey, mergedMap);

                    if (__DEV__) {
                        const elapsed = Date.now() - start;
                        console.log(`[PREWARM_PREVIEW_DONE] tournamentKey=${tournamentKey} items=${itemsCount} ms=${elapsed}`);
                    }
                } catch (e) {
                    if (__DEV__) console.warn('[PREWARM_PREVIEW_FAILED]', e);
                }
            })();
        }

    }, []);

    // [LIVE_DISCOVERY] Fetch and poll live broadcasts
    const fetchDiscovery = useCallback(async (forceRefresh: boolean = false) => {
        try {
            const items = await fetchLiveBroadcasts(forceRefresh);
            if (items.length > 0) {
                setLiveDiscoveryItems(items);
                await saveLiveCache(items);
            } else {
                // On error or empty, try to load from cache (unless force refresh)
                if (!forceRefresh) {
                    const cached = await loadLiveCache();
                    if (cached.length > 0) {
                        setLiveDiscoveryItems(cached);
                    }
                }
            }
        } catch (error) {
            if (__DEV__) console.warn('[Discovery] Fetch failed', error);
            // Try cache on error (unless force refresh)
            if (!forceRefresh) {
                const cached = await loadLiveCache();
                if (cached.length > 0) {
                    setLiveDiscoveryItems(cached);
                }
            }
        }
    }, []);

    // Initial fetch and setup polling
    useEffect(() => {
        if (isFocused) {
            // Immediate fetch
            fetchDiscovery();

            // Setup 60s polling
            if (!discoveryIntervalRef.current) {
                discoveryIntervalRef.current = setInterval(() => {
                    fetchDiscovery();
                }, 60000);
            }
        }

        return () => {
            if (discoveryIntervalRef.current) {
                clearInterval(discoveryIntervalRef.current);
                discoveryIntervalRef.current = null;
            }
        };
    }, [isFocused, fetchDiscovery]);


    // Viewability Config for Probe (Scrolling)
    const viewabilityConfig = useRef({
        itemVisiblePercentThreshold: 50,
        minimumViewTime: 500,
    }).current;

    const onViewableItemsChanged = useRef(({ viewableItems }: { viewableItems: any[] }) => {
        if (!isFocused) return;

        viewableItems.forEach((item) => {
            const tournament = item.item as Tournament;
            if (tournament.status === 'FINISHED') return;
            executeProbe(tournament.slug);
        });
    }).current;

    const onRefresh = useCallback(async () => {
        setRefreshing(true);
        // Add minimal delay for UX so spinner is visible
        const minWait = new Promise(resolve => setTimeout(resolve, 500));

        // Force re-probe Tata Steel and fetch fresh discovery data (bypass cache)
        const p1 = prefetchTournament(TATA_STEEL_2026_SLUG); // Keep prefetch for detailed data
        const p2 = executeProbe(TATA_STEEL_2026_SLUG); // Re-run probe logic
        const p3 = fetchDiscovery(true); // Force refresh discovery data

        await Promise.all([p1, p2, p3, minWait]);
        setRefreshing(false);
    }, [executeProbe, fetchDiscovery]);

    // Auto-focus logic
    useEffect(() => {
        if (isSearchMode && searchInputRef.current) {
            // Small delay to ensure layout is ready
            setTimeout(() => searchInputRef.current?.focus(), 100);
        }
    }, [isSearchMode]);

    // Filter Logic
    const filteredTournaments = useMemo(() => {
        let result = allTournaments;

        // 1. Category Filter
        if (filter !== 'ALL') {
            result = result.filter(t => {
                if (filter === 'UPCOMING') return t.status === 'UPCOMING';
                if (filter === 'FINISHED') return t.status === 'FINISHED';
                if (filter === 'ONGOING') return t.status === 'ONGOING';
                return true;
            });
        }

        // 2. Search Filter
        if (searchQuery.trim()) {
            const query = searchQuery.toLowerCase();
            result = result.filter(t =>
                t.name.toLowerCase().includes(query) // Requirement: case-insensitive substring match on tournament name
            );
        }

        return result;
    }, [allTournaments, filter, searchQuery]);

    // Section-based data structure
    type TournamentItem = {
        tournament: Tournament;
        discoveryItem?: DiscoveryItem;
    };

    type TournamentSection = {
        title: string;
        data: TournamentItem[];
    };

    const sections = useMemo((): TournamentSection[] => {
        const liveSlugs = new Set(
            liveDiscoveryItems
                .filter(item => item?.tournament?.slug)
                .map(item => item.tournament.slug)
        );

        // Normalize search query for filtering
        const normalizedQuery = searchQuery.trim().toLowerCase().replace(/\s+/g, ' ');
        const hasSearch = normalizedQuery.length > 0;

        // Helper to check if tournament matches search
        const matchesSearch = (name: string): boolean => {
            if (!hasSearch) return true;
            const normalizedName = name.toLowerCase().replace(/\s+/g, ' ');
            return normalizedName.includes(normalizedQuery);
        };

        const liveItems: TournamentItem[] = [];
        const ongoingItems: TournamentItem[] = [];
        const completedItems: TournamentItem[] = [];
        const upcomingItems: TournamentItem[] = [];

        // Process discovery items into Live section
        liveDiscoveryItems.forEach(discoveryItem => {
            if (!discoveryItem?.tournament?.slug || !discoveryItem?.tournament?.name) {
                if (__DEV__) console.warn('[SECTIONS] Skipping invalid discovery item:', discoveryItem);
                return;
            }

            // Apply search filter to Live items
            if (!matchesSearch(discoveryItem.tournament.name)) return;

            liveItems.push({
                tournament: {
                    id: discoveryItem.tournament.slug,
                    slug: discoveryItem.tournament.slug,
                    name: discoveryItem.tournament.name,
                    status: 'ONGOING',
                    rounds: parseInt(discoveryItem.current.round.id, 10) || 1,
                } as Tournament,
                discoveryItem,
            });
        });

        // Process curated tournaments into Ongoing/Completed/Upcoming sections
        filteredTournaments.forEach(tournament => {
            if (!tournament?.slug) {
                if (__DEV__) console.warn('[SECTIONS] Skipping invalid tournament:', tournament);
                return;
            }

            // Skip if already in Live section (dedupe by slug)
            if (liveSlugs.has(tournament.slug)) return;

            // Apply search filter to curated tournaments
            if (!matchesSearch(tournament.name)) return;

            const cachedGames = getCachedGames(tournament.slug);
            const override = liveOverrides[tournament.slug];
            const isChecking = pendingProbes.has(tournament.slug) && !override;

            const { primaryText } = computeHomeRoundAndStatus(
                tournament,
                cachedGames,
                now,
                override,
                isChecking
            );

            // Categorize based on status
            if (tournament.status === 'FINISHED' || primaryText === 'Completed') {
                completedItems.push({ tournament });
            } else if (tournament.status === 'UPCOMING' || primaryText === 'Upcoming') {
                upcomingItems.push({ tournament });
            } else {
                // ONGOING or Live (but not in discovery)
                ongoingItems.push({ tournament });
            }
        });

        // Build sections array with robust filtering
        const allSections: TournamentSection[] = [
            {
                title: 'Live',
                data: liveItems.filter(item =>
                    item &&
                    item.tournament &&
                    item.tournament.slug
                )
            },
            {
                title: 'Ongoing',
                data: ongoingItems.filter(item =>
                    item &&
                    item.tournament &&
                    item.tournament.slug
                )
            },
            {
                title: 'Completed',
                data: completedItems.filter(item =>
                    item &&
                    item.tournament &&
                    item.tournament.slug
                )
            },
            {
                title: 'Upcoming',
                data: upcomingItems.filter(item =>
                    item &&
                    item.tournament &&
                    item.tournament.slug
                )
            },
        ];

        return allSections;
    }, [liveDiscoveryItems, filteredTournaments, now, liveOverrides, pendingProbes, searchQuery]);

    // Section index mapping for jump chips
    const sectionIndexMap = useMemo(() => {
        const map: Record<string, number> = {};
        sections.forEach((section, index) => {
            map[section.title] = index;
        });
        return map;
    }, [sections]);

    const scrollToSection = useCallback((sectionTitle: string) => {
        const sectionIndex = sectionIndexMap[sectionTitle];
        if (sectionIndex !== undefined && sections[sectionIndex]?.data.length > 0) {
            sectionListRef.current?.scrollToLocation({
                sectionIndex,
                itemIndex: 0,
                animated: true,
            });
        }
    }, [sectionIndexMap, sections]);

    // Section Title
    let sectionTitle = 'Tournaments';
    if (filter === 'ONGOING') {
        sectionTitle = 'Live & Ongoing';
    } else if (filter === 'FINISHED') {
        sectionTitle = 'Completed';
    } else if (filter === 'UPCOMING') {
        sectionTitle = 'Coming Up';
    }

    const handleTournamentPress = async (tournament: Tournament) => {
        // Use unified logic for consistency
        const tKey = resolveTournamentKey({ slug: tournament.slug });

        const isChecking = pendingProbes.has(tournament.slug) && !liveOverrides[tournament.slug];

        const cachedGames = getCachedGames(tKey);
        const override = liveOverrides[tournament.slug];

        const status = computeHomeRoundAndStatus(
            tournament,
            cachedGames,
            now,
            override,
            isChecking
        );

        console.log(`[TAP_NAV_KEY] tKey=${tKey} round=${status.preferredOpenRoundNumber ?? 1}`);

        const targetRound = status.preferredOpenRoundNumber ?? 1;

        // [PREWARM_PREVIEW]
        if (__DEV__) console.log(`[PREWARM_PREVIEW_START] slug=${tKey} round=${targetRound}`);
        const start = Date.now();

        // Tap-gated prewarm (Synchronous check, async load if missing)
        await previewMemory.ensurePreviewInMemory(tKey);

        if (__DEV__) {
            const elapsed = Date.now() - start;
            const has = previewMemory.has(tKey);
            const items = previewMemory.get(tKey) ? Object.keys(previewMemory.get(tKey)!).length : 0;
            // Guards for log spam? Touched once per tap, so okay.
            console.log(`[TAP_PREWARM_DONE] slug=${tKey} items=${items} hasPreviewFen=${has} ms=${elapsed}`);
            console.log(`[PREWARM_MEMORY_SET] slug=${tKey} items=${items}`);
        }

        // INSTANT NAVIGATION
        navigation.navigate('TournamentBoards', {
            tournamentId: tournament.id,
            tournamentSlug: tKey, // PASS CANONICAL KEY
            tournamentName: tournament.name,
            initialRound: targetRound,
            // We don't need initialPreviewMap anymore as we rely on memory singleton
            initialPreviewMap: undefined,
            snapshot: {
                name: tournament.name,
                status: tournament.status,
                rounds: tournament.rounds || 0,
            },
        });
    };

    // NOTE: If you see a refresh button or "three dots" menu in dev mode,
    // these are from the Expo Go / dev client overlay and will NOT appear in production builds.
    // Our app UI only has: hamburger menu, search, and pull-to-refresh gesture.
    return (
        <View style={styles.container}>
            <StatusBar style="light" />

            {/* Sidebar */}
            <Sidebar visible={sidebarVisible} onClose={() => setSidebarVisible(false)} />

            {/* Header */}
            <View style={styles.header}>
                <View style={styles.headerContent}>
                    <TouchableOpacity onPress={() => setSidebarVisible(true)} style={styles.hamburgerButton}>
                        <Ionicons name="menu" size={28} color={broadcastTheme.colors.slate50} />
                    </TouchableOpacity>

                    <Image source={require('../../assets/logo.png')} style={styles.headerLogo} />

                    <Text style={styles.title} numberOfLines={1} ellipsizeMode="tail">ChessView Live</Text>
                </View>
            </View>

            {/* Unified Chips + Search Toolbar */}
            {isSearchMode ? (
                <View style={styles.searchBarRow}>
                    <View style={styles.searchInputContainer}>
                        <Ionicons name="search" size={18} color={broadcastTheme.colors.sky400} />
                        <TextInput
                            ref={searchInputRef}
                            style={styles.searchInput}
                            placeholder="Search tournaments..."
                            placeholderTextColor={colors.textSecondary}
                            value={searchQuery}
                            onChangeText={setSearchQuery}
                            returnKeyType="search"
                        />
                        <TouchableOpacity
                            onPress={() => {
                                setSearchQuery('');
                                setIsSearchMode(false);
                            }}
                            style={styles.searchCloseButton}
                        >
                            <Ionicons name="close-circle" size={18} color={broadcastTheme.colors.slate400} />
                        </TouchableOpacity>
                    </View>
                </View>
            ) : (
                <View style={styles.chipToolbarRow}>
                    <ScrollView
                        horizontal
                        showsHorizontalScrollIndicator={false}
                        contentContainerStyle={styles.chipsScrollContent}
                        style={styles.chipsScroll}
                    >
                        {['Live', 'Ongoing', 'Completed', 'Upcoming'].map((sectionTitle) => {
                            const sectionIndex = sectionIndexMap[sectionTitle];
                            const hasData = sectionIndex !== undefined && sections[sectionIndex]?.data.length > 0;
                            return (
                                <TouchableOpacity
                                    key={sectionTitle}
                                    style={[
                                        styles.chip,
                                        !hasData && styles.chipDisabled,
                                    ]}
                                    onPress={() => hasData && scrollToSection(sectionTitle)}
                                    disabled={!hasData}
                                    activeOpacity={0.7}
                                >
                                    <Text style={[
                                        styles.chipText,
                                        !hasData && styles.chipTextDisabled,
                                    ]}>
                                        {sectionTitle}
                                    </Text>
                                </TouchableOpacity>
                            );
                        })}
                    </ScrollView>
                    <TouchableOpacity onPress={() => setIsSearchMode(true)} style={styles.searchIconButton}>
                        <Ionicons name="search" size={20} color={colors.textSecondary} />
                    </TouchableOpacity>
                </View>
            )}

            {/* Section-based List: Live / Ongoing / Completed / Upcoming */}
            {sections.length === 0 ? (
                <View style={styles.emptyState}>
                    <Text style={styles.emptyStateText}>
                        {searchQuery ? 'No matching tournaments.' : 'No tournaments found.'}
                    </Text>
                </View>
            ) : (
                <SectionList
                    ref={sectionListRef}
                    style={styles.scrollView}
                    contentContainerStyle={styles.scrollContent}
                    sections={sections}
                    keyExtractor={(item: TournamentItem, index: number) => {
                        // Defensive keyExtractor: never assume item.tournament.id exists
                        // Prefer stable keys in order: slug > id > fallback
                        if (!item?.tournament) {
                            if (__DEV__ && !KEY_EXTRACTOR_WARNED.has(index)) {
                                KEY_EXTRACTOR_WARNED.add(index);
                                console.warn(`[KEY_EXTRACTOR] Invalid item at index ${index}`);
                            }
                            return `fallback-${index}`;
                        }

                        const t = item.tournament;

                        // For discovery items (Live section)
                        if (item.discoveryItem) {
                            const slug = t.slug;
                            const roundId = item.discoveryItem.current?.round?.id || 'unknown';
                            return slug ? `live-${slug}-${roundId}` : `live-fallback-${index}`;
                        }

                        // For curated tournaments: prefer slug > id > index
                        const key = t.slug || t.id;
                        return key ? `tournament-${key}` : `fallback-${index}`;
                    }}
                    refreshControl={
                        <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.foreground} />
                    }
                    extraData={{ liveOverrides, now, refreshing }}
                    onViewableItemsChanged={onViewableItemsChanged}
                    viewabilityConfig={viewabilityConfig}
                    renderSectionHeader={({ section: { data } }) => {
                        if (data.length === 0) return null;
                        return <View style={styles.sectionSpacer} />;
                    }}
                    renderItem={({ item }) => {
                        const { tournament, discoveryItem } = item;

                        return (
                            <TournamentCard
                                tournament={tournament}
                                onPress={() => {
                                    if (discoveryItem) {
                                        const roundId = parseInt(discoveryItem.current.round.id, 10);
                                        navigation.navigate('TournamentBoards', {
                                            tournamentId: tournament.slug,
                                            tournamentSlug: tournament.slug,
                                            tournamentName: tournament.name,
                                            initialRound: isNaN(roundId) ? 1 : roundId,
                                            snapshot: {
                                                name: tournament.name,
                                                status: 'ONGOING',
                                                rounds: roundId || 1,
                                            },
                                        });
                                    } else {
                                        handleTournamentPress(tournament);
                                    }
                                }}
                                now={now}
                                discoveryItem={discoveryItem}
                                liveOverride={liveOverrides[tournament.slug]}
                                isChecking={pendingProbes.has(tournament.slug) && !liveOverrides[tournament.slug]}
                            />
                        );
                    }}
                />
            )}
        </View>
    );
}

function TournamentCard({ tournament, onPress, now, liveOverride, isChecking, discoveryItem }: { tournament: Tournament; onPress: () => void; now: number; liveOverride?: LiveOverride; isChecking?: boolean; discoveryItem?: DiscoveryItem }) {
    const [expanded, setExpanded] = useState(false);

    // Forces re-render if memory cache updates
    const cachedGames = getCachedGames(tournament.slug);

    const toggleExpand = () => {
        LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
        setExpanded(!expanded);
    };

    // Unified status computing: discovery items or curated tournaments
    const statusInfo = useMemo(() => {
        if (discoveryItem) {
            // Discovery item: map to unified status format
            const isLive = discoveryItem.current.kind === 'live';
            const statusColor = isLive ? '#ef4444' : '#f97316'; // Red for Live, Orange for Ongoing
            const statusText = isLive ? 'Live' : 'Ongoing';
            const roundName = discoveryItem.current.round.name || 'Round';

            return {
                primaryText: statusText,
                secondaryText: ` • ${roundName}`,
                statusColor,
                badgeText: statusText,
                badgeColor: statusColor,
            };
        } else {
            // Curated tournament: use existing logic
            const { primaryText, secondaryText, statusColor } = computeHomeRoundAndStatus(
                tournament,
                cachedGames,
                now,
                liveOverride,
                isChecking
            );

            // Determine badge based on status
            let badgeText: string | null = null;
            let badgeColor: string | null = null;

            if (primaryText === 'Live') {
                badgeText = 'Live';
                badgeColor = '#ef4444'; // Red
            } else if (primaryText === 'Ongoing') {
                badgeText = 'Ongoing';
                badgeColor = '#f97316'; // Orange
            } else if (primaryText === 'Completed') {
                badgeText = 'Completed';
                badgeColor = '#10b981'; // Green
            } else if (primaryText === 'Upcoming') {
                badgeText = 'Upcoming';
                badgeColor = '#6366f1'; // Indigo
            }

            return {
                primaryText,
                secondaryText,
                statusColor,
                badgeText,
                badgeColor,
            };
        }
    }, [discoveryItem, tournament, cachedGames, now, liveOverride, isChecking]);

    const displayName = tournament.name.replace(/tournament/yi, '').replace(/\s+/g, ' ').trim();

    return (
        <View style={styles.itemContainer}>
            <View style={styles.itemRow}>
                {/* Main Content (Title + Status Row) */}
                <TouchableOpacity
                    style={styles.itemMainContent}
                    onPress={onPress}
                    activeOpacity={0.7}
                >
                    <Text style={styles.itemTitle} numberOfLines={1} ellipsizeMode="tail">
                        {displayName}
                    </Text>
                    <Text style={styles.itemSubtitle} numberOfLines={1}>
                        <Text style={{ color: statusInfo.statusColor, fontWeight: '700' }}>{statusInfo.primaryText}</Text>
                        <Text style={{ color: colors.foreground }}>{statusInfo.secondaryText}</Text>
                    </Text>
                </TouchableOpacity>

                {/* Chevron Trigger - only for non-discovery items */}
                {!discoveryItem && (
                    <TouchableOpacity
                        style={styles.chevronButton}
                        onPress={toggleExpand}
                        hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
                    >
                        <Ionicons
                            name={expanded ? "chevron-up" : "chevron-down"}
                            size={20}
                            color={colors.textSecondary}
                        />
                    </TouchableOpacity>
                )}
            </View>

            {/* Expanded Content */}
            {expanded && (
                <View style={styles.expandedContent}>
                    <View style={styles.expandedRow}>
                        <Text style={styles.expandedLabel}>Status:</Text>
                        <Text style={styles.expandedValue}>{tournament.status}</Text>
                    </View>
                </View>
            )}
        </View>
    );
}

const styles = StyleSheet.create({
    container: {
        flex: 1,
        backgroundColor: colors.background,
    },
    header: {
        paddingTop: 42,
        paddingBottom: 6,
        paddingHorizontal: 16,
        backgroundColor: colors.background,
        borderBottomWidth: 1,
        borderBottomColor: colors.border,
    },
    headerContent: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 0, // Reduced gap to 0
    },
    hamburgerButton: {
        padding: 4,
        marginRight: 0,
    },
    headerLogo: {
        width: 110,
        height: 110,
        resizeMode: 'contain',
    },
    title: {
        fontSize: 20, // Slightly smaller header title
        fontWeight: '700' as '700',
        color: colors.foreground,
        flex: 1,
    },
    sectionHeader: {
        paddingHorizontal: 16,
        paddingTop: 16,
        paddingBottom: 8,
        justifyContent: 'center',
    },
    sectionHeaderRow: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
    },
    sectionLabel: {
        fontSize: 13,
        fontWeight: '700' as '700',
        color: colors.textSecondary,
        letterSpacing: 1,
        textTransform: 'uppercase',
    },
    searchIconButton: {
        padding: 8,
        marginLeft: 4,
    },
    searchInputContainer: {
        flexDirection: 'row',
        alignItems: 'center',
        backgroundColor: 'rgba(255, 255, 255, 0.08)',
        borderRadius: 8,
        paddingHorizontal: 10,
        height: 36,
        gap: 8,
    },
    searchInput: {
        flex: 1,
        color: colors.foreground,
        fontSize: 14,
        padding: 0,
    },
    searchCloseButton: {
        padding: 2,
    },
    scrollView: {
        flex: 1,
    },
    scrollContent: {
        paddingBottom: 20,
    },
    // NEW COMPACT LIST STYLES
    itemContainer: {
        borderBottomWidth: 1,
        borderBottomColor: colors.border,
        backgroundColor: colors.background,
    },
    itemRow: {
        flexDirection: 'row',
        alignItems: 'center',
        paddingVertical: 12,
        paddingHorizontal: 16,
        minHeight: 64,
        gap: 12,
    },
    itemMainContent: {
        flex: 1,
        justifyContent: 'center',
        gap: 2,
    },
    itemTitle: {
        fontSize: 16,
        fontWeight: '600',
        color: colors.foreground,
    },
    itemSubtitle: {
        fontSize: 13,
        color: colors.textSecondary,
    },
    chevronButton: {
        padding: 4,
        justifyContent: 'center',
        alignItems: 'center',
    },
    expandedContent: {
        paddingHorizontal: 16,
        paddingBottom: 12,
        paddingTop: 0,
    },
    expandedRow: {
        flexDirection: 'row',
        alignItems: 'center',
        marginTop: 4,
    },
    expandedLabel: {
        fontSize: 13,
        color: colors.textSecondary,
        width: 80,
    },
    expandedValue: {
        fontSize: 13,
        color: colors.foreground,
    },
    emptyState: {
        flex: 1,
        justifyContent: 'center',
        alignItems: 'center',
        paddingTop: 60,
    },
    emptyStateText: {
        color: colors.textSecondary,
        fontSize: 16,
    },
    // Live Discovery Styles
    liveSection: {
        paddingHorizontal: 16,
        paddingTop: 8,
        paddingBottom: 12,
        borderBottomWidth: 1,
        borderBottomColor: colors.border,
    },
    liveSectionTitle: {
        fontSize: 13,
        fontWeight: '700' as '700',
        color: colors.textSecondary,
        letterSpacing: 1,
        textTransform: 'uppercase',
        marginBottom: 8,
    },
    liveCard: {
        backgroundColor: 'rgba(255, 255, 255, 0.05)',
        borderRadius: 12,
        borderWidth: 1,
        borderColor: 'rgba(239, 68, 68, 0.3)',
        marginBottom: 8,
        overflow: 'hidden',
    },
    liveCardContent: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        paddingVertical: 12,
        paddingHorizontal: 14,
        gap: 12,
    },
    liveCardText: {
        flex: 1,
        gap: 2,
    },
    liveCardTitle: {
        fontSize: 15,
        fontWeight: '600',
        color: colors.foreground,
    },
    liveCardRound: {
        fontSize: 13,
        color: colors.textSecondary,
    },
    liveBadge: {
        backgroundColor: '#ef4444',
        paddingHorizontal: 10,
        paddingVertical: 4,
        borderRadius: 6,
    },
    liveBadgeText: {
        fontSize: 11,
        fontWeight: '700' as '700',
        color: '#ffffff',
        textTransform: 'uppercase',
        letterSpacing: 0.5,
    },
    sectionHeaderInline: {
        paddingHorizontal: 16,
        paddingTop: 16,
        paddingBottom: 8,
    },
    statusBadge: {
        paddingHorizontal: 10,
        paddingVertical: 4,
        borderRadius: 6,
    },
    statusBadgeText: {
        fontSize: 11,
        fontWeight: '700' as '700',
        color: '#ffffff',
        textTransform: 'uppercase',
        letterSpacing: 0.5,
    },
    chipRow: {
        flexDirection: 'row',
        paddingHorizontal: 12,
        paddingVertical: 8,
        gap: 7,
        backgroundColor: colors.background,
        borderBottomWidth: 1,
        borderBottomColor: colors.border,
    },
    chipToolbarRow: {
        flexDirection: 'row',
        alignItems: 'center',
        paddingVertical: 8,
        paddingRight: 12,
        backgroundColor: colors.background,
        borderBottomWidth: 1,
        borderBottomColor: colors.border,
    },
    chipsScroll: {
        flex: 1,
    },
    chipsScrollContent: {
        paddingHorizontal: 12,
        gap: 7,
        flexDirection: 'row',
        alignItems: 'center',
    },
    searchBarRow: {
        paddingHorizontal: 12,
        paddingVertical: 8,
        backgroundColor: colors.background,
        borderBottomWidth: 1,
        borderBottomColor: colors.border,
    },
    chip: {
        paddingHorizontal: 11,
        paddingVertical: 5,
        borderRadius: 14,
        backgroundColor: 'rgba(99, 102, 241, 0.15)',
        borderWidth: 1,
        borderColor: 'rgba(99, 102, 241, 0.3)',
    },
    chipDisabled: {
        backgroundColor: 'rgba(255, 255, 255, 0.02)',
        borderColor: 'rgba(255, 255, 255, 0.1)',
    },
    chipText: {
        fontSize: 12,
        fontWeight: '600',
        color: '#a5b4fc',
    },
    chipTextDisabled: {
        color: colors.textSecondary,
        opacity: 0.4,
    },
    sectionSpacer: {
        height: 12,
    },
});

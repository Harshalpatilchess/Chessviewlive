import { useRef, useEffect, useState, useMemo, useCallback } from 'react';
import { StatusBar } from 'expo-status-bar';
import { StyleSheet, Text, View, FlatList, Image, TouchableOpacity, TextInput, LayoutAnimation, Platform, UIManager, RefreshControl } from 'react-native';
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

    // Local Search State
    const [searchQuery, setSearchQuery] = useState('');
    const [isSearchMode, setIsSearchMode] = useState(false);
    const searchInputRef = useRef<TextInput>(null);
    const [refreshing, setRefreshing] = useState(false);

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

        // Force re-probe Tata Steel
        const p1 = prefetchTournament(TATA_STEEL_2026_SLUG); // Keep prefetch for detailed data
        const p2 = executeProbe(TATA_STEEL_2026_SLUG); // Re-run probe logic

        await Promise.all([p1, p2, minWait]);
        setRefreshing(false);
    }, [executeProbe]);

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

            {/* Section Label or Search Bar */}
            <View style={styles.sectionHeader}>
                {isSearchMode ? (
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
                ) : (
                    <View style={[styles.sectionHeaderRow, { justifyContent: 'flex-end' }]}>
                        <TouchableOpacity onPress={() => setIsSearchMode(true)} style={styles.searchIconButton}>
                            <Ionicons name="search" size={20} color={colors.textSecondary} />
                        </TouchableOpacity>
                    </View>
                )}
            </View>

            {/* Tournament List */}
            {filteredTournaments.length === 0 ? (
                <View style={styles.emptyState}>
                    <Text style={styles.emptyStateText}>
                        {searchQuery ? 'No matching tournaments.' : 'No tournaments found.'}
                    </Text>
                </View>
            ) : (
                <FlatList
                    style={styles.scrollView}
                    contentContainerStyle={styles.scrollContent}
                    data={filteredTournaments}
                    keyExtractor={item => item.id}
                    refreshControl={
                        <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.foreground} />
                    }
                    extraData={{ liveOverrides, now, refreshing, filteredTournaments, pendingProbes }} // Added pendingProbes
                    onViewableItemsChanged={onViewableItemsChanged}
                    viewabilityConfig={viewabilityConfig}
                    renderItem={({ item }) => (
                        <TournamentCard
                            tournament={item}
                            onPress={() => handleTournamentPress(item)}
                            now={now}
                            liveOverride={liveOverrides[item.slug]}
                            isChecking={pendingProbes.has(item.slug) && !liveOverrides[item.slug]} // Only show checking if NO override exists
                        />
                    )}
                />
            )}
        </View>
    );
}

function TournamentCard({ tournament, onPress, now, liveOverride, isChecking }: { tournament: Tournament; onPress: () => void; now: number; liveOverride?: LiveOverride; isChecking?: boolean }) {
    const [expanded, setExpanded] = useState(false);

    // Forces re-render if memory cache updates
    const cachedGames = getCachedGames(tournament.slug);

    const toggleExpand = () => {
        LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
        setExpanded(!expanded);
    };

    const { primaryText, secondaryText, statusColor, debugSource, preferredOpenRoundNumber } = useMemo(() => {
        return computeHomeRoundAndStatus(tournament, cachedGames, now, liveOverride, isChecking);
    }, [tournament, cachedGames, now, liveOverride, isChecking]);

    // One-time log per tournament render (if Tata) - SILENCED for loop spam prevention
    // useEffect(() => {
    //     if (__DEV__ && (tournament.slug.includes('tata') || tournament.slug.includes('steel'))) {
    //         const age = liveOverride ? Math.floor((Date.now() - liveOverride.lastUpdated) / 1000) : -1;
    //         const stateStr = liveOverride ? (liveOverride.isLive === true ? 'TRUE' : liveOverride.isLive === false ? 'FALSE' : 'NULL') : 'NONE';
    //         console.log(`HOME_ROW [${tournament.slug}] label="${primaryText} ${secondaryText}" live=${stateStr} prefRound=${preferredOpenRoundNumber} debug=${debugSource}`);
    //     }
    // }, [tournament.slug, primaryText, secondaryText, liveOverride, preferredOpenRoundNumber, debugSource]);

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
                    <Text style={styles.itemSubtitle}>
                        <Text style={{ color: statusColor, fontWeight: '700' }}>{primaryText}</Text>
                        <Text style={{ color: colors.foreground }}>{secondaryText}</Text>
                    </Text>
                </TouchableOpacity>

                {/* Chevron Trigger */}
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
            </View>


            {/* Expanded Content */}
            {expanded && (
                <View style={styles.expandedContent}>
                    <View style={styles.expandedRow}>
                        <Text style={styles.expandedLabel}>Status:</Text>
                        <Text style={styles.expandedValue}>{tournament.status}</Text>
                    </View>
                    {/* Placeholder for Avg Elo if it becomes available */}
                    {/*
                    <View style={styles.expandedRow}>
                        <Text style={styles.expandedLabel}>Avg Elo:</Text>
                        <Text style={styles.expandedValue}>####</Text>
                    </View>
                    */}
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
        paddingTop: 60,
        paddingBottom: 10,
        paddingHorizontal: 16, // Increased horizontal padding
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
        width: 140, // Increased by ~55% from 90
        height: 140,
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
        padding: 4,
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
});

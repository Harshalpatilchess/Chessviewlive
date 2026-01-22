import { StatusBar } from 'expo-status-bar';
import { StyleSheet, Text, View, FlatList, TouchableOpacity, useWindowDimensions, Modal, Pressable, Alert, TextInput } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { type GameSummary } from '@chessview/core';
import { getDefaultRound, isGameOngoing, isGameFinished } from '../utils/roundSelection';
import { broadcastTheme } from '../theme/broadcastTheme';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { RootStackParamList } from '../navigation/types';
import MiniBoard from '../components/MiniBoard';
import Capsule from '../components/Capsule';
import EngineBar from '../components/EngineBar';
import AboutModal from '../components/AboutModal';
import RoundSelectorCapsule from '../components/RoundSelectorCapsule';
import RoundSelectorSheet from '../components/RoundSelectorSheet';
import { memo, useState, useRef, useEffect, useMemo } from 'react';
import { getSettings } from '../utils/settingsStorage';
import { lastDebugStats, TATA_STEEL_2026_SLUG } from '../services/tataSteel';

type Props = NativeStackScreenProps<RootStackParamList, 'TournamentBoards'>;

type FilterType = 'ALL' | 'LIVE' | 'FINISHED';

// Fixed card height for getItemLayout optimization
// Fixed card height for getItemLayout optimization
const CARD_HEIGHT = 400; // Approximate: 16 (pad) + 30 (row) + 6 (gap) + 260 (board) + 6 (gap) + 30 (row) + 16 (pad)
const CARD_MARGIN = 16;
const ITEM_HEIGHT = CARD_HEIGHT + CARD_MARGIN;



// Ensure we always have rounds 1..13 even if no games loaded
function getFallbackRounds(): number[] {
    return Array.from({ length: 13 }, (_, i) => 13 - i); // [13, 12, ... 1]
}

import { usePollTournamentGames } from '../hooks/usePollTournamentGames';
import { RefreshControl } from 'react-native';

export default function TournamentBoardsScreen({ route, navigation }: Props) {
    const { tournamentSlug, tournamentName, initialRound } = route.params;
    const { games, refresh, isRefreshing, isHydrated } = usePollTournamentGames(tournamentSlug);
    const [filter, setFilter] = useState<FilterType>('ALL');
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
    const searchInputRef = useRef<TextInput>(null);

    // Compute available rounds from games data
    const availableRounds = useMemo(() => {
        const roundsSet = new Set<number>();
        games.forEach(game => {
            if (game.round !== undefined && game.round !== null) {
                // Handle both string and number types, ensure numeric value
                const roundNum = typeof game.round === 'string' ? parseInt(game.round, 10) : game.round;
                if (!isNaN(roundNum) && roundNum > 0) {
                    roundsSet.add(roundNum);
                }
            }
        });

        // If no rounds found from games, return fallback (1..13) so selector isn't empty
        if (roundsSet.size === 0) {
            return getFallbackRounds();
        }

        // Sort numerically descending (N, ... 3, 2, 1) - latest rounds first
        return Array.from(roundsSet).sort((a, b) => b - a);
    }, [games]);

    // Track if we have performed the initial round selection
    const hasInitializedRound = useRef(false);

    // Initialize selected round state
    // If we have games immediately (memory cache), use them. Otherwise default to 1 but wait for update.
    // Initialize selectedRound state
    // Use initialRound from navigation (Computed from memory cache) if available
    // Otherwise fallback to existing logic (memory cache check again or default 1)
    const [selectedRound, setSelectedRound] = useState<number | null>(() => {
        if (initialRound) {
            hasInitializedRound.current = true;
            if (__DEV__) console.log(`[TournamentBoards] initial selectedRound=${initialRound} (param/cache)`);
            return initialRound;
        }

        // Hydration Gate: If not hydrated (and thus no games potentially), start as null to hide UI
        if (!isHydrated) {
            if (__DEV__) console.log('[HydrationGate] isHydrated=false -> withholding rounds UI');
            return null;
        }

        const initialRoundFromEffect = getDefaultRound(games);
        // If games are already present, mark as initialized
        if (games.length > 0) {
            hasInitializedRound.current = true;
        }
        return initialRoundFromEffect;
    });

    // EFFECT: Update round when games first load (Async/Disk Cache case) or Hydration completes
    useEffect(() => {
        // Condition: Not initialized yet, but we are now hydrated.
        if (!hasInitializedRound.current && isHydrated) {
            const bestRound = getDefaultRound(games);
            setSelectedRound(bestRound);
            hasInitializedRound.current = true;
            if (__DEV__) console.log(`[HydrationGate] isHydrated=true -> selecting preferred round R${bestRound}`);
        }
    }, [games, isHydrated]);

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

        // If both players match, apply bonus
        if ((whiteStartsWith || whiteContains) && (blackStartsWith || blackContains)) {
            score *= 1.5;
        }

        return score;
    };

    // Filter games based on selected filter and persistent toggles
    const filteredGames = games.filter(game => {
        // First apply round filter
        // Use loose equality or explicit parsing as game.round might be string in some edge cases
        if (selectedRound === null) return false; // Gate: No games if no round selected

        if (game.round != undefined && game.round != null) {
            const r = typeof game.round === 'string' ? parseInt(game.round, 10) : game.round;
            if (r !== selectedRound) return false;
        }

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
        : filteredGames;

    const hasSearchResults = debouncedSearchQuery.trim() && displayGames.some(game => getSearchScore(game, debouncedSearchQuery.trim()) > 0);

    // DEV-ONLY DIAGNOSTICS: Rendering
    useEffect(() => {
        if (__DEV__ && tournamentSlug === TATA_STEEL_2026_SLUG) {
            console.log(`[TournamentBoards:Render] Selected Round: ${selectedRound}`);
            console.log(`[TournamentBoards:Render] Games passed to list: ${displayGames.length}`);

            // Log first 10 keys
            console.log('[TournamentBoards:Render] First 10 keys:', displayGames.slice(0, 10).map(g => g.gameId));

            // Check keys and duplicates
            const keys = displayGames.map(g => g.gameId);
            const uniqueKeys = new Set(keys);
            if (uniqueKeys.size !== keys.length) {
                console.warn('[TournamentBoards:Render] DUPLICATE KEYS DETECTED found in render list!');
                // Find duplicate
                const seen = new Set();
                const duplicates = keys.filter(k => {
                    const has = seen.has(k);
                    seen.add(k);
                    return has;
                });
                console.warn('[TournamentBoards:Render] Duplicates:', duplicates);
            }

            // Filtering reasons
            const totalForRound = games.filter(g => {
                const r = typeof g.round === 'string' ? parseInt(g.round, 10) : g.round;
                return r === selectedRound;
            }).length;

            const removedCount = totalForRound - displayGames.length;
            if (removedCount > 0) {
                console.log(`[TournamentBoards:Render] Filtered out ${removedCount} games from Round ${selectedRound}. Reasons: ` +
                    `LiveFilter=${liveGamesFilter}, CountryFilter=${countryGamesFilter}, Search=${!!debouncedSearchQuery}`);
            }
        }
    }, [displayGames, selectedRound, tournamentSlug, games, liveGamesFilter, countryGamesFilter, debouncedSearchQuery]);


    return (
        <View style={styles.container}>
            <StatusBar style="light" />

            {/* DEV Banner */}
            {__DEV__ && tournamentSlug === TATA_STEEL_2026_SLUG && (
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
                            onPress={() => Alert.alert('Navigation', 'Hamburger menu coming soon')}
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
                            placeholder="Search player"
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
                onSelectRound={(r) => setSelectedRound(r)}
                onClose={() => setRoundSelectorVisible(false)}
            />

            {/* Games Feed */}
            {selectedRound === null ? (
                <View style={styles.listContent}>
                    {/* Skeleton State during hydration gate */}
                    <SkeletonGameCard />
                    <SkeletonGameCard />
                    <SkeletonGameCard />
                </View>
            ) : debouncedSearchQuery.trim() && !hasSearchResults ? (
                <View style={styles.emptyState}>
                    <Text style={styles.emptyStateText}>No matching players</Text>
                </View>
            ) : displayGames.length === 0 ? (
                // Safe Empty State (No games loaded but not searching)
                <View style={[styles.emptyState, { justifyContent: 'center', paddingTop: 100 }]}>
                    <Ionicons name="grid-outline" size={64} color={broadcastTheme.colors.slate700} style={{ marginBottom: 16 }} />
                    <Text style={[styles.emptyStateText, { fontSize: 18, fontWeight: '600' }]}>
                        No games available
                    </Text>
                    <Text style={[styles.emptyStateText, { marginTop: 8, fontSize: 14, color: broadcastTheme.colors.slate400 }]}>
                        Waiting for round to start...
                    </Text>
                    {/* DEV INFO in empty state too if needed */}
                    {__DEV__ && tournamentSlug === TATA_STEEL_2026_SLUG && (
                        <Text style={{ marginTop: 20, color: '#633', fontSize: 10 }}>
                            Debug: {lastDebugStats.source} | {lastDebugStats.dgtUrl ? 'URL Found' : 'No URL'}
                        </Text>
                    )}
                </View>
            ) : (
                <FlatList
                    data={displayGames}
                    keyExtractor={(item) => item.gameId}
                    refreshControl={
                        <RefreshControl
                            refreshing={isRefreshing}
                            onRefresh={refresh}
                            tintColor={broadcastTheme.colors.sky400}
                            colors={[broadcastTheme.colors.sky400]}
                        />
                    }
                    renderItem={({ item }) => (
                        <GameCard
                            game={item}
                            flipBoards={flipBoards}
                            navigation={navigation}
                            tournamentSlug={tournamentSlug}
                            tournamentName={tournamentName}
                        />
                    )}
                    contentContainerStyle={styles.listContent}
                    showsVerticalScrollIndicator={false}
                    initialNumToRender={8}
                    maxToRenderPerBatch={8}
                    windowSize={11}
                    removeClippedSubviews={false} // Fix for missing items on some devices
                />
            )}
        </View>
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


const GameCard = memo(({ game, flipBoards, navigation, tournamentSlug, tournamentName }: {
    game: GameSummary;
    flipBoards: boolean;
    navigation: any;
    tournamentSlug: string;
    tournamentName: string;
}) => {
    const { width } = useWindowDimensions();

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

    // Determine display value for each player (clock if live, result if finished)
    const blackDisplayValue = game.isLive ? game.blackClock : (game.blackResult || '');
    const whiteDisplayValue = game.isLive ? game.whiteClock : (game.whiteResult || '');

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
                game.isLive && styles.gameCardLive
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
                    <MiniBoard fen={game.fen} size={boardSize} lastMove={game.lastMove} flipped={flipBoards} />
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
    emptyStateText: {
        fontWeight: '500' as '500',
    },
});


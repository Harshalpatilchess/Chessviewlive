import { StatusBar } from 'expo-status-bar';
import { StyleSheet, Text, View, FlatList, TouchableOpacity } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { getTournamentGames, type GameSummary } from '@chessview/core';
import { broadcastTheme } from '../theme/broadcastTheme';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { RootStackParamList } from '../navigation/types';

type Props = NativeStackScreenProps<RootStackParamList, 'TournamentLeaderboard'>;

interface PlayerStanding {
    rank: number;
    name: string;
    title?: string;
    federation?: string;
    rating?: number;
    points: number;
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

// Compute standings from game results
function computeStandings(games: GameSummary[]): PlayerStanding[] {
    const playerScores = new Map<string, { score: number; title?: string; federation?: string; rating?: number }>();

    // Aggregate points for each player
    games.forEach(game => {
        // White player
        if (!playerScores.has(game.whiteName)) {
            playerScores.set(game.whiteName, {
                score: 0,
                title: game.whiteTitle,
                federation: game.whiteFederation,
                rating: game.whiteRating,
            });
        }
        const whitePlayer = playerScores.get(game.whiteName)!;
        if (game.whiteResult === '1') whitePlayer.score += 1;
        else if (game.whiteResult === '½') whitePlayer.score += 0.5;

        // Black player
        if (!playerScores.has(game.blackName)) {
            playerScores.set(game.blackName, {
                score: 0,
                title: game.blackTitle,
                federation: game.blackFederation,
                rating: game.blackRating,
            });
        }
        const blackPlayer = playerScores.get(game.blackName)!;
        if (game.blackResult === '1') blackPlayer.score += 1;
        else if (game.blackResult === '½') blackPlayer.score += 0.5;
    });

    // Convert to array and sort
    const standings = Array.from(playerScores.entries())
        .map(([name, data]) => ({
            name,
            title: data.title,
            federation: data.federation,
            rating: data.rating,
            points: data.score,
            rank: 0, // Will be set after sorting
        }))
        .sort((a, b) => {
            // Sort by points descending
            if (b.points !== a.points) return b.points - a.points;
            // Tie-break: alphabetical by name
            return a.name.localeCompare(b.name);
        });

    // Assign ranks
    standings.forEach((player, index) => {
        player.rank = index + 1;
    });

    return standings;
}

export default function TournamentLeaderboardScreen({ route, navigation }: Props) {
    const { tournamentSlug, tournamentName } = route.params;
    const games = getTournamentGames(tournamentSlug);
    const standings = computeStandings(games);

    // Check if we have any data
    const hasData = standings.length > 0 && standings.some(p => p.points > 0);

    return (
        <View style={styles.container}>
            <StatusBar style="light" />

            {/* Header */}
            <View style={styles.header}>
                <TouchableOpacity
                    style={styles.backButton}
                    onPress={() => navigation.goBack()}
                >
                    <Ionicons name="arrow-back" size={24} color={broadcastTheme.colors.slate200} />
                </TouchableOpacity>

                <View style={styles.headerCenter}>
                    <Text style={styles.tournamentName} numberOfLines={1}>
                        {tournamentName}
                    </Text>
                    <Text style={styles.subtitle}>Leaderboard</Text>
                </View>

                <View style={styles.headerSpacer} />
            </View>

            {/* Table Header */}
            <View style={styles.tableHeader}>
                <Text style={[styles.tableHeaderText, styles.colRank]}>Sr. No</Text>
                <Text style={[styles.tableHeaderText, styles.colFlag]}></Text>
                <Text style={[styles.tableHeaderText, styles.colTitle]}></Text>
                <Text style={[styles.tableHeaderText, styles.colName]}>Name</Text>
                <Text style={[styles.tableHeaderText, styles.colRating]}>Rating</Text>
                <Text style={[styles.tableHeaderText, styles.colPoints]}>Points</Text>
            </View>

            {/* Standings List */}
            {hasData ? (
                <FlatList
                    data={standings}
                    keyExtractor={(item) => item.name}
                    renderItem={({ item }) => (
                        <View style={styles.row}>
                            <Text style={[styles.cellText, styles.colRank]}>{item.rank}</Text>
                            <Text style={[styles.cellText, styles.colFlag]}>
                                {getFlagEmoji(item.federation)}
                            </Text>
                            <Text style={[styles.cellTextTitle, styles.colTitle]}>
                                {item.title || ''}
                            </Text>
                            <Text style={[styles.cellTextName, styles.colName]} numberOfLines={1}>
                                {item.name}
                            </Text>
                            <Text style={[styles.cellText, styles.colRating]}>
                                {item.rating || '-'}
                            </Text>
                            <Text style={[styles.cellTextPoints, styles.colPoints]}>
                                {item.points.toFixed(item.points % 1 === 0 ? 0 : 1)}
                            </Text>
                        </View>
                    )}
                    contentContainerStyle={styles.listContent}
                    showsVerticalScrollIndicator={false}
                />
            ) : (
                <View style={styles.emptyState}>
                    <Text style={styles.emptyStateText}>
                        Leaderboard unavailable for this tournament
                    </Text>
                </View>
            )}
        </View>
    );
}

const styles = StyleSheet.create({
    container: {
        flex: 1,
        backgroundColor: broadcastTheme.colors.background,
    },
    header: {
        flexDirection: 'row',
        alignItems: 'center',
        paddingTop: 50,
        paddingBottom: 12,
        paddingHorizontal: 16,
        backgroundColor: broadcastTheme.colors.background,
        borderBottomWidth: 1,
        borderBottomColor: broadcastTheme.colors.borderDefault,
    },
    backButton: {
        width: 40,
        height: 40,
        alignItems: 'center',
        justifyContent: 'center',
    },
    headerCenter: {
        flex: 1,
        marginHorizontal: 12,
        alignItems: 'center',
    },
    tournamentName: {
        fontSize: 16,
        fontWeight: '700' as '700',
        color: broadcastTheme.colors.slate50,
    },
    subtitle: {
        fontSize: 12,
        color: '#FFFFFF',
        marginTop: 2,
    },
    headerSpacer: {
        width: 40,
    },
    tableHeader: {
        flexDirection: 'row',
        paddingVertical: 12,
        paddingHorizontal: 16,
        backgroundColor: broadcastTheme.colors.slate900,
        borderBottomWidth: 1,
        borderBottomColor: broadcastTheme.colors.borderDefault,
    },
    tableHeaderText: {
        fontSize: 12,
        fontWeight: '700' as '700',
        color: broadcastTheme.colors.slate400,
        textTransform: 'uppercase',
    },
    listContent: {
        padding: 16,
    },
    row: {
        flexDirection: 'row',
        alignItems: 'center',
        paddingVertical: 12,
        paddingHorizontal: 12,
        backgroundColor: 'rgba(2, 6, 23, 0.7)',
        borderRadius: broadcastTheme.radii.lg,
        marginBottom: 8,
        borderWidth: 1,
        borderColor: broadcastTheme.colors.borderDefault,
    },
    cellText: {
        fontSize: 13,
        color: broadcastTheme.colors.slate300,
        fontWeight: '500' as '500',
    },
    cellTextTitle: {
        fontSize: 11,
        color: broadcastTheme.colors.amber200,
        fontWeight: '700' as '700',
    },
    cellTextName: {
        fontSize: 15,
        color: broadcastTheme.colors.slate50,
        fontWeight: '600' as '600',
    },
    cellTextPoints: {
        fontSize: 16,
        color: broadcastTheme.colors.sky400,
        fontWeight: '700' as '700',
    },
    // Column widths
    colRank: {
        width: 50,
    },
    colFlag: {
        width: 30,
    },
    colTitle: {
        width: 40,
    },
    colName: {
        flex: 1,
        minWidth: 100,
    },
    colRating: {
        width: 60,
        textAlign: 'right' as 'right',
    },
    colPoints: {
        width: 60,
        textAlign: 'right' as 'right',
    },
    emptyState: {
        flex: 1,
        justifyContent: 'center',
        alignItems: 'center',
        paddingTop: 80,
    },
    emptyStateText: {
        fontSize: 15,
        color: broadcastTheme.colors.slate400,
        fontWeight: '500' as '500',
    },
});

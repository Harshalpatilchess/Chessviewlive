import { StatusBar } from 'expo-status-bar';
import { StyleSheet, Text, View, FlatList, TouchableOpacity } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { broadcastTheme } from '../theme/broadcastTheme';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { RootStackParamList } from '../navigation/types';
import { useState, useEffect } from 'react';
import { getTournaments, getTournamentGames } from '@chessview/core';

type Props = NativeStackScreenProps<RootStackParamList, 'FavouritePlayers'>;

interface Player {
    id: string; // Unique identifier (name)
    name: string;
    title?: string;
    federation?: string;
    rating?: number;
}

const STORAGE_KEY = '@chessview_favourite_players';

export default function FavouritePlayersScreen({ navigation }: Props) {
    const [players, setPlayers] = useState<Player[]>([]);
    const [selectedPlayerIds, setSelectedPlayerIds] = useState<Set<string>>(new Set());

    useEffect(() => {
        loadPlayers();
        loadSelectedPlayers();
    }, []);

    const loadPlayers = () => {
        // Get all unique players from all tournaments
        const tournaments = getTournaments();
        const playerMap = new Map<string, Player>();

        tournaments.forEach(tournament => {
            const games = getTournamentGames(tournament.slug);
            games.forEach(game => {
                // Add white player
                if (!playerMap.has(game.whiteName)) {
                    playerMap.set(game.whiteName, {
                        id: game.whiteName,
                        name: game.whiteName,
                        title: game.whiteTitle,
                        federation: game.whiteFederation,
                        rating: game.whiteRating,
                    });
                }
                // Add black player
                if (!playerMap.has(game.blackName)) {
                    playerMap.set(game.blackName, {
                        id: game.blackName,
                        name: game.blackName,
                        title: game.blackTitle,
                        federation: game.blackFederation,
                        rating: game.blackRating,
                    });
                }
            });
        });

        // Convert to array and sort alphabetically
        const uniquePlayers = Array.from(playerMap.values()).sort((a, b) =>
            a.name.localeCompare(b.name)
        );

        setPlayers(uniquePlayers);
    };

    const loadSelectedPlayers = async () => {
        try {
            const AsyncStorage = (await import('@react-native-async-storage/async-storage')).default;
            const json = await AsyncStorage.getItem(STORAGE_KEY);
            if (json) {
                const saved = JSON.parse(json);
                setSelectedPlayerIds(new Set(saved));
            }
        } catch (error) {
            console.error('Failed to load favourite players:', error);
        }
    };

    const saveSelectedPlayers = async (selected: Set<string>) => {
        try {
            const AsyncStorage = (await import('@react-native-async-storage/async-storage')).default;
            await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(Array.from(selected)));
        } catch (error) {
            console.error('Failed to save favourite players:', error);
        }
    };

    const togglePlayer = (playerId: string) => {
        const newSelected = new Set(selectedPlayerIds);
        if (newSelected.has(playerId)) {
            newSelected.delete(playerId);
        } else {
            newSelected.add(playerId);
        }
        setSelectedPlayerIds(newSelected);
        saveSelectedPlayers(newSelected);
    };

    const getFlagEmoji = (countryCode?: string): string => {
        if (!countryCode || countryCode.length !== 2) return '';
        const codePoints = countryCode
            .toUpperCase()
            .split('')
            .map(char => 127397 + char.charCodeAt(0));
        return String.fromCodePoint(...codePoints);
    };

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
                <Text style={styles.headerTitle}>Favourite Players</Text>
                <View style={styles.headerSpacer} />
            </View>

            {/* Info note */}
            <View style={styles.infoContainer}>
                <Text style={styles.infoText}>
                    You'll get alerts when selected players start or finish games.
                </Text>
            </View>

            {/* Player List */}
            <FlatList
                data={players}
                keyExtractor={(item) => item.id}
                renderItem={({ item }) => {
                    const isSelected = selectedPlayerIds.has(item.id);
                    const flag = getFlagEmoji(item.federation);

                    return (
                        <TouchableOpacity
                            style={styles.playerRow}
                            onPress={() => togglePlayer(item.id)}
                            activeOpacity={0.7}
                        >
                            {/* Checkbox */}
                            <View style={[styles.checkbox, isSelected && styles.checkboxSelected]}>
                                {isSelected && (
                                    <Ionicons name="checkmark" size={16} color={broadcastTheme.colors.slate50} />
                                )}
                            </View>

                            {/* Player info */}
                            <View style={styles.playerInfo}>
                                {flag && <Text style={styles.flag}>{flag}</Text>}
                                {item.title && (
                                    <View style={styles.titleBadge}>
                                        <Text style={styles.titleText}>{item.title}</Text>
                                    </View>
                                )}
                                <Text style={styles.playerName} numberOfLines={1}>
                                    {item.name}
                                </Text>
                                {item.rating && (
                                    <Text style={styles.rating}>{item.rating}</Text>
                                )}
                            </View>
                        </TouchableOpacity>
                    );
                }}
                contentContainerStyle={styles.listContent}
                showsVerticalScrollIndicator={false}
            />
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
    headerTitle: {
        flex: 1,
        fontSize: 18,
        fontWeight: '700' as '700',
        color: broadcastTheme.colors.slate50,
        textAlign: 'center',
        marginRight: 40, // Balance the back button
    },
    headerSpacer: {
        width: 40,
    },
    infoContainer: {
        paddingHorizontal: 16,
        paddingVertical: 12,
        backgroundColor: broadcastTheme.colors.slate900,
        borderBottomWidth: 1,
        borderBottomColor: broadcastTheme.colors.borderDefault,
    },
    infoText: {
        fontSize: 12,
        color: broadcastTheme.colors.slate400,
        textAlign: 'center',
        lineHeight: 17,
    },
    listContent: {
        padding: 16,
    },
    playerRow: {
        flexDirection: 'row',
        alignItems: 'center',
        paddingVertical: 12,
        paddingHorizontal: 12,
        marginBottom: 8,
        backgroundColor: broadcastTheme.colors.slate900,
        borderRadius: broadcastTheme.radii.lg,
        borderWidth: 1,
        borderColor: broadcastTheme.colors.borderDefault,
    },
    checkbox: {
        width: 22,
        height: 22,
        borderWidth: 2,
        borderColor: broadcastTheme.colors.slate400,
        borderRadius: 4,
        alignItems: 'center',
        justifyContent: 'center',
        marginRight: 12,
    },
    checkboxSelected: {
        backgroundColor: broadcastTheme.colors.sky400,
        borderColor: broadcastTheme.colors.sky400,
    },
    playerInfo: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 6,
        flex: 1,
    },
    flag: {
        fontSize: 16,
        lineHeight: 18,
    },
    titleBadge: {
        backgroundColor: broadcastTheme.colors.amber200,
        paddingHorizontal: 6,
        paddingVertical: 2,
        borderRadius: broadcastTheme.radii.full,
    },
    titleText: {
        fontSize: 11,
        fontWeight: '700' as '700',
        color: broadcastTheme.colors.slate950,
    },
    playerName: {
        fontSize: 15,
        fontWeight: '600' as '600',
        color: broadcastTheme.colors.slate50,
        flex: 1,
    },
    rating: {
        fontSize: 13,
        fontWeight: '600' as '600',
        color: broadcastTheme.colors.slate400,
    },
});

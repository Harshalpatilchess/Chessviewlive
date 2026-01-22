import { StatusBar } from 'expo-status-bar';
import { StyleSheet, Text, View, ScrollView, Image, TouchableOpacity } from 'react-native';
import { getTournaments, type Tournament } from '@chessview/core';
import { colors } from '../theme/colors';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { RootStackParamList } from '../navigation/types';

type Props = NativeStackScreenProps<RootStackParamList, 'Tournaments'>;

export default function TournamentsScreen({ navigation }: Props) {
    const tournaments = getTournaments();

    const handleTournamentPress = (tournament: Tournament) => {
        navigation.navigate('TournamentBoards', {
            tournamentSlug: tournament.slug,
            tournamentName: tournament.name,
        });
    };

    return (
        <View style={styles.container}>
            <StatusBar style="light" />

            {/* Header */}
            <View style={styles.header}>
                <View style={styles.headerContent}>
                    <Image
                        source={require('../../assets/logo.png')}
                        style={styles.logo}
                        resizeMode="contain"
                    />
                    <Text style={styles.title}>ChessView Live</Text>
                </View>
            </View>

            {/* Section Label */}
            <View style={styles.sectionHeader}>
                <Text style={styles.sectionLabel}>TOURNAMENTS</Text>
            </View>

            {/* Tournament List */}
            <ScrollView style={styles.scrollView} contentContainerStyle={styles.scrollContent}>
                {tournaments.map(tournament => (
                    <TournamentCard
                        key={tournament.id}
                        tournament={tournament}
                        onPress={() => handleTournamentPress(tournament)}
                    />
                ))}
            </ScrollView>
        </View>
    );
}

function TournamentCard({ tournament, onPress }: { tournament: Tournament; onPress: () => void }) {
    const subtitle = [
        tournament.dateRange,
        tournament.rounds ? `${tournament.rounds} rounds` : null,
        tournament.location && tournament.country ? `${tournament.location}, ${tournament.country}` : tournament.country,
    ].filter(Boolean).join(' • ');

    const isOngoing = tournament.status === 'ONGOING';
    const isFinished = tournament.status === 'FINISHED';

    return (
        <TouchableOpacity
            style={[
                styles.tournamentCard,
                isOngoing && styles.tournamentCardOngoing,
                isFinished && styles.tournamentCardFinished,
            ]}
            onPress={onPress}
            activeOpacity={0.7}
        >
            <View style={styles.tournamentInfo}>
                <View style={styles.tournamentHeader}>
                    <Text style={[
                        styles.tournamentName,
                        isFinished && styles.tournamentNameMuted,
                    ]}>
                        {tournament.name}
                    </Text>
                    {isOngoing && (
                        <View style={styles.ongoingBadge}>
                            <Text style={styles.ongoingText}>ONGOING</Text>
                        </View>
                    )}
                </View>
                <Text style={[
                    styles.tournamentSubtitle,
                    isFinished && styles.tournamentSubtitleMuted
                ]}>
                    {subtitle}
                </Text>
            </View>
        </TouchableOpacity>
    );
}

const styles = StyleSheet.create({
    container: {
        flex: 1,
        backgroundColor: colors.background,
    },
    header: {
        paddingTop: 60,
        paddingBottom: 20,
        paddingHorizontal: 20,
        backgroundColor: colors.background,
        borderBottomWidth: 1,
        borderBottomColor: colors.border,
    },
    headerContent: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 16,
    },
    logo: {
        width: 88,
        height: 88,
    },
    title: {
        fontSize: 28,
        fontWeight: '700' as '700',
        color: colors.foreground,
    },
    sectionHeader: {
        paddingHorizontal: 20,
        paddingTop: 20,
        paddingBottom: 12,
    },
    sectionLabel: {
        fontSize: 12,
        fontWeight: '700' as '700',
        color: colors.textSecondary,
        letterSpacing: 1,
    },
    scrollView: {
        flex: 1,
    },
    scrollContent: {
        paddingHorizontal: 16,
        paddingBottom: 20,
    },
    tournamentCard: {
        backgroundColor: colors.backgroundCard,
        borderRadius: 12,
        padding: 16,
        marginBottom: 12,
        borderWidth: 1,
        borderColor: 'transparent',
    },
    tournamentCardOngoing: {
        borderColor: colors.accent,
        backgroundColor: '#1a2a3a',
    },
    tournamentCardFinished: {
        backgroundColor: colors.backgroundSecondary,
        opacity: 0.7,
    },
    tournamentInfo: {
        gap: 8,
    },
    tournamentHeader: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: 12,
    },
    tournamentName: {
        fontSize: 16,
        fontWeight: '600' as '600',
        color: colors.foreground,
        flex: 1,
    },
    tournamentNameMuted: {
        color: colors.textSecondary,
    },
    ongoingBadge: {
        backgroundColor: colors.accent,
        paddingVertical: 4,
        paddingHorizontal: 10,
        borderRadius: 12,
    },
    ongoingText: {
        fontSize: 10,
        fontWeight: '700' as '700',
        color: colors.foreground,
        letterSpacing: 0.5,
    },
    tournamentSubtitle: {
        fontSize: 13,
        color: colors.textSecondary,
        lineHeight: 18,
    },
    tournamentSubtitleMuted: {
        color: colors.textMuted,
    },
});

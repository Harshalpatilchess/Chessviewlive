import { StatusBar } from 'expo-status-bar';
import { StyleSheet, Text, View, ScrollView, TouchableOpacity, Image } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { broadcastTheme } from '../theme/broadcastTheme';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { RootStackParamList } from '../navigation/types';
import MiniBoard from '../components/MiniBoard';
import { BOARD_THEMES, type BoardThemeId } from '../config/boardConfig';
import { useSettings } from '../contexts/SettingsContext';

type Props = NativeStackScreenProps<RootStackParamList, 'BoardDesign'>;

// Demo position with last move
const DEMO_FEN = 'rnbqkbnr/pppp1ppp/8/4p3/4P3/8/PPPP1PPP/RNBQKBNR w KQkq e6 0 2';
const DEMO_LAST_MOVE = 'e7e5';

export default function BoardDesignScreen({ navigation }: Props) {
    const { settings, updateBoardTheme } = useSettings();

    if (!settings) {
        return <View style={styles.container} />;
    }

    const { boardThemeId } = settings;

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
                <Text style={styles.headerTitle}>Board Design</Text>
                <View style={styles.headerSpacer} />
            </View>

            {/* Content */}
            <View style={styles.content}>
                {/* Preview Board - smaller */}
                <View style={styles.previewContainer}>
                    <MiniBoard fen={DEMO_FEN} size={240} lastMove={DEMO_LAST_MOVE} flipped={false} />
                </View>

                {/* Board Themes - 2x2 mini boards */}
                <View style={styles.section}>
                    <Text style={styles.sectionHeader}>Board Color</Text>
                    <View style={styles.themeRowCompact}>
                        {Object.keys(BOARD_THEMES).map((themeId) => {
                            const theme = BOARD_THEMES[themeId];
                            return (
                                <TouchableOpacity
                                    key={themeId}
                                    style={[
                                        styles.themeTileCompact,
                                        boardThemeId === themeId && styles.themeTileCompactSelected
                                    ]}
                                    onPress={() => updateBoardTheme(themeId)}
                                >
                                    {/* 2x2 Checkerboard pattern */}
                                    <View style={styles.miniBoard2x2}>
                                        <View style={styles.miniRow}>
                                            <View style={[styles.miniSquare, { backgroundColor: theme.lightSquare }]} />
                                            <View style={[styles.miniSquare, { backgroundColor: theme.darkSquare }]} />
                                        </View>
                                        <View style={styles.miniRow}>
                                            <View style={[styles.miniSquare, { backgroundColor: theme.darkSquare }]} />
                                            <View style={[styles.miniSquare, { backgroundColor: theme.lightSquare }]} />
                                        </View>
                                    </View>
                                    <Text style={[
                                        styles.themeLabelCompact,
                                        boardThemeId === themeId && styles.themeLabelCompactSelected
                                    ]}>{themeId}</Text>
                                </TouchableOpacity>
                            );
                        })}
                    </View>
                </View>
            </View>
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
        marginRight: 40,
    },
    headerSpacer: {
        width: 40,
    },
    content: {
        flex: 1,
        paddingHorizontal: 16,
    },
    previewContainer: {
        alignItems: 'center',
        paddingVertical: 12,
    },
    section: {
        marginTop: 12,
    },
    sectionHeader: {
        fontSize: 12,
        fontWeight: '600' as '600',
        color: broadcastTheme.colors.amber200,
        marginBottom: 8,
        textTransform: 'capitalize',
    },
    // Compact last-move controls
    compactSection: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        marginTop: 12,
        paddingVertical: 8,
    },
    compactSectionCentered: {
        flexDirection: 'column',
        alignItems: 'center',
        marginTop: 12,
        paddingVertical: 8,
        gap: 8,
    },
    compactLabel: {
        fontSize: 12,
        fontWeight: '600' as '600',
        color: broadcastTheme.colors.amber200,
        textTransform: 'capitalize',
    },
    indicatorRowCompact: {
        flexDirection: 'row',
        gap: 8,
    },
    indicatorIconButton: {
        width: 36,
        height: 36,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: broadcastTheme.colors.slate900,
        borderRadius: 6,
        borderWidth: 1,
        borderColor: broadcastTheme.colors.borderDefault,
    },
    indicatorIconButtonSelected: {
        borderColor: broadcastTheme.colors.sky400,
        backgroundColor: 'rgba(56, 189, 248, 0.15)',
    },
    // Compact piece sets - Knight only
    pieceSetRowCompact: {
        flexDirection: 'row',
        gap: 10,
        flexWrap: 'wrap',
    },
    pieceSetTileCompact: {
        alignItems: 'center',
        padding: 6,
        backgroundColor: broadcastTheme.colors.slate900,
        borderRadius: 8,
        borderWidth: 1,
        borderColor: broadcastTheme.colors.borderDefault,
        minWidth: 60,
    },
    pieceSetTileCompactSelected: {
        borderColor: broadcastTheme.colors.sky400,
        backgroundColor: 'rgba(56, 189, 248, 0.1)',
    },
    knightIconContainer: {
        width: 50,
        height: 50,
        alignItems: 'center',
        justifyContent: 'center',
    },
    knightImage: {
        width: 48,
        height: 48,
    },
    pieceSetLabelCompact: {
        marginTop: 4,
        fontSize: 10,
        fontWeight: '500' as '500',
        color: broadcastTheme.colors.slate400,
        textTransform: 'capitalize',
    },
    pieceSetLabelCompactSelected: {
        color: broadcastTheme.colors.sky400,
    },
    // Compact board themes - 2x2 mini boards
    themeRowCompact: {
        flexDirection: 'row',
        gap: 10,
        flexWrap: 'wrap',
    },
    themeTileCompact: {
        alignItems: 'center',
        padding: 8,
        backgroundColor: broadcastTheme.colors.slate900,
        borderRadius: 8,
        borderWidth: 1,
        borderColor: broadcastTheme.colors.borderDefault,
        minWidth: 60,
    },
    themeTileCompactSelected: {
        borderColor: broadcastTheme.colors.sky400,
        backgroundColor: 'rgba(56, 189, 248, 0.1)',
    },
    miniBoard2x2: {
        width: 44,
        height: 44,
    },
    miniRow: {
        flexDirection: 'row',
    },
    miniSquare: {
        width: 22,
        height: 22,
    },
    themeLabelCompact: {
        marginTop: 6,
        fontSize: 10,
        fontWeight: '500' as '500',
        color: broadcastTheme.colors.slate400,
        textTransform: 'capitalize',
    },
    themeLabelCompactSelected: {
        color: broadcastTheme.colors.sky400,
    },
});

import React, { useState, useEffect } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Switch, LayoutAnimation, Platform, UIManager } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { premiumTheme } from '../theme/premiumTheme';
import { useMobileEngineEvaluation } from '../hooks/useMobileEngineEvaluation';
import { Ionicons } from '@expo/vector-icons';
import { Move } from 'lucide-react-native';

// Enable layout animation for Android
if (Platform.OS === 'android' && UIManager.setLayoutAnimationEnabledExperimental) {
    UIManager.setLayoutAnimationEnabledExperimental(true);
}

const ENGINE_PREF_KEY = 'engine_enabled_preference_v1';

interface EngineViewProps {
    fen: string;
    isLiveMode: boolean; // Potentially used to pause auto-eval in future
}

export default function EngineView({ fen, isLiveMode }: EngineViewProps) {
    const [isEnabled, setIsEnabled] = useState(false);
    const [isLoaded, setIsLoaded] = useState(false); // To prevent flash of default state

    // Load persisted preference
    useEffect(() => {
        (async () => {
            try {
                const stored = await AsyncStorage.getItem(ENGINE_PREF_KEY);
                if (stored !== null) {
                    setIsEnabled(stored === 'true');
                }
            } catch (e) {
                console.warn('Failed to load engine pref', e);
            } finally {
                setIsLoaded(true);
            }
        })();
    }, []);

    const toggleSwitch = async () => {
        LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
        const newState = !isEnabled;
        setIsEnabled(newState);
        try {
            await AsyncStorage.setItem(ENGINE_PREF_KEY, String(newState));
        } catch (e) {
            console.warn('Failed to save engine pref', e);
        }
    };

    // Engine Hook
    const { isEvaluating, evalResult, bestLines } = useMobileEngineEvaluation({
        enabled: isEnabled,
        fen,
    });

    // Formatting helpers
    const formatScore = (cp?: number, mate?: number) => {
        if (mate !== undefined) {
            return `M${Math.abs(mate)}`;
        }
        if (cp !== undefined) {
            const score = cp / 100;
            return (score > 0 ? '+' : '') + score.toFixed(2);
        }
        return '--';
    };

    if (!isLoaded) return null;

    const topMove = bestLines && bestLines.length > 0 ? bestLines[0] : null;
    const headlineScore = topMove ? formatScore(topMove.scoreCp, topMove.scoreMate) : '--';
    const depth = topMove ? topMove.depth : 0;

    return (
        <View style={styles.container}>
            {/* Engine Toggle Card */}
            <View style={styles.card}>
                <View style={styles.cardHeader}>
                    <View style={styles.toggleRow}>
                        <Switch
                            trackColor={{ false: '#334155', true: 'rgba(16, 185, 129, 0.3)' }} // slate-700, emerald-500/30
                            thumbColor={isEnabled ? '#34d399' : '#94a3b8'} // emerald-400, slate-400
                            ios_backgroundColor="#334155"
                            onValueChange={toggleSwitch}
                            value={isEnabled}
                            style={{ transform: [{ scaleX: 0.8 }, { scaleY: 0.8 }] }}
                        />
                        <View style={styles.headerText}>
                            <Text style={styles.title}>
                                Stockfish 17.1 NNUE cloud
                            </Text>
                            <Text style={styles.subtitle}>
                                Cloud engine
                            </Text>
                        </View>
                    </View>

                    {isEnabled && (
                        <View style={styles.scoreBlock}>
                            <Text style={styles.bigScore}>{headlineScore}</Text>
                            <Text style={styles.depthText}>Depth {depth}</Text>
                        </View>
                    )}
                </View>
            </View>

            {/* Analysis Lines List */}
            {isEnabled && (
                <View style={styles.linesContainer}>
                    {isEvaluating && bestLines.length === 0 ? (
                        <View style={styles.loadingRow}>
                            <Text style={styles.loadingText}>Thinking...</Text>
                        </View>
                    ) : (
                        bestLines.map((line, index) => {
                            const score = formatScore(line.scoreCp, line.scoreMate);
                            // Simple PV sanitization - simpler than web's full parser for now
                            const pvText = line.pvMoves ? line.pvMoves.join(' ') : '';

                            return (
                                <View key={index} style={styles.lineRow}>
                                    <View style={styles.lineScoreBadge}>
                                        <Text style={styles.lineScoreText}>{score}</Text>
                                    </View>
                                    <Text style={styles.linePv} numberOfLines={1} ellipsizeMode="tail">
                                        {pvText}
                                    </Text>
                                </View>
                            );
                        })
                    )}
                </View>
            )}
        </View>
    );
}

const styles = StyleSheet.create({
    container: {
        width: '100%',
        paddingVertical: 12,
        paddingHorizontal: 16,
        gap: 12,
    },
    card: {
        backgroundColor: premiumTheme.colors.bgHeader,
        borderRadius: 16,
        borderWidth: 1,
        borderColor: premiumTheme.colors.border,
        padding: 12,
    },
    cardHeader: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
    },
    toggleRow: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 8,
    },
    headerText: {
        gap: 2,
    },
    title: {
        fontSize: 14,
        fontWeight: '600',
        color: premiumTheme.colors.textPrimary,
    },
    subtitle: {
        fontSize: 11,
        color: premiumTheme.colors.textSecondary,
    },
    scoreBlock: {
        alignItems: 'flex-end',
    },
    bigScore: {
        fontSize: 18,
        fontWeight: '700',
        color: premiumTheme.colors.textSecondary, // Neutral evaluation text
        fontVariant: ['tabular-nums'],
    },
    depthText: {
        fontSize: 10,
        fontWeight: '600',
        color: premiumTheme.colors.textSecondary,
        textTransform: 'uppercase',
    },
    linesContainer: {
        gap: 8,
    },
    loadingRow: {
        padding: 12,
        alignItems: 'center',
    },
    loadingText: {
        fontSize: 13,
        color: premiumTheme.colors.textSecondary,
        fontStyle: 'italic',
    },
    lineRow: {
        flexDirection: 'row',
        alignItems: 'center',
        backgroundColor: premiumTheme.colors.bgSubtle,
        padding: 10,
        borderRadius: 10,
        borderWidth: 1,
        borderColor: premiumTheme.colors.borderSubtle,
        gap: 12,
    },
    lineScoreBadge: {
        minWidth: 44,
        paddingVertical: 4,
        paddingHorizontal: 6,
        backgroundColor: premiumTheme.colors.bgSubtle,
        borderRadius: 6,
        alignItems: 'center',
        justifyContent: 'center',
        borderWidth: 1,
        borderColor: premiumTheme.colors.border,
    },
    lineScoreText: {
        fontSize: 12,
        fontWeight: '700',
        color: premiumTheme.colors.textPrimary,
        fontVariant: ['tabular-nums'],
    },
    linePv: {
        flex: 1,
        fontSize: 13,
        fontFamily: Platform.select({ ios: 'Menlo', android: 'monospace' }),
        color: premiumTheme.colors.textSecondary,
    },
});

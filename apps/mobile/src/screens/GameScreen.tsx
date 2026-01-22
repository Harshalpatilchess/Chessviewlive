import { StatusBar } from 'expo-status-bar';
import { StyleSheet, Text, View, TouchableOpacity, Modal, Pressable, Alert, useWindowDimensions, Switch } from 'react-native';
import { ChevronLeft, ChevronRight, FlipHorizontal, Share2, Play, Pause, FlaskConical, Activity } from 'lucide-react-native'; // Changed Activity to lucide
import { Ionicons } from '@expo/vector-icons';
import { broadcastTheme } from '../theme/broadcastTheme';
import { premiumTheme } from '../theme/premiumTheme';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { RootStackParamList } from '../navigation/types';
import { useState, memo, useEffect, useMemo, useRef, useCallback } from 'react';
import MiniBoard from '../components/MiniBoard';
import Capsule from '../components/Capsule';
import AboutModal from '../components/AboutModal';
import EvalBar from '../components/EvalBar';
import GameTabs, { TabType } from '../components/GameTabs';
import soundManager from '../utils/soundManager';
import { Chess } from 'chess.js';
import NotationView, { Move } from '../components/NotationView';
import EngineView from '../components/EngineView';
import InfoToastCard from '../components/InfoToastCard';
import { usePollTournamentGames } from '../hooks/usePollTournamentGames';
import Constants, { ExecutionEnvironment } from 'expo-constants';
// import { VolumeManager, VolumeResult } from 'react-native-volume-manager';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useFocusEffect } from '@react-navigation/native';

type Props = NativeStackScreenProps<RootStackParamList, 'Game'>;

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
    if (!clock) return '';
    const parts = clock.split(':');
    if (parts.length === 2) {
        const mins = parts[0].padStart(2, '0');
        const secs = parts[1].padStart(2, '0');
        return `${mins}:${secs}`;
    } else if (parts.length === 3) {
        const hours = parts[0].padStart(2, '0');
        const mins = parts[1].padStart(2, '0');
        const secs = parts[2].padStart(2, '0');
        return `${hours}:${mins}:${secs}`;
    }
    return clock;
}



const PlayerInfoBlock = memo(({
    name,
    title,
    federation,
    rating,
    clock,
    align,
    isWhite
}: {
    name: string;
    title?: string;
    federation?: string;
    rating?: number;
    clock?: string;
    align: 'left' | 'right';
    isWhite: boolean;
}) => {
    const flag = getFlagEmoji(federation);
    const formattedClock = formatClock(clock || '');

    // Toast Interaction Logic
    const [toastVisible, setToastVisible] = useState(false);
    const timeoutRef = useRef<NodeJS.Timeout>();

    const handlePress = useCallback(() => {
        // Clear existing timer if any
        if (timeoutRef.current) clearTimeout(timeoutRef.current);

        // Show visibility
        setToastVisible(true);

        // Auto-hide after 2.5s
        timeoutRef.current = setTimeout(() => {
            setToastVisible(false);
        }, 2500);
    }, []);

    // Cleanup
    useEffect(() => {
        return () => {
            if (timeoutRef.current) clearTimeout(timeoutRef.current);
        };
    }, []);

    // Placeholder flag (small circle) if missing
    const flagDisplay = flag ? (
        <Text style={styles.stripFlag}>{flag}</Text>
    ) : (
        <View style={styles.stripFlagPlaceholder} />
    );

    return (
        <View style={[styles.stripPlayerBlock, align === 'left' ? styles.alignLeft : styles.alignRight]}>
            <TouchableOpacity
                activeOpacity={0.7}
                onPress={handlePress}
                style={{ position: 'relative' }} // Anchor for toast
            >
                {/* Toast Overlay */}
                <InfoToastCard
                    visible={toastVisible}
                    name={name}
                    title={title}
                    rating={rating}
                    flagEmoji={flag}
                    align={align}
                />

                <View style={[styles.stripNameRow, align === 'right' && { justifyContent: 'flex-end' }]}>
                    {flagDisplay}
                    {title && <Capsule variant="title">{title}</Capsule>}

                    <Text style={styles.stripName} numberOfLines={1}>
                        {name}
                    </Text>
                </View>
                <View style={styles.stripStatsRow}>
                    <Text style={styles.stripRating}>{rating || '--'}</Text>
                    <Text style={styles.stripTime}>{formattedClock || '--'}</Text>
                </View>
            </TouchableOpacity>
        </View>
    );
});

const PlayerStrip = memo(({
    whiteName, whiteTitle, whiteFederation, whiteRating, whiteClock,
    blackName, blackTitle, blackFederation, blackRating, blackClock,
    result
}: {
    whiteName: string; whiteTitle?: string; whiteFederation?: string; whiteRating?: number; whiteClock?: string;
    blackName: string; blackTitle?: string; blackFederation?: string; blackRating?: number; blackClock?: string;
    result?: string;
}) => {
    return (
        <View style={styles.playerStrip}>
            {/* White Player (Left) */}
            <PlayerInfoBlock
                name={whiteName}
                title={whiteTitle}
                federation={whiteFederation}
                rating={whiteRating}
                clock={whiteClock}
                align="left"
                isWhite={true}
            />

            {/* Center Result */}
            <View style={styles.stripCenter}>
                <Text style={styles.stripCenterText}>{result}</Text>
            </View>

            {/* Black Player (Right) */}
            <PlayerInfoBlock
                name={blackName}
                title={blackTitle}
                federation={blackFederation}
                rating={blackRating}
                clock={blackClock}
                align="right"
                isWhite={false}
            />
        </View>
    );
});

export default function GameScreen({ route, navigation }: Props) {
    const {
        tournamentName,
        round,
        whiteName,
        blackName,
        whiteTitle,
        blackTitle,
        whiteFederation,
        blackFederation,
        whiteRating,
        blackRating,
        whiteClock,
        blackClock,
        whiteResult,
        blackResult,
        isLive,
        fen,
        lastMove,
        evalCp,
        gameId, // Assuming gameId is passed in route.params
        tournamentSlug,
        pgn: initialPgn, // Rename to avoid conflict with history logic
    } = route.params;

    // Polling for live updates (Silent)
    // tournamentSlug comes from route.params above
    const { games: liveGames } = usePollTournamentGames(tournamentSlug);
    const liveGame = liveGames.find(g => g.gameId === gameId);

    // Merge live data or fall back to initial params
    const activePgn = liveGame?.pgn || initialPgn;
    const activeWhiteClock = liveGame?.whiteClock || whiteClock;
    const activeBlackClock = liveGame?.blackClock || blackClock;
    const activeWhiteResult = liveGame?.whiteResult || whiteResult;
    const activeBlackResult = liveGame?.blackResult || blackResult;
    const activeIsLive = liveGame ? liveGame.isLive : isLive;
    const activeEvalCp = liveGame?.scoreCp ?? liveGame?.evalCp ?? evalCp;

    const [menuDropdownVisible, setMenuDropdownVisible] = useState(false);
    const [aboutModalVisible, setAboutModalVisible] = useState(false);
    const [isGameSaved, setIsGameSaved] = useState(false);
    const [isBoardFlipped, setIsBoardFlipped] = useState(false);
    const [isLiveMode, setIsLiveMode] = useState(true);

    // Variation State (Web-Parity)
    // "Variation" = a manual branch starting from a specific ply.
    // Supports multiple branches (lines) from the same anchor.
    type VariationLine = {
        id: string;             // Unique ID for the line
        moves: Move[];          // Full list of moves for this line (from anchor)
        fenHistory: string[];   // FENs corresponding to moves
    };

    type VariationRoot = {
        anchorPly: number;      // The ply where the branch started (e.g. 24)
        activeLineId: string;   // Currently active branch
        lines: VariationLine[]; // List of all branches
    };

    const [variation, setVariation] = useState<VariationRoot | null>(null);

    const [selectedSquare, setSelectedSquare] = useState<string | null>(null);
    const [validMoves, setValidMoves] = useState<string[]>([]);

    // Independent Chess instance for analysis/variation logic
    const analysisChessRef = useRef(new Chess());

    const [currentMoveIndex, setCurrentMoveIndex] = useState(0);
    const [showEval, setShowEval] = useState(false);
    const [activeTab, setActiveTab] = useState<TabType>('notation');
    const { width } = useWindowDimensions();
    // Debug state for touch interaction




    const { history: gameHistory, lastPly, startFen } = useMemo(() => {
        const c = new Chess();
        const cleanPgn = initialPgn || '';

        try {
            // Load PGN to extract moves
            c.loadPgn(cleanPgn);
        } catch (e) {
            console.warn('PGN Parse Error:', e);
        }

        const moves = c.history({ verbose: true });
        const historyWithFen: Move[] = [];
        const replay = new Chess(); // Replay to generate FENs

        moves.forEach((m: any, index: number) => {
            try {
                replay.move(m);
                historyWithFen.push({
                    ply: index + 1,
                    san: m.san,
                    fen: replay.fen(),
                    from: m.from,
                    to: m.to,
                    color: m.color,
                    moveNumber: Math.floor(index / 2) + 1,
                });
            } catch (e) {
                console.warn('Move replay error', e);
            }
        });

        // If game is empty/new, lastPly is 0
        return {
            history: historyWithFen,
            lastPly: historyWithFen.length,
            startFen: 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1'
        };
    }, [activePgn]);

    // Sync isLiveMode with latest move
    useEffect(() => {
        if (isLiveMode) {
            setCurrentMoveIndex(lastPly);
        }
    }, [isLiveMode, lastPly]);

    // -- Volume Navigation Logic --
    const [volumeNavEnabled, setVolumeNavEnabled] = useState<boolean | null>(null);
    const isRestoringVol = useRef(false);
    const initialVolumeRef = useRef<number>(0);
    // Keep a ref of state to use inside valid listener without re-binding
    const navStateRef = useRef({
        currentMoveIndex,
        lastPly,
        variation,
        isLiveMode
    });

    useEffect(() => {
        navStateRef.current = { currentMoveIndex, lastPly, variation, isLiveMode };
    }, [currentMoveIndex, lastPly, variation, isLiveMode]);

    // Load Preference
    useEffect(() => {
        AsyncStorage.getItem('volume_nav_enabled').then(val => {
            if (val !== null) setVolumeNavEnabled(val === 'true');
        });
    }, []);

    // Ask Permission (First Time)
    useFocusEffect(
        useCallback(() => {
            const timer = setTimeout(() => {
                AsyncStorage.getItem('volume_nav_enabled').then(val => {
                    if (val === null) {
                        Alert.alert(
                            "Enable Volume Navigation?",
                            "Do you want to use volume buttons to move through moves?",
                            [
                                {
                                    text: "No",
                                    style: "cancel",
                                    onPress: () => {
                                        setVolumeNavEnabled(false);
                                        AsyncStorage.setItem('volume_nav_enabled', 'false');
                                    }
                                },
                                {
                                    text: "Yes",
                                    onPress: () => {
                                        setVolumeNavEnabled(true);
                                        AsyncStorage.setItem('volume_nav_enabled', 'true');
                                    }
                                }
                            ]
                        );
                    }
                });
            }, 500);
            return () => clearTimeout(timer);
        }, [])
    );

    // Volume Listener
    useFocusEffect(
        useCallback(() => {
            if (volumeNavEnabled !== true) return;

            // Expo Go Safeguard
            const isExpoGo = Constants.executionEnvironment === ExecutionEnvironment.StoreClient;
            if (isExpoGo) {
                // Friendly dev warning only
                return;
            }

            let cleaner: any;

            const initVolumeListener = async () => {
                try {
                    const vol = await VolumeManager.getVolume();
                    const baselineVol = typeof vol === 'object' ? vol.volume : vol;
                    initialVolumeRef.current = baselineVol;

                    cleaner = VolumeManager.addVolumeListener((result) => {
                        if (isRestoringVol.current) {
                            isRestoringVol.current = false;
                            return;
                        }

                        const newVol = result.volume;
                        const oldVol = initialVolumeRef.current;

                        // Threshold to avoid noise
                        if (Math.abs(newVol - oldVol) < 0.0001) return;

                        if (newVol > oldVol) {
                            // UP -> Next
                            const state = navStateRef.current;
                            let maxIdx = state.lastPly;
                            if (state.variation) {
                                const activeLine = state.variation.lines.find(l => l.id === state.variation!.activeLineId);
                                if (activeLine) maxIdx = state.variation!.anchorPly + activeLine.moves.length;
                            }
                            if (state.currentMoveIndex < maxIdx) {
                                setCurrentMoveIndex(state.currentMoveIndex + 1);
                                setIsLiveMode(false);
                                if (__DEV__) console.log("Volume UP -> Move Next");
                            }
                        } else {
                            // DOWN -> Prev
                            const state = navStateRef.current;
                            if (state.currentMoveIndex > 0) {
                                setCurrentMoveIndex(state.currentMoveIndex - 1);
                                setIsLiveMode(false);
                                if (__DEV__) console.log("Volume DOWN -> Move Prev");
                            }
                        }

                        // Restore volume
                        isRestoringVol.current = true;
                        VolumeManager.setVolume(oldVol).catch(() => { });
                    });

                    // Hide native UI
                    VolumeManager.showNativeVolumeUI({ enabled: false });

                } catch (e) {
                    console.warn("Error init volume listener", e);
                }
            };

            initVolumeListener();

            return () => {
                if (cleaner) cleaner.remove();
                if (!isExpoGo) {
                    VolumeManager.showNativeVolumeUI({ enabled: true });
                }
            };
        }, [volumeNavEnabled])
    );


    // Effect: Reset variation when game changes
    useEffect(() => {
        setVariation(null);
        setSelectedSquare(null);
        setValidMoves([]);
    }, [gameId]);

    // Calculate display FEN based on currentMoveIndex
    const displayFen = useMemo(() => {
        // 1. If in variation territory (Variation active AND index > anchor)
        if (variation && currentMoveIndex > variation.anchorPly) {
            const activeLine = variation.lines.find(l => l.id === variation.activeLineId);
            if (activeLine) {
                const relIndex = currentMoveIndex - variation.anchorPly - 1; // 0-based index in variation
                if (relIndex >= 0 && relIndex < activeLine.fenHistory.length) {
                    return activeLine.fenHistory[relIndex];
                }
            }
        }

        // 2. Default: Main game history
        if (currentMoveIndex === 0) return startFen;
        // Safety: ensure history index is valid
        if (currentMoveIndex <= gameHistory.length) {
            return gameHistory[currentMoveIndex - 1]?.fen || startFen;
        }

        // Fallback
        return startFen;
    }, [currentMoveIndex, gameHistory, startFen, variation]);

    // Calculate displayed last move (UCI) for highlighting
    const displayedLastMove = useMemo(() => {
        // 1. Variation move
        if (variation && currentMoveIndex > variation.anchorPly) {
            const activeLine = variation.lines.find(l => l.id === variation.activeLineId);
            if (activeLine) {
                const relIndex = currentMoveIndex - variation.anchorPly - 1;
                if (relIndex >= 0) {
                    const manualMove = activeLine.moves[relIndex];
                    return manualMove ? (manualMove.from + manualMove.to) : undefined;
                }
            }
        }

        // 2. Main history move (or anchor move if we are AT the anchor but not deep in variation yet?)
        // If currentMoveIndex matches anchorPly, we show the move that led to that state.
        if (currentMoveIndex > 0) {
            const move = gameHistory[currentMoveIndex - 1]; // Main history
            if (move && move.from && move.to) {
                return move.from + move.to;
            }
        }
        return undefined;
    }, [currentMoveIndex, gameHistory, variation]);

    // Navigation handlers
    const handleJumpToMove = (ply: number) => {
        setIsLiveMode(false);
        setCurrentMoveIndex(ply);
        setSelectedSquare(null);
        setValidMoves([]);
    };

    // NEW: Handle jumping to a specific variation line
    // If user taps a move in a specific line, we must set that line as active
    const handleJumpToVariationMove = (lineId: string, ply: number) => {
        setVariation(prev => {
            if (!prev) return null;
            return {
                ...prev,
                activeLineId: lineId
            };
        });
        setIsLiveMode(false);
        setCurrentMoveIndex(ply);
        setSelectedSquare(null);
        setValidMoves([]);
    };

    const clearVariation = () => {
        setVariation(null);
        setSelectedSquare(null);
        setValidMoves([]);
    };

    // Handle Square Press (Tap-to-move)
    const handleMove = (from: string, to: string) => {
        console.log('handleMove called', from, to);

        // 1. Initialize Chess instance with current display FEN
        try {
            if (analysisChessRef.current.fen() !== displayFen) {
                analysisChessRef.current.load(displayFen);
            }
        } catch (e) { /* fallback */ }

        const chess = analysisChessRef.current;

        try {
            const move = chess.move({ from, to, promotion: 'q' });

            if (move) {
                console.log('Move successful', move.san);
                const newFen = chess.fen();
                const newSan = move.san;

                setIsLiveMode(false);
                setSelectedSquare(null);
                setValidMoves([]);
                soundManager.playMove(move.flags.includes('c') ? 'capture' : 'move' as any);

                // 2. State Update: Variation
                setVariation(prev => {
                    const newId = Date.now().toString(); // Simple ID generation
                    const absolutePly = currentMoveIndex + 1; // The ply index AFTER this move is made

                    const newMoveObj = {
                        ply: absolutePly,
                        san: newSan,
                        uci: move.from + move.to,
                        fen: newFen,
                        from: move.from,
                        to: move.to,
                        color: move.color,
                        moveNumber: Math.floor((absolutePly - 1) / 2) + 1,
                    } as unknown as Move;

                    if (!prev) {
                        // Scenario A: Starting a NEW variation root (Line 0)
                        setCurrentMoveIndex(absolutePly);
                        return {
                            anchorPly: currentMoveIndex,
                            activeLineId: newId,
                            lines: [{
                                id: newId,
                                moves: [newMoveObj],
                                fenHistory: [newFen]
                            }]
                        };
                    } else {
                        // Scenario B: Extending existing variation structure
                        // Find current active line to determine context
                        const activeLine = prev.lines.find(l => l.id === prev.activeLineId);

                        // Calculate where we are relative to the anchor
                        const currentRelIndex = currentMoveIndex - prev.anchorPly;

                        // CHECK DEDUPE:
                        // Before creating/branching, check if an existing line ALREADY has this move at this position.
                        // We are looking for a line where:
                        // 1. It shares the same prefix moves (up to currentRelIndex) as the active line (or empty if at anchor)
                        // 2. Its move at [currentRelIndex] matches newSan.

                        // Get prefix moves from active line (if any)
                        const prefixMoves = activeLine ? activeLine.moves.slice(0, currentRelIndex) : [];

                        const existingLine = prev.lines.find(line => {
                            // Must be at least long enough to contain the new move
                            if (line.moves.length <= currentRelIndex) return false;

                            // Check specific move match
                            if (line.moves[currentRelIndex].san !== newSan) return false;

                            // Check prefix match (ensure we are branching from same point)
                            // Optimization: If currentRelIndex is 0 (at anchor), prefix is empty, always matches.
                            if (currentRelIndex === 0) return true;

                            // Compare prefixes
                            for (let i = 0; i < currentRelIndex; i++) {
                                if (line.moves[i].san !== prefixMoves[i].san) return false;
                            }
                            return true;
                        });

                        if (existingLine) {
                            // FOUND DUPLICATE/EXISTING BRANCH
                            // Switch to it instead of creating new
                            console.log('Deduped: Switching to existing line', existingLine.id);
                            setCurrentMoveIndex(absolutePly);
                            return {
                                ...prev,
                                activeLineId: existingLine.id
                            };
                        }

                        // If no duplicate found, proceed to Append or Branch

                        if (activeLine) {
                            const lineEndPly = prev.anchorPly + activeLine.moves.length;

                            if (currentMoveIndex === lineEndPly) {
                                // APPEND to current line
                                const updatedLine = {
                                    ...activeLine,
                                    moves: [...activeLine.moves, newMoveObj],
                                    fenHistory: [...activeLine.fenHistory, newFen]
                                };

                                setCurrentMoveIndex(absolutePly);
                                return {
                                    ...prev,
                                    lines: prev.lines.map(l => l.id === prev.activeLineId ? updatedLine : l)
                                };
                            } else {
                                // BRANCH from inside current line
                                const relIndex = currentMoveIndex - prev.anchorPly;
                                const prefixMoves = activeLine.moves.slice(0, relIndex);
                                const prefixFens = activeLine.fenHistory.slice(0, relIndex);

                                const newLine: VariationLine = {
                                    id: newId,
                                    moves: [...prefixMoves, newMoveObj],
                                    fenHistory: [...prefixFens, newFen]
                                };

                                setCurrentMoveIndex(absolutePly);
                                return {
                                    ...prev,
                                    activeLineId: newId,
                                    lines: [...prev.lines, newLine]
                                };
                            }
                        }

                        // Fallback (should not happen if activeLine logic holds)
                        return prev;
                    }
                });

            } else {
                console.log('Move failed in chess.js');
            }
        } catch (e) {
            console.log('Move exception', e);
        }
    };

    // ... handleSquarePress ... (omitted, assuming it uses handleMove)

    // Handle Square Press
    const handleSquarePress = (square: string) => {
        // If we already have a selection
        if (selectedSquare) {
            // Case 1: Tapping the SAME square -> Deselect
            if (selectedSquare === square) {
                setSelectedSquare(null);
                setValidMoves([]);
                return;
            }

            // Case 2: Tapping a VALID TARGET square -> Move
            // We use the pre-calculated validMoves for reliability
            if (validMoves.includes(square)) {
                handleMove(selectedSquare, square);
                return;
            }

            // Case 3: Tapping a DIFFERENT piece (that might be own color) or Invalid Square
            // If it's a piece of our color, select it. otherwise deselect.
            // We reuse selectPiece logic which handles color checking.
            selectPiece(square);
        } else {
            // Case 4: No selection -> Try to select
            selectPiece(square);
        }
    };

    const selectPiece = (square: string) => {
        const chess = analysisChessRef.current;

        // Ensure chess instance is loaded with current display FEN
        // We do this every time to be safe across history jumps
        if (chess.fen() !== displayFen) {
            try {
                chess.load(displayFen);
            } catch (e) {
                console.warn('Failed to load displayFen for selection', displayFen);
                return;
            }
        }

        const piece = chess.get(square as any);

        // Only allow selecting own pieces
        if (piece && piece.color === chess.turn()) {
            setSelectedSquare(square);
            const moves = chess.moves({ square: square as any, verbose: true });
            setValidMoves(moves.map(m => m.to));
        } else {
            setSelectedSquare(null);
            setValidMoves([]);
        }
    };

    // Determine side to move from FEN (default is white if FEN parsing fails)
    const sideToMove = displayFen.split(' ')[1] === 'b' ? 'black' : 'white';

    // Calculate board size
    const SCREEN_PADDING = 32;
    const MIN_BOARD_SIZE = 250;
    const MAX_BOARD_SIZE = 500;
    // Reduce board size when eval bar is shown to create space for wider bar
    const EVAL_BAR_SPACE = showEval ? 24 : 0;
    const boardSize = Math.max(MIN_BOARD_SIZE, Math.min(width - SCREEN_PADDING - EVAL_BAR_SPACE, MAX_BOARD_SIZE));

    // Determine result string
    // Determine result string
    let gameResult = '—'; // Default em dash
    if (!activeIsLive) {
        if (activeWhiteResult && activeBlackResult) {
            gameResult = `${activeWhiteResult}—${activeBlackResult}`;
        } else if (activeWhiteResult) {
            gameResult = activeWhiteResult.replace('-', '—'); // Fallback if strictly combined string
        } else if (activeBlackResult) {
            gameResult = activeBlackResult.replace('-', '—');
        }
    }

    const handleSaveGame = () => {
        setIsGameSaved(!isGameSaved);
        setMenuDropdownVisible(false);
        Alert.alert(
            isGameSaved ? 'Game Unsaved' : 'Game Saved',
            isGameSaved ? 'Game removed from saved games' : 'Game added to saved games'
        );
    };

    return (
        <View style={styles.container}>
            <StatusBar style="light" />

            {/* Header */}
            <View style={styles.header}>
                {/* Left: Hamburger Icon */}
                <TouchableOpacity
                    style={styles.iconButton}
                    onPress={() => Alert.alert('Navigation', 'Hamburger menu coming soon')}
                >
                    <Ionicons name="menu" size={24} color="#fff" />
                </TouchableOpacity>

                {/* Center: 2-row title (no truncation) */}
                <View style={styles.headerCenter}>
                    <Text style={styles.headerTitle1}>
                        Tata Steel Chess
                    </Text>
                    <Text style={styles.headerTitle2}>
                        Tournament 2026 • Round {round}
                    </Text>
                </View>

                {/* Right: Video Icon + Menu */}
                <View style={styles.headerRight}>
                    <TouchableOpacity
                        style={styles.iconButtonCompact}
                        onPress={() => Alert.alert('Broadcast', 'Broadcast view coming soon')}
                    >
                        <Ionicons name="videocam" size={22} color="#fff" />
                    </TouchableOpacity>

                    <TouchableOpacity
                        style={styles.iconButtonCompact}
                        onPress={() => setMenuDropdownVisible(true)}
                    >
                        <Ionicons name="ellipsis-vertical" size={20} color="#fff" />
                    </TouchableOpacity>
                </View>
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


                        <TouchableOpacity
                            style={styles.dropdownItem}
                            onPress={() => {
                                setMenuDropdownVisible(false);
                                navigation.navigate('Settings');
                            }}
                        >
                            <Ionicons name="settings-outline" size={18} color="#fff" style={styles.menuIcon} />
                            <Text style={styles.dropdownItemText}>Settings</Text>
                        </TouchableOpacity>

                        <TouchableOpacity
                            style={styles.dropdownItem}
                            onPress={() => {
                                setMenuDropdownVisible(false);
                                Alert.alert('Share Link', 'Share game link coming soon');
                            }}
                        >
                            <Ionicons name="link-outline" size={18} color="#fff" style={styles.menuIcon} />
                            <Text style={styles.dropdownItemText}>Share game link</Text>
                        </TouchableOpacity>

                        <TouchableOpacity
                            style={styles.dropdownItem}
                            onPress={() => {
                                setMenuDropdownVisible(false);
                                Alert.alert('Share PGN', 'Share game PGN coming soon');
                            }}
                        >
                            <Ionicons name="document-text-outline" size={18} color="#fff" style={styles.menuIcon} />
                            <Text style={styles.dropdownItemText}>Share game PGN</Text>
                        </TouchableOpacity>

                        <TouchableOpacity
                            style={styles.dropdownItem}
                            onPress={handleSaveGame}
                        >
                            <Ionicons
                                name={isGameSaved ? "heart" : "heart-outline"}
                                size={18}
                                color="#fff"
                                style={styles.menuIcon}
                            />
                            <Text style={styles.dropdownItemText}>Save game</Text>
                        </TouchableOpacity>

                        <TouchableOpacity
                            style={styles.dropdownItem}
                            onPress={() => {
                                setMenuDropdownVisible(false);
                                navigation.navigate('Help');
                            }}
                        >
                            <Ionicons name="help-circle-outline" size={18} color="#fff" style={styles.menuIcon} />
                            <Text style={styles.dropdownItemText}>Help</Text>
                        </TouchableOpacity>

                        <TouchableOpacity
                            style={[styles.dropdownItem, styles.dropdownItemLast]}
                            onPress={() => {
                                setMenuDropdownVisible(false);
                                setAboutModalVisible(true);
                            }}
                        >
                            <Ionicons name="information-circle-outline" size={18} color="#fff" style={styles.menuIcon} />
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

            {/* Game Content: White Player → Board → Player-to-Move → Controls */}
            <View style={styles.content}>
                {/* Player Strip - Consolidating both players above board */}
                <PlayerStrip
                    whiteName={whiteName}
                    whiteTitle={whiteTitle}
                    whiteFederation={whiteFederation}
                    whiteRating={whiteRating}
                    whiteClock={activeWhiteClock}
                    blackName={blackName}
                    blackTitle={blackTitle}
                    blackFederation={blackFederation}
                    blackRating={blackRating}
                    blackClock={activeBlackClock}
                    result={gameResult}
                />

                {/* Chess Board + Eval Bar */}
                <View style={styles.boardContainer}>
                    <View style={styles.boardWithEval}>
                        <MiniBoard
                            fen={displayFen}
                            size={boardSize}
                            lastMove={displayedLastMove}
                            flipped={isBoardFlipped}
                            onSquarePress={handleSquarePress}
                            onMove={handleMove}
                            selectedSquare={selectedSquare}
                            validMoves={validMoves}
                        />



                        {/* Eval Bar - conditionally visible */}
                        {showEval && (
                            <View style={styles.evalBarContainer}>
                                <EvalBar
                                    evalCp={activeEvalCp}
                                    height={boardSize}
                                    flipped={isBoardFlipped}
                                />
                            </View>
                        )}
                    </View>
                </View>

                {/* Removed bottom PlayerRow as strictly requested to consolidate top area. 
                    If user wanted to keep it, we would uncomment this, but visual design implies replacement. 
                */}

                {/* Game Controls Bar */}
                <View style={styles.controlsBar}>
                    {/* Left: Evaluation Gauge (with larger gap after) */}
                    <TouchableOpacity
                        style={[
                            styles.controlButton,
                            showEval && styles.controlButtonActive
                        ]}
                        onPress={() => setShowEval(!showEval)}
                        hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
                    >
                        <Activity size={18} color="#fff" />
                    </TouchableOpacity>

                    {/* Center: Navigation Controls (tight cluster) */}
                    <View style={styles.navigationControls}>
                        <TouchableOpacity
                            style={styles.controlButton}
                            onPress={() => {
                                if (currentMoveIndex > 0) {
                                    setCurrentMoveIndex(currentMoveIndex - 1);
                                    setIsLiveMode(false);
                                }
                            }}
                            hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
                        >
                            <Ionicons name="chevron-back" size={18} color="#fff" />
                        </TouchableOpacity>

                        <TouchableOpacity
                            style={[
                                styles.livePill,
                                (currentMoveIndex === lastPly) && styles.livePillAtLive
                            ]}
                            onPress={() => {
                                // Jump to latest position AND clear manual/local moves
                                setIsLiveMode(true);
                                clearVariation();
                                setCurrentMoveIndex(lastPly);
                            }}
                        >
                            <Text style={[
                                styles.liveText,
                                (currentMoveIndex === lastPly) && styles.liveTextAtLive
                            ]}>LIVE</Text>
                        </TouchableOpacity>

                        <TouchableOpacity
                            style={styles.controlButton}
                            onPress={() => {
                                // Determine max index based on whether we are in a variation
                                let maxIdx = lastPly;
                                if (variation) {
                                    const activeLine = variation.lines.find(l => l.id === variation.activeLineId);
                                    if (activeLine) {
                                        maxIdx = variation.anchorPly + activeLine.moves.length;
                                    }
                                }

                                // Guard: prevent wrapping past the last move
                                if (currentMoveIndex >= maxIdx) return;

                                setCurrentMoveIndex(currentMoveIndex + 1);
                                setIsLiveMode(false);
                            }}
                            hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
                        >
                            <Ionicons name="chevron-forward" size={18} color="#fff" />
                        </TouchableOpacity>
                    </View>

                    {/* Right: Flip Board (with larger gap before) */}
                    <TouchableOpacity
                        style={styles.controlButton}
                        onPress={() => setIsBoardFlipped(!isBoardFlipped)}
                        hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
                    >
                        <Ionicons name="reload-outline" size={18} color="#fff" />
                    </TouchableOpacity>
                </View>

                {/* Tabs */}
                <GameTabs activeTab={activeTab} onTabChange={setActiveTab} />

                {/* Tab Content Placeholder */}
                <View style={styles.tabContent}>
                    {activeTab === 'notation' && (
                        <NotationView
                            moves={gameHistory as Move[]}
                            currentPly={currentMoveIndex}
                            onJumpToMove={handleJumpToMove}
                            variation={variation}
                            onClearVariation={clearVariation}
                            onJumpToVariationMove={handleJumpToVariationMove}
                        />
                    )}
                    {activeTab === 'engine' && (
                        <EngineView fen={displayFen} isLiveMode={activeIsLive} />
                    )}
                    {activeTab === 'commentary' && (
                        <Text style={styles.placeholderText}>Live Commentary Feed</Text>
                    )}
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
        paddingTop: 44,
        paddingBottom: 12,
        paddingHorizontal: 16,
        backgroundColor: broadcastTheme.colors.background,
        borderBottomWidth: 1,
        borderBottomColor: broadcastTheme.colors.borderDefault,
    },
    headerCenter: {
        flex: 1,
        marginHorizontal: 8,
        alignItems: 'center',
        justifyContent: 'center',
    },
    headerTitle1: {
        fontSize: 13,
        fontWeight: '700',
        color: broadcastTheme.colors.slate50,
        textAlign: 'center',
    },
    headerTitle2: {
        fontSize: 13,
        fontWeight: '700',
        color: broadcastTheme.colors.slate50,
        textAlign: 'center',
        marginTop: 2,
    },
    headerRight: {
        flexDirection: 'row',
        gap: 4,
        alignItems: 'center',
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
        minWidth: 200,
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 4 },
        shadowOpacity: 0.3,
        shadowRadius: 8,
        elevation: 8,
    },
    dropdownItem: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        paddingVertical: 14,
        paddingHorizontal: 16,
        borderBottomWidth: 1,
        borderBottomColor: broadcastTheme.colors.borderDefault,
    },
    dropdownItemLast: {
        borderBottomWidth: 0,
    },
    menuIcon: {
        marginRight: 12,
    },
    dropdownItemText: {
        fontSize: 14,
        fontWeight: '500',
        color: broadcastTheme.colors.slate50,
    },
    menuRow: {
        flex: 1,
        flexDirection: 'row',
        alignItems: 'center',
    },
    content: {
        flex: 1,
        alignItems: 'center',
        justifyContent: 'flex-start',
        padding: 12,
        paddingTop: 8,
    },
    playerRowContainer: {
        width: '100%',
        alignItems: 'center',
        paddingVertical: 4,
    },
    playerToMoveContainer: {
        width: '100%',
        alignItems: 'center',
        paddingVertical: 2,
        paddingTop: 6,
    },
    boardContainer: {
        marginTop: 8,
        marginBottom: 5, // Reduced from 8
        borderRadius: broadcastTheme.radii.lg,
        overflow: 'visible', // Allow eval bar to show
    },
    boardWithEval: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 2, // Reduced gap (from 8) to bring board and bar close
        borderRadius: broadcastTheme.radii.lg,
        // overflow: 'hidden', // Removed to allow eval label to show fully
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 4 },
        shadowOpacity: 0.3,
        shadowRadius: 8,
        elevation: 8,
    },
    evalBarContainer: {
        opacity: 1,
        marginLeft: 0, // Removed extra spacing
    },
    // Player row styles (matching tournament cards)
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
        minWidth: 0,
    },
    flag: {
        fontSize: 13,
        lineHeight: 15,
    },
    playerName: {
        fontSize: 15,
        fontWeight: '600',
        color: broadcastTheme.colors.slate50,
        flex: 1,
        minWidth: 50,
    },
    rating: {
        fontSize: 12,
        fontWeight: '600',
        color: broadcastTheme.colors.slate400,
    },
    displayValue: {
        fontSize: 13,
        fontWeight: '700',
        color: broadcastTheme.colors.sky400,
        fontVariant: ['tabular-nums'],
        marginLeft: 8,
    },
    // Game Controls Bar
    controlsBar: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        paddingVertical: 10, // Reduced from 12 (overall 25% gap reduction)
        paddingHorizontal: 16,
        backgroundColor: broadcastTheme.colors.background,
        width: '100%',
        gap: 16,
    },
    controlButton: {
        width: 36, // Scaled down from 44 (~20%)
        height: 36,
        borderRadius: 18,
        backgroundColor: 'rgba(255, 255, 255, 0.05)',
        borderWidth: 1,
        borderColor: 'rgba(255, 255, 255, 0.1)',
        alignItems: 'center',
        justifyContent: 'center',
    },
    controlButtonActive: {
        backgroundColor: 'rgba(5, 150, 105, 0.3)', // emerald-600/30
        borderColor: 'rgba(16, 185, 129, 0.4)', // emerald-500
    },
    navigationControls: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 6, // Tightened gap for unified group feel (was 8)
        flex: 1,
        justifyContent: 'center',
    },
    livePill: {
        height: 36, // Match button height (was 44)
        paddingHorizontal: 12, // Slightly reduced padding
        borderRadius: 18, // Match button radius
        backgroundColor: 'rgba(16, 185, 129, 0.1)',
        borderWidth: 1,
        borderColor: 'rgba(52, 211, 153, 0.4)', // emerald-400
        alignItems: 'center',
        justifyContent: 'center',
        minWidth: 60, // Reduced minWidth (was 70)
    },
    livePillAtLive: {
        backgroundColor: 'rgba(30, 41, 59, 0.4)', // slate-800
        borderColor: 'rgba(255, 255, 255, 0.1)',
    },
    liveText: {
        fontSize: 12, // Scaled down slightly (was 13)
        fontWeight: '700',
        color: '#34d399', // emerald-400
        letterSpacing: 0.5,
    },
    liveTextAtLive: {
        color: broadcastTheme.colors.slate400,
    },
    tabContent: {
        flex: 1,
        width: '100%',
        justifyContent: 'flex-start',
        padding: 0, // Remove padding to allow child to handle it
    },
    placeholderText: {
        color: premiumTheme.colors.textSecondary,
        fontSize: 14,
        fontStyle: 'italic',
    },
    // NEW Player Strip Styles
    playerStrip: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        width: '100%',
        paddingHorizontal: 12,
        paddingBottom: 4, // Tighter spacing to board
    },
    stripPlayerBlock: {
        flex: 1,
        minWidth: 0,
        gap: 0, // Very tight rows
    },
    alignLeft: {
        alignItems: 'flex-start',
        paddingRight: 8,
    },
    alignRight: {
        alignItems: 'flex-end',
        paddingLeft: 8,
    },
    stripNameRow: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 5,
        width: '100%',
        height: 20, // Fixed height for alignment
    },
    stripName: {
        fontSize: 14,
        fontWeight: '700',
        color: broadcastTheme.colors.slate50,
        flexShrink: 1,
        lineHeight: 18,
    },
    stripFlag: {
        fontSize: 14,
        lineHeight: 18,
    },
    stripFlagPlaceholder: {
        width: 14,
        height: 14,
        borderRadius: 7,
        backgroundColor: broadcastTheme.colors.slate700,
    },
    stripStatsRow: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 6,
        height: 18, // Fixed height for alignment
    },
    stripRating: {
        fontSize: 11,
        fontWeight: '500',
        color: broadcastTheme.colors.slate400,
        lineHeight: 16,
    },
    stripTime: {
        fontSize: 12,
        fontWeight: '600',
        color: broadcastTheme.colors.slate300,
        fontVariant: ['tabular-nums'],
        lineHeight: 16,
    },
    stripCenter: {
        alignItems: 'center',
        justifyContent: 'center',
        minWidth: 52,
        paddingHorizontal: 8,
        paddingVertical: 2,
        backgroundColor: 'rgba(255, 255, 255, 0.05)',
        borderRadius: 8,
        borderWidth: 1,
        borderColor: 'rgba(255, 255, 255, 0.1)',
        marginHorizontal: 4,
    },
    stripCenterText: {
        fontSize: 13,
        fontWeight: '700',
        color: broadcastTheme.colors.slate200,
        fontVariant: ['tabular-nums'],
    },
});

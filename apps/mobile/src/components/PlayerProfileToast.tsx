import React, { memo, useEffect, useRef, useMemo } from 'react';
import { StyleSheet, Text, View, Animated, Easing, useWindowDimensions, LayoutRectangle } from 'react-native';
import { premiumTheme } from '../theme/premiumTheme';
import { broadcastTheme } from '../theme/broadcastTheme';
import Capsule from './Capsule';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

export interface PlayerData {
    name: string;
    title?: string;
    rating?: number;
    flagEmoji?: string;
}

export interface PlayerProfileToastProps {
    visible: boolean;
    data: PlayerData;
    anchorLayout?: LayoutRectangle;
}

const TOAST_WIDTH = 220; // Slightly wider for better text flow
const TOAST_HEIGHT = 80; // Estimated
const PADDING = 12;

const PlayerProfileToast = memo(({ visible, data, anchorLayout }: PlayerProfileToastProps) => {
    const { width: windowWidth, height: windowHeight } = useWindowDimensions();
    const insets = useSafeAreaInsets();
    const opacity = useRef(new Animated.Value(0)).current;

    // Scale animation pop-in
    const scale = useRef(new Animated.Value(0.9)).current;

    useEffect(() => {
        if (visible) {
            Animated.parallel([
                Animated.timing(opacity, {
                    toValue: 1,
                    duration: 200,
                    useNativeDriver: true,
                    easing: Easing.out(Easing.ease),
                }),
                Animated.spring(scale, {
                    toValue: 1,
                    useNativeDriver: true,
                    speed: 20,
                    bounciness: 4,
                })
            ]).start();

            if (__DEV__ && anchorLayout) {
                console.log(`[PlayerToast] Showing for ${data.name}`);
            }
        } else {
            Animated.timing(opacity, {
                toValue: 0,
                duration: 150,
                useNativeDriver: true,
                easing: Easing.in(Easing.ease),
            }).start(() => {
                scale.setValue(0.9);
            });
        }
    }, [visible]);

    // Compute Position
    const positionStyle = useMemo(() => {
        if (!anchorLayout) return { top: -999, left: 0 }; // Hide offscreen if no anchor

        const { x, y, width, height } = anchorLayout;

        // 1. Determine X (Horizontal)
        // Center text horizontally relative to anchor
        let left = x + (width / 2) - (TOAST_WIDTH / 2);

        // Clamp X to safe bounds
        const minX = insets.left + PADDING;
        const maxX = windowWidth - insets.right - TOAST_WIDTH - PADDING;

        let clamped = false;
        if (left < minX) {
            left = minX;
            clamped = true;
        } else if (left > maxX) {
            left = maxX;
            clamped = true;
        }

        // 2. Determine Y (Vertical) - Above or Below?
        // Prefer above
        const spaceAbove = y - insets.top;
        const spaceBelow = windowHeight - (y + height) - insets.bottom;

        let top = 0;
        let placement = 'above';

        // Check if fits above (need approx 90px space)
        if (spaceAbove > TOAST_HEIGHT + 10) {
            top = y - TOAST_HEIGHT - 6; // 6px gap
            placement = 'above';
        } else {
            top = y + height + 6;
            placement = 'below';
        }

        if (__DEV__) {
            console.log(`[PlayerToast] x=${Math.round(left)} y=${Math.round(top)} placement=${placement} clamped=${clamped}`);
        }

        return {
            left,
            top,
        };
    }, [anchorLayout, windowWidth, windowHeight, insets]);

    if (!visible && opacity['_value'] === 0) return null; // Optimization? Actually pointerEvents box-none handles it usually but safe to render null if fully hidden/unmounted logic is preferred. 
    // However, keeping it mounted with 0 opacity allows animation out. 
    // We'll rely on global `visible` prop to control mounting in parent if needed, or just layout here.

    // Actually, if we want to unmount after animation, we need internal state.
    // For now, let's keep it simple: always rendered if parent says visible OR animating.
    // But Parent controls `visible`. 

    return (
        <Animated.View
            style={[
                styles.container,
                positionStyle,
                { opacity, transform: [{ scale }] }
            ]}
            pointerEvents="none" // Pass touches through? No, toast usually blocks touches to internal content, but let's allow "touch outside" to dismiss. 
        // Actually, specs say "Tap name again restarts".
        // Given it's absolute overlay, pointerEvents="box-none" on root needed? 
        // This view is the card itself. It SHOULD receive touches to prevent click-through maybe?
        // User said "Ensure skeleton does not trap touches" (for skeleton task).
        // For TOAST: "if user taps outside, dismiss".
        // We will handle dismiss in GameScreen via overlay press or just timeout.
        // Let's set pointerEvents="none" so user can tap "through" it? 
        // No, if it covers something, maybe we don't want that.
        // Let's stick effectively to just Visual for now.
        >
            <View style={styles.card}>
                <View style={styles.row}>
                    {data.flagEmoji ? (
                        <Text style={styles.flag}>{data.flagEmoji}</Text>
                    ) : (
                        <View style={styles.flagPlaceholder} />
                    )}

                    <View style={styles.info}>
                        <View style={styles.nameRow}>
                            {data.title && <Capsule variant="title">{data.title}</Capsule>}
                            <Text style={styles.name} numberOfLines={2}>
                                {data.name}
                            </Text>
                        </View>
                        {data.rating && (
                            <Text style={styles.rating}>
                                Rating: <Text style={styles.ratingValue}>{data.rating}</Text>
                            </Text>
                        )}
                    </View>
                </View>
            </View>
        </Animated.View>
    );
});

const styles = StyleSheet.create({
    container: {
        position: 'absolute',
        width: TOAST_WIDTH,
        zIndex: 9999, // High z-index to sit on top
        elevation: 10,
    },
    card: {
        backgroundColor: premiumTheme.colors.bgHeader, // Neutral-800
        borderRadius: premiumTheme.spacing.borderRadius,
        padding: 12,
        borderWidth: 1,
        borderColor: premiumTheme.colors.border, // Neutral-700
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 4 },
        shadowOpacity: 0.4,
        shadowRadius: 10,
        gap: 8,
    },
    row: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 12,
    },
    flag: {
        fontSize: 24,
    },
    flagPlaceholder: {
        width: 24,
        height: 24,
        borderRadius: 12,
        backgroundColor: premiumTheme.colors.bgSubtle,
    },
    info: {
        flex: 1,
        gap: 2,
    },
    nameRow: {
        flexDirection: 'row',
        flexWrap: 'wrap',
        alignItems: 'center',
        gap: 6,
    },
    name: {
        fontSize: 14,
        fontWeight: '700',
        color: premiumTheme.colors.textPrimary, // Neutral-100
        lineHeight: 18,
    },
    rating: {
        fontSize: 12,
        color: premiumTheme.colors.textSecondary, // Neutral-400
        fontWeight: '500',
    },
    ratingValue: {
        color: premiumTheme.colors.textPrimary,
        fontWeight: '600',
    }
});

export default PlayerProfileToast;
